import { Type } from '@google/genai';
import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { pdfPageImageUrl } from '@/lib/cloudinary-pdf';
import type { LessonDoc } from '@/lib/lesson-doc';
import { normalizePythonCodeInput } from '@/lib/python-engine';

// Full-course generation fans out many LLM calls; use the platform's maximum window.
export const maxDuration = 300;

const ALLOWED_ACTIONS = new Set([
  'generate_questions',
  'generate_distractors',
  'generate_lesson',
  'generate_hint',
  'generate_explanation',
  'generate_outcomes',
  'generate_course_description',
  'generate_event_setup',
  'generate_broadcast_email',
  'generate_sql_course_outline',
  'generate_sql_course_full',
  'generate_doc_course_outline',
  'generate_doc_course_full',
  'generate_python_course_outline',
  'generate_python_course_full',
]);

async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) {
    // Fail closed -- AI is a paid feature, don't allow through if limiter is down
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  try {
    if (await bumpRateLimit(redis, `rate:ai-course:${userId}`, 20, 3600)) {
      return NextResponse.json(
        { error: 'AI generation limit reached. You can make up to 20 requests per hour.' },
        { status: 429 },
      );
    }
  } catch {
    // Redis error -- fail closed
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

const getYouTubeApiKey = () => process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '';

const buildYouTubeUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

const PREFERRED_CHANNELS = [
  'Google',
  'Microsoft',
  'TEDx Talks',
  'TED',
  'Alex The Analyst',
  'Maven Analytics',
  'freeCodeCamp.org',
  'Khan Academy',
  'CrashCourse',
  'Fireship',
  'Programming with Mosh',
  'Traversy Media',
  'Google Developers',
  'Microsoft Developer',
  'DeepLearningAI',
  'StatQuest with Josh Starmer',
];

const OFFICIAL_CHANNEL_KEYWORDS = [
  'google',
  'microsoft',
  'ted',
  'tedx',
  'google developers',
  'microsoft developer',
];

const CLICKBAIT_PATTERNS = [
  'shocking',
  'insane',
  'crazy',
  'unbelievable',
  'secret',
  'secrets',
  'must watch',
  "won't believe",
  'you wont believe',
  'guaranteed',
  'click here',
  'thumbnail',
];

const TUTORIAL_PATTERNS = [
  'tutorial',
  'course',
  'explained',
  'lesson',
  'guide',
  'walkthrough',
  'training',
  'bootcamp',
  'for beginners',
  'step by step',
  'learn',
];

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const containsAny = (text: string, patterns: string[]) =>
  patterns.some(pattern => text.includes(pattern));

// Resolve a creator-provided channel reference (name, @handle, or URL) to a YouTube channelId.
async function resolveYouTubeChannelId(input: string, apiKey: string): Promise<string | null> {
  const raw = input.trim();
  if (!raw) return null;

  // Already a channel ID.
  if (/^UC[\w-]{22}$/.test(raw)) return raw;

  // Pull a handle or id out of a pasted URL.
  let handle = '';
  let query = raw;
  const urlMatch = raw.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i);
  if (urlMatch) {
    if (urlMatch[1]) return urlMatch[1];                       // /channel/UC...
    handle = urlMatch[2] || urlMatch[3] || urlMatch[4] || '';
    query = handle;
  } else if (raw.startsWith('@')) {
    handle = raw.slice(1);
    query = handle;
  }

  // Try the precise handle lookup first.
  if (handle) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const json = await res.json();
        const id = json?.items?.[0]?.id;
        if (id) return id as string;
      }
    } catch { /* fall through to name search */ }
  }

  // Fall back to a channel search by name.
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&type=channel&maxResults=1&q=${encodeURIComponent(query)}&key=${apiKey}`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const json = await res.json();
      const id = json?.items?.[0]?.id?.channelId;
      if (id) return id as string;
    }
  } catch { /* no channel found */ }

  return null;
}

// Find the most relevant embeddable video for a query WITHIN a specific channel.
async function findChannelVideo(channelId: string, query: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    channelId,
    q: query,
    type: 'video',
    maxResults: '5',
    order: 'relevance',
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    relevanceLanguage: 'en',
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const json = await res.json();
  const videoId = (json.items || []).map((item: any) => item?.id?.videoId).filter(Boolean)[0];
  return videoId ? buildYouTubeUrl(videoId) : null;
}

async function findLessonVideo(query: string, preferredChannels: string[] = []): Promise<string | null> {
  const apiKey = getYouTubeApiKey();
  if (!apiKey || !query.trim()) return null;

  // If the creator named channels, pull a video FROM those channels first -- a generic
  // topic search will not surface a niche channel, so restricting the search is the only
  // reliable way to honor the preference.
  const namedChannels = preferredChannels.map(c => c.trim()).filter(Boolean).slice(0, 3);
  for (const channel of namedChannels) {
    const channelId = await resolveYouTubeChannelId(channel, apiKey).catch(() => null);
    if (!channelId) continue;
    const url = await findChannelVideo(channelId, query, apiKey).catch(() => null);
    if (url) return url;
  }

  // General search (used when no channels were named, or none had a relevant video).
  const userChannels = preferredChannels.map(c => c.toLowerCase().trim()).filter(Boolean);

  const searchParams = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '12',
    order: 'rating',
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    relevanceLanguage: 'en',
  });

  const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`, {
    cache: 'no-store',
  });

  if (!searchRes.ok) {
    const text = await searchRes.text().catch(() => '');
    throw new Error(text || 'YouTube search failed');
  }

  const searchJson = await searchRes.json();
  const videoIds = (searchJson.items || [])
    .map((item: any) => item?.id?.videoId)
    .filter(Boolean)
    .slice(0, 8);

  if (!videoIds.length) return null;

  const detailsParams = new URLSearchParams({
    key: apiKey,
    part: 'snippet,statistics,contentDetails,status',
    id: videoIds.join(','),
  });

  const detailsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams.toString()}`, {
    cache: 'no-store',
  });

  if (!detailsRes.ok) {
    const text = await detailsRes.text().catch(() => '');
    throw new Error(text || 'YouTube video lookup failed');
  }

  const detailsJson = await detailsRes.json();
  const scored = (detailsJson.items || [])
    .filter((item: any) => item?.status?.embeddable !== false)
    .map((item: any) => {
      const stats = item.statistics || {};
      const snippet = item.snippet || {};
      const viewCount = toNumber(stats.viewCount);
      const likeCount = toNumber(stats.likeCount);
      const commentCount = toNumber(stats.commentCount);
      const engagement = viewCount > 0 ? (likeCount * 5 + commentCount * 2) / viewCount : 0;
      const channelTitle = String(snippet.channelTitle || '').toLowerCase();
      const title = String(snippet.title || '').toLowerCase();
      const description = String(snippet.description || '').toLowerCase();
      const combinedText = `${title} ${description}`;
      const preferredBoost = PREFERRED_CHANNELS.reduce((score, channel) => {
        const name = channel.toLowerCase();
        if (channelTitle === name) return score + 200;
        if (channelTitle.includes(name)) return score + 120;
        return score;
      }, 0);
      // Channels the creator explicitly asked for win decisively over the defaults.
      const userPreferredBoost = userChannels.reduce((score, name) => {
        if (channelTitle === name) return score + 600;
        if (channelTitle.includes(name)) return score + 400;
        return score;
      }, 0);
      const officialBoost = containsAny(channelTitle, OFFICIAL_CHANNEL_KEYWORDS) ? 80 : 0;
      const tutorialBoost = containsAny(combinedText, TUTORIAL_PATTERNS) ? 45 : 0;
      const clickbaitPenalty = containsAny(combinedText, CLICKBAIT_PATTERNS) ? 80 : 0;
      const shortPenalty = viewCount < 5_000 ? 18 : 0;
      const topCreatorBoost =
        viewCount >= 1_000_000 ? 35 :
        viewCount >= 250_000 ? 18 :
        viewCount >= 100_000 ? 10 : 0;
      const score =
        userPreferredBoost +
        preferredBoost +
        officialBoost +
        tutorialBoost +
        topCreatorBoost +
        engagement * 1000 +
        Math.log10(viewCount + 1) * 10 -
        clickbaitPenalty -
        shortPenalty;
      return { id: item.id as string, score };
    })
    .sort((a: any, b: any) => b.score - a.score);

  return scored[0]?.id ? buildYouTubeUrl(scored[0].id) : null;
}

// Find a relevant stock photo for a lesson. Tries Unsplash, then Pexels.
// Returns null when no key is configured so the feature degrades gracefully.
async function findStockImage(query: string): Promise<string | null> {
  if (!query?.trim()) return null;

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (unsplashKey) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&content_filter=high&query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Client-ID ${unsplashKey}` }, cache: 'no-store' },
      );
      if (res.ok) {
        const json = await res.json();
        const url = json?.results?.[0]?.urls?.regular;
        if (url) return url as string;
      }
    } catch { /* fall through to Pexels */ }
  }

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?per_page=1&orientation=landscape&size=large&query=${encodeURIComponent(query)}`,
        { headers: { Authorization: pexelsKey }, cache: 'no-store' },
      );
      if (res.ok) {
        const json = await res.json();
        const src = json?.photos?.[0]?.src;
        // Prefer the high-res variant; fall back through progressively smaller ones.
        const url = src?.large2x ?? src?.landscape ?? src?.large;
        if (url) return url as string;
      }
    } catch { /* no image available */ }
  }

  return null;
}

async function checkDocCourseRateLimit(userId: string, role: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  const limit = role === 'admin' ? 20 : 5;
  try {
    if (await bumpRateLimit(redis, `rate:ai-doc-course:${userId}`, limit, 3600)) {
      return NextResponse.json(
        { error: `AI course limit reached. You can generate ${limit} courses per hour.` },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

async function checkSqlCourseRateLimit(userId: string, role: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  const limit = role === 'admin' ? 20 : 5;
  try {
    if (await bumpRateLimit(redis, `rate:ai-sql-course:${userId}`, limit, 3600)) {
      return NextResponse.json(
        { error: `AI SQL course limit reached. You can generate ${limit} courses per hour.` },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

async function checkPythonCourseRateLimit(userId: string, role: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  const limit = role === 'admin' ? 20 : 5;
  try {
    if (await bumpRateLimit(redis, `rate:ai-python-course:${userId}`, limit, 3600)) {
      return NextResponse.json(
        { error: `AI Python course limit reached. You can generate ${limit} courses per hour.` },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

// Shared JSON schema shape for interactive lesson blocks (used by multiple actions).
const blockItemSchema = {
  type: Type.OBJECT,
  properties: {
    type:         { type: Type.STRING, description: 'paragraph | heading | bulletList | blockquote | callout | knowledgeCheck | runnableCode' },
    text:         { type: Type.STRING, description: 'For paragraph, heading, blockquote, callout: main text content' },
    level:        { type: Type.NUMBER, description: 'For heading only: always 4' },
    items:        { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For bulletList: the list items as plain strings' },
    variant:      { type: Type.STRING, description: 'For callout: info | warning | success | danger' },
    title:        { type: Type.STRING, description: 'For callout: short header label (3-5 words)' },
    question:     { type: Type.STRING, description: 'For knowledgeCheck: the question text' },
    options:      { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For knowledgeCheck: exactly 4 answer options' },
    correctIndex: { type: Type.NUMBER, description: 'For knowledgeCheck: 0-based index of the correct answer' },
    explanation:  { type: Type.STRING, description: 'For knowledgeCheck: one sentence explaining why the answer is correct' },
    language:     { type: Type.STRING, description: 'For runnableCode: sql | python | javascript' },
    code:         { type: Type.STRING, description: 'For runnableCode: the main code snippet the learner sees and can edit/run' },
    setupSql:     { type: Type.STRING, description: 'For runnableCode sql: CREATE TABLE + INSERT INTO to seed sample data (compact, 3-5 rows)' },
    setupPython:  { type: Type.STRING, description: 'For runnableCode python: import statements and helper setup (no output)' },
  },
  required: ['type'],
};

// Convert AI-generated block list to a ProseMirror/TipTap doc (dependency-free, runs server-side).
function buildLessonDoc(blocks: unknown[]): LessonDoc {
  const makeText = (t: string): LessonDoc => ({ type: 'text', text: t });
  const makePara = (text: string): LessonDoc => ({ type: 'paragraph', content: [makeText(text)] });

  const nodes: LessonDoc[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'paragraph':
        nodes.push(makePara(String(b.text ?? '')));
        break;
      case 'heading':
        nodes.push({ type: 'heading', attrs: { level: Number(b.level) || 4 }, content: [makeText(String(b.text ?? ''))] });
        break;
      case 'bulletList': {
        const items = Array.isArray(b.items) ? b.items : [];
        if (items.length) {
          nodes.push({
            type: 'bulletList',
            content: items.map((item) => ({ type: 'listItem', content: [makePara(String(item))] })),
          });
        }
        break;
      }
      case 'blockquote':
        nodes.push({ type: 'blockquote', content: [makePara(String(b.text ?? ''))] });
        break;
      case 'callout':
        nodes.push({
          type: 'callout',
          attrs: { variant: String(b.variant ?? 'info'), title: String(b.title ?? ''), borderStyle: 'solid', borderColor: '' },
          content: [makePara(String(b.text ?? ''))],
        });
        break;
      case 'knowledgeCheck': {
        const opts = Array.isArray(b.options) ? b.options.map(String) : [];
        nodes.push({
          type: 'knowledgeCheck',
          attrs: {
            question:     String(b.question ?? ''),
            options:      opts,
            correctIndex: Number(b.correctIndex ?? 0),
            explanation:  String(b.explanation ?? ''),
            borderStyle:  'solid',
            borderColor:  '',
          },
        });
        break;
      }
      case 'runnableCode':
        nodes.push({
          type: 'runnableCode',
          attrs: {
            language:    String(b.language ?? 'sql'),
            code:        String(b.code ?? ''),
            setupSql:    String(b.setupSql ?? ''),
            setupPython: String(b.setupPython ?? ''),
          },
        });
        break;
      default:
        break;
    }
  }
  return { type: 'doc', content: nodes.length ? nodes : [makePara('')] };
}

// Shared instructional-design persona for the document-to-course engine.
const DOC_COURSE_PERSONA = `You are a world-class course creator and instructional designer with deep expertise in adult learning, backward design, and skills-based training. Your specialty is transforming documents, documentation, and product guides into JOB-READY, hands-on courses that build real, applicable workplace skills.

