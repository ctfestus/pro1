import { Type } from '@google/genai';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { generateVisionJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 10 MB base64 limit ≈ ~7.5 MB raw image -- enough for any screenshot
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 3 analyses per day per user
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
    if (await bumpRateLimit(redis, `rate:dashboard-critique:${userId}`, RATE_LIMIT, RATE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: `Limit reached: ${RATE_LIMIT} dashboard analyses per day. Try again tomorrow.` },
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
    elements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id:          { type: Type.STRING },
          label:       { type: Type.STRING },
          elementType: { type: Type.STRING },
          bounds: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER },
            },
            required: ['x', 'y', 'w', 'h'],
          },
          strengths:      { type: Type.ARRAY, items: { type: Type.STRING } },
          weaknesses:     { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendation: { type: Type.STRING },
        },
        required: ['id', 'label', 'elementType', 'bounds', 'strengths', 'weaknesses', 'recommendation'],
      },
    },
    audit: {
      type: Type.OBJECT,
      properties: {
        overallScore: { type: Type.NUMBER },
        executiveSummary: { type: Type.STRING },
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name:       { type: Type.STRING },
              score:      { type: Type.NUMBER },
              summary:    { type: Type.STRING },
              strengths:  { type: Type.ARRAY, items: { type: Type.STRING } },
              gaps:       { type: Type.ARRAY, items: { type: Type.STRING } },
              priority:   { type: Type.STRING },
            },
            required: ['name', 'score', 'summary', 'strengths', 'gaps', 'priority'],
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
      required: ['overallScore', 'executiveSummary', 'categories', 'topRecommendations'],
    },
  },
  required: ['elements', 'audit'],
};

