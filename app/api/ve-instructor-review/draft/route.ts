/**
 * POST /api/ve-instructor-review/draft
 * Drafts an instructor report on one file a student uploaded to a standalone virtual experience.
 * Returns the draft only; nothing is saved. The instructor edits it in the Review panel and it is
 * stored when they submit the review (guided-project-progress, action 'review').
 */
import { NextRequest, NextResponse } from 'next/server';

import { requireRole, isAuthError } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { getRedis } from '@/lib/redis';
import { spendRateLimit } from '@/lib/rate-limit';
import { refundAiFeature, type AiFeatureReceipt } from '@/lib/ai-feature-gate';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { toPlainText } from '@/lib/plain-text';
import { lessonPlainText } from '@/lib/lesson-doc';
import { EXTRACTION_TIMEOUT_MS, extractFromWorkbook, withTimeout } from '@/lib/excel-workbook-extract';
import { ArchiveTooLargeError, assertZipWithinLimit, extractDocxText, extractPptxText } from '@/lib/office-text';
import { hasReportContent, normalizeInstructorReport, reportableRequirementIds } from '@/lib/ve-instructor-report';
import { normalizeReviewSheetNames } from '@/lib/excel-review-config';
import { repairVeSubmissionUrl } from '@/lib/ve-upload';

export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Sent to the model as the file itself.
const BINARY_MIME: Record<string, string> = {
  pdf:  'application/pdf',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
// Office files: unzipped and sent as extracted text.
const ZIP_TEXT_EXTS = new Set(['xlsx', 'docx', 'pptx']);
// Read as UTF-8 and sent as text.
const TEXT_EXTS = new Set(['txt', 'csv', 'py', 'js', 'ts', 'sql', 'html', 'css']);

// Read a response body, giving up (null) as soon as it passes maxBytes, so an oversized file is
// never held in memory whole. Content-Length is checked first but can be absent or wrong.
async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<ArrayBuffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}

// The shape the prompt promises: 3-5 quality dimensions and exactly 3 next steps. Stated in the
// schema for Gemini, and checked again after the call because the OpenAI fallback ignores schemas.
const DRAFT_CATEGORIES = { min: 3, max: 5 };
const DRAFT_RECOMMENDATIONS = 3;

const responseSchema = {
  type: 'object',
  properties: {
    score:   { type: 'number' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'improvement', 'suggestion'] },
          title:    { type: 'string' },
          detail:   { type: 'string' },
          fix:      { type: 'string' },
        },
        required: ['location', 'severity', 'title', 'detail', 'fix'],
      },
    },
    categories: {
      type: 'array',
      minItems: DRAFT_CATEGORIES.min,
      maxItems: DRAFT_CATEGORIES.max,
      items: {
        type: 'object',
        properties: {
          name:      { type: 'string' },
          score:     { type: 'number' },
          summary:   { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          gaps:      { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'score', 'summary', 'strengths', 'gaps'],
      },
    },
    recommendations: { type: 'array', minItems: DRAFT_RECOMMENDATIONS, maxItems: DRAFT_RECOMMENDATIONS, items: { type: 'string' } },
  },
  required: ['score', 'summary', 'findings', 'categories', 'recommendations'],
};

