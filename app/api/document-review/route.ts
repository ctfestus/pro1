import { Type } from '@google/genai';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = 3;
const RATE_WINDOW_SECONDS = 86400;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

const SUPPORTED_MIME: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  txt:  'text/plain',
};

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
    if (await bumpRateLimit(redis, `rate:document-review:${userId}`, RATE_LIMIT, RATE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: `Limit reached: ${RATE_LIMIT} document reviews per day. Try again tomorrow.` },
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
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name:           { type: Type.STRING },
          severity:       { type: Type.STRING },
          title:          { type: Type.STRING },
          detail:         { type: Type.STRING },
          recommendation: { type: Type.STRING },
        },
        required: ['name', 'severity', 'title', 'detail', 'recommendation'],
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
  required: ['overallScore', 'executiveSummary', 'sections', 'categories', 'topRecommendations'],
};

const SYSTEM_PROMPT = `You are a panel of senior business consultants and strategy advisors -- a Strategy Partner, a Management Consultant, a Corporate Finance Director, a Market Research Lead, and a Business Writing Coach -- each with 15+ years of experience reviewing strategy and business reports across African markets including banking, fintech, FMCG, telecoms, retail, healthcare, manufacturing, agriculture, and public sector.

You review student-submitted business and strategy reports with the rigour of a senior consultant and the clarity of a patient mentor who understands real-world African business contexts.

Review the document across five categories (score each 0-100):

1. Strategic Analysis Quality
   Depth and accuracy of the situation analysis, SWOT/PESTEL/Porter's or equivalent frameworks. Are insights specific and evidence-based or generic and superficial? Does the student show command of the strategic environment?

2. Market Research & Evidence
   Quality of data cited, research rigor, relevance to the African/local context, use of credible sources. Are claims backed by facts or assumed?

3. Recommendations & Actionability
   Are the recommendations specific, prioritised, financially grounded, and implementable? Do they follow logically from the analysis? Are risks and trade-offs considered?

4. Financial Viability (if applicable)
   Soundness of any financial projections, cost-benefit analysis, or valuation. If no financials are present, score this category based on whether the student addresses resource requirements and budget implications.

5. Structure, Clarity & Professionalism
   Report organisation (executive summary, body, conclusion), flow of argument, use of headings, grammar, tone, and overall presentation quality.

For each section-level issue provide:
- name: which section it falls under (e.g. "Executive Summary", "Market Analysis", "Financial Projections")
- severity: "critical" (major gap that undermines the report), "improvement" (notable weakness), or "suggestion" (refinement opportunity)
- title: short specific issue name
- detail: 1-2 sentences explaining the problem
- recommendation: specific actionable fix

Also provide:
- overallScore: weighted average score 0-100 (one decimal)
- executiveSummary: 2-3 sentence briefing for the instructor on this student's report quality and key strengths/weaknesses
- topRecommendations: exactly 3 highest-priority improvements ordered by impact
- rubricGrades: grade each rubric criterion if provided

Return ONLY valid JSON. No markdown fences.`;

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth instanceof NextResponse) return auth;

    const formData  = await req.formData();
    const file      = formData.get('file') as File | null;
    const context   = (formData.get('context') as string | null) ?? '';
    const rubricRaw = formData.get('rubric') as string | null;
    const rubric    = rubricRaw ? JSON.parse(rubricRaw) as string[] : [];

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = SUPPORTED_MIME[ext];
    if (!mimeType) {
      return NextResponse.json({ error: 'Only PDF, DOCX, DOC, and TXT files are supported.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large. Maximum size is 20 MB.' }, { status: 413 });
    }

    // Rate limit checked after validation so bad requests don't burn credits
    const rateLimitError = await checkRateLimit(auth.userId);
    if (rateLimitError) return rateLimitError;

    const buffer = await file.arrayBuffer();

    // Build Gemini prompt
    const contextBlock = context.trim()
      ? `\nINSTRUCTOR CONTEXT -- WHAT THIS REPORT SHOULD COVER:\n${context.trim()}\n`
      : '';
    const rubricBlock = rubric.length > 0
      ? `\nINSTRUCTOR RUBRIC -- GRADE EACH CRITERION\nGrade every criterion with a "passed" boolean and a 1-2 sentence "comment".\n\nCriteria:\n${rubric.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
      : '';
    const promptText = `${SYSTEM_PROMPT}${contextBlock}${rubricBlock}\n\nReview the attached document.`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const ai = new GoogleGenAI({ apiKey });

    const base64 = Buffer.from(buffer).toString('base64');
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2,
      },
    });

    const safeJSON = (text: string) =>
      JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    const parsed = safeJSON(result.text ?? '{}');

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('[document-review] error:', err);
    return NextResponse.json({
      error: 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.',
    }, { status: 503 });
  }
}
