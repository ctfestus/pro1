import { Type } from '@google/genai';
import { requireUser, isAuthError, type AuthedUser } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { reserveAiFeatureLimit, spendAiFeatureReservation, type AiFeatureReservation } from '@/lib/ai-feature-gate';
import ExcelJS from 'exceljs';
import { collectRubricGrades, reviewPassed, rubricCriterionId, rubricPassRate } from '@/lib/review-gate';
import {
  canAccessAssignedVirtualExperience,
  findExcelReviewItem,
  normalizeExcelReviewConfig,
  parseExcelReviewTarget,
  type ExcelReviewConfig,
  type ExcelReviewTarget,
} from '@/lib/excel-review-config';

export const dynamic = 'force-dynamic';

// Read from settings rather than declared here, so the AI features tab is the one place
// this number lives. A constant left behind would quietly ignore whatever an admin typed.
const MAX_FORMULAS = 200;
const MAX_SHEETS = 5;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_TOTAL_CELLS = 50_000;
const MAX_TEXT_BYTES = 300_000;
const EXTRACTION_TIMEOUT_MS = 20_000;

async function authenticate(req: NextRequest): Promise<AuthedUser | NextResponse> {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  return auth;
}

async function reserveReview(auth: AuthedUser): Promise<AiFeatureReservation | NextResponse> {
  return reserveAiFeatureLimit(auth, getRedis(), 'excelReview', {
    unavailableMessage: 'Service temporarily unavailable',
  });
}

async function loadVirtualExperience(auth: AuthedUser, target: Extract<ExcelReviewTarget, { source: 'virtual_experience' }>): Promise<any | null> {
  const direct = await auth.getActorDb()
    .from('virtual_experiences')
    .select('modules')
    .eq('id', target.contentId)
    .maybeSingle();
  if (direct.data) return direct.data;
  if (!target.assignmentId) return null;

  const svc = auth.serviceDb;
  const [{ data: ve }, { data: assignment }, { data: caller }, { data: memberships }] = await Promise.all([
    svc.from('virtual_experiences').select('id, user_id, modules').eq('id', target.contentId).maybeSingle(),
    svc.from('assignments').select('id, created_by, status, config, cohort_ids, group_ids').eq('id', target.assignmentId).maybeSingle(),
    svc.from('students').select('role, cohort_id').eq('id', auth.user.id).maybeSingle(),
    svc.from('group_members').select('group_id').eq('student_id', auth.user.id),
  ]);
  if (!ve || !assignment || assignment.status !== 'published' || assignment.config?.ve_form_id !== target.contentId) return null;

  const allowed = canAccessAssignedVirtualExperience({
    userId: auth.user.id,
    callerRole: caller?.role,
    callerCohortId: caller?.cohort_id,
    callerGroupIds: (memberships ?? []).map((membership: any) => membership.group_id as string),
    experienceOwnerId: ve.user_id,
    assignmentOwnerId: assignment.created_by,
    assignmentCohortIds: assignment.cohort_ids,
    assignmentGroupIds: assignment.group_ids,
  });
  return allowed ? ve : null;
}

