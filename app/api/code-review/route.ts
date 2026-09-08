import { Type } from '@google/genai';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_CODE_CHARS = 20_000;
const RATE_LIMIT = 3;
const RATE_WINDOW_SECONDS = 86400;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function authenticate(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  return { userId: auth.user.id };
}

async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  try {
    if (await bumpRateLimit(redis, `rate:code-review:${userId}`, RATE_LIMIT, RATE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: `Limit reached: ${RATE_LIMIT} code reviews per day. Try again tomorrow.` },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
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
          lines:    { type: Type.STRING },
          severity: { type: Type.STRING },
          title:    { type: Type.STRING },
          detail:   { type: Type.STRING },
          fix:      { type: Type.STRING },
        },
        required: ['lines', 'severity', 'title', 'detail', 'fix'],
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
          criterion: { type: Type.STRING },
          passed:    { type: Type.BOOLEAN },
          comment:   { type: Type.STRING },
        },
        required: ['criterion', 'passed', 'comment'],
      },
    },
  },
  required: ['overallScore', 'executiveSummary', 'issues', 'categories', 'topRecommendations'],
};

const BASE_INSTRUCTIONS = `You review student code with the precision of a top-tier tech company code review and the clarity of a patient mentor.

Your task: review the submitted code and deliver honest, actionable feedback structured as follows.

ISSUE DETECTION
Identify every issue in the code. For each issue provide:
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

For each category provide score, a 2-sentence summary, 1-3 strengths, and 1-3 gaps.

Also provide:
- overallScore: weighted average (one decimal)
- executiveSummary: 2-3 sentences. Write as if briefing a technical lead on this student's submission. Be direct.
- topRecommendations: exactly 3 strings -- the highest-impact changes, ordered by priority.

Return ONLY valid JSON matching the schema. No markdown fences, no explanation outside JSON.`;

function buildSystemPrompt(language: string, dialect?: string, schema?: string): string {
  const lang = language.toLowerCase();

  if (lang === 'sql') {
    const dialectName = dialect ?? 'standard SQL';
    const schemaBlock = schema?.trim()
      ? `\nSCHEMA AND CONTEXT PROVIDED BY STUDENT:\n${schema.trim()}\nUse this schema to validate table names, column names, data types, and JOIN conditions. Flag any reference to a table or column not present in the schema as an error.\n`
      : '';
    return `You are a Senior Data Engineer and SQL expert with 15+ years of experience specialising in ${dialectName}.${schemaBlock}
${BASE_INSTRUCTIONS}

SQL-SPECIFIC FOCUS AREAS (apply all that are relevant to ${dialectName}):
- Correctness: verify JOIN conditions (missing ON clause, cartesian products, wrong join type); NULL handling in WHERE/HAVING clauses (use IS NULL not = NULL); GROUP BY completeness (all non-aggregated SELECT columns must appear); HAVING vs WHERE placement; subquery correlated vs uncorrelated correctness.
- Performance: missing or redundant indexes implied by the query; SELECT * in production queries; N+1 patterns; functions on indexed columns in WHERE (e.g. LOWER(col) = ... prevents index use); large IN lists; unnecessary DISTINCT.
- Window functions: correct PARTITION BY / ORDER BY; ROWS vs RANGE frame differences; using window functions where aggregation suffices.
- Dialect-specific pitfalls for ${dialectName}: flag any syntax or function not available in ${dialectName} (e.g. QUALIFY in BigQuery, ISNULL vs COALESCE differences, LIMIT vs TOP, date arithmetic syntax, STRING_AGG vs GROUP_CONCAT, UNNEST usage).
- Safety: parameterised queries vs string concatenation (SQL injection); hardcoded credentials or environment values in queries.
- Style: CTEs preferred over deeply nested subqueries; consistent aliasing; meaningful alias names (not single letters for complex tables).`;
  }

  if (lang === 'python') {
    const schemaBlock = schema?.trim()
      ? `\nDATA CONTEXT PROVIDED BY STUDENT:\n${schema.trim()}\nUse this context to validate column references, data types, and assumptions about the dataset.\n`
      : '';
    return `You are a Senior Data Scientist and Python engineer with 15+ years of experience in data analysis, data engineering, and machine learning pipelines.${schemaBlock}
${BASE_INSTRUCTIONS}

PYTHON-SPECIFIC FOCUS AREAS (data analysis and engineering context):
- Pandas anti-patterns: chained indexing (df[...][...] vs .loc/.iloc); iterrows() over vectorised operations; apply() where built-in methods exist; inplace=True misuse; not using .copy() when slicing; implicit index alignment gotchas.
- Memory efficiency: loading entire datasets when chunking/lazy evaluation suffices; object dtype columns that should be category; unnecessary full DataFrame copies; not releasing memory after large intermediates.
- Correctness: NaN propagation in aggregations; float comparison without tolerance; off-by-one in date ranges; timezone-naive vs timezone-aware datetime mixing; incorrect merge/join keys.
- Code quality: PEP 8 naming and spacing; functions longer than 30 lines without decomposition; magic numbers; missing type hints on function signatures; bare except clauses.
- Data analysis best practices: reproducibility (random seeds); hardcoded file paths; missing data validation at pipeline entry; no assertions on expected DataFrame shape or dtypes after transforms.
- Performance: use of .apply() vs vectorised NumPy/Pandas; SQL pushdown (filtering at DB level rather than Python); unnecessary .reset_index() calls; sorting when unnecessary.`;
  }

  return `You are a Senior Software Engineer and technical educator with 15+ years of experience across software development, data engineering, and analytics.\n${BASE_INSTRUCTIONS}`;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth instanceof NextResponse) return auth;

    const rateLimitError = await checkRateLimit(auth.userId);
    if (rateLimitError) return rateLimitError;

    const { code, language = 'Unknown', dialect, schema, rubric } = await req.json();
    if (!code?.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 });

    if (code.length > MAX_CODE_CHARS) {
      return NextResponse.json(
        { error: 'Code too long. Please submit under 20,000 characters.' },
        { status: 413 },
      );
    }

    const systemPrompt = buildSystemPrompt(language, dialect, schema);

    const rubricSection = Array.isArray(rubric) && rubric.length > 0
      ? `\n\nINSTRUCTOR RUBRIC -- GRADE EACH CRITERION\nGrade every criterion below with a "passed" boolean and a 1-2 sentence "comment".\n\nCriteria:\n${rubric.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}\n\nGrade strictly.`
      : '';

    const dialectLabel = dialect ? ` (${dialect})` : '';
    const fullPrompt = `${systemPrompt}${rubricSection}\n\nLanguage: ${language}${dialectLabel}\n\nCode to review:\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\``;

    const parsed = await generateJSON(fullPrompt, responseSchema, {
      temperature: 0.25,
      usageContext: {
        operation: 'code-review',
        metadata: {
          codeChars: code.length,
          language: String(language),
          rubricCriteria: Array.isArray(rubric) ? rubric.length : 0,
        },
      },
    });
    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('code-review error:', err);
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