Design philosophy:
- Job-ready: every lesson maps to something the learner will actually DO on the job, not just facts to memorize. Frame outcomes as concrete capabilities.
- Hands-on and realistic: teach through worked examples, concrete steps, and realistic workplace scenarios drawn from the document's subject matter. Show how the concept is used in practice.
- Backward design: start from the capability the learner should walk away with, then build lessons and practice toward it.
- Active application: assessments test decision-making and applying the concept in realistic situations, not just definition recall.
- Scaffolded: progress from foundational concepts to applied, scenario-based mastery so confidence builds module over module.`;

// The full vocabulary of exercise types the platform supports, with guidance on when to pick each.
// The engine chooses the most fitting type per lesson based on the document content AND the creator's focus.
const DOC_COURSE_TYPE_GUIDE = `Choose the most fitting exercise type for each lesson based on the document's subject matter and the creator's stated focus. Be decisive and practical - prefer hands-on, tool-appropriate exercises over generic quizzes whenever the content supports it:
- sql_exercise: the learner writes and runs real SQL against sample tables. Use whenever the material involves SQL, querying, or relational databases.
- code_review: the learner writes code and an AI reviewer grades it. Use for programming, scripting, or software tasks.
- excel_review: the learner builds a spreadsheet and an AI reviewer grades it. Use for Excel, spreadsheets, or formula-based analysis.
- dashboard_critique: the learner builds a dashboard/visualization and an AI reviewer critiques it. Use for BI, reporting, analytics, or data visualization.
- document_review: the learner writes a report/document and an AI reviewer grades it. Use for writing, business analysis, strategy, or deliverables.
- written_response: the learner answers a question in their own words (a few paragraphs, typed in the browser) and an AI reviewer grades it against a rubric. Use when the skill is judgement, reasoning, or explanation - recommending an approach, justifying a decision, interpreting a result - rather than producing a document.
- multiple_choice: a scenario-based knowledge check with 4 options. Use for conceptual understanding.
- fill_blank: complete a key term, command, or value. Use for precise recall of syntax or terminology.
- arrange: order the steps of a real process or workflow. Use for procedures and sequences.
- python_exercise: the learner writes and runs real Python code in the browser (Pyodide). Use whenever the material involves Python programming, data analysis with pandas/numpy, automation, or scripting tasks.
STRONGLY honor the creator's focus: if they ask for SQL, make SQL lessons sql_exercise; if they ask for hands-on practice, favor the applied types (sql_exercise, code_review, excel_review, dashboard_critique, document_review, written_response) over plain knowledge checks. Use multiple_choice/fill_blank/arrange for genuinely conceptual lessons or to vary pacing.`;

