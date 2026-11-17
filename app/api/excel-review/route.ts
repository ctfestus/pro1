
import { requireUser, isAuthError, type AuthedUser } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { REVIEW_GRADING_INSTRUCTIONS, RUBRIC_GRADES, reviewSchema, rubricInstructions } from '@/lib/review-instructions';
import { NextRequest, NextResponse } from 'next/server';
import { AiConfigurationError, aiConfigurationResponse } from '@/lib/ai/errors';
import { getRedis } from '@/lib/redis';
import { refundAiFeature, reserveAiFeatureLimit, spendAiFeatureReservation } from '@/lib/ai-feature-gate';
import { EXTRACTION_TIMEOUT_MS, extractFromWorkbook, withTimeout } from '@/lib/excel-workbook-extract';
import { UNGRADED_COMMENT, collectRubricGrades, reviewPassed, rubricCriterionId, rubricPassRate } from '@/lib/review-gate';
import { loadReviewItem } from '@/lib/review-target';
import {
  normalizeExcelReviewConfig,
  parseExcelReviewTarget,
  type ExcelReviewConfig,
  type ExcelReviewTarget,
} from '@/lib/excel-review-config';

export const dynamic = 'force-dynamic';

// A review on a thinking model can run past the platform default; without this it is cut off mid-call.
export const maxDuration = 120;

async function resolveReviewConfig(auth: AuthedUser, target: ExcelReviewTarget): Promise<ExcelReviewConfig | NextResponse> {
  const item = await loadReviewItem(auth, target, 'excel_review');
  if (!item) return NextResponse.json({ error: 'Excel review activity not found.' }, { status: 404 });

  const config = normalizeExcelReviewConfig(item);
  if (config.sheetNameError) {
    return NextResponse.json({ error: `The instructor's worksheet configuration is invalid: ${config.sheetNameError}` }, { status: 400 });
  }
  return config;
}


const FINDINGS = { key: 'issues', fields: ['cell', 'severity', 'title', 'detail', 'fix'] };

const READING = `You are given the extracted contents of a student's spreadsheet: cell addresses, their formulas, and their computed values. A formula cell is listed as "=..." and a constant is listed as a bare value, so a cell with no "=" holds a typed constant.`;

// With a rubric this replaces the formula audit below, which is what pulled a report off the rubric.
const RUBRIC_PROMPT = `You are a senior Excel specialist marking a student's workbook against the instructor's rubric.

${READING}`;

const RUBRIC_EVIDENCE = `Absence of evidence is a fail, not a pass: if a criterion requires formulas in named cells and those cells hold typed constants, or are missing entirely, it fails. Never pass a criterion because the displayed value looks right. Name the cells or sheets you checked in each comment, and give the exact corrected formula as the fix where one applies.`;

const SYSTEM_PROMPT = `You are a panel of senior Excel specialists -- a Financial Modeller, Finance Analyst, Fintech Analyst, Business Intelligence Analyst, Data Analyst, and Data Scientist -- each with 15+ years of hands-on Excel experience working across African business contexts including banking, fintech, FMCG, telecoms, retail, healthcare, and public sector.

Your collective Excel expertise is modern and comprehensive: advanced formulas and dynamic array functions (XLOOKUP, XMATCH, FILTER, SORT, UNIQUE, LET, LAMBDA, BYROW, MAKEARRAY), Power Query (M language, query folding, data transformation pipelines), DAX (calculated columns, measures, time intelligence), PivotTables and PivotCharts, conditional formatting with formula-driven rules, data validation, structured tables, named ranges, dynamic named ranges with OFFSET/INDEX, charting best practices, and dashboard design. You are equally fluent in legacy functions (VLOOKUP, INDEX/MATCH, SUMIF, IFERROR) and know exactly when to recommend the modern equivalent.

You adapt your domain lens to the spreadsheet being reviewed: if it is a financial model, the Financial Modeller leads the review; if it is a BI dashboard, the BI Analyst leads; if it is a data pipeline or analysis, the Data Analyst or Data Scientist leads. You review student work with the precision of a senior practitioner and the clarity of a patient mentor who understands real-world African business data.

You are given the extracted contents of a student's spreadsheet: cell addresses, their formulas, and their computed values.

Review the spreadsheet focusing ONLY on three things:

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
- topRecommendations: up to 3 highest-impact changes ordered by priority; fewer, or none, when the workbook does not need them

For each category give a 1-sentence summary, up to 3 strengths and up to 3 gaps ([] when there are none).

Return ONLY valid JSON. No markdown fences.`;