async function resolveReviewConfig(auth: AuthedUser, target: ExcelReviewTarget): Promise<ExcelReviewConfig | NextResponse> {
  let stored: any = null;
  if (target.source === 'course') {
    stored = (await auth.getActorDb().from('courses').select('questions').eq('id', target.contentId).maybeSingle()).data;
  } else if (target.source === 'assignment') {
    stored = (await auth.getActorDb().from('assignments').select('type, config').eq('id', target.contentId).maybeSingle()).data;
  } else {
    stored = await loadVirtualExperience(auth, target);
  }

  const item = stored ? findExcelReviewItem(target, stored) : null;
  if (!item) return NextResponse.json({ error: 'Excel review activity not found.' }, { status: 404 });

  const config = normalizeExcelReviewConfig(item);
  if (config.sheetNameError) {
    return NextResponse.json({ error: `The instructor's worksheet configuration is invalid: ${config.sheetNameError}` }, { status: 400 });
  }
  return config;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error('Workbook extraction timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle!));
}

interface WorkbookExtraction {
  text: string;
  reviewedSheetNames: string[];
  partiallyReviewedSheetNames: string[];
  missingSheetNames: string[];
  availableSheetNames: string[];
  truncated: boolean;
}

async function extractFromWorkbook(buffer: ArrayBuffer, requestedSheetNames: string[]): Promise<WorkbookExtraction> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const availableSheetNames = wb.worksheets.map(ws => ws.name);
  const sheetsByName = new Map(wb.worksheets.map(ws => [ws.name.trim().toLowerCase(), ws]));
  const missingSheetNames = requestedSheetNames.filter(name => !sheetsByName.has(name.toLowerCase()));
  const selectedSheets = requestedSheetNames.length > 0
    ? requestedSheetNames.flatMap(name => {
        const worksheet = sheetsByName.get(name.toLowerCase());
        return worksheet ? [worksheet] : [];
      })
    : wb.worksheets.slice(0, MAX_SHEETS);

  const sections: string[] = [];
  const reviewedSheetNames: string[] = [];
  const partiallyReviewedSheetNames: string[] = [];
  let totalCells = 0;
  let totalChars = 0;

  // The cell and character budgets belong to the workbook, not to one worksheet, so each selected
  // sheet takes only its share of whatever is left. Recomputed per sheet, so a sheet that uses less
  // than its share hands the rest to the ones after it. A single shared pot let an oversized first
  // worksheet spend all of it and leave a later required worksheet unopened, which is the one case
  // a student cannot do anything about: the instructor chose both sheets.
  selectedSheets.forEach((ws, index) => {
    const sheetsLeft = selectedSheets.length - index;
    const cellCeiling = totalCells + Math.ceil((MAX_TOTAL_CELLS - totalCells) / sheetsLeft);
    const charCeiling = totalChars + Math.ceil((MAX_TEXT_BYTES - totalChars) / sheetsLeft);

    const lines: string[] = [`Sheet: ${ws.name}`];
    let formulaCount = 0;
    let formulaLimitNoted = false;
    let rowCount = 0;
    let sheetTruncated = false;

    ws.eachRow((row) => {
      if (rowCount >= MAX_ROWS_PER_SHEET) { sheetTruncated = true; return; }
      rowCount++;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (totalCells >= cellCeiling) { sheetTruncated = true; return; }
        totalCells++;
        const addr = cell.address;
        if (cell.formula) {
          // A listing cap, not an extraction limit: the sheet was read, the prompt just stops
          // enumerating. It must not mark the sheet as partially extracted.
          if (formulaCount >= MAX_FORMULAS) {
            if (!formulaLimitNoted) {
              lines.push(`  ... (formula listing capped at ${MAX_FORMULAS} formulas)`);
              formulaLimitNoted = true;
            }
            return;
          }
          const raw = cell.value;
          const result = raw !== null && typeof raw === 'object' && 'result' in raw
            ? (raw as any).result
            : undefined;
          const val = result !== undefined ? ` => ${result}` : '';
          const line = `  ${addr}: =${cell.formula}${val}`;
          if (totalChars + line.length > charCeiling) { sheetTruncated = true; return; }
          totalChars += line.length;
          lines.push(line);
          formulaCount++;
        } else if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          const line = `  ${addr}: ${cell.value}`;
          if (totalChars + line.length > charCeiling) { sheetTruncated = true; return; }
          totalChars += line.length;
          lines.push(line);
        }
      });
    });

    if (lines.length === 1) lines.push('(empty)');
    if (sheetTruncated) {
      lines.push('  ... (worksheet partially extracted: review limit reached)');
      partiallyReviewedSheetNames.push(ws.name);
    } else {
      reviewedSheetNames.push(ws.name);
    }
    sections.push(lines.join('\n'));
  });

  return {
    text: sections.join('\n\n'),
    reviewedSheetNames,
    partiallyReviewedSheetNames,
    missingSheetNames,
    availableSheetNames,
    truncated: partiallyReviewedSheetNames.length > 0,
  };
}


