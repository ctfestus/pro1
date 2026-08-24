import { Type } from '@google/genai';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { readBoundedJson } from '@/lib/bounded-json';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 86400;
// Max length of a written answer we send to the model (HTML stripped). Keep the client-side
// caps/counters in the VE players (VirtualExperienceTaker, AssignmentExperiencePlayer) in sync.
const MAX_ANSWER_CHARS = 2000;
// Hard cap on the raw (pre-strip) answer string. Rich text carries markup, so allow headroom
// over MAX_ANSWER_CHARS, but bound it so a huge payload cannot be stripped down under the limit
// and consume server memory in the process.
const MAX_RAW_ANSWER_CHARS = 20000;
// Ceiling on the whole request body in raw bytes - enforced by the bounded stream reader (and by a
// Content-Length fast-path when present). Generous vs. the raw answer cap + JSON overhead so a
// legitimate max-length answer is never falsely rejected, but far tighter than any platform limit.
const MAX_BODY_BYTES = 128 * 1024;

// RLS-scoped client for the caller: reading the VE through it enforces the same
// access the standalone player itself has (owner / admin / cohort / learning path).
function callerClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
}

const VE_COLUMNS = 'user_id, modules, company, role, industry';

async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  // Fail closed. This route spends a metered AI quota, so a limiter that cannot be
  // reached must not silently become no limiter at all -- an outage is exactly when an
  // unbounded bill would be run up.
  if (!redis) return NextResponse.json({ error: 'AI review is unavailable right now. Please try again shortly.' }, { status: 503 });
  try {
    if (await bumpRateLimit(redis, `rate:ve-answer-review:${userId}`, RATE_LIMIT, RATE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: `Limit reached: ${RATE_LIMIT} AI reviews per day. Try again tomorrow.` },
        { status: 429 },
      );
    }
  } catch {
    // Same reasoning as above: an unreachable limiter refuses rather than waves through.
    return NextResponse.json({ error: 'AI review is unavailable right now. Please try again shortly.' }, { status: 503 });
  }
  return null;
}


