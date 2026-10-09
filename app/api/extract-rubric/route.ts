
import { requireRole, isAuthError } from '@/lib/api-auth';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertZipWithinLimit, extractDocxText } from '@/lib/office-text';
import { EXTRACTION_TIMEOUT_MS, extractFromWorkbook, withTimeout } from '@/lib/excel-workbook-extract';
import { normalizeReviewSheetNames } from '@/lib/excel-review-config';
import { CODE_FILE_EXTENSIONS, mergeRubricCriteria, type RubricImportKind } from '@/lib/rubric-criteria';

export const dynamic = 'force-dynamic';
// A rubric of any size takes 20s or more on a thinking model, and the retries below stack on top
// of that. Without this the platform default can cut the request off mid-call.
export const maxDuration = 120;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RUBRIC_PRESERVATION_INSTRUCTIONS = 'If the uploaded content contains an assessment rubric, treat that rubric as authoritative. Preserve every separately marked subcriterion and its exact mark allocation in its criterion string. Do not merge or omit subcriteria. Preserve assessment notes, including full credit for valid alternative approaches and assessment of both results and logic, as separate strings. Do not invent marks where none are supplied.';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function authenticate(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  return { userId: auth.user.id };
}

const responseSchema = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['criteria'],
};

// POST /api/extract-rubric
// Body: multipart/form-data with `file`, `label` (reference_solution) and, for workbooks,
// an optional `reviewSheetNames` JSON array: the same worksheets the task's Excel review reads.
// Returns: { criteria: string[] }
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file') as File | null;
  const rawLabel = (form.get('label') as string | null) ?? 'reference_solution';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (rawLabel !== 'reference_solution') {
    return NextResponse.json({ error: 'Unsupported rubric extraction type' }, { status: 400 });
  }
  const label: RubricImportKind = rawLabel;
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 });

  const lowerName = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  const mime = file.type || 'application/octet-stream';
  const docDescription = 'a completed reference solution file';
  const usageMetadata = {
    fileBytes: file.size,
    importKind: label,
    mimeType: mime,
  };

  const isExcel = mime.includes('spreadsheet') || mime.includes('excel') ||
    lowerName.endsWith('.xlsx');
  const isText = mime.startsWith('text/') || ['.csv', '.txt', '.md', ...CODE_FILE_EXTENSIONS].some(ext => lowerName.endsWith(ext));
  const isDocx = lowerName.endsWith('.docx') || mime.includes('wordprocessingml.document');

  try {
    let parsed: any;

    if (isExcel) {
      let requested: unknown;
      try { requested = JSON.parse(String(form.get('reviewSheetNames') ?? '[]')); } catch { requested = 'invalid'; }
      const sheets = normalizeReviewSheetNames(requested);
      if (sheets.error) return NextResponse.json({ error: sheets.error }, { status: 400 });
      const extraction = await withTimeout(extractFromWorkbook(buffer, sheets.names), EXTRACTION_TIMEOUT_MS);
      if (extraction.missingSheetNames.length) {
        return NextResponse.json({ error: `Worksheets not found in this file: ${extraction.missingSheetNames.join(', ')}. Check the worksheet names on this task.` }, { status: 400 });
      }
      const text = extraction.text;
      const prompt = `You are an expert assessment designer. The instructor has uploaded ${docDescription} (an Excel/spreadsheet file). Analyse the content below and extract clear, specific, measurable rubric criteria that an AI reviewer can use to grade student submissions. Extract as many criteria as the file warrants -- one criterion per distinct requirement, skill, or standard present in the file. Return each as a concise action-oriented statement.\n\nFile content:\n${text}`;
      parsed = await generateJSON(`${prompt}\n\n${RUBRIC_PRESERVATION_INSTRUCTIONS}`, responseSchema, { feature: 'extract-rubric',
        temperature: 0.3,
        retries: 2,
        usageContext: {
          operation: 'extract-rubric',
          metadata: { ...usageMetadata, extractedChars: text.length, sourceKind: 'excel' },
        },
      });
    } else if (isText || isDocx) {
      if (isDocx) await withTimeout(assertZipWithinLimit(buffer), EXTRACTION_TIMEOUT_MS);
      const text = isDocx ? await withTimeout(extractDocxText(buffer), EXTRACTION_TIMEOUT_MS) : new TextDecoder().decode(buffer);
      if (!text.trim()) throw new Error('Document contains no readable text');
      const prompt = `You are an expert assessment designer. The instructor has uploaded ${docDescription}. Analyse the content below and extract clear, specific, measurable rubric criteria that an AI reviewer can use to grade student submissions. Extract as many criteria as the file warrants -- one criterion per distinct requirement, skill, or standard present in the file. Return each as a concise action-oriented statement.\n\nFile content:\n${text}`;
      parsed = await generateJSON(`${prompt}\n\n${RUBRIC_PRESERVATION_INSTRUCTIONS}`, responseSchema, { feature: 'extract-rubric',
        temperature: 0.3,
        retries: 2,
        usageContext: {
          operation: 'extract-rubric',
          metadata: { ...usageMetadata, extractedChars: text.length, sourceKind: 'text' },
        },
      });
    } else {
      const base64 = Buffer.from(buffer).toString('base64');
      const isImage = mime.startsWith('image/');
      const imageInstruction = isImage
        ? `This is a completed dashboard screenshot. Extract rubric criteria based on what you observe visually: chart type choices, KPI placement and formatting, layout and hierarchy, colour usage, labelling clarity, axis correctness, insight callouts, and overall readability. Each criterion should be something a student dashboard can be objectively graded against.`
        : `Analyse the file and extract clear, specific, measurable rubric criteria that an AI reviewer can use to grade student submissions.`;
      const prompt = `You are an expert assessment designer. The instructor has uploaded ${docDescription}. ${imageInstruction} Extract as many criteria as the file warrants -- one criterion per distinct requirement, skill, or standard present. Return each as a concise action-oriented statement.`;
      if (isImage) {
        parsed = await generateVisionJSON(`${prompt}\n\n${RUBRIC_PRESERVATION_INSTRUCTIONS}`, { data: base64, mimeType: mime }, responseSchema, { feature: 'extract-rubric',
          temperature: 0.3,
          usageContext: {
            operation: 'extract-rubric',
            metadata: { ...usageMetadata, sourceKind: 'image' },
          },
        });
      } else {
        // PDFs stay native; the shared layer routes legacy DOC directly to Gemini.
        try {
          parsed = await generateVisionJSON(`${prompt}\n\n${RUBRIC_PRESERVATION_INSTRUCTIONS}`, { data: base64, mimeType: lowerName.endsWith('.doc') ? 'application/msword' : mime }, responseSchema, { feature: 'extract-rubric',
            temperature: 0.3,
            usageContext: {
              operation: 'extract-rubric',
              metadata: { ...usageMetadata, sourceKind: 'document' },
            },
          });
        } catch {
          return NextResponse.json(
            { error: 'Could not extract rubric from this file. If the AI service is unavailable, try uploading an image screenshot instead.' },
            { status: 422 },
          );
        }
      }
    }

    const criteria = mergeRubricCriteria([], parsed.criteria);

    return NextResponse.json({ criteria });
  } catch (err: any) {
    console.error('[extract-rubric]', err);
    // "Failed to extract rubric from file" sent instructors hunting through a file that was never
    // the problem. A busy model is the common failure and it says so.
    const message = String(err?.message ?? '').toLowerCase();
    if (message.includes('unavailable') || message.includes('overloaded') || message.includes('high demand') || message.includes('503')) {
      return NextResponse.json(
        { error: 'The AI service is busy right now. Your file is fine - please try the import again in a moment.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Failed to extract rubric from file' }, { status: 500 });
  }
}