export async function POST(req: NextRequest) {
  // Set only once an attempt has actually been taken, so a failure before that point cannot hand
  // back an allowance nobody spent.
  let refundAttempt: (() => Promise<void>) | null = null;

  try {
    const auth = await requireUser(req);
    if (isAuthError(auth)) return auth.error;

    const reservation = await reserveAiFeatureLimit(auth, getRedis(), 'excelReview', {
      unavailableMessage: 'Service temporarily unavailable',
    });
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

    const hasRubric = rubric.length > 0;
    const instructions = hasRubric
      ? `${RUBRIC_PROMPT}\n${contextBlock}${sheetBlock}\n${rubricInstructions(rubric, 'the cell or range, e.g. "B5" or "Sheet1!C12:C20"')}\n\n${RUBRIC_EVIDENCE}\n`
      : `${SYSTEM_PROMPT}${contextBlock}${sheetBlock}`;
    const prompt = `${instructions}${truncationBlock}\n\n${REVIEW_GRADING_INSTRUCTIONS}\n\nEXTRACTED SPREADSHEET CONTENTS:\n${extracted}`;

    const schema = reviewSchema({ findings: FINDINGS, hasRubric });
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
    const charge = await spendAiFeatureReservation(reservation);
    if (charge.response) return charge.response;
    // Only an attempt the counter really took can be given back.
    const receipt = charge.receipt;
    if (receipt) refundAttempt = () => refundAiFeature(receipt);
    const parsed = await generateJSON(prompt, schema, { feature: 'excel-review',  temperature: 0.2, usageContext });

    if (!hasRubric) {
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
    // student for the model's sloppiness. Ask once more, for the missing verdicts only, and merge:
    // the retry fills in what the first attempt left out, and where both graded the same criterion
    // the first attempt's verdict stands. The report itself always comes from the first attempt.
    if (graded.ungraded > 0) {
      const missing = graded.grades.flatMap((grade, i) => grade.comment === UNGRADED_COMMENT ? [rubricCriterionId(i)] : []);
      try {
        const retry = await generateJSON(
          `${prompt}\n\nReturn "rubricGrades" only, for these criterion ids and no others: ${missing.join(', ')}.`,
          { type: 'object', properties: { rubricGrades: RUBRIC_GRADES }, required: ['rubricGrades'] },
          { feature: 'excel-review',
            temperature: 0.2,
            usageContext: { ...usageContext, metadata: { ...usageContext.metadata, gradeRetry: true } },
          },
        );
        graded = collectRubricGrades(rubric, parsed?.rubricGrades, retry?.rubricGrades);
      } catch (err) {
        console.warn('excel-review: rubric grade retry failed', err);
      }
      if (graded.ungraded > 0) {
        console.warn(`excel-review: graded ${graded.covered}/${rubric.length} criteria after retry`);
      }
    }

    // The share of the rubric met is both the gate and the score shown. Computed here so every
    // consumer -- the VE player, the course player, and any saved report re-rendered later -- agrees.
    const rubricScore = rubricPassRate(graded.grades, rubric) ?? 0;
    // The fixes travel on the grades, so the findings, categories and recommendations stay empty.
    const result = {
      ...parsed,
      issues: [],
      categories: [],
      topRecommendations: [],
      overallScore: rubricScore,
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
    // The review never happened, so it should not have cost them an attempt.
    await refundAttempt?.();
    if (err instanceof AiConfigurationError) return aiConfigurationResponse();
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