const responseSchema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.NUMBER },
    executiveSummary: { type: Type.STRING },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cell:     { type: Type.STRING },
          severity: { type: Type.STRING },
          title:    { type: Type.STRING },
          detail:   { type: Type.STRING },
          fix:      { type: Type.STRING },
        },
        required: ['cell', 'severity', 'title', 'detail', 'fix'],
      },
    },
    categories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name:      { type: Type.STRING },
          score:     { type: Type.NUMBER },
          summary:   { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          gaps:      { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['name', 'score', 'summary', 'strengths', 'gaps'],
      },
    },
    topRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
    rubricGrades: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id:      { type: Type.NUMBER },
          passed:  { type: Type.BOOLEAN },
          comment: { type: Type.STRING },
        },
        required: ['id', 'passed', 'comment'],
      },
    },
  },
  required: ['overallScore', 'executiveSummary', 'issues', 'categories', 'topRecommendations'],
};

// With a rubric in play the grades decide whether the student passes, so they cannot be optional:
// left out of `required`, the model drops them often enough that the gate would silently fall back
// to the quality score -- the exact behaviour this route is meant to stop.
function schemaFor(hasRubric: boolean) {
  if (!hasRubric) return responseSchema;
  return { ...responseSchema, required: [...responseSchema.required, 'rubricGrades'] };
}