const responseSchema = {
  type: Type.OBJECT,
  properties: {
    score:    { type: Type.NUMBER },
    passed:   { type: Type.BOOLEAN },
    feedback: { type: Type.STRING },
  },
  required: ['score', 'passed', 'feedback'],
};

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  // Note: the daily rate limit is consumed later, once the request is validated and authorized,
  // so an oversized or invalid attempt never costs the student one of their reviews.

  // Content-Length is a cheap early reject when present; the bounded read below is the real,
  // platform-independent guarantee (chunked requests omit Content-Length, so this alone is not
  // enough - it just avoids opening the stream for an obviously over-large declared body).
  const declaredBytes = Number(req.headers.get('content-length') || 0);
  if (declaredBytes > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Answer must be ${MAX_ANSWER_CHARS} characters or fewer.` }, { status: 413 });
  }

  const parsed = await readBoundedJson(req, MAX_BODY_BYTES);
  if (parsed.status === 'too_large') {
    return NextResponse.json({ error: `Answer must be ${MAX_ANSWER_CHARS} characters or fewer.` }, { status: 413 });
  }
  if (parsed.status === 'bad_json') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const body = parsed.body;
  const veId  = typeof body?.veId === 'string' ? body.veId : '';
  const reqId = typeof body?.reqId === 'string' ? body.reqId : '';

  // Reject an oversized raw payload before stripping, so huge markup cannot be collapsed under
  // the limit at the cost of processing it in memory.
  const rawAnswer = typeof body?.studentAnswer === 'string' ? body.studentAnswer : '';
  if (rawAnswer.length > MAX_RAW_ANSWER_CHARS) {
    return NextResponse.json({ error: `Answer must be ${MAX_ANSWER_CHARS} characters or fewer.` }, { status: 400 });
  }

  // Strip HTML tags so the AI evaluates the actual text, not markup
  const studentAnswer = rawAnswer.replace(/<[^>]*>/g, '').trim();

  if (!veId || !reqId) {
    return NextResponse.json({ error: 'veId and reqId are required.' }, { status: 400 });
  }
  if (!studentAnswer) {
    return NextResponse.json({ error: 'No answer submitted.' }, { status: 400 });
  }
  if (studentAnswer.length > MAX_ANSWER_CHARS) {
    return NextResponse.json({ error: `Answer must be ${MAX_ANSWER_CHARS} characters or fewer.` }, { status: 400 });
  }

  // Authoritative grading context: the question, rubric, and expected answer
  // all come from the VE row, never from the request body. First read under
  // the caller's own RLS (standalone-player parity); if that yields nothing,
  // fall back to the assignment-embed access check, mirroring
  // /api/ve-for-assignment.
  let ve: any = (await callerClient(auth.token)
    .from('virtual_experiences').select(VE_COLUMNS).eq('id', veId).maybeSingle()).data;

  if (!ve) {
    const svc = auth.serviceDb;
    const { data: veSvc } = await svc
      .from('virtual_experiences').select(VE_COLUMNS).eq('id', veId).maybeSingle();
    if (!veSvc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    let allowed = veSvc.user_id === auth.user.id;
    if (!allowed) {
      const { data: caller } = await svc
        .from('students').select('role, cohort_id').eq('id', auth.user.id).maybeSingle();
      if (caller?.role === 'admin' || caller?.role === 'instructor') {
        allowed = true;
      } else {
        const [{ data: assignments }, { data: memberships }] = await Promise.all([
          svc.from('assignments').select('cohort_ids, group_ids')
            .eq('status', 'published').eq('config->>ve_form_id', veId),
          svc.from('group_members').select('group_id').eq('student_id', auth.user.id),
        ]);
        const myGroups = new Set((memberships ?? []).map((m: any) => m.group_id as string));
        allowed = (assignments ?? []).some((a: any) =>
          (caller?.cohort_id && (a.cohort_ids ?? []).includes(caller.cohort_id)) ||
          (a.group_ids ?? []).some((g: string) => myGroups.has(g)));
      }
    }
    if (!allowed) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    ve = veSvc;
  }

  // Locate the requirement being graded; only AI-review questions qualify.
  let target: any = null;
  let moduleTitle = '';
  let lessonTitle = '';
  for (const m of (Array.isArray(ve.modules) ? ve.modules : [])) {
    for (const les of (Array.isArray(m?.lessons) ? m.lessons : [])) {
      for (const r of (Array.isArray(les?.requirements) ? les.requirements : [])) {
        if (r?.id === reqId) { target = r; moduleTitle = m?.title || ''; lessonTitle = les?.title || ''; }
      }
    }
  }
  if (!target || !target.aiReview) {
    return NextResponse.json({ error: 'Question not found.' }, { status: 404 });
  }

  const { company, role, industry } = ve;
  const question = target.label;
  const description = target.description;
  const context = target.context;
  const rubric = target.rubric;
  const expectedAnswer = target.expectedAnswer;

  const roleLine    = (role && company) ? `${role} at ${company}` : role || company || 'a professional';
  const taskLabel   = question || description || 'this task';
  const lessonLine  = [moduleTitle, lessonTitle].filter(Boolean).join(' > ');

  const rubricLines = Array.isArray(rubric) && rubric.length > 0
    ? `Criteria: ${rubric.join(' | ')}`
    : '';
  const contextLine  = context       ? `Context: ${context}` : '';
  const modelLine    = expectedAnswer ? `Strong answer covers: ${expectedAnswer}` : '';
  const extras       = [contextLine, rubricLines, modelLine].filter(Boolean).join('\n');

  const prompt = `You are a senior ${roleLine}${industry ? ` in ${industry}` : ''}. A junior team member has submitted a written response as part of their work experience${lessonLine ? ` (${lessonLine})` : ''}.

Task: ${taskLabel}
${extras ? `\n${extras}\n` : ''}
Their response: "${studentAnswer}"

Score 0-100 (60+ passes). Write exactly 2-3 sentences of feedback. Rules:
- Be direct. Cut any sentence that does not add information.
- Reference what they actually wrote, not generic advice.
- If passed: name one specific strength, then one concrete way to go further.
- If not passed: name the exact gap, explain why it matters on the job, tell them precisely what to add or change.
- No preamble. No filler phrases ("great effort", "however", "it's worth noting"). No bullet points. Start with the assessment, not their name.`;

  // Consume the daily quota only now: the request is valid and the caller is authorized for a
  // real review, so a rejected attempt above never spent one of the student's ten.
  const rateLimitError = await checkRateLimit(auth.user.id);
  if (rateLimitError) return rateLimitError;

  try {
    const parsed = await generateJSON(prompt, responseSchema, { temperature: 0.4 });
    return NextResponse.json({
      passed:   !!parsed.passed,
      feedback: parsed.feedback || '',
      score:    typeof parsed.score === 'number' ? Math.round(parsed.score) : 0,
    });
  } catch (err: any) {
    console.error('[ve-answer-review]', err);
    return NextResponse.json({ error: 'AI review failed. Please try again.' }, { status: 500 });
  }
}