const SYSTEM_PROMPT = `You are a Senior Partner at McKinsey & Company specialising in data storytelling, executive dashboard design, and information architecture. You have advised Fortune 500 clients on turning raw data into board-level decision tools. You hold the same design standards as Edward Tufte, Stephen Few, and the Google Material Design team.

Your task: audit every visible element in the attached dashboard screenshot and deliver ruthlessly honest, board-ready coaching feedback.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ELEMENT DETECTION -- ZERO TOLERANCE FOR OMISSIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Detect and box EVERY visible component individually:
- Each KPI / metric tile separately (a row of 4 = 4 elements, not 1)
- Every chart container (include its title + legend in the same box)
- Every data table or grid
- Every filter, slicer, date picker, or dropdown
- Every page header, section title, or navigation bar
- Every legend, axis label block, or annotation
- Any logo, timestamp, or page number in the corners

BOUNDING BOX FORMAT -- normalized 0.0-1.0 relative to full image dimensions:
{ "x": left edge, "y": top edge, "w": width, "h": height }
Boxes must be tight to the element, not loose approximations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FEEDBACK STANDARDS -- McKINSEY PARTNER LEVEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are coaching an analyst who will present this dashboard to a C-suite audience. Mediocre feedback wastes their time. Apply these non-negotiables:

TYPOGRAPHY & HIERARCHY
- Title: 20-28px, bold (weight 700+). If it reads like body text, say so.
- KPI value: 28-40px, bold. The number must dominate the card.
- KPI label: 11-13px, medium weight, muted colour -- supporting, never competing.
- Body / axis labels: 11-13px, regular weight.
- If font sizes are inconsistent across sibling elements (e.g., two KPI cards with different value sizes), flag it as a consistency failure.
- If a title is ALL CAPS when mixed-case would be more readable, recommend the change.

COLOUR & CONTRAST
- A sequential colour palette must have one dominant hue with lightness variation -- not rainbow.
- Categorical colours must be distinct and accessible (WCAG AA minimum 4.5:1 contrast on backgrounds).
- If more than 4-5 colours are used in a single chart, flag colour overload.
- Highlight colour (accent) must appear on no more than 1-2 elements to retain impact.
- Dark backgrounds require high-contrast text (white or near-white). Light text on mid-grey = failure.

CHART SELECTION & DATA-INK RATIO
- Bar charts: always start at zero. A truncated axis is misleading -- name it explicitly.
- Pie/donut charts: acceptable only for 2-3 segments showing part-to-whole. More than 4 slices = recommend a bar chart.
- Line charts: only for continuous time-series. Do not use for categorical comparisons.
- 3D effects, shadows, or gradients on data series: always flag as chartjunk -- remove them.
- Gridlines: light grey, horizontal only. Vertical gridlines on bar charts = noise.
- Data labels on every bar of a dense bar chart = clutter. Recommend axis + selective callouts instead.

LAYOUT & VISUAL HIERARCHY
- The most important insight must be in the top-left or top-centre (F-pattern reading).
- KPI tiles belong above charts -- they set context for what the charts explain.
- Filters and controls belong at the top, not scattered.
- Consistent card padding: at least 12-16px internal padding. Cards that feel cramped reduce trust.
- White space is not wasted space -- dense dashboards signal poor prioritisation.

NUMBERS & FORMATTING
- Large numbers must use K / M / B abbreviations with one decimal (e.g., 1.4M not 1,400,000).
- Currency must show symbol. Percentage must show % sign. Never leave units ambiguous.
- Align numbers right in tables. Left-aligning numbers is a beginner error.
- Avoid showing more than 2 decimal places unless precision is scientifically required.

STORYTELLING & DECISION SUPPORT
- Every chart must answer one specific business question. If the title does not state the question or finding, flag it.
- Descriptive titles ("Sales by Region") are weaker than insight titles ("North leads sales, East declining YoY").
- If a KPI shows no trend, target, or benchmark, flag it -- a raw number without context does not support a decision.
- Callout boxes, reference lines, and annotations turn passive charts into active stories -- recommend them where missing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT NEVER TO WRITE IN FEEDBACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER mention:
- Whether elements are "floating", "positioned", "placed", or their layout coordinates.
- Generic praise like "looks good", "well designed", or "professional".
- Vague negatives like "could be improved" without specifying exactly how.
- Implementation tools or code (no CSS, HTML, or software-specific advice).

ALWAYS write:
- Specific measurements where relevant (e.g., "increase to 18px", "reduce to 2 colours").
- The business impact of the issue (e.g., "a truncated Y-axis will mislead executives about the scale of variance").
- One recommendation per element -- the single highest-priority change to make.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2 -- HOLISTIC AUDIT REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After completing element-level analysis, evaluate the ENTIRE dashboard against these 11 principles and group them into exactly 4 aggregated audit categories:

CATEGORY 1 -- "Layout & Structure"
Covers: (1) Layout & Visual Hierarchy, (8) White Space, (10) Consistency
Score out of 100: penalise for cluttered layouts, inconsistent card sizes, poor reading flow, insufficient padding, mixed font styles.

CATEGORY 2 -- "Visual Design"
Covers: (4) Color Usage, (3) Chart Type Selection, (6) Axes & Scales
Score out of 100: penalise for rainbow colour palettes, 3D charts, truncated axes, inaccessible contrast, incorrect chart type for data type.

CATEGORY 3 -- "Data Clarity"
Covers: (2) Titles & Labels, (5) Data Labeling, (7) Tables & Numbers
Score out of 100: penalise for missing units, ambiguous titles, overcrowded labels, left-aligned numbers in tables, raw numbers without K/M/B formatting.

CATEGORY 4 -- "Insight & Storytelling"
Covers: (9) Callouts & Highlights, (11) Positive Reinforcement, and overall decision-support quality
Score out of 100: penalise for descriptive-only titles (no insight), missing benchmarks or targets on KPIs, no callout annotations, no clear narrative flow.

For each category provide:
- score (0-100, be honest -- a score of 80+ must be genuinely earned)
- summary (2-3 sentences, McKinsey-level directness -- what the score reflects)
- strengths (1-3 specific things working well in this category)
- gaps (1-3 specific failures that pulled the score down; empty [] only if truly flawless)
- priority: "HIGH" | "MEDIUM" | "LOW" -- how urgently this category needs attention

Also provide:
- overallScore: weighted average of the 4 category scores (one decimal)
- executiveSummary: 3-4 sentences. Write as if briefing a C-suite sponsor on this analyst's dashboard. Be direct about what works and what needs to change before this reaches a real audience.
- topRecommendations: exactly 3 strings -- the single highest-impact actions across the entire dashboard, ordered by priority. Each must be concrete and specific (e.g., "Replace the 6-colour pie chart with a ranked horizontal bar chart sorted by value descending").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elementType values: HEADER | KPI_CARD | BAR_CHART | LINE_CHART | PIE_CHART | STACKED_CHART | SCATTER_CHART | TABLE | FILTER | LEGEND | SECTION_TITLE | NAVIGATION | ANNOTATION | OTHER

Return ONLY valid JSON matching the schema. No markdown fences, no explanation text outside the JSON.`;

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth instanceof NextResponse) return auth;

    const rateLimitError = await checkRateLimit(auth.userId);
    if (rateLimitError) return rateLimitError;

    const { imageBase64, mimeType = 'image/png', rubric } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 });

    if (imageBase64.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: 'Image too large. Please upload a screenshot under 7 MB.' },
        { status: 413 },
      );
    }



    const rubricSection = Array.isArray(rubric) && rubric.length > 0
      ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nINSTRUCTOR RUBRIC -- GRADE EACH CRITERION\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThe instructor has defined the following specific criteria for this assignment. In the audit.rubricGrades array, evaluate EVERY criterion below with a "passed" boolean and a 1-2 sentence "comment" explaining your judgement.\n\nCriteria:\n${rubric.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}\n\nGrade strictly -- if the dashboard partially meets a criterion, mark passed: false and explain what's missing.`
      : '';

    const fullPrompt = SYSTEM_PROMPT + rubricSection;

    const parsed = await generateVisionJSON(fullPrompt, { data: imageBase64, mimeType }, responseSchema, {
      temperature: 0.35,
      usageContext: {
        operation: 'dashboard-critique',
        metadata: {
          imageBytesApprox: Math.floor(imageBase64.length * 0.75),
          mimeType,
          rubricCriteria: Array.isArray(rubric) ? rubric.length : 0,
        },
      },
    });
    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('dashboard-critique error:', err);
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