function buildPrompt(ctx: { veTitle: string; company: string; role: string; lessonTitle: string; missionContent: string; taskLabel: string; taskBrief: string; fileName: string }) {
  return `You are drafting a review report for an instructor. The instructor will check and edit it before the student sees it, so be accurate and specific; never invent content that is not in the submission.

The student completed a workplace simulation ("virtual experience") and uploaded a file for one of its tasks.

Virtual experience: ${ctx.veTitle}
${ctx.company ? `Company: ${ctx.company}\n` : ''}${ctx.role ? `Student role: ${ctx.role}\n` : ''}Mission: ${ctx.lessonTitle}
${ctx.missionContent ? `Mission content the student read before the task:\n${ctx.missionContent}\n\n` : ''}Task: ${ctx.taskLabel}
Task brief (as the student saw it):
${ctx.taskBrief || '(no brief provided)'}

Uploaded file: ${ctx.fileName}

Judge how well the file completes the task brief, as a senior professional in this field would.

Return:
- score: overall quality 0-100 (one decimal).
- summary: 2-3 sentences addressed to the student ("you") on how well the work meets the brief.
- findings: the specific issues and notable points. For each: location (where in the file, e.g. "Slide 3", "Sheet Sales, C4", "Section: Methodology"; "General" if not tied to one place), severity ("critical" = fails the brief, "improvement" = notable weakness, "suggestion" = refinement), title (short), detail (1-2 sentences), fix (one concrete action).
- categories: 3-5 quality dimensions suited to this task (e.g. Accuracy, Analysis depth, Communication), each scored 0-100 with a one-sentence summary, strengths and gaps.
- recommendations: exactly 3 highest-impact next steps, ordered by impact.`;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { user, role } = auth;

  const body = await req.json().catch(() => ({}));
  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
  const reqId = typeof body.reqId === 'string' ? body.reqId : '';
  if (!attemptId || !reqId) return NextResponse.json({ error: 'attemptId and reqId required' }, { status: 400 });

  const supabase = adminClient();
  const { data: attempt } = await supabase
    .from('guided_project_attempts')
    .select('ve_id, progress')
    .eq('id', attemptId)
    .single();
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  const { data: ve } = await supabase
    .from('virtual_experiences')
    .select('user_id, title, modules, company, role')
    .eq('id', attempt.ve_id)
    .single();
  // Same ownership rule as saving a review: the VE's author, or an admin.
  if (!ve || (ve.user_id !== user.id && role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!reportableRequirementIds(ve.modules).has(reqId)) {
    return NextResponse.json({ error: 'This step does not collect a file.' }, { status: 400 });
  }

  // Only fetch files from this VE's own submission folders in our public storage bucket, so a
  // crafted progress entry cannot point the server at an arbitrary URL. Both players write into the
  // same attempt, each under its own folder: the standalone player (VirtualExperienceTaker) uses
  // submissions/, the assignment player (AssignmentExperiencePlayer) uses ve-submissions/.
  const fileUrl = String((attempt.progress as any)?.[reqId]?.fileUrl || '');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let parsed: URL | null = null;
  try { parsed = new URL(fileUrl); } catch { /* handled below */ }
  const allowedPrefixes = ['submissions', 've-submissions'].map(folder => `/storage/v1/object/public/form-assets/${folder}/${attempt.ve_id}/`);
  const pathname = parsed?.pathname ?? '';
  if (!parsed || !supabaseUrl || parsed.origin !== new URL(supabaseUrl).origin || !allowedPrefixes.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.json({ error: 'No uploaded file found for this step.' }, { status: 400 });
  }
  // The instructor is looking at a particular file. If the student has replaced it since the panel
  // loaded, drafting the new one would produce a report about a file the instructor has not seen.
  if (typeof body.fileUrl !== 'string' || body.fileUrl !== fileUrl) {
    return NextResponse.json({ error: 'The student has uploaded a new version of this file since you opened the review. The review now shows the new file; draft again to review it.' }, { status: 409 });
  }

  let fileName = parsed.pathname.split('/').pop() || 'file';
  try { fileName = decodeURIComponent(fileName); } catch { /* keep the raw name */ }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  // Decided from the name, before any download, so an unsupported file costs nothing.
  if (!BINARY_MIME[ext] && !ZIP_TEXT_EXTS.has(ext) && !TEXT_EXTS.has(ext)) {
    return NextResponse.json({ error: `AI drafting is not available for .${ext} files. Write the report by hand.` }, { status: 415 });
  }

  // Locate the requirement for the prompt context.
  let lesson: any = null;
  let requirement: any = null;
  for (const m of (ve.modules as any[]) ?? []) {
    for (const l of m?.lessons ?? []) {
      const found = (l?.requirements ?? []).find((r: any) => r?.id === reqId);
      if (found) { requirement = found; lesson = l; }
    }
  }
  // The brief exactly as the player shows it: an email-framed step shows its email body in place of
  // the description, and a deliverable may carry its brief as a document.
  const briefParts = [
    requirement?.emailFrame ? (requirement?.emailBody || requirement?.description) : requirement?.description,
    requirement?.descriptionDoc ? lessonPlainText(requirement.descriptionDoc, 4000) : '',
  ].map(part => toPlainText(part || '')).filter(Boolean);
  // The mission's lesson content sits above the task and often carries the real instructions.
  const missionContent = lesson?.doc ? lessonPlainText(lesson.doc, 6000) : toPlainText(lesson?.body || '').slice(0, 6000);
  const prompt = buildPrompt({
    veTitle:   ve.title || '',
    company:   ve.company || '',
    role:      ve.role || '',
    lessonTitle: lesson?.title || '',
    missionContent,
    taskLabel: requirement?.label || 'Upload',
    // {{first_name}} tags are left as written; the model is drafting about the work, not greeting anyone.
    taskBrief: briefParts.join('\n\n').slice(0, 4000),
    fileName,
  });

  // Charged before the download and extraction, so an account at its limit cannot keep making the
  // server fetch and unpack files. Every exit below that produced no draft hands the charge back.
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  const limit = role === 'admin' ? 60 : 30;
  const rateKey = `rate:ve-instructor-review:${user.id}`;
  // A refused request never adds to the counter, and the receipt records which window was charged,
  // so a refund can neither be absorbed by a concurrent refusal nor credit a later window.
  let receipt: AiFeatureReceipt;
  try {
    const spend = await spendRateLimit(redis, rateKey, limit, 3600);
    if (!spend.allowed) {
      return NextResponse.json({ error: `AI draft limit reached. You can draft up to ${limit} reports per hour.` }, { status: 429 });
    }
    receipt = { counterKey: rateKey, redis, windowEndsAt: spend.ttlSeconds === null ? Infinity : Date.now() + spend.ttlSeconds * 1000 };
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  // The draft did not happen, so it should not count against the hour.
  const refund = () => refundAiFeature(receipt);
  const refunded = async (response: NextResponse) => { await refund(); return response; };

  const tooLarge = () => NextResponse.json({ error: 'The file is larger than 10 MB, which is too large to draft from. Write the report by hand.' }, { status: 413 });
  let buffer: ArrayBuffer;
  let text = '';
  // Workbook coverage: told to the model so it does not judge sheets it never saw, and shown to the
  // instructor above the draft.
  let sheetPrompt = '';
  const notices: string[] = [];
  try {
    // Older standalone uploads saved a double-escaped link that storage rejects; open the repaired one.
    const res = await fetch(repairVeSubmissionUrl(parsed.toString()), { redirect: 'error' });
    if (!res.ok || !res.body) return refunded(NextResponse.json({ error: 'Could not open the uploaded file.' }, { status: 502 }));
    if (Number(res.headers.get('content-length') || 0) > MAX_FILE_BYTES) {
      await res.body.cancel().catch(() => {});
      return refunded(tooLarge());
    }
    const read = await readCapped(res.body, MAX_FILE_BYTES);
    if (!read) return refunded(tooLarge());
    buffer = read;

    if (ZIP_TEXT_EXTS.has(ext)) {
      try { await assertZipWithinLimit(buffer); } catch (err) {
        if (err instanceof ArchiveTooLargeError) return refunded(tooLarge());
        throw err;
      }
      if (ext === 'xlsx') {
        // The worksheets the author listed on this File Upload step; none means the first few.
        const wanted = normalizeReviewSheetNames(requirement?.reviewSheetNames).names;
        const extraction = await withTimeout(extractFromWorkbook(buffer, wanted), EXTRACTION_TIMEOUT_MS);
        const sheetsRead = [...extraction.reviewedSheetNames, ...extraction.partiallyReviewedSheetNames];
        if (wanted.length > 0 && sheetsRead.length === 0) {
          return refunded(NextResponse.json({
            error: `None of the worksheets set for this step were found (${wanted.join(', ')}). This workbook has: ${extraction.availableSheetNames.join(', ') || 'no worksheets'}. Write the report by hand, or update the worksheet list on the File Upload step.`,
          }, { status: 422 }));
        }
        text = extraction.text;
        const notRead = extraction.availableSheetNames.filter(name => !sheetsRead.includes(name));
        if (wanted.length > 0) {
          sheetPrompt += `\nINSTRUCTOR-SPECIFIED WORKSHEETS:\nReview only these worksheets: ${wanted.join(', ')}.\n`;
          if (extraction.missingSheetNames.length > 0) {
            sheetPrompt += `These required worksheets are missing from the workbook: ${extraction.missingSheetNames.join(', ')}. Report each as a critical finding.\n`;
            notices.push(`Worksheets not found in the file: ${extraction.missingSheetNames.join(', ')}.`);
          }
        } else if (notRead.length > 0) {
          sheetPrompt += `\nWORKBOOK COVERAGE:\nOnly these worksheets were read: ${sheetsRead.join(', ')}. These were not read: ${notRead.join(', ')}. Do not judge or mention work on sheets you were not given.\n`;
          notices.push(`Only the first ${sheetsRead.length} worksheets were read (${sheetsRead.join(', ')}). Not read: ${notRead.join(', ')}. To choose worksheets, list them on the File Upload step.`);
        }
        if (extraction.truncated) {
          sheetPrompt += `\nEXTRACTION LIMITATION:\nThese worksheets were only partially read: ${extraction.partiallyReviewedSheetNames.join(', ')}. Judge only what is listed, and say in the summary that part of the workbook could not be read.\n`;
          notices.push(`Worksheets only partly read because of their size: ${extraction.partiallyReviewedSheetNames.join(', ')}.`);
        }
      } else if (ext === 'docx') text = await extractDocxText(buffer);
      else text = await extractPptxText(buffer);
    } else if (TEXT_EXTS.has(ext)) {
      text = new TextDecoder().decode(buffer).slice(0, 300_000);
    }
  } catch (err) {
    console.error('[ve-instructor-review/draft] read', err);
    return refunded(NextResponse.json({ error: 'Could not read the uploaded file. Write the report by hand.' }, { status: 422 }));
  }
  if (!BINARY_MIME[ext] && !text.trim()) {
    return refunded(NextResponse.json({ error: 'The file has no readable text to draft from. Write the report by hand.' }, { status: 422 }));
  }

  const usageContext = { operation: 've-instructor-review-draft', metadata: { fileType: ext } };
  try {
    const raw = BINARY_MIME[ext]
      ? await generateVisionJSON(prompt, { data: Buffer.from(buffer).toString('base64'), mimeType: BINARY_MIME[ext] }, responseSchema, { feature: 've-instructor-review-draft',  temperature: 0.2, usageContext })
      : await generateJSON(`${prompt}${sheetPrompt}\n\nFILE CONTENTS:\n${text}`, responseSchema, { feature: 've-instructor-review-draft',  temperature: 0.2, effort: 'low', usageContext });

    const report = normalizeInstructorReport({ ...raw, aiDrafted: true, fileUrl });
    if (!report || !hasReportContent(report)) {
      await refund();
      return NextResponse.json({ error: 'The AI returned an empty draft. Please try again.' }, { status: 502 });
    }
    // Extra rows are trimmed; too few means the draft is missing a section the instructor relies on.
    report.categories = report.categories.slice(0, DRAFT_CATEGORIES.max);
    report.recommendations = report.recommendations.slice(0, DRAFT_RECOMMENDATIONS);
    if (report.categories.length < DRAFT_CATEGORIES.min || report.recommendations.length < DRAFT_RECOMMENDATIONS) {
      await refund();
      return NextResponse.json({ error: 'The AI returned an incomplete draft. Please try again.' }, { status: 502 });
    }
    return NextResponse.json({ report, notices });
  } catch (err) {
    console.error('[ve-instructor-review/draft]', err);
    await refund();
    return NextResponse.json({ error: 'The AI could not draft this report right now. Please try again.' }, { status: 503 });
  }
}
