
import { requireUser, isAuthError } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { REVIEW_GRADING_INSTRUCTIONS, reviewSchema, rubricInstructions, taskInstructions } from '@/lib/review-instructions';
import { scoreRubricReview } from '@/lib/review-gate';
import { resolveReviewItem, reviewMinScore, reviewRubric, reviewTask, reviewText } from '@/lib/review-target';
import { NextRequest, NextResponse } from 'next/server';
import { AiConfigurationError, aiConfigurationResponse } from '@/lib/ai/errors';
import { getRedis } from '@/lib/redis';
import { chargeAiFeature, refundAiFeature } from '@/lib/ai-feature-gate';

export const dynamic = 'force-dynamic';
// A review on a thinking model can run past the platform default; without this it is cut off mid-call.
export const maxDuration = 120;

const MAX_CODE_CHARS = 20_000;
const FINDINGS = { key: 'issues', fields: ['lines', 'severity', 'title', 'detail', 'fix'] };

const BASE_INSTRUCTIONS = `You review student code with the precision of a top-tier tech company code review and the clarity of a patient mentor.

Your task: review the submitted code and deliver honest, actionable feedback structured as follows.

ISSUE DETECTION
Identify the real issues in the code. For each issue provide:
- lines: the line number(s) affected (e.g. "12", "5-8", or "" if global)
- severity: "error" (breaks the code or produces wrong results), "warning" (works but is risky or inefficient), or "suggestion" (style, readability, or best practice)
- title: a short, specific issue name (e.g. "Division by zero risk", "Unused variable")
- detail: 1-2 sentences explaining why this is a problem
- fix: the exact change to make -- be concrete (e.g. "Add a check: if divisor == 0: return None")

NEVER flag issues that don't exist. NEVER be vague. Each issue must have a specific, implementable fix.

HOLISTIC AUDIT -- 4 CATEGORIES
Score each category 0-100. Be honest -- 80+ must be genuinely earned.

CATEGORY 1: "Correctness & Logic" -- Does the code produce the right output? Are edge cases handled? Are there logic errors or incorrect assumptions?
CATEGORY 2: "Code Quality & Readability" -- Are names descriptive? Is structure clear? Is it easy for another developer to read?
CATEGORY 3: "Efficiency & Performance" -- Are there unnecessary loops, redundant operations, or memory inefficiencies?
CATEGORY 4: "Best Practices & Safety" -- Are language-specific conventions followed? Is error handling present? Are there security concerns?

For each category provide score, a 1-sentence summary, up to 3 strengths, and up to 3 gaps ([] when there are none).

Also provide:
- overallScore: weighted average (one decimal)
- executiveSummary: 2-3 sentences. Write as if briefing a technical lead on this student's submission. Be direct.
- topRecommendations: up to 3 strings -- the highest-impact changes, ordered by priority. Fewer, or none, when the code does not need them.

Return ONLY valid JSON matching the schema. No markdown fences, no explanation outside JSON.`;


const SQL_FOCUS = (dialectName: string) => `SQL-SPECIFIC FOCUS AREAS (apply all that are relevant to ${dialectName}):
- Correctness: verify JOIN conditions (missing ON clause, cartesian products, wrong join type); NULL handling in WHERE/HAVING clauses (use IS NULL not = NULL); GROUP BY completeness (all non-aggregated SELECT columns must appear); HAVING vs WHERE placement; subquery correlated vs uncorrelated correctness.
- Performance: missing or redundant indexes implied by the query; SELECT * in production queries; N+1 patterns; functions on indexed columns in WHERE (e.g. LOWER(col) = ... prevents index use); large IN lists; unnecessary DISTINCT.
- Window functions: correct PARTITION BY / ORDER BY; ROWS vs RANGE frame differences; using window functions where aggregation suffices.
- Dialect-specific pitfalls for ${dialectName}: flag any syntax or function not available in ${dialectName} (e.g. QUALIFY in BigQuery, ISNULL vs COALESCE differences, LIMIT vs TOP, date arithmetic syntax, STRING_AGG vs GROUP_CONCAT, UNNEST usage).
- Safety: parameterised queries vs string concatenation (SQL injection); hardcoded credentials or environment values in queries.
- Style: CTEs preferred over deeply nested subqueries; consistent aliasing; meaningful alias names (not single letters for complex tables).`;

const PYTHON_FOCUS = `PYTHON-SPECIFIC FOCUS AREAS (data analysis and engineering context):
- Pandas anti-patterns: chained indexing (df[...][...] vs .loc/.iloc); iterrows() over vectorised operations; apply() where built-in methods exist; inplace=True misuse; not using .copy() when slicing; implicit index alignment gotchas.
- Memory efficiency: loading entire datasets when chunking/lazy evaluation suffices; object dtype columns that should be category; unnecessary full DataFrame copies; not releasing memory after large intermediates.
- Correctness: NaN propagation in aggregations; float comparison without tolerance; off-by-one in date ranges; timezone-naive vs timezone-aware datetime mixing; incorrect merge/join keys.
- Code quality: PEP 8 naming and spacing; functions longer than 30 lines without decomposition; magic numbers; missing type hints on function signatures; bare except clauses.
- Data analysis best practices: reproducibility (random seeds); hardcoded file paths; missing data validation at pipeline entry; no assertions on expected DataFrame shape or dtypes after transforms.
- Performance: use of .apply() vs vectorised NumPy/Pandas; SQL pushdown (filtering at DB level rather than Python); unnecessary .reset_index() calls; sorting when unnecessary.`;