const SYSTEM_PROMPT = `You are a panel of senior Excel specialists -- a Financial Modeller, Finance Analyst, Fintech Analyst, Business Intelligence Analyst, Data Analyst, and Data Scientist -- each with 15+ years of hands-on Excel experience working across African business contexts including banking, fintech, FMCG, telecoms, retail, healthcare, and public sector.

Your collective Excel expertise is modern and comprehensive: advanced formulas and dynamic array functions (XLOOKUP, XMATCH, FILTER, SORT, UNIQUE, LET, LAMBDA, BYROW, MAKEARRAY), Power Query (M language, query folding, data transformation pipelines), DAX (calculated columns, measures, time intelligence), PivotTables and PivotCharts, conditional formatting with formula-driven rules, data validation, structured tables, named ranges, dynamic named ranges with OFFSET/INDEX, charting best practices, and dashboard design. You are equally fluent in legacy functions (VLOOKUP, INDEX/MATCH, SUMIF, IFERROR) and know exactly when to recommend the modern equivalent.

You adapt your domain lens to the spreadsheet being reviewed: if it is a financial model, the Financial Modeller leads the review; if it is a BI dashboard, the BI Analyst leads; if it is a data pipeline or analysis, the Data Analyst or Data Scientist leads. You review student work with the precision of a senior practitioner and the clarity of a patient mentor who understands real-world African business data.

You are given the extracted contents of a student's spreadsheet: cell addresses, their formulas, and their computed values.

Review the spreadsheet focusing ONLY on two things:

1. FORMULA CORRECTNESS
Are the formulas logically correct? Do they produce the right result given what the spreadsheet is supposed to do? Check for: wrong cell references, off-by-one row/column errors, incorrect range selection, wrong aggregation scope, formula errors (#REF!, #DIV/0!, #VALUE!), incorrect logical conditions in IF/IFS statements.

2. FORMULA CHOICE
Is this the best formula for the task? Flag cases where a simpler or more appropriate function exists: nested IFs that should be IFS or SWITCH, VLOOKUP that should be XLOOKUP or INDEX/MATCH, SUM where SUMIF/SUMIFS is needed, manual calculations where a built-in function applies.

3. VALUE ACCURACY
Based on the instructor's description of what the spreadsheet should produce, are the computed values correct? Flag any cell whose value does not match what is expected.

For each issue provide:
- cell: the cell reference (e.g. "B5" or "Sheet1!C12")
- severity: "error" (wrong result or broken formula), "warning" (works but wrong approach), or "suggestion" (could be improved)
- title: short specific issue name
- detail: 1-2 sentences explaining the problem
- fix: the exact corrected formula or change to make

Score three categories 0-100:
- "Formula Correctness": are the formulas logically and syntactically correct?
- "Formula Choice": are the right functions being used for each task?
- "Value Accuracy": do the computed values match the expected outputs?

Score honestly. 80 and above must be genuinely earned, and work that skipped part of the task cannot reach it. Judge the spreadsheet against what it was asked to do, not only against the quality of the formulas that happen to be present. Work that is missing is a failure, not a neutral absence.

A cell holding a typed constant where the task calls for a calculation is an "error" of the highest severity, never an acceptable answer. In the extracted contents below, a formula cell is listed as "=..." and a constant is listed as a bare value, so a required cell with no "=" was never converted. It produces the right number without the required formula, so it earns no credit for that requirement and must pull down Formula Correctness and Value Accuracy.

Also provide:
- overallScore: weighted average (one decimal)
- executiveSummary: 2-3 sentences briefing a technical reviewer on this student's submission
- topRecommendations: exactly 3 highest-impact changes ordered by priority

Return ONLY valid JSON. No markdown fences.`;

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth instanceof NextResponse) return auth;

    const reservation = await reserveReview(auth);
    if (reservation instanceof NextResponse) return reservation;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const reviewTargetRaw = formData.get('reviewTarget');
    let reviewTarget: ExcelReviewTarget | null = null;
    if (typeof reviewTargetRaw === 'string') {
      try { reviewTarget = parseExcelReviewTarget(JSON.parse(reviewTargetRaw)); } catch {}
    }
    if (!reviewTarget) return NextResponse.json({ error: 'A saved Excel review activity is required.' }, { status: 400 });

    const storedConfig = await resolveReviewConfig(auth, reviewTarget);
    if (storedConfig instanceof NextResponse) return storedConfig;
    const { context, rubric, minScore, reviewSheetNames } = storedConfig;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx') {
      return NextResponse.json({ error: 'Only .xlsx files are supported' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5 MB.' }, { status: 413 });
    }

    const buffer = await file.arrayBuffer();
    const extraction = await withTimeout(extractFromWorkbook(buffer, reviewSheetNames), EXTRACTION_TIMEOUT_MS);

    if (extraction.missingSheetNames.length > 0) {
      return NextResponse.json({
        error: `Required worksheet${extraction.missingSheetNames.length === 1 ? '' : 's'} not found: ${extraction.missingSheetNames.join(', ')}. Available worksheets: ${extraction.availableSheetNames.join(', ') || 'none'}.`,
        missingSheetNames: extraction.missingSheetNames,
        availableSheetNames: extraction.availableSheetNames,
      }, { status: 400 });
    }

    const extracted = extraction.text;

    if (!extracted.trim()) {
      return NextResponse.json({ error: 'No data found in the spreadsheet.' }, { status: 400 });
    }

    const contextBlock = context.trim()
      ? `\nINSTRUCTOR CONTEXT -- WHAT THIS SPREADSHEET SHOULD DO:\n${context.trim()}\n`
      : '';

    const sheetBlock = reviewSheetNames.length > 0
      ? `\nINSTRUCTOR-SPECIFIED WORKSHEETS:\nReview only these worksheets: ${reviewSheetNames.join(', ')}.\n`
      : '';

    const truncationBlock = extraction.truncated
      ? `\nEXTRACTION LIMITATION:\nThese worksheets were only partially extracted: ${extraction.partiallyReviewedSheetNames.join(', ')}. Judge only what is listed above. A criterion whose evidence would sit in cells you cannot see is not met: mark it as not passed, and say in its comment that the required cells could not be read. State the evidence limitation in the summary.\n`
      : '';

    const rubricBlock = rubric.length > 0
      ? `\nINSTRUCTOR RUBRIC -- GRADE EACH CRITERION BY ID\nThis rubric is what the student was actually asked to do, and it decides whether they pass. Return one "rubricGrades" entry per criterion: its "id" exactly as numbered below, a "passed" boolean, and a 1-2 sentence "comment" naming the cells or sheets you checked.\n\nGrade every id exactly once. Ids you omit are marked as not met and count against the student, ids you repeat are ignored after the first, and ids that are not on this list are discarded -- so a criterion you skip cannot be made up for by grading another one twice.\n\nMark a criterion "passed" only when the extracted contents show it was met. Absence of evidence is a fail, not a pass: if a criterion requires formulas in named cells and those cells hold constants, or are missing entirely, it fails. Never pass a criterion because the displayed value looks right.\n\nCriteria:\n${rubric.map((c, i) => `id ${rubricCriterionId(i)}: ${c}`).join('\n')}\n`
      : '';

    const prompt = `${SYSTEM_PROMPT}${contextBlock}${sheetBlock}${rubricBlock}${truncationBlock}\n\nEXTRACTED SPREADSHEET CONTENTS:\n${extracted}`;

    const schema = schemaFor(rubric.length > 0);
    const usageContext = {
      operation: 'excel-review',
      metadata: {
        fileBytes: file.size,
        extractedChars: extracted.length,
        contextChars: context.length,
        rubricCriteria: rubric.length,
        reviewedSheetNames: JSON.stringify(extraction.reviewedSheetNames),
        reviewedSheetCount: extraction.reviewedSheetNames.length,
        partiallyReviewedSheetNames: JSON.stringify(extraction.partiallyReviewedSheetNames),
        extractionTruncated: extraction.truncated,
      },
    };
    const spendError = await spendAiFeatureReservation(reservation);
    if (spendError) return spendError;
    // The narrative half of the review always comes from the first attempt; only the grades
    // merge, so the report a student reads is one coherent response rather than two spliced.
    const parsed = await generateJSON(prompt, schema, { temperature: 0.2, usageContext });

    if (rubric.length === 0) {
      const result = { ...parsed, rubricScore: null };
      return NextResponse.json({
        ...result,
        passed: reviewPassed(result, minScore),
        minScore,
        reviewedSheetNames: extraction.reviewedSheetNames,
        partiallyReviewedSheetNames: extraction.partiallyReviewedSheetNames,
        extractionTruncated: extraction.truncated,
      });
    }

    let graded = collectRubricGrades(rubric, parsed?.rubricGrades);

    // An ungraded criterion counts as not met, so a response that skipped one would fail the
    // student for the model's sloppiness. Ask once more before that happens and merge the two
    // responses: the retry fills in the criteria the first attempt left out, and where both graded
    // the same criterion the first attempt's verdict stands. Choosing one whole response instead
    // would throw away a retry that covered different criteria rather than more of them.
    if (graded.ungraded > 0) {
      try {
        const retry = await generateJSON(prompt, schema, {
          temperature: 0.2,
          usageContext: { ...usageContext, metadata: { ...usageContext.metadata, gradeRetry: true } },
        });
        graded = collectRubricGrades(rubric, parsed?.rubricGrades, retry?.rubricGrades);
      } catch (err) {
        console.warn('excel-review: rubric grade retry failed', err);
      }
      if (graded.ungraded > 0) {
        console.warn(`excel-review: graded ${graded.covered}/${rubric.length} criteria after retry`);
      }
    }

    // The pass gate reads this, not overallScore. Computed here so every consumer -- the VE
    // player, the course player, and any saved report re-rendered later -- gates identically.
    const rubricScore = rubricPassRate(graded.grades, rubric.length);
    const result = {
      ...parsed,
      rubricGrades: graded.grades,
      rubricScore,
      rubricCriteriaCount: rubric.length,
      rubricUngraded: graded.ungraded,
    };
    return NextResponse.json({
      ...result,
      passed: reviewPassed(result, minScore, rubric.length),
      minScore,
      reviewedSheetNames: extraction.reviewedSheetNames,
      partiallyReviewedSheetNames: extraction.partiallyReviewedSheetNames,
      extractionTruncated: extraction.truncated,
    });
  } catch (err: any) {
    console.error('excel-review error:', err);
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