export async function POST(req: NextRequest) {
  // 1. Authentication + RBAC -- instructors and admins only
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, role: userRole } = auth;

  // 2. Per-user rate limit -- 20 requests per hour
  const rateLimitError = await checkRateLimit(user.id);
  if (rateLimitError) return rateLimitError;

  const body = await req.json();
  const { action } = body;

  // 3. Action allowlist -- reject unknown actions before touching any API
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  // Input length guards -- limit injection surface on user-controlled strings
  const clamp = (val: unknown, max: number): string => String(val ?? '').slice(0, max);

  try {
    // -- Generate a batch of questions from a topic ---
    if (action === 'generate_questions') {
      const topic = clamp(body.topic, 200);
      const count = Math.min(Math.max(Number(body.count) || 5, 1), 20);
      const type = clamp(body.type, 30) || 'multiple_choice';
      const customPrompt = clamp(body.customPrompt, 800);

      // When the creator supplies custom instructions, they lead the prompt and are explicitly
      // marked as mandatory so the model cannot treat them as optional flavoring.
      const creatorBlock = customPrompt
        ? `CREATOR INSTRUCTIONS -- these are mandatory and override any defaults below. Follow them exactly:\n${customPrompt}\n\n`
        : '';

      // sql_exercise: generate realistic SQL tasks with solutions and starter code
      if (type === 'sql_exercise') {
        const result = await generateJSON(
          `${creatorBlock}Generate ${count} hands-on SQL exercise questions about: "${topic}". Each exercise is a realistic workplace task where the learner writes a SQL query to answer a business question.

Format rules (apply these within the creator's requirements above):
- question: a short, realistic business scenario (1-2 sentences) that tells the learner WHAT to retrieve and WHY. Name a stakeholder and their goal.
- sqlSolution: a correct, readable SQL query that answers the task. Use realistic but generic table/column names that match the topic.
- sqlStarterCode: a skeleton or comment the learner starts from, e.g. "SELECT\\n-- your query here" or a partial query with ___. Keep it short.
- sqlHints: 2-3 progressive hints. First hint: which clause to use. Second: which table/column. Third: the full approach.
- No em dashes, no curly quotes, plain ASCII only.`,
          {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id:             { type: Type.STRING, description: 'unique short id like q_abc123' },
                    type:           { type: Type.STRING, description: 'always sql_exercise' },
                    question:       { type: Type.STRING, description: 'Realistic business scenario + task (1-2 sentences)' },
                    sqlSolution:    { type: Type.STRING, description: 'Correct SQL query' },
                    sqlStarterCode: { type: Type.STRING, description: 'Skeleton or partial query the learner edits' },
                    sqlHints:       { type: Type.ARRAY, items: { type: Type.STRING }, description: '2-3 progressive hints' },
                  },
                  required: ['id', 'question', 'sqlSolution', 'sqlStarterCode', 'sqlHints'],
                },
              },
            },
            required: ['questions'],
          },
        );
        return NextResponse.json(result);
      }

      // python_exercise: generate Python coding tasks with starter code, solution, and expected output
      if (type === 'python_exercise') {
        const result = await generateJSON(
          `${creatorBlock}Generate ${count} Python coding exercises about: "${topic}". Each exercise is a practical task the learner completes in the browser (Pyodide). Available packages: pandas, numpy, matplotlib, scipy, scikit-learn.

Format rules (apply these within the creator's requirements above):
- question: a clear, concise task description (1-2 sentences). State what the learner must write or produce.
- pythonSetupCode: import statements and any helper data that runs BEFORE the learner's code. No print() statements here.
- pythonStarterCode: skeleton code with # TODO comments where the learner fills in logic. Include the function/variable names they should define.
- pythonSolution: a complete, correct Python solution that produces the expected output when run after pythonSetupCode.
- pythonExpectedOutput: the exact stdout printed by running pythonSolution (newline-separated). Must match character for character.
- pythonHints: 2-3 progressive hints.
- Keep exercises self-contained: no file I/O, no network calls.
- No em dashes, no curly quotes, plain ASCII only.`,
          {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id:                   { type: Type.STRING, description: 'unique short id like q_abc123' },
                    type:                 { type: Type.STRING, description: 'always python_exercise' },
                    question:             { type: Type.STRING, description: 'Clear task description' },
                    pythonSetupCode:      { type: Type.STRING, description: 'Import statements and setup data (no output)' },
                    pythonStarterCode:    { type: Type.STRING, description: 'Skeleton code with # TODO markers' },
                    pythonSolution:       { type: Type.STRING, description: 'Complete correct Python solution' },
                    pythonExpectedOutput: { type: Type.STRING, description: 'Exact stdout from running the solution' },
                    pythonHints:          { type: Type.ARRAY, items: { type: Type.STRING }, description: '2-3 progressive hints' },
                  },
                  required: ['id', 'question', 'pythonStarterCode', 'pythonSolution', 'pythonExpectedOutput', 'pythonHints'],
                },
              },
            },
            required: ['questions'],
          },
        );
        return NextResponse.json(result);
      }

      // multiple_choice / fill_blank / arrange (existing path)
      const result = await generateJSON(
        `${creatorBlock}Generate ${count} course quiz questions about: "${topic}". Question type: ${type}. For multiple_choice, provide 4 options and mark the correct one. For fill_blank, use ___ in the question text. For arrange, provide items in the correct order.`,
        {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: 'unique short random id like q_abc123' },
                  type: { type: Type.STRING, description: 'multiple_choice, fill_blank, or arrange' },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For MC: 4 options. For arrange: items in correct order. For fill_blank: empty array.' },
                  correctAnswer: { type: Type.STRING, description: 'For MC: exact text of correct option. For fill_blank: the answer word(s). For arrange: options joined with |||' },
                  explanation: { type: Type.STRING, description: 'Brief explanation of why the answer is correct' },
                  hint: { type: Type.STRING, description: 'A subtle hint that nudges toward the answer without giving it away' },
                },
                required: ['id', 'question', 'options', 'correctAnswer'],
              },
            },
          },
          required: ['questions'],
        },
      );
      return NextResponse.json(result);
    }

    // -- Generate distractors (wrong answer options) ---
    if (action === 'generate_distractors') {
      const question = clamp(body.question, 500);
      const correctAnswer = clamp(body.correctAnswer, 300);
      const count = Math.min(Math.max(Number(body.count) || 3, 1), 6);
      const result = await generateJSON(
        `For this quiz question: "${question}" with correct answer: "${correctAnswer}", generate ${count} plausible but incorrect answer options (distractors). They should be convincing enough to challenge students but clearly wrong to someone who knows the material. Return only the distractor strings, no explanations.`,
        {
          type: Type.OBJECT,
          properties: {
            distractors: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['distractors'],
        },
      );
      return NextResponse.json(result);
    }

    // -- Generate lesson content ---
    if (action === 'generate_lesson') {
      const question = clamp(body.question, 500);
      const correctAnswer = clamp(body.correctAnswer, 300);
      const instruction = clamp(body.instruction ?? '', 500);
      const promptText = instruction
        ? `Write a mini, interactive lesson about: "${instruction}".`
        : `Write a mini, interactive lesson that teaches the concept behind this quiz question: "${question}" (correct answer: "${correctAnswer}").`;
      const lesson = await generateJSON(
        `${promptText}

The lesson must be lightweight, scannable, and use interactive components where they add value.

Produce two things:
1. "body": a compact HTML fallback using only <p>, <strong>, <ul>, <li>, <h4>, <blockquote>. 80-140 words. No <hr> dividers.
2. "blocks": an interactive lesson as an ordered array of block nodes for the rich lesson player. Use these types:
   - paragraph: { "type": "paragraph", "text": "..." }
   - heading: { "type": "heading", "level": 4, "text": "Sub-section title" }
   - bulletList: { "type": "bulletList", "items": ["point 1", "point 2", ...] }
   - blockquote: { "type": "blockquote", "text": "A standout rule or tip" }
   - callout: { "type": "callout", "variant": "info"|"warning"|"success"|"danger", "title": "Label", "text": "..." }
   - knowledgeCheck: { "type": "knowledgeCheck", "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }
   - runnableCode: { "type": "runnableCode", "language": "sql"|"python"|"javascript", "code": "...", "setupSql": "...", "setupPython": "..." }

Blocks structure rules:
- Start with a hook: a callout (info/success) or paragraph that frames WHY this matters.
- Use a bulletList or heading + paragraphs for 2-4 key points or steps.
- Include runnableCode ONLY when the concept involves SQL or Python -- skip it for purely conceptual topics.
  - SQL runnableCode: always include setupSql with CREATE TABLE + INSERT (3-5 rows) so the query is actually runnable.
  - Python runnableCode: include setupPython with imports if needed.
- End with exactly one knowledgeCheck testing the core concept.
- Keep total prose under 150 words across all blocks.

Also provide "videoSearchQuery": a short YouTube search query for a high-quality educational explainer video.`,
        {
          type: Type.OBJECT,
          properties: {
            title:            { type: Type.STRING, description: 'Short lesson title, 3-6 words' },
            body:             { type: Type.STRING, description: 'Compact HTML fallback using p, strong, ul/li, h4, blockquote; no hr dividers' },
            videoSearchQuery: { type: Type.STRING, description: 'Short YouTube search query for an educational explainer video' },
            blocks: {
              type: Type.ARRAY,
              description: 'Interactive lesson blocks for the rich lesson player',
              items: blockItemSchema,
            },
          },
          required: ['title', 'body', 'videoSearchQuery', 'blocks'],
        },
      );
      const query = lesson.videoSearchQuery || lesson.title || `${question} ${correctAnswer}`;
      const videoUrl = await findLessonVideo(query).catch(err => {
        console.warn('YouTube lookup failed:', err);
        return null;
      });
      const doc = Array.isArray(lesson.blocks) && lesson.blocks.length
        ? buildLessonDoc(lesson.blocks)
        : undefined;
      return NextResponse.json({
        title: lesson.title,
        body: lesson.body,
        ...(doc ? { doc } : {}),
        videoUrl,
      });
    }

    // -- Generate a hint ---
    if (action === 'generate_hint') {
      const question = clamp(body.question, 500);
      const correctAnswer = clamp(body.correctAnswer, 300);
      const result = await generateJSON(
        `Write a single-sentence hint for this quiz question: "${question}" (correct answer: "${correctAnswer}"). The hint should nudge students toward the answer without revealing it directly. Keep it to one sentence, max 20 words.`,
        { type: Type.OBJECT, properties: { hint: { type: Type.STRING } }, required: ['hint'] },
      );
      return NextResponse.json(result);
    }

    // -- Generate explanation ---
    if (action === 'generate_explanation') {
      const question = clamp(body.question, 500);
      const correctAnswer = clamp(body.correctAnswer, 300);
      const result = await generateJSON(
        `Write a brief explanation (1-2 sentences, max 40 words) for why "${correctAnswer}" is the correct answer to this quiz question: "${question}". Be clear and educational.`,
        { type: Type.OBJECT, properties: { explanation: { type: Type.STRING } }, required: ['explanation'] },
      );
      return NextResponse.json(result);
    }

    // -- Generate learning outcomes ---
    if (action === 'generate_outcomes') {
      const questions: any[] = Array.isArray(body.questions) ? body.questions.slice(0, 30) : [];
      const summary = questions.map((q: any, i: number) => `${i + 1}. ${clamp(q.question, 300)}`).join('\n');
      const result = await generateJSON(
        `Based on these ${questions.length} quiz questions:\n${summary}\n\nGenerate 3-5 concise learning outcomes (what students will know/be able to do after completing this course). Start each with an action verb (e.g. "Understand", "Apply", "Identify"). Keep each under 15 words.`,
        { type: Type.OBJECT, properties: { outcomes: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['outcomes'] },
      );
      return NextResponse.json(result);
    }

    if (action === 'generate_course_description') {
      const title       = clamp(body.title, 200);
      const description = clamp(body.description, 1000);
      const style       = clamp(body.style, 50) || 'professional';
      const length      = clamp(body.length, 20) || 'medium';
      const prompt      = clamp(body.prompt, 500);
      const questions: any[]     = Array.isArray(body.questions)     ? body.questions.slice(0, 30)     : [];
      const learnOutcomes: any[] = Array.isArray(body.learnOutcomes) ? body.learnOutcomes.slice(0, 10) : [];

      const questionSummary = (questions as any[])
        .slice(0, 8)
        .map((q: any, i: number) => `${i + 1}. ${q.question}`)
        .join('\n');

      const outcomeSummary = (learnOutcomes as string[])
        .slice(0, 6)
        .map((outcome: string, i: number) => `${i + 1}. ${outcome}`)
        .join('\n');

      const result = await generateJSON(
        `Write a polished, creator-friendly course description for this course.

Course title: "${title}"

Requested style: "${style}"
Requested length: "${length}"

Learning outcomes:
${outcomeSummary || 'None provided'}

Questions covered:
${questionSummary || 'None provided'}

Existing description for context:
${description || 'None provided'}

Creator instructions:
${prompt || 'None provided'}

Requirements:
- Return plain text only. No HTML tags, no markdown, no bullet points, no special characters.
- Length: ${length === 'short' ? '2-3 sentences' : length === 'long' ? '4-5 sentences' : '3-4 sentences'}.
- Tone: professional, concise, benefit-driven.
- Lead with the single most compelling outcome the learner will gain.
- Focus on what the learner walks away with, not what the course covers.
- Use clear, direct language. No jargon, no filler phrases like "In this course you will...".
- Do not use lists or line breaks -- write it as flowing prose.
- End with a forward-looking motivating sentence.`,
        { type: Type.OBJECT, properties: { description: { type: Type.STRING } }, required: ['description'] },
      );
      return NextResponse.json(result);
    }

    if (action === 'generate_event_setup') {
      const brief               = clamp(body.brief, 1000);
      const existingTitle       = clamp(body.existingTitle, 200);
      const existingDescription = clamp(body.existingDescription, 1000);
      const eventDetails        = body.eventDetails && typeof body.eventDetails === 'object' ? body.eventDetails : {};

      const result = await generateJSON(
        `You are helping a creator set up an event registration experience.

Creator brief:
${brief}

Existing title:
${existingTitle || 'None provided'}

Existing description:
${existingDescription || 'None provided'}

Existing event details:
${JSON.stringify(eventDetails || {}, null, 2)}

Generate a polished event setup for a modern creator platform.

Requirements:
- Return practical, ready-to-use event configuration.
- Make the title catchy but clear.
- Write a concise event description in HTML using only <p>, <strong>, <ul>, <li> when helpful.
- Determine whether the event is "virtual" or "in-person".
- If virtual, provide a meetingLink as an empty string.
- If in-person, provide a location and leave meetingLink empty.
- Suggest useful registration fields for this event. Prioritize quality over quantity.
- Include a short confirmation notice title and body for after registration.
- Use realistic placeholders when exact details are unknown.
- Timezone should be a short string like "UTC", "WAT", "PST", "GMT+1".
- Capacity can be omitted if not clearly implied.

Field rules:
- Allowed field types: text, email, textarea, number, select, phone, company, social.
- Include label, name, type, placeholder when relevant, required, and options only for select.
- For social fields, also include socialPlatforms as an array if useful.
- Do not include duplicate first name, last name, email, or phone fields if not necessary.`,
        {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            eventDetails: {
              type: Type.OBJECT,
              properties: {
                isEvent: { type: Type.BOOLEAN },
                date: { type: Type.STRING },
                time: { type: Type.STRING },
                timezone: { type: Type.STRING },
                capacity: { type: Type.NUMBER },
                eventType: { type: Type.STRING },
                meetingLink: { type: Type.STRING },
                location: { type: Type.STRING },
              },
              required: ['isEvent', 'eventType'],
            },
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  label: { type: Type.STRING },
                  type: { type: Type.STRING },
                  placeholder: { type: Type.STRING },
                  required: { type: Type.BOOLEAN },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  socialPlatforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['id', 'name', 'label', 'type'],
              },
            },
            postSubmission: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                noticeTitle: { type: Type.STRING },
                noticeBody: { type: Type.STRING },
              },
              required: ['type', 'noticeTitle', 'noticeBody'],
            },
          },
          required: ['title', 'description', 'eventDetails', 'fields', 'postSubmission'],
        },
      );
      return NextResponse.json(result);
    }

    if (action === 'generate_broadcast_email') {
      const formTitle   = clamp(body.formTitle, 200);
      const description = clamp(body.description, 1000);
      const audience    = clamp(body.audience, 100) || 'registrants';
      const tone        = clamp(body.tone, 50)      || 'friendly';
      const purpose     = clamp(body.purpose, 100)  || 'event update';
      const prompt      = clamp(body.prompt, 500);
      const eventDetails = body.eventDetails && typeof body.eventDetails === 'object' ? body.eventDetails : {};

      const result = await generateJSON(
        `You are writing a broadcast email for a creator platform.

Page title: ${formTitle}
Audience: ${audience}
Purpose: ${purpose}
Tone: ${tone}

Page description:
${description || 'None provided'}

Event details (if any):
${JSON.stringify(eventDetails || {}, null, 2)}

Extra creator instructions:
${prompt || 'None provided'}

Write a polished broadcast email.

Requirements:
- Return a subject and body.
- The subject should be concise and clickable, but not spammy.
- The body should be plain text content suitable for email.
- Keep the body to 2-5 short paragraphs.
- Be clear, warm, and action-oriented.
- Do not include HTML.
- Do not include placeholder brackets like [Name].
- Do not include a sign-off from any specific platform; write as the creator/host.`,
        { type: Type.OBJECT, properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } }, required: ['subject', 'body'] },
      );
      return NextResponse.json(result);
    }

    // -- Generate SQL course outline (step 1 of 2) ---
    if (action === 'generate_sql_course_outline') {
      const rateLimitErr = await checkSqlCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const title      = clamp(body.title, 200);
      const industry   = clamp(body.industry, 100);
      const role       = clamp(body.role, 100);
      const level      = clamp(body.level, 30);
      const promptText = clamp(body.promptText, 800);
      const moduleIndex: number | null = typeof body.moduleIndex === 'number' ? body.moduleIndex : null;
      const existingOutline = body.existingOutline ?? null;

      const lessonItemSchema = {
        type: Type.OBJECT,
        properties: {
          id:              { type: Type.STRING },
          title:           { type: Type.STRING },
          skillFocus:      { type: Type.STRING },
          questionType:    { type: Type.STRING },
          questionSummary: { type: Type.STRING },
        },
        required: ['id', 'title', 'skillFocus', 'questionType', 'questionSummary'],
      };

      if (moduleIndex !== null && existingOutline) {
        const currentModule = existingOutline.modules?.[moduleIndex];
        const otherModules = existingOutline.modules
          ?.filter((_: any, i: number) => i !== moduleIndex)
          .map((m: any) => m.title).join(', ') ?? '';

        const prompt = `You are regenerating a single module for an existing SQL course.

Course context:
- Title: ${title || existingOutline.courseTitle}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Other modules already in the course: ${otherModules}

Current module to replace:
${JSON.stringify(currentModule, null, 2)}

Generate a fresh replacement module that:
- Covers SQL skills not covered by the other modules
- Has 4-6 lessons each covering exactly ONE atomic SQL sub-topic
- Do not bundle multiple concepts into one lesson
- Lesson titles must clearly name the specific sub-topic (e.g. "Filtering with BETWEEN" not "WHERE Clauses")
- Use varied question types matching the course level (sql, mcq, debug, completion)
- No em dashes, no curly quotes, no ellipsis characters, no asterisks`;

        const schema = {
          type: Type.OBJECT,
          properties: {
            module: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING }, title: { type: Type.STRING },
                description: { type: Type.STRING },
                lessons: { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
          required: ['module'],
        };
        const result = await generateJSON(prompt, schema, { temperature: 0.7, geminiRetries: 2, thinkingLevel: 'low' });
        return NextResponse.json(result);
      }

      const structurePrompt = `You are a World-Class Data Science Instructor designing a job-ready SQL course.

Course parameters:
- Title: ${title}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Focus: ${promptText || 'General SQL skills for the role'}
${promptText ? `
STRICT TOPIC CONSTRAINT: The course MUST cover ONLY the topics listed in the Focus above. Do not add modules or lessons for any topic not mentioned there. Every module title and every lesson must map directly to one of those topics.
` : ''}
Create a complete SQL course outline following these rules:

1. Business scenario: 2-3 sentences describing a high-performance data team and their mission.

2. Course description: 2-3 sentences summarizing what students will learn.

3. Learning outcomes: 4-6 concise outcomes starting with action verbs.

4. Shared dataset plan:
   - 2-4 relational tables reflecting realistic data for the industry
   - For each table, provide tableName, description, rowCount, and columns
   - Each column must include name, type, and description
   - Use only INTEGER, TEXT, REAL, DATE. No BIGINT, SERIAL, BOOLEAN, ARRAY
   - Tables must support exercises from basic SELECT to joins and aggregation

5. Course structure: 6-10 modules, each with 4-6 lessons
   - Every lesson covers exactly ONE atomic SQL concept - never bundle two concepts into one lesson
   - Bad example: "SELECT and filtering" -- Good: "Selecting a Single Column" then "Filtering Rows with WHERE"
   - A SELECT module should have separate lessons for: single column, multiple columns, SELECT *, LIMIT, aliases with AS, DISTINCT
   - A WHERE module should have separate lessons for: equality, comparison operators, AND/OR, IN/NOT IN, BETWEEN, LIKE
   - Every module must be this granular
   - Question type distribution across ALL modules: mostly sql, completion, and debug
   - MCQ is rare: at most 1 lesson per module may be mcq, and only in the first 2-3 modules
   - Advanced modules (last 2-3): sql and debug only, no mcq, no completion
   - Lesson titles must clearly name the specific sub-topic

Strict formatting: No em dashes. No curly quotes. No ellipsis. No asterisks.`;

      const structureSchema = {
        type: Type.OBJECT,
        properties: {
          courseTitle:       { type: Type.STRING },
          courseDescription: { type: Type.STRING },
          businessScenario:  { type: Type.STRING },
          learningOutcomes:  { type: Type.ARRAY, items: { type: Type.STRING } },
          sharedDatasetPlan: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              tables: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tableName: { type: Type.STRING },
                    description: { type: Type.STRING },
                    rowCount: { type: Type.NUMBER },
                    columns: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          type: { type: Type.STRING },
                          description: { type: Type.STRING },
                        },
                        required: ['name', 'type', 'description'],
                      },
                    },
                  },
                  required: ['tableName', 'description', 'rowCount', 'columns'],
                },
              },
            },
            required: ['description', 'tables'],
          },
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING }, title: { type: Type.STRING },
                description: { type: Type.STRING },
                lessons: { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
        },
        required: ['courseTitle', 'courseDescription', 'businessScenario', 'learningOutcomes', 'sharedDatasetPlan', 'modules'],
      };

      const structure = await generateJSON(structurePrompt, structureSchema, { temperature: 0.7, geminiRetries: 2, thinkingLevel: 'low' });

      const datasetPrompt = `You are generating the shared dataset for a SQL course outline.

Course context:
- Title: ${structure.courseTitle || title}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Business scenario: ${structure.businessScenario ?? ''}

Shared dataset description:
${structure.sharedDatasetPlan?.description ?? ''}

Generate valid DuckDB seed SQL for all planned tables below.

Rules:
- Return 2-4 tables with realistic relational data and internally consistent foreign keys
- Total rows across all tables should be between 50 and 100
- Use only INTEGER, TEXT, REAL, DATE
- Each table's seedSql must include CREATE TABLE and INSERT INTO statements
- Use the exact table names and exact column names from the plan
- Do not invent extra tables or columns
- Keep ids and relationships consistent across the whole dataset
- No markdown fences

Planned tables:
${JSON.stringify(structure.sharedDatasetPlan?.tables ?? [], null, 2)}`;

      const datasetSchema = {
        type: Type.OBJECT,
        properties: {
          sharedDataset: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              tables: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tableName:   { type: Type.STRING },
                    description: { type: Type.STRING },
                    seedSql:     { type: Type.STRING },
                  },
                  required: ['tableName', 'description', 'seedSql'],
                },
              },
            },
            required: ['description', 'tables'],
          },
        },
        required: ['sharedDataset'],
      };

      const dataset = await generateJSON(datasetPrompt, datasetSchema, { temperature: 0.5, geminiRetries: 2, thinkingLevel: 'low' });
      return NextResponse.json({
        ...structure,
        sharedDataset: dataset.sharedDataset,
      });
    }

    // -- Generate full SQL course from approved outline (step 2 of 2) ---
    if (action === 'generate_sql_course_full') {
      const rateLimitErr = await checkSqlCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const outline  = body.outline;
      const title    = clamp(body.title || outline?.courseTitle || '', 200);
      const industry = clamp(body.industry, 100);
      const role     = clamp(body.role, 100);
      const level    = clamp(body.level, 30);

      if (!outline?.modules?.length) {
        return NextResponse.json({ error: 'outline.modules is required' }, { status: 400 });
      }

      const tableNames = (outline.sharedDataset?.tables ?? []).map((t: any) => t.tableName).join(', ');

      // Escape plain text for safe HTML interpolation.
      const esc = (s: string) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const stripHtml = (s: string) =>
        String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const quoteSqlIdent = (name: string) => `"${String(name ?? '').replace(/"/g, '""')}"`;

      // Include only CREATE TABLE (strip INSERT statements) -- column names are all Gemini needs,
      // and INSERT rows can be 3000+ tokens which causes ECONNRESET on every module call.
      const createOnly = (seedSql: string): string => {
        const idx = seedSql.toUpperCase().indexOf('INSERT INTO');
        return idx > 0 ? seedSql.slice(0, idx).trim() : seedSql;
      };
      const tableSchemas = (outline.sharedDataset?.tables ?? [])
        .map((t: any) => `-- ${t.tableName}: ${t.description}\n${createOnly(t.seedSql ?? '')}`)
        .join('\n\n');

      const baseCtx = `Course context:
- Title: ${title}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Business scenario: ${outline.businessScenario ?? ''}

SHARED DATASET SCHEMA (use ONLY these tables and ONLY these exact column names - never invent column names):
${tableSchemas}

STRICT FORMATTING: No em dashes. No curly quotes - use straight quotes only. No ellipsis. No asterisks.
STYLE: Write like a senior data professional coaching a junior analyst. Be practical, specific, and concise. Teach only what the learner needs for the task.
Return the EXACT lessonId value from the input for every lesson - do not change IDs.`;

      const mcqQuestionSchema = {
        type: Type.OBJECT,
        properties: {
          questionText:  { type: Type.STRING },
          options:       { type: Type.ARRAY, items: { type: Type.STRING } },
          correctAnswer: { type: Type.STRING },
          explanation:   { type: Type.STRING },
        },
        required: ['questionText', 'options', 'correctAnswer', 'explanation'],
      };

      const mcqItemSchema = {
        type: Type.OBJECT,
        properties: {
          lessonId:    { type: Type.STRING },
          lessonTitle: { type: Type.STRING },
          lessonBody:  { type: Type.STRING },
          questions:   { type: Type.ARRAY, items: mcqQuestionSchema },
        },
        required: ['lessonId', 'lessonTitle', 'lessonBody', 'questions'],
      };

      const sqlQuestionSchema = {
        type: Type.OBJECT,
        properties: {
          lessonBody:                { type: Type.STRING },
          questionText:              { type: Type.STRING },
          solution:                  { type: Type.STRING },
          initialCode:               { type: Type.STRING },
          hints:                     { type: Type.ARRAY, items: { type: Type.STRING } },
          requirements:              { type: Type.ARRAY, items: { type: Type.STRING } },
          expectedOutputDescription: { type: Type.STRING },
        },
        required: ['lessonBody', 'questionText', 'solution', 'initialCode', 'hints', 'requirements', 'expectedOutputDescription'],
      };

      const sqlItemSchema = {
        type: Type.OBJECT,
        properties: {
          lessonId:    { type: Type.STRING },
          lessonTitle: { type: Type.STRING },
          questions:   { type: Type.ARRAY, items: sqlQuestionSchema },
        },
        required: ['lessonId', 'lessonTitle', 'questions'],
      };

      const lessonBodyRules = `LESSON BODY STRUCTURE - lessonBody must follow this exact order:
1. CONCEPT: Define the SQL keyword, clause, or operator in one practical paragraph. Say what it helps an analyst do.
2. SYNTAX: Show one short syntax pattern or example in <pre><code>. Use <code> inline for SQL keywords like <code>SELECT</code>, <code>WHERE</code>, <code>GROUP BY</code>.
3. WORK CONTEXT: Add one sentence connecting the concept to the role and industry.
lessonBody HTML allowed tags: <p> <strong> <ul> <li> <pre> <code> <blockquote>. No headings. 70-110 words total.
Do NOT include the task instruction in lessonBody - that goes in questionText only.
Avoid textbook filler, history, edge cases, and long business storytelling.`;

      const lessonMap = new Map<string, any>();
      const buildModuleIntro = (mod: any) => {
        const lessons = (mod.lessons ?? []).map((l: any) => l.title).filter(Boolean);
        const lessonList = lessons.slice(0, 5).map((title: string) => `<li>${esc(title)}</li>`).join('');
        const moduleDescription = stripHtml(mod.description ?? '');
        const firstTable = (outline.sharedDataset?.tables ?? [])[0];
        const firstTableName = String(firstTable?.tableName ?? '').trim();
        const demoQuery = firstTableName ? `SELECT *\nFROM ${quoteSqlIdent(firstTableName)}\nLIMIT 5;` : '';
        const setupSql = String(firstTable?.seedSql ?? '').trim();

        const body = [
          `<p>This module focuses on ${esc(mod.title)}${moduleDescription ? `: ${esc(moduleDescription)}` : '.'}</p>`,
          lessonList ? `<p><strong>You will practice:</strong></p><ul>${lessonList}</ul>` : '',
          firstTableName ? `<p>Start by inspecting the shared <strong>${esc(firstTableName)}</strong> table so each exercise feels grounded in the data.</p>` : '',
        ].filter(Boolean).join('');

        const blocks = [
          { type: 'heading', level: 4, text: mod.title },
          {
            type:    'callout',
            variant: 'info',
            title:   'Module focus',
            text:    moduleDescription || `Practice the SQL skills in ${mod.title} using the shared dataset.`,
          },
          ...(lessons.length ? [{ type: 'bulletList', items: lessons.slice(0, 5) }] : []),
          ...(firstTableName ? [{
            type:     'runnableCode',
            language: 'sql',
            code:     demoQuery,
            setupSql,
          }] : []),
        ];

        return {
          title: mod.title,
          body,
          doc: buildLessonDoc(blocks),
        };
      };

      // Generate modules in parallel (lessons sequential within each module) -- wall time
      // becomes the slowest module instead of the sum of every lesson. A typical 8x5
      // outline is ~40 sequential Gemini calls otherwise, which exceeds the function timeout.
      await Promise.all(outline.modules.map(async (mod: any) => {
        for (const lesson of mod.lessons ?? []) {
          const lessonInput = {
            lessonId: lesson.id,
            moduleTitle: mod.title,
            moduleDescription: mod.description ?? '',
            lessonTitle: lesson.title,
            skillFocus: lesson.skillFocus,
            questionType: lesson.questionType,
            questionSummary: lesson.questionSummary,
          };

          const promptBase = `You are generating exercise content for one lesson of a SQL course.
${baseCtx}

Current module: ${mod.title}
${mod.description ? `Module description: ${mod.description}` : ''}

${lessonBodyRules}

SQL/completion/debug lessons MUST have a "questions" array with EXACTLY 2 questions.
MCQ lessons MUST have a "questions" array with EXACTLY 1 question.
For every SQL question:
- initialCode must be a useful starter query the learner edits.
- Use real table names from the schema.
- Use blanks like ____ for missing expressions, selected columns, filters, or aliases.
- Do NOT use table_name, column_name, or a complete final answer as initialCode.
- requirements must contain 2-4 short checklist items that match the task.
`;

          if (lesson.questionType === 'mcq') {
            const mcqPrompt = `${promptBase}

For this MCQ lesson, produce a "questions" array with exactly 1 item:
- lessonBody: follow LESSON BODY STRUCTURE above.
- questions[0] has:
  - questionText: 1 concise sentence question. No background.
  - options: EXACTLY 4 answer choice strings. Real choices only - no field names.
  - correctAnswer: exact text of the correct option.
  - explanation: 1-2 sentences explaining why the answer is correct.

Lesson input:
${JSON.stringify(lessonInput, null, 2)}`;

            const result = await generateJSON(mcqPrompt, mcqItemSchema, { temperature: 0.6, geminiRetries: 2, thinkingLevel: 'low' });
            lessonMap.set(result.lessonId, result);
            continue;
          }

          const sqlPrompt = `${promptBase}

For this SQL lesson, produce a "questions" array with EXACTLY 2 items. Each question has its own lessonBody.

questions[0]:
- lessonBody: The full teaching lesson. Follow LESSON BODY STRUCTURE above. 70-110 words.
- questionText: Task instruction only. 1-2 sentences starting with a verb. No background or context.
- solution, initialCode, hints, requirements, expectedOutputDescription as described above.

questions[1]:
- lessonBody: A brief scenario (1-2 sentences, 25-45 words). Do NOT repeat the lesson explanation.
  Write a new business situation where the same SQL concept applies. Mention a specific team, report, or business need from the course scenario.
  Use HTML <p> and <strong> only. Example: "<p>The operations team also needs a quick overview of all <strong>supplier</strong> records. They have requested every column from the suppliers table for an internal audit report.</p>"
- questionText: Task instruction only. 1-2 sentences starting with a verb. No background or context.
- solution, initialCode, hints, requirements, expectedOutputDescription as described above.

All SQL must use only these tables and exact column names: ${tableNames}
Good starter examples:
- SELECT ____ FROM Customers;
- SELECT SUBSTRING(phone_number, ____, ____) AS ____ FROM Customers;
- SELECT ____ FROM Orders WHERE ____;

Lesson input:
${JSON.stringify(lessonInput, null, 2)}`;

          const result = await generateJSON(sqlPrompt, sqlItemSchema, { temperature: 0.6, geminiRetries: 2, thinkingLevel: 'low' });
          lessonMap.set(result.lessonId, result);
        }
      }));

      const buildSqlLessonBody = (lessonBody: string, requirements: string[]): string => {
        if (!requirements?.length) return lessonBody;
        const items = requirements.map(r => `<li>${esc(r)}</li>`).join('');
        return `${lessonBody}<p><strong>Before submitting:</strong></p><ul>${items}</ul>`;
      };

      const firstTableName = String((outline.sharedDataset?.tables ?? [])[0]?.tableName ?? '').trim();
      const starterFromSolution = (solution: string) => {
        const fromMatch = String(solution ?? '').match(/\bFROM\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w]*)/i);
        const table = fromMatch?.[1] || (firstTableName ? quoteSqlIdent(firstTableName) : '');
        if (!table) return 'SELECT ____\nFROM ____;';

        const clauses: string[] = [`SELECT ____`, `FROM ${table}`];
        if (/\bWHERE\b/i.test(solution)) clauses.push('WHERE ____');
        if (/\bGROUP\s+BY\b/i.test(solution)) clauses.push('GROUP BY ____');
        if (/\bORDER\s+BY\b/i.test(solution)) clauses.push('ORDER BY ____');
        return `${clauses.join('\n')};`;
      };

      const normalizeSqlStarter = (starter: unknown, solution: unknown) => {
        const raw = String(starter ?? '').trim();
        const sol = String(solution ?? '').trim();
        const hasPlaceholder = /____|TODO|fill\s+in|your_/i.test(raw);
        const isGeneric = /\b(table_name|column_name)\b/i.test(raw);
        const isSolution = raw && sol && raw.replace(/\s+/g, ' ').toLowerCase() === sol.replace(/\s+/g, ' ').toLowerCase();
        if (!raw || isGeneric || isSolution || !hasPlaceholder) return starterFromSolution(sol);
        return raw;
      };

      const tables: any[] = outline.sharedDataset?.tables ?? [];
      const uid = () => Math.random().toString(36).slice(2, 9);
      let isFirstSqlLesson = true;
      const questions: any[] = [];

      for (const mod of outline.modules) {
        // Insert the master lesson as a lessonOnly slide at the top of each module
        const masterLesson = buildModuleIntro(mod);
        questions.push({
          id:            uid(),
          lessonOnly:    true,
          question:      '',
          options:       [],
          correctAnswer: '',
          lesson:        { title: masterLesson.title || mod.title, body: masterLesson.body, doc: masterLesson.doc },
        });

        for (const outLesson of mod.lessons ?? []) {
          const gen = lessonMap.get(outLesson.id);
          if (!gen) continue;

          const genQuestions: any[] = gen.questions ?? [];
          const lessonTitle = gen.lessonTitle ?? outLesson.title;
          const lessonBody  = gen.lessonBody ?? '';

          if (outLesson.questionType === 'mcq') {
            // MCQ: lesson intro slide first, then questions with no lesson embedded
            if (lessonBody) {
              questions.push({
                id:            uid(),
                lessonOnly:    true,
                question:      '',
                options:       [],
                correctAnswer: '',
                lesson:        { title: lessonTitle, body: lessonBody },
              });
            }
            for (const q of genQuestions) {
              questions.push({
                id:            uid(),
                type:          'multiple_choice',
                question:      q.questionText ?? '',
                options:       q.options ?? [],
                correctAnswer: q.correctAnswer ?? '',
                explanation:   q.explanation ?? '',
              });
            }
          } else {
            // SQL/debug/completion: each question carries its own lessonBody
            // questions[0] gets the full lesson; questions[1+] get the scenario body
            for (let qi = 0; qi < genQuestions.length; qi++) {
              const q = genQuestions[qi];
              const sqlTables = isFirstSqlLesson ? tables : [];
              if (isFirstSqlLesson) isFirstSqlLesson = false;

              const body = qi === 0
                ? buildSqlLessonBody(q.lessonBody ?? lessonBody, q.requirements ?? [])
                : (q.lessonBody ?? '');

              questions.push({
                id:                  uid(),
                type:                'sql_exercise',
                question:            q.questionText ?? '',
                options:             [],
                correctAnswer:       '',
                sqlTables,
                sqlSolution:         q.solution ?? '',
                sqlStarterCode:      normalizeSqlStarter(q.initialCode, q.solution),
                sqlHints:            q.hints ?? [],
                sqlRequiredPatterns: [],
                lesson:              { title: lessonTitle, body },
              });
            }
          }
        }
      }

      return NextResponse.json({
        title,
        description: outline.courseDescription ?? outline.businessScenario ?? '',
        isCourse:    true,
        learnOutcomes: outline.learningOutcomes ?? [],
        questions,
      });
    }

    // -- Generate course outline from a document (step 1 of 2) ---
    if (action === 'generate_doc_course_outline') {
      const rateLimitErr = await checkDocCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const sourceText = clamp(body.sourceText, 100_000);
      const title      = clamp(body.title, 200);
      const audience   = clamp(body.audience, 200);
      const level      = clamp(body.level, 30) || 'Beginner';
      const goal       = clamp(body.goal, 600);
      const focus      = clamp(body.focus, 800);
      const depth      = clamp(body.depth, 20) || 'balanced';
      const practice   = clamp(body.practice, 20) || 'balanced';
      const tone       = clamp(body.tone, 20) || 'professional';
      const moduleIndex: number | null = typeof body.moduleIndex === 'number' ? body.moduleIndex : null;
      const existingOutline = body.existingOutline ?? null;

      const depthGuidance =
        depth === 'primer'        ? 'Keep it concise and essential: 3-4 modules, 2-4 lessons each. Cover only the core, highest-value material.'
      : depth === 'comprehensive' ? 'Be thorough and complete: 8-12 modules, 4-6 lessons each, covering the material in depth with no important gaps.'
      :                             'Use a balanced scope: 4-8 modules, 3-6 lessons each.';

      const practiceGuidance =
        practice === 'hands_on'  ? 'Strongly favor applied, hands-on exercise types (sql_exercise, code_review, excel_review, dashboard_critique, document_review, written_response). Use knowledge checks only occasionally.'
      : practice === 'knowledge' ? 'Favor knowledge-check types (multiple_choice, fill_blank, arrange); use applied exercises only where the content clearly calls for hands-on work.'
      :                            'Use a balanced mix of applied exercises and knowledge checks.';

      if (!sourceText.trim()) {
        return NextResponse.json({ error: 'sourceText is required' }, { status: 400 });
      }

      const lessonItemSchema = {
        type: Type.OBJECT,
        properties: {
          id:           { type: Type.STRING, description: 'short random id like l_ab12cd' },
          title:        { type: Type.STRING },
          summary:      { type: Type.STRING, description: 'one sentence on what this lesson teaches' },
          questionType: { type: Type.STRING, description: 'one of: sql_exercise, python_exercise, code_review, excel_review, dashboard_critique, document_review, written_response, multiple_choice, fill_blank, arrange' },
        },
        required: ['id', 'title', 'summary', 'questionType'],
      };

      const briefBlock = `Course parameters:
- Working title: ${title || '(none, propose one)'}
- Audience: ${audience || 'general learners'}
- Level: ${level}
- Primary goal (what learners should be able to DO): ${goal || 'derive the most valuable, job-ready capability from the document'}
- Tone: ${tone}
- Creator focus: ${focus || 'cover the document comprehensively'}`;

      const rules = `Rules:
- Ground every concept, fact, feature, and step strictly in the DOCUMENT CONTENT below. Do not invent product facts or capabilities that are not in the document.
- You MAY build realistic, job-relevant scenarios and worked examples that APPLY the document's content to real workplace situations. That is how hands-on skill is practiced, and it is encouraged.
- Use backward design toward the primary goal. ${depthGuidance} Sequence lessons from foundational to applied so later modules build hands-on mastery.
- Each lesson teaches exactly ONE focused, applicable concept, task, or step. Lesson titles name the specific skill or task and are action-oriented where possible (e.g. "Configure X", "Troubleshoot Y"), not vague headers.
- Set each lesson's questionType using the EXERCISE TYPE GUIDE below - match the type to what the lesson actually trains.

${DOC_COURSE_TYPE_GUIDE}

- Practice emphasis: ${practiceGuidance}
- Plain ASCII only. No em dashes, no curly quotes, no ellipsis characters, no asterisks.`;

      // -- Single-module regeneration --
      if (moduleIndex !== null && existingOutline) {
        const currentModule = existingOutline.modules?.[moduleIndex];
        const otherModules = (existingOutline.modules ?? [])
          .filter((_: any, i: number) => i !== moduleIndex)
          .map((m: any) => m.title).join(', ');

        const prompt = `${DOC_COURSE_PERSONA}

You are regenerating a single module for a course built from a document.

${briefBlock}
- Other modules already in the course: ${otherModules}

Current module to replace:
${JSON.stringify(currentModule, null, 2)}

${rules}

Generate a fresh replacement module that covers material from the document not already covered by the other modules.

DOCUMENT CONTENT:
${sourceText}`;

        const schema = {
          type: Type.OBJECT,
          properties: {
            module: {
              type: Type.OBJECT,
              properties: {
                id:          { type: Type.STRING },
                title:       { type: Type.STRING },
                description: { type: Type.STRING },
                lessons:     { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
          required: ['module'],
        };
        const result = await generateJSON(prompt, schema, { temperature: 0.6, geminiRetries: 2, thinkingLevel: 'low' });
        return NextResponse.json(result);
      }

      const prompt = `${DOC_COURSE_PERSONA}

Design a complete, job-ready course from the document below.

${briefBlock}

${rules}

Produce:
1. courseTitle: a clear, compelling, outcome-driven title (reuse the working title if it fits).
2. courseDescription: 2-3 sentences on the concrete job-ready capability the learner will walk away with.
3. learningOutcomes: 4-6 outcomes, each a real on-the-job capability starting with an action verb (e.g. "Configure", "Troubleshoot", "Design", "Apply").
4. modules: the full module and lesson structure following the rules above.

DOCUMENT CONTENT:
${sourceText}`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          courseTitle:       { type: Type.STRING },
          courseDescription: { type: Type.STRING },
          learningOutcomes:  { type: Type.ARRAY, items: { type: Type.STRING } },
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id:          { type: Type.STRING },
                title:       { type: Type.STRING },
                description: { type: Type.STRING },
                lessons:     { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
        },
        required: ['courseTitle', 'courseDescription', 'learningOutcomes', 'modules'],
      };

      const result = await generateJSON(prompt, schema, { temperature: 0.6, geminiRetries: 2, thinkingLevel: 'low' });
      return NextResponse.json(result);
    }

    // -- Generate full course from approved document outline (step 2 of 2) ---
    if (action === 'generate_doc_course_full') {
      const rateLimitErr = await checkDocCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const outline    = body.outline;
      const sourceText = clamp(body.sourceText, 100_000);
      const title      = clamp(body.title || outline?.courseTitle || '', 200);
      const audience   = clamp(body.audience, 200);
      const level      = clamp(body.level, 30) || 'Beginner';
      const goal       = clamp(body.goal, 600);
      const tone       = clamp(body.tone, 20) || 'professional';
      const pdfUrl     = typeof body.pdfUrl === 'string' ? body.pdfUrl : '';
      const pageCount  = Number(body.pageCount) || 0;

      const imageMode: string[] = Array.isArray(body.imageMode)
        ? body.imageMode.map((m: any) => String(m))
        : [body.imageMode].filter(Boolean).map((m: any) => String(m));
      const wantSourceImages = imageMode.includes('source') && !!pdfUrl;
      const wantStockImages  = imageMode.includes('stock');

      // Video preferences -- creator decides whether to use videos at all, and which channels to favor.
      const includeVideos = body.includeVideos !== false; // default on
      const preferredChannels: string[] = Array.isArray(body.preferredChannels)
        ? body.preferredChannels.map((c: any) => clamp(c, 80)).filter(Boolean).slice(0, 12)
        : [];

      if (!outline?.modules?.length) {
        return NextResponse.json({ error: 'outline.modules is required' }, { status: 400 });
      }
      if (!sourceText.trim()) {
        return NextResponse.json({ error: 'sourceText is required' }, { status: 400 });
      }

      const baseCtx = `${DOC_COURSE_PERSONA}

Course context:
- Title: ${title}
- Audience: ${audience || 'general learners'}
- Level: ${level}
- Primary goal: ${goal || 'build the most valuable, job-ready capability from the document'}
- Tone: write all lesson and question content in a ${tone} voice.

STRICT GROUNDING: All facts, features, and steps must come from the DOCUMENT CONTENT. Do not invent product facts. You MAY construct realistic, job-relevant scenarios and worked examples that apply that content to practice.
STRICT FORMATTING: Plain ASCII only. No em dashes, no curly quotes, no ellipsis, no asterisks.`;

      const questionSchema = {
        type: Type.OBJECT,
        properties: {
          type:          { type: Type.STRING, description: 'Must equal the lesson planned questionType: sql_exercise, code_review, excel_review, dashboard_critique, document_review, written_response, multiple_choice, fill_blank, or arrange.' },
          question:      { type: Type.STRING, description: 'The question, task, or brief. For fill_blank put ___ where the blank goes. For applied types this is the task/brief the learner must complete.' },
          options:       { type: Type.ARRAY, items: { type: Type.STRING }, description: 'multiple_choice: exactly 4 options. arrange: items in correct order. Empty for all other types.' },
          correctAnswer: { type: Type.STRING, description: 'multiple_choice: exact correct option text. fill_blank: the answer word(s). Empty for arrange and all applied types.' },
          explanation:   { type: Type.STRING, description: 'For knowledge-check types: why the answer is correct.' },
          hint:          { type: Type.STRING, description: 'Optional subtle hint (knowledge-check types).' },
          codeSnippet:   { type: Type.STRING, description: 'Optional code shown with the question (code type only).' },
          codeLanguage:  { type: Type.STRING, description: 'Language of codeSnippet, e.g. javascript, python (code type only).' },
          // AI reviewer types (code_review, excel_review, dashboard_critique, document_review, written_response)
          rubric:        { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For reviewer types: 3-5 specific grading criteria the AI should assess.' },
          context:       { type: Type.STRING, description: 'For reviewer types: dataset, scope, or context the learner works with.' },
          expectedAnswer:{ type: Type.STRING, description: 'For written_response: a model answer covering what a strong response includes. Grounding for the AI reviewer only - never shown to the learner.' },
          reviewLanguage:{ type: Type.STRING, description: 'For code_review: the programming language, e.g. python, javascript, sql.' },
          // sql_exercise
          scenario:      { type: Type.STRING, description: 'For sql_exercise: a short HTML business scenario (2-3 sentences, <p> and <strong> only) that frames the task in a realistic workplace situation, naming a specific role, team, or report and why the data is needed.' },
          sqlSolution:   { type: Type.STRING, description: 'For sql_exercise: a correct SQL query that answers the task, using ONLY the shared dataset tables and exact column names.' },
          sqlStarterCode:{ type: Type.STRING, description: 'For sql_exercise: starter SQL the learner edits, e.g. a SELECT skeleton.' },
          sqlHints:      { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For sql_exercise: 1-3 progressive hints.' },
          // python_exercise
          pythonStarterCode:    { type: Type.STRING, description: 'For python_exercise: skeleton code with # TODO comments where the learner fills in logic.' },
          pythonSolution:       { type: Type.STRING, description: 'For python_exercise: complete, correct Python solution.' },
          pythonExpectedOutput: { type: Type.STRING, description: 'For python_exercise: exact stdout produced by running the solution (newline-separated lines).' },
          pythonSetupCode:      { type: Type.STRING, description: 'For python_exercise: optional import statements and setup code that runs before the main code (no output).' },
          pythonHints:          { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For python_exercise: 1-3 progressive hints.' },
        },
        required: ['type', 'question'],
      };

      const lessonContentSchema = {
        type: Type.OBJECT,
        properties: {
          lessonId:   { type: Type.STRING },
          title:      { type: Type.STRING },
          body:       { type: Type.STRING, description: 'Practical, hands-on lesson HTML with a worked example or how-to steps where possible: <p>, <strong>, <ul>, <li>, <h4>, <blockquote>. 100-180 words. No hr dividers.' },
          blocks:     { type: Type.ARRAY, items: blockItemSchema, description: 'Interactive lesson blocks for the rich player; mirrors body as interactive nodes.' },
          imageQuery: { type: Type.STRING, description: 'Concrete visual 2-4 word subject for a professional stock photo (real-world scene/tool/object, never text or a UI screenshot)' },
          sourcePage: { type: Type.NUMBER, description: '1-based page number ONLY if the document has a real figure/diagram/chart for this lesson worth showing; otherwise 0' },
          questions:  { type: Type.ARRAY, items: questionSchema },
        },
        required: ['lessonId', 'title', 'body', 'questions'],
      };

      const moduleContentSchema = {
        type: Type.OBJECT,
        properties: {
          intro: {
            type: Type.OBJECT,
            properties: {
              title:      { type: Type.STRING },
              body:       { type: Type.STRING, description: 'Module intro HTML, 120-220 words, using <p>, <strong>, <ul>, <li>, <h4>, <blockquote>.' },
              blocks:     { type: Type.ARRAY, items: blockItemSchema, description: 'Interactive lesson blocks for the rich player; mirrors body as interactive nodes.' },
              videoQuery: { type: Type.STRING, description: 'Specific educational YouTube query naming the subject and ending with "tutorial" or "explained"' },
              imageQuery: { type: Type.STRING, description: 'Concrete visual 2-4 word subject for a professional stock photo (real-world scene/tool/workplace, not abstract text)' },
            },
            required: ['title', 'body'],
          },
          lessons: { type: Type.ARRAY, items: lessonContentSchema },
        },
        required: ['intro', 'lessons'],
      };

      const uid = () => Math.random().toString(36).slice(2, 9);
      const questions: any[] = [];

      const resolveLessonImage = async (imageQuery: string, sourcePage: number): Promise<string> => {
        // Prefer a relevant, high-res stock photo. Document page screenshots are mostly
        // text (and sometimes blank), so they are only a fallback when no stock photo is found.
        if (wantStockImages) {
          const url = await findStockImage(imageQuery).catch(() => null);
          if (url) return url;
        }
        if (wantSourceImages && sourcePage >= 1 && (!pageCount || sourcePage <= pageCount)) {
          return pdfPageImageUrl(pdfUrl, sourcePage);
        }
        return '';
      };

      // -- Shared SQL dataset: generated once, only when the outline has SQL exercises --
      const hasSqlLessons = outline.modules.some(
        (m: any) => (m.lessons ?? []).some((l: any) => l.questionType === 'sql_exercise'),
      );
      let sqlTables: { tableName: string; description: string; seedSql: string }[] = [];
      let sqlSchemaBlock = '';
      if (hasSqlLessons) {
        const datasetPrompt = `${DOC_COURSE_PERSONA}

Generate a small, realistic SQL practice dataset grounded in the subject and domain of the DOCUMENT CONTENT below.

Rules:
- 2-4 relational tables with realistic, internally consistent data and sensible foreign keys.
- Total rows across all tables between 40 and 90.
- Use ONLY these column types: INTEGER, TEXT, REAL, DATE. No BIGINT, SERIAL, BOOLEAN, or ARRAY.
- Each table's seedSql must contain valid DuckDB CREATE TABLE and INSERT INTO statements, no markdown fences.
- Keep ids and relationships consistent across the whole dataset so JOINs work.
- Plain ASCII only.

DOCUMENT CONTENT:
${clamp(sourceText, 40_000)}`;

        const datasetSchema = {
          type: Type.OBJECT,
          properties: {
            tables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  tableName:   { type: Type.STRING },
                  description: { type: Type.STRING },
                  seedSql:     { type: Type.STRING },
                },
                required: ['tableName', 'description', 'seedSql'],
              },
            },
          },
          required: ['tables'],
        };

        try {
          const ds = await generateJSON(datasetPrompt, datasetSchema, { temperature: 0.4, geminiRetries: 2, thinkingLevel: 'low' });
          if (Array.isArray(ds?.tables)) {
            sqlTables = ds.tables.filter((t: any) => t?.tableName && t?.seedSql);
          }
        } catch (err) {
          console.warn('[doc-course] SQL dataset generation failed:', (err as Error).message);
        }

        // CREATE-only schema (strip INSERT rows) to give module prompts the table/column names cheaply.
        const createOnly = (seedSql: string): string => {
          const idx = seedSql.toUpperCase().indexOf('INSERT INTO');
          return idx > 0 ? seedSql.slice(0, idx).trim() : seedSql;
        };
        sqlSchemaBlock = sqlTables
          .map(t => `-- ${t.tableName}: ${t.description}\n${createOnly(t.seedSql)}`)
          .join('\n\n');
      }
      let isFirstSqlExercise = true;

      for (const mod of outline.modules) {
        const lessonPlan = (mod.lessons ?? [])
          .map((l: any) => `- [${l.id}] ${l.title} (${l.questionType}): ${l.summary ?? ''}`)
          .join('\n');

        const modulePrompt = `You are writing one module of a course built from a document.
${baseCtx}

Module: ${mod.title}
${mod.description ? `Module description: ${mod.description}` : ''}

Lessons to write (return the EXACT lessonId for each, do not change ids):
${lessonPlan}

For the module, produce:
- intro: a short, motivating introduction that frames what the learner will be able to DO after this module and why it matters on the job. Include:
  - videoQuery: a specific, educational YouTube search query that names the concrete subject and ends with a word like "tutorial" or "explained" (so it surfaces a high-quality explainer, not a vlog or promo).
  - imageQuery: a concrete, visual 2-4 word subject for a professional stock photo that depicts a real-world scene, tool, or workplace, NOT abstract text or a UI screenshot.
- lessons: one entry per planned lesson, in order. Each lesson has:
  - body: a focused, practical mini-lesson that teaches the concept AND how to apply it in real work. Where the document supports it, include a concrete worked example or a short numbered "how to" sequence of steps, and connect the concept to a realistic workplace task. Be specific and actionable, not abstract.
  - imageQuery: a concrete, visual 2-4 word subject for a professional stock photo illustrating this lesson (a real-world scene, tool, or object - never text, a logo, or a UI screenshot).
  - sourcePage: set to the 1-based page number ONLY if the document clearly contains a figure, diagram, chart, or screenshot for THIS lesson that is worth showing; otherwise 0.
  - questions: build exactly ONE question whose "type" EQUALS the lesson's planned questionType shown above. Make it realistic and job-relevant. Fill ONLY the fields for that type:
    - multiple_choice: a short realistic scenario question, exactly 4 plausible options, correctAnswer is the exact correct option text, plus a one-sentence explanation and a subtle hint. (You may add a second multiple_choice question if helpful.)
    - fill_blank: put ___ in the question (inside a practical statement or command), options empty, correctAnswer is the missing word(s), plus explanation.
    - arrange: options are the steps of a real process or workflow in the correct order, correctAnswer empty, plus explanation.
    - sql_exercise: ALWAYS write "scenario" first - a short, realistic business situation (2-3 sentences, HTML <p> and <strong> only) that names a specific role, team, or report and explains WHY the data is needed. Example: "<p>The <strong>Head of Marketing</strong> wants a full list of every customer and their contact details from the sales records to plan an outreach campaign.</p>". Then "question" is the concrete task tied to that scenario, e.g. "Write a query that returns every column from the sales table." NEVER write a bare task without a scenario. Provide sqlSolution (a correct query using ONLY the shared dataset tables and exact column names below), sqlStarterCode (a starter the learner edits), and 1-3 sqlHints. Leave options/correctAnswer empty.
    - code_review: question is a coding task/brief. Provide reviewLanguage and a rubric of 3-5 specific grading criteria. Optionally context. Leave options/correctAnswer empty.
    - excel_review: question is a spreadsheet task/brief. Provide a rubric of 3-5 criteria and context describing the dataset. Leave options/correctAnswer empty.
    - dashboard_critique: question is a dashboard/visualization task/brief. Provide a rubric of 3-5 criteria and context. Leave options/correctAnswer empty.
    - document_review: question is a report/document brief. Provide a rubric of 3-5 criteria and context describing scope. Leave options/correctAnswer empty.
    - written_response: question is one open question the learner answers in their own words in a few paragraphs - ask for a judgement, a justification, or an interpretation, never a definition to recite. Provide a rubric of 3-5 criteria, context the AI should judge against, and expectedAnswer (a model answer, reviewer grounding only). Leave options/correctAnswer empty.
    - python_exercise: question is a realistic Python task grounded in the lesson content. Provide pythonStarterCode (a skeleton with # TODO comments where learner fills in logic), pythonSolution (complete correct Python), pythonExpectedOutput (exact stdout from running the solution, newline-separated), pythonSetupCode (import statements only, no output), and 1-3 pythonHints. Note: available packages are pandas, numpy, matplotlib, scipy, scikit-learn. Do not use file I/O or network calls. Leave options/correctAnswer empty.

For each lesson's "body", also produce a "blocks" array that builds the same content as interactive TipTap nodes:
- Start with a hook: a callout (info/success) or paragraph framing WHY this concept matters on the job.
- Use heading (level 4), paragraph, bulletList, and blockquote for structure.
- Include runnableCode (sql or python) ONLY when the lesson content involves code or queries -- skip for conceptual/process lessons.
  - SQL runnableCode: include setupSql with CREATE TABLE + INSERT (3-5 rows, exact column names from the shared dataset) so the example is runnable.
  - Python runnableCode: include setupPython with import statements if needed.
- End with exactly one knowledgeCheck testing the core concept (4 options, correctIndex 0-3, one-sentence explanation).
For the intro "blocks": same rules; use callout for module overview, bulletList for what learners will be able to do, and runnableCode for a motivating demo if relevant.
${hasSqlLessons && sqlSchemaBlock ? `
SHARED SQL DATASET (use ONLY these tables and exact column names for every sql_exercise; never invent columns):
${sqlSchemaBlock}
` : ''}
DOCUMENT CONTENT:
${clamp(sourceText, 60_000)}`;

        let gen: any;
        try {
          gen = await generateJSON(modulePrompt, moduleContentSchema, { temperature: 0.6, geminiRetries: 2, thinkingLevel: 'low' });
        } catch (err) {
          console.warn('[doc-course] module generation failed, skipping:', (err as Error).message);
          continue;
        }

        // -- Module intro slide --
        const intro = gen.intro ?? {};
        const introVideo = (includeVideos && intro.videoQuery)
          ? await findLessonVideo(intro.videoQuery, preferredChannels).catch(() => null)
          : null;
        const introImage = await resolveLessonImage(intro.imageQuery ?? mod.title, 0);
        const introDoc = Array.isArray(intro.blocks) && intro.blocks.length
          ? buildLessonDoc(intro.blocks)
          : undefined;
        questions.push({
          id:            uid(),
          lessonOnly:    true,
          question:      '',
          options:       [],
          correctAnswer: '',
          lesson:        { title: intro.title || mod.title, body: intro.body || '', ...(introDoc ? { doc: introDoc } : {}), imageUrl: introImage, videoUrl: introVideo || '' },
        });

        // -- Lessons + questions --
        for (const lesson of gen.lessons ?? []) {
          const lessonImage = await resolveLessonImage(lesson.imageQuery ?? lesson.title, Number(lesson.sourcePage) || 0);
          const lessonDoc = Array.isArray(lesson.blocks) && lesson.blocks.length
            ? buildLessonDoc(lesson.blocks)
            : undefined;
          questions.push({
            id:            uid(),
            lessonOnly:    true,
            question:      '',
            options:       [],
            correctAnswer: '',
            lesson:        { title: lesson.title || '', body: lesson.body || '', ...(lessonDoc ? { doc: lessonDoc } : {}), imageUrl: lessonImage, videoUrl: '' },
          });

          const ALL_TYPES = ['multiple_choice', 'fill_blank', 'arrange', 'code', 'sql_exercise', 'python_exercise', 'code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];
          const toStrArray = (v: any): string[] => Array.isArray(v) ? v.map((x: any) => String(x)).filter(Boolean) : [];

          for (const q of lesson.questions ?? []) {
            const type = ALL_TYPES.includes(q.type) ? q.type : 'multiple_choice';
            const options = toStrArray(q.options);

            // Base shape shared by every question slide.
            const base: any = {
              id:            uid(),
              type,
              question:      String(q.question ?? ''),
              options:       [],
              correctAnswer: '',
              explanation:   String(q.explanation ?? ''),
              hint:          String(q.hint ?? ''),
            };

            if (type === 'multiple_choice' || type === 'code') {
              base.options = options;
              base.correctAnswer = String(q.correctAnswer ?? '');
              if (type === 'code') {
                base.codeSnippet = String(q.codeSnippet ?? '');
                base.codeLanguage = String(q.codeLanguage ?? 'javascript');
              }
            } else if (type === 'fill_blank') {
              base.correctAnswer = String(q.correctAnswer ?? '');
            } else if (type === 'arrange') {
              base.options = options;
              base.correctAnswer = options.join('|||'); // options are in correct order
            } else if (type === 'sql_exercise') {
              base.sqlTables           = isFirstSqlExercise ? sqlTables.map(t => ({ tableName: t.tableName, seedSql: t.seedSql })) : [];
              base.sqlSolution         = String(q.sqlSolution ?? '');
              base.sqlStarterCode      = String(q.sqlStarterCode ?? 'SELECT * FROM table_name LIMIT 10;');
              base.sqlHints            = toStrArray(q.sqlHints);
              base.sqlResultOrdered    = false;
              base.sqlNumericTolerance = 0;
              base.sqlRequiredPatterns = [];
              // Business scenario shown above the SQL editor; the task itself stays in `question`.
              base.lesson              = { title: String(lesson.title ?? ''), body: String(q.scenario ?? '') };
              isFirstSqlExercise = false;
            } else if (type === 'python_exercise') {
              base.pythonStarterCode    = String(q.pythonStarterCode ?? '');
              base.pythonSolution       = String(q.pythonSolution ?? '');
              base.pythonExpectedOutput = String(q.pythonExpectedOutput ?? '');
              base.pythonSetupCode      = String(q.pythonSetupCode ?? '');
              base.pythonHints          = toStrArray(q.pythonHints);
              base.pythonDatasets       = [];
            } else {
              // AI reviewer types: code_review, excel_review, dashboard_critique, document_review, written_response
              base.rubric  = toStrArray(q.rubric);
              base.context = String(q.context ?? '');
              base.minScore = 70;
              if (type === 'code_review') base.reviewLanguage = String(q.reviewLanguage ?? 'javascript');
              if (type === 'document_review') base.documentReviewMode = 'ai_only';
              if (type === 'written_response') {
                base.expectedAnswer = String(q.expectedAnswer ?? '');
                base.writtenMaxWords = 200;   // same default both authoring editors seed
              }
            }

            questions.push(base);
          }
        }
      }

      if (!questions.length) {
        return NextResponse.json({ error: 'Course generation produced no content. Please try again.' }, { status: 502 });
      }

      return NextResponse.json({
        title,
        description:   outline.courseDescription ?? '',
        isCourse:      true,
        learnOutcomes: outline.learningOutcomes ?? [],
        questions,
      });
    }

    // -- Python Course AI Wizard: Outline (step 1 of 2) ---
    if (action === 'generate_python_course_outline') {
      const rateLimitErr = await checkPythonCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const title      = clamp(body.title, 200);
      const industry   = clamp(body.industry, 100);
      const role       = clamp(body.role, 100);
      const level      = clamp(body.level, 30);
      const focus      = clamp(body.focus, 50);
      const promptText = clamp(body.promptText, 800);
      const moduleIndex: number | null = typeof body.moduleIndex === 'number' ? body.moduleIndex : null;
      const existingOutline = body.existingOutline ?? null;

      const lessonItemSchema = {
        type: Type.OBJECT,
        properties: {
          id:              { type: Type.STRING },
          title:           { type: Type.STRING },
          skillFocus:      { type: Type.STRING },
          questionType:    { type: Type.STRING },
          questionSummary: { type: Type.STRING },
        },
        required: ['id', 'title', 'skillFocus', 'questionType', 'questionSummary'],
      };

      if (moduleIndex !== null && existingOutline) {
        const currentModule = existingOutline.modules?.[moduleIndex];
        if (!currentModule) {
          return NextResponse.json({ error: 'Module not found in outline.' }, { status: 400 });
        }

        const otherModules = (existingOutline.modules ?? [])
          .filter((_: any, i: number) => i !== moduleIndex)
          .map((m: any) => m.title)
          .filter(Boolean)
          .join(', ');
        const datasetDesc = (existingOutline.datasetPlan?.datasets ?? [])
          .map((d: any) => `- ${d.variableName}: ${d.description} | columns: ${(d.columns ?? []).join(', ')}`)
          .join('\n');

        const prompt = `You are regenerating one module for an existing job-ready Python data analysis course.

Course context:
- Title: ${title || existingOutline.courseTitle}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Focus Area: ${focus || 'Data Analysis'}
- Specific Focus: ${promptText || 'General Python data analysis for the role'}
- Existing modules to avoid duplicating: ${otherModules || 'none'}

AVAILABLE DATASETS:
${datasetDesc || '- df: a generic DataFrame loaded for the student'}

Regenerate this module:
- Current title: ${currentModule.title}
- Current description: ${currentModule.description ?? ''}

Return exactly one replacement module with 3-5 lessons.
- Every lesson covers exactly ONE atomic concept.
- Question types: mostly python_exercise; multiple_choice only for pure concept-check lessons.
- Keep lesson IDs stable when possible, but use unique IDs if changing the lesson set.
- Lesson titles must clearly name the specific sub-topic.
- Plain ASCII only. No em dashes, no curly quotes, no ellipsis, no asterisks.`;

        const schema = {
          type: Type.OBJECT,
          properties: {
            module: {
              type: Type.OBJECT,
              properties: {
                id:          { type: Type.STRING },
                title:       { type: Type.STRING },
                description: { type: Type.STRING },
                lessons:     { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
          required: ['module'],
        };

        const result = await generateJSON(prompt, schema, { temperature: 0.7, geminiRetries: 2, thinkingLevel: 'low' });
        return NextResponse.json(result);
      }

      const prompt = `You are a World-Class Data Science Instructor designing a job-ready Python data analysis course.

Course parameters:
- Title: ${title}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Focus Area: ${focus || 'Data Analysis'}
- Specific Focus: ${promptText || 'General Python data analysis for the role'}
${promptText ? `\nSTRICT TOPIC CONSTRAINT: The course MUST cover ONLY the topics listed in the Specific Focus above.\n` : ''}
Create a complete Python course outline:

1. Business scenario: 2-3 sentences describing a data team using Python for the role.

2. Course description: 2-3 sentences on what students will learn.

3. Learning outcomes: 4-6 concise outcomes starting with action verbs.

4. Dataset plan: Describe 1-2 CSV datasets the instructor should prepare.
   - For each: a Python variable name (e.g. df, df_sales), a brief description, and 5-8 realistic column names.
   - Datasets must support exercises from basic exploration to groupby, merge, and visualization.

5. Course structure: 5-8 modules, each with 3-5 lessons.
   - Every lesson covers exactly ONE atomic concept (e.g. "Filtering Rows with Boolean Indexing", not "Filtering and Sorting").
   - Question types: mostly python_exercise; multiple_choice only for pure concept-check lessons.
   - Lesson titles must clearly name the specific sub-topic.

Strict formatting: No em dashes. No curly quotes. No ellipsis. No asterisks.`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          courseTitle:       { type: Type.STRING },
          courseDescription: { type: Type.STRING },
          businessScenario:  { type: Type.STRING },
          learningOutcomes:  { type: Type.ARRAY, items: { type: Type.STRING } },
          datasetPlan: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              datasets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    variableName: { type: Type.STRING },
                    description:  { type: Type.STRING },
                    columns:      { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['variableName', 'description', 'columns'],
                },
              },
            },
            required: ['description', 'datasets'],
          },
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id:          { type: Type.STRING },
                title:       { type: Type.STRING },
                description: { type: Type.STRING },
                lessons:     { type: Type.ARRAY, items: lessonItemSchema },
              },
              required: ['id', 'title', 'description', 'lessons'],
            },
          },
        },
        required: ['courseTitle', 'courseDescription', 'businessScenario', 'learningOutcomes', 'datasetPlan', 'modules'],
      };

      const result = await generateJSON(prompt, schema, { temperature: 0.7, geminiRetries: 2, thinkingLevel: 'low' });
      return NextResponse.json(result);
    }

    // -- Python Course AI Wizard: Full course (step 2 of 2) ---
    if (action === 'generate_python_course_full') {
      const rateLimitErr = await checkPythonCourseRateLimit(user.id, userRole);
      if (rateLimitErr) return rateLimitErr;

      const outline  = body.outline;
      const title    = clamp(body.title || outline?.courseTitle || '', 200);
      const industry = clamp(body.industry, 100);
      const role     = clamp(body.role, 100);
      const level    = clamp(body.level, 30);

      if (!outline?.modules?.length) {
        return NextResponse.json({ error: 'outline.modules is required' }, { status: 400 });
      }

      const uid = () => Math.random().toString(36).slice(2, 9);

      // Describe the datasets for prompts
      const datasetDesc = (outline.datasetPlan?.datasets ?? [])
        .map((d: any) => `- ${d.variableName}: ${d.description} | columns: ${(d.columns ?? []).join(', ')}`)
        .join('\n');

      const baseCtx = `Course context:
- Title: ${title}
- Industry: ${industry}
- Target Role: ${role}
- Skill Level: ${level}
- Business scenario: ${outline.businessScenario ?? ''}

AVAILABLE DATASETS (use these exact variable names and column names in all code):
${datasetDesc || '- df: a generic DataFrame loaded for the student'}

STRICT FORMATTING: No em dashes. No curly quotes. No asterisks. Return exact lessonId values from input.`;

      // One Gemini call per module generates: master intro lesson + all exercise lessons.
      // This keeps total calls to N_modules (typically 5-7) instead of N_modules * N_lessons (~25).
      const mcqItemSchema = {
        type: Type.OBJECT,
        properties: {
          questionText:  { type: Type.STRING },
          options:       { type: Type.ARRAY, items: { type: Type.STRING } },
          correctAnswer: { type: Type.STRING },
          explanation:   { type: Type.STRING },
        },
        required: ['questionText', 'options', 'correctAnswer', 'explanation'],
      };

      const lessonItemSchema = {
        type: Type.OBJECT,
        properties: {
          lessonId:       { type: Type.STRING },
          lessonTitle:    { type: Type.STRING },
          lessonBody:     { type: Type.STRING },
          lessonType:     { type: Type.STRING, description: 'python_exercise or multiple_choice' },
          questionText:   { type: Type.STRING, description: 'For python_exercise: HTML numbered task steps using <ol><li>. Wrap function/variable/column names in <code>. Use <blockquote> for context. For mcq: empty string.' },
          setupCode:      { type: Type.STRING, description: 'For python_exercise: imports + numpy/pandas seeded data generation (np.random.seed(42), pd.DataFrame, pd.date_range, etc). Must produce 30-80 rows. No hardcoded lists. This runs before student code.' },
          starterCode:    { type: Type.STRING, description: 'For python_exercise: skeleton the student fills in. Dataset already created by setupCode -- do not recreate it.' },
          solution:       { type: Type.STRING, description: 'For python_exercise: complete runnable solution. Runs after setupCode.' },
          expectedOutput: { type: Type.STRING, description: 'For python_exercise: the exact stdout that running solution (after setupCode) produces. Must match character for character.' },
          hints:          { type: Type.ARRAY, items: { type: Type.STRING }, description: 'For python_exercise: 3 hints.' },
          mcqQuestions:   { type: Type.ARRAY, items: mcqItemSchema, description: 'For multiple_choice: 2 questions.' },
        },
        required: ['lessonId', 'lessonTitle', 'lessonBody', 'lessonType'],
      };

      const moduleSchema = {
        type: Type.OBJECT,
        properties: {
          moduleIntroTitle: { type: Type.STRING },
          moduleIntroBody:  { type: Type.STRING },
          lessons:          { type: Type.ARRAY, items: lessonItemSchema },
        },
        required: ['moduleIntroTitle', 'moduleIntroBody', 'lessons'],
      };

      // Build the prompt and fire all module calls in parallel.
      // Each call is kept small (numpy seeded setup, no giant inline lists) so Gemini
      // returns clean structured JSON. Sequential calls were timing out at 250s+.
      function buildModulePrompt(mod: any, modIdx: number): string {
        const lessonList = (mod.lessons ?? [])
          .map((l: any) => `  - id: "${l.id}" | title: "${l.title}" | type: ${l.questionType} | focus: ${l.skillFocus} | task: ${l.questionSummary}`)
          .join('\n');

        const priorModules = (outline.modules ?? []).slice(0, modIdx);
        const priorContext = priorModules.length
          ? `CONCEPTS ALREADY TAUGHT IN PREVIOUS MODULES (students know these -- do NOT re-teach, but may reference them):
${priorModules.map((m: any) => `  Module "${m.title}": ${(m.lessons ?? []).map((l: any) => l.skillFocus || l.title).join(', ')}`).join('\n')}\n`
          : 'This is the FIRST module -- students know only basic Python syntax (variables, loops, if/else). Introduce pandas and numpy from scratch.\n';

        return `You are generating one complete module for a hands-on Python data analysis course.
${baseCtx}

${priorContext}
MODULE ${modIdx + 1}: ${mod.title}
${mod.description ? `Description: ${mod.description}` : ''}

LESSONS TO GENERATE (return ALL of them in the "lessons" array with the exact lessonId values):
${lessonList}

=== PART 1: moduleIntroTitle and moduleIntroBody ===
Write a module intro lesson as HTML. Keep it to 150-200 words.
- <blockquote> with a 1-2 sentence job scenario (${industry} industry, ${role} role).
- <p> explaining what this module covers and why it matters.
- For EVERY concept or function that will be used in this module's exercises: give it its own <h4>, one <p> with the key function in <strong>, and a SHORT <pre><code class="language-python"> snippet (3-5 lines, inline # comments). Students must see it explained here before they are asked to use it.
- <blockquote> with the single most important rule.
- <p> listing the lessons ahead.
Allowed tags: <p> <strong> <h4> <ul> <li> <pre> <code> <blockquote>. No em dashes. No curly quotes.

=== PART 2: lessons array ===

PROGRESSION RULE: Lessons within this module must build on each other in order.
- Lesson 1 introduces the simplest concept only.
- Each subsequent lesson adds exactly ONE new concept or function on top of what came before.
- Never combine two unrelated pandas/numpy topics in a single lesson.
- If a task step requires a function not yet covered in this module, add a teaching lesson for it BEFORE the exercise that uses it (reorder if needed).

lessonBody (ALL lesson types, 80-120 words):
  The lessonBody TEACHES the concept used in THIS lesson's exercise.
  <blockquote> scenario (1-2 sentences, job context).
  <p> concept explanation with the EXACT function/method used in the task, in <strong>.
  <pre><code class="language-python"> annotated example showing that exact function (4-6 lines max).
  <p> key rule with <strong>.
  The student must be able to complete the task by following the lessonBody alone.
  Tags: <p> <strong> <pre> <code> <blockquote> only. No headings.

For lessonType = "python_exercise":

  setupCode -- COMPACT numpy seeded generation, NEVER hardcode long lists:
    import pandas as pd
    import numpy as np
    np.random.seed(42)
    n = 50
    <varName> = pd.DataFrame({
        '<col1>': np.random.choice([...3-4 values...], n),
        '<col2>': np.random.randint(low, high, n),
        '<col3>': pd.date_range('2024-01-01', periods=n, freq='D'),
        ...
    })
    Rules:
    - Use AVAILABLE DATASETS variable names and column names.
    - Use np.random functions (choice, randint, uniform, randn) -- never list 50 values manually.
    - Include only imports + DataFrame creation. No print(). No analysis.
    - n=50 rows minimum.

  questionText: HTML. Optionally open with a <blockquote> (1-sentence job context). Then an <ol> of 3-5 steps.
    Each <li> = ONE atomic action. Wrap all function/method/variable/column names in <code>.
    ONLY use functions/methods that were taught in this lesson's lessonBody or in a prior lesson in this module or in the priorContext above. Never ask students to use something not yet introduced.
    Example: "<blockquote>Your manager needs a regional breakdown of sales.</blockquote><ol><li>Filter <code>df</code> to rows where <code>region</code> equals <code>'North'</code> and assign to <code>df_north</code>.</li><li>Print <code>df_north.shape</code>.</li></ol>"
    Bad step: "Filter the data." -- always name the exact method and variables.
    Allowed tags: <ol> <li> <code> <blockquote> <strong>. Nothing else.

  starterCode: skeleton with # ____ blanks for key operations. Dataset pre-loaded -- do NOT recreate it.
    End with print() or .info() for visible output.

  solution: complete solution running AFTER setupCode. Must print or display output.

  expectedOutput:
    The EXACT stdout the solution produces (character for character).
    For shape/columns/dtypes checks: write the exact output (e.g. "(50, 4)" or "Index(['col1',...])").
    For scalar results (mean, sum, count): write the exact number (e.g. "2541.36").
    For filtered DataFrames with print(): include the full printed table.
    For matplotlib plots: the solution must also print "[plot]" after creating the figure, and expectedOutput must be exactly "[plot]".
    Do not leave expectedOutput blank. If exact table output is uncertain, change the task to print a deterministic scalar, shape, list, or "[plot]" marker.

  hints: exactly 3 one-sentence hints (general -> function name -> exact syntax).

For lessonType = "multiple_choice":
  mcqQuestions: 2 scenario-based questions ("A colleague runs X -- what happens?"). 4 options, 1 correct, short explanation.
  questionText: ""  setupCode: ""  starterCode: ""  solution: ""  expectedOutput: ""  hints: []

STRICT RULES:
- Return the exact lessonId from the input for every lesson -- do not change IDs.
- Never use .iterrows() -- vectorized pandas only.
- No em dashes. No curly quotes. No asterisks.
- Each lesson teaches ONE concept. Do not merge two unrelated topics.
- The task (questionText) must ONLY use what was taught in this lesson's lessonBody or prior lessons. No mystery functions.`;
      }

      // Run all modules in parallel -- wall time = slowest single module (~30-40s) not sum of all.
      const moduleResults = await Promise.all(
        outline.modules.map(async (mod: any, modIdx: number) => {
          try {
            const result = await generateJSON(buildModulePrompt(mod, modIdx), moduleSchema, { temperature: 0.5, geminiRetries: 2, thinkingLevel: 'low' });
            return { mod, result };
          } catch {
            return { mod, result: null };
          }
        })
      );

      const failedModules = moduleResults.filter(({ result }) => !result || !Array.isArray((result as any).lessons));
      if (failedModules.length) {
        const names = failedModules
          .map(({ mod }) => String(mod?.title ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        return NextResponse.json({
          error: `Python course generation failed for ${failedModules.length} module${failedModules.length === 1 ? '' : 's'}${names ? `: ${names}` : ''}. Please regenerate the course.`,
        }, { status: 502 });
      }

      const questions: any[] = [];

      for (const { mod, result: modResult } of moduleResults) {
        if (!modResult) continue;

        // Module intro slide
        if (modResult.moduleIntroBody) {
          questions.push({
            id:            uid(),
            lessonOnly:    true,
            question:      '',
            options:       [],
            correctAnswer: '',
            lesson:        { title: modResult.moduleIntroTitle || mod.title, body: modResult.moduleIntroBody },
          });
        }

        // Restore original lesson order from the outline
        const lessonOrder = new Map<string, number>((mod.lessons ?? []).map((l: any, i: number) => [l.id as string, i]));
        const sortedLessons = (modResult.lessons ?? []).slice().sort((a: any, b: any) => {
          const ai: number = lessonOrder.get(a.lessonId) ?? 999;
          const bi: number = lessonOrder.get(b.lessonId) ?? 999;
          return ai - bi;
        });

        for (const gen of sortedLessons) {
          const outLesson = (mod.lessons ?? []).find((l: any) => l.id === gen.lessonId);
          const lessonTitle = gen.lessonTitle || outLesson?.title || '';

          if (gen.lessonType === 'multiple_choice') {
            if (gen.lessonBody) {
              questions.push({
                id: uid(), lessonOnly: true, question: '', options: [], correctAnswer: '',
                lesson: { title: lessonTitle, body: gen.lessonBody },
              });
            }
            for (const q of gen.mcqQuestions ?? []) {
              questions.push({
                id:            uid(),
                type:          'multiple_choice',
                question:      q.questionText ?? '',
                options:       q.options ?? [],
                correctAnswer: q.correctAnswer ?? '',
                explanation:   q.explanation ?? '',
              });
            }
          } else {
            questions.push({
              id:                   uid(),
              type:                 'python_exercise',
              question:             gen.questionText ?? '',
              options:              [],
              correctAnswer:        '',
              pythonStarterCode:    normalizePythonCodeInput(gen.starterCode ?? '# Write your solution here\n'),
              pythonSolution:       normalizePythonCodeInput(gen.solution ?? ''),
              pythonExpectedOutput: gen.expectedOutput ?? '',
              pythonSetupCode:      normalizePythonCodeInput(gen.setupCode ?? ''),
              pythonHints:          gen.hints ?? [],
              pythonDatasets:       [],
              lesson:               { title: lessonTitle, body: gen.lessonBody ?? '' },
            });
          }
        }
      }

      if (!questions.length) {
        return NextResponse.json({ error: 'Course generation produced no content. Please try again.' }, { status: 502 });
      }

      return NextResponse.json({
        title,
        description:   outline.courseDescription ?? '',
        isCourse:      true,
        learnOutcomes: outline.learningOutcomes ?? [],
        questions,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 }); // unreachable -- allowlist above
  } catch (err: any) {
    console.error('AI course error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