// With a rubric the prompt is the reviewer, the data context and the rubric. The general audit and
// the language focus areas are left out entirely: they are what pulled a report off the rubric.
function buildSystemPrompt(language: string, dialect: string | undefined, schema: string | undefined, rubric: string[], task: string): string {
  const lang = language.toLowerCase();
  const dialectName = dialect ?? 'standard SQL';
  const reviewer = lang === 'sql'
    ? `You are a Senior Data Engineer and SQL expert with 15+ years of experience specialising in ${dialectName}.`
    : lang === 'python'
      ? 'You are a Senior Data Scientist and Python engineer with 15+ years of experience in data analysis, data engineering, and machine learning pipelines.'
      : 'You are a Senior Software Engineer and technical educator with 15+ years of experience across software development, data engineering, and analytics.';
  const dataContext = !schema?.trim() ? ''
    : lang === 'sql'
      ? `\nSCHEMA AND CONTEXT PROVIDED BY THE INSTRUCTOR:\n${schema.trim()}\nUse this schema to validate table names, column names, data types, and JOIN conditions.\n`
      : `\nDATA CONTEXT PROVIDED BY THE INSTRUCTOR:\n${schema.trim()}\nUse this context to validate column references, data types, and assumptions about the dataset.\n`;

  if (rubric.length > 0) {
    return `${reviewer} You are marking a student's code against the instructor's rubric.${dataContext}\n${rubricInstructions(rubric, 'the line number(s), e.g. "12" or "5-8", or "" if it concerns the whole submission')}`;
  }
  const focus = lang === 'sql' ? `\n\n${SQL_FOCUS(dialectName)}` : lang === 'python' ? `\n\n${PYTHON_FOCUS}` : '';
  return `${reviewer}${dataContext}\n${taskInstructions(task)}${BASE_INSTRUCTIONS}${focus}`;
}

export async function POST(req: NextRequest) {
  // Set only once an attempt has actually been taken, so a failure before that point cannot hand
  // back an allowance nobody spent.
  let refundAttempt: (() => Promise<void>) | null = null;

  try {
    const auth = await requireUser(req);
    if (isAuthError(auth)) return auth.error;

    const body = await req.json();
    const { code, language = 'Unknown', dialect } = body;
    if (!code?.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 });

    if (code.length > MAX_CODE_CHARS) {
      return NextResponse.json(
        { error: 'Code too long. Please submit under 20,000 characters.' },
        { status: 413 },
      );
    }

    // Rubric, pass mark and schema come from the saved step, never the request (staff previews aside).
    const resolved = await resolveReviewItem(auth, body.reviewTarget, 'code_review', { rubric: body.rubric, schema: body.schema, minScore: body.minScore });
    if ('response' in resolved) return resolved.response;
    const rubric = reviewRubric(resolved.item);
    const schema = reviewText(resolved.item, 'schema', 20_000);
    const minScore = reviewMinScore(resolved.item);

    // Charged only once the request is worth running. Taking the attempt first meant an empty or
    // oversized submission drained an allowance for a review that was never going to happen.
    const charge = await chargeAiFeature(auth, getRedis(), 'codeReview', {
      unavailableMessage: 'Service temporarily unavailable',
    });
    if (charge.response) return charge.response;
    // Only an attempt the counter really took can be given back.
    const receipt = charge.receipt;
    if (receipt) refundAttempt = () => refundAiFeature(receipt);

    const dialectLabel = dialect ? ` (${dialect})` : '';
    const fullPrompt = `${buildSystemPrompt(language, dialect, schema, rubric, reviewTask(resolved.item))}\n\n${REVIEW_GRADING_INSTRUCTIONS}\n\nLanguage: ${language}${dialectLabel}\n\nCode to review:\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\``;

    const parsed = await generateJSON(fullPrompt, reviewSchema({ findings: FINDINGS, hasRubric: rubric.length > 0 }), { feature: 'code-review',
      temperature: 0.25,
      usageContext: {
        operation: 'code-review',
        metadata: {
          codeChars: code.length,
          language: String(language),
          rubricCriteria: rubric.length,
        },
      },
    });
    return NextResponse.json({ ...scoreRubricReview(parsed, rubric, 'issues'), minScore });
  } catch (err: any) {
    console.error('code-review error:', err);
    // The review never happened, so it should not have cost them an attempt.
    await refundAttempt?.();
    if (err instanceof AiConfigurationError) return aiConfigurationResponse();
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
