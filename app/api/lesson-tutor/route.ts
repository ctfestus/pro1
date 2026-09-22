import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError, type AuthedUser } from '@/lib/api-auth';
import { generateText, GEMINI_MODEL } from '@/lib/ai';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit, refundRateLimit } from '@/lib/rate-limit';
import { chargeAiFeature, refundAiFeature, type AiFeatureCharge } from '@/lib/ai-feature-gate';
import { lessonPlainText } from '@/lib/lesson-doc';
import {
  MAX_QUESTION_CHARS, MAX_LESSON_CHARS, MAX_OUTPUT_TOKENS, TUTOR_SYSTEM_INSTRUCTION,
  asksAboutCode, buildTutorPrompt, normalizeHistory, supportsThinkingLevel,
  type TutorLesson,
} from '@/lib/lesson-tutor';

export const dynamic = 'force-dynamic';

// AI tutor for interactive lesson slides, opt-in per course (courses.ai_tutor_enabled).
//
// The lesson is loaded HERE from the course row -- the client sends only which slide is
// being read, never the content to answer from. That keeps the grounding authoritative and
// stops a caller from feeding in their own text. Access is the caller's own RLS read of the
// course, so the tutor is reachable exactly where the course itself is.
//
// Nothing is persisted -- the thread lives in the player's session state by design.

// GEMINI_TUTOR_API_KEY is REQUIRED, not an optional optimisation. Falling back to the platform
// key would put a student-facing surface on the same quota as course generation -- one class
// could take authoring down -- and would re-enable the OpenAI fallback, quietly spending paid
// credit on a feature meant to run on a free tier. Missing key means the tutor is off.
const TUTOR_KEY = process.env.GEMINI_TUTOR_API_KEY;
const TUTOR_MODEL = process.env.GEMINI_TUTOR_MODEL || GEMINI_MODEL;

const AI_OPTS = {
  geminiApiKey: TUTOR_KEY,
  // The RESOLVED model, not the raw env var. Passing the raw value sent `undefined` whenever
  // GEMINI_TUTOR_MODEL was unset, so lib/ai fell back to the platform model while
  // supportsThinkingLevel() below had already been evaluated against the resolved name. The
  // two could disagree, which is how a thinking cap could reach a model that rejects it.
  geminiModel: TUTOR_MODEL,
  noFallback: true,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  // No automatic retry. On a student-facing surface a retry silently doubles what one question
  // costs, and the failures a retry existed to paper over -- unparseable JSON and truncated
  // envelopes -- cannot happen now that the reply comes back as plain text.
  geminiRetries: 0,
  // Left at the model default, thinking burns output budget on a reply that is only a few
  // paragraphs long. Only sent to models that accept the parameter: pre-3 models reject it
  // outright, and the tutor ships on a 2.5 model, so this cannot be assumed.
  ...(supportsThinkingLevel(TUTOR_MODEL) ? { thinkingLevel: 'low' as const } : {}),
};

// Three ceilings, because they protect against different things.
//
// The per-user cap stops one student monopolising the tutor. The global caps protect the
// PROJECT quota, which is what Gemini actually meters -- a per-user limit does nothing there,
// since thirty students within their personal allowance can still drain a shared daily
// allocation between them. Overridable per deployment because the right numbers depend
// entirely on which plan the tutor key sits on.
const num = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);
// The per-learner limit comes from settings. The two GLOBAL ceilings below stay in env: they
// are the circuit breaker on the AI account, not a product setting, and a form that can raise
// them is a form that can run up a bill.
const GLOBAL_HOURLY_LIMIT = num(process.env.TUTOR_GLOBAL_HOURLY_LIMIT, 120);
const GLOBAL_DAILY_LIMIT = num(process.env.TUTOR_GLOBAL_DAILY_LIMIT, 600);
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;
const GLOBAL_DAY_KEY = 'rate:lesson-tutor:global:day';
const GLOBAL_HOUR_KEY = 'rate:lesson-tutor:global:hour';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unavailable = (): AiFeatureCharge => ({
  // Fail closed -- the tutor runs on a metered AI quota, so an unavailable limiter must not become
  // an unlimited one.
  response: NextResponse.json({ error: 'The tutor is unavailable right now.' }, { status: 503 }),
  receipt: null,
});

async function checkRateLimit(auth: AuthedUser): Promise<AiFeatureCharge> {
  const redis = getRedis();
  if (!redis) return unavailable();

  // The caller's own cap is checked first so a student who is already over their limit cannot
  // spend from the shared platform budget on the way to being refused.
  const own = await chargeAiFeature(auth, redis, 'lessonTutor', {
    unavailableMessage: 'The tutor is unavailable right now.',
  });
  if (own.response) return own;

  // The ceilings are checked in order, so by the time one of them refuses, the ones before it have
  // already been charged for a question that is not going to be answered. Everything charged on the
  // way here goes back: the day's budget, and the learner's own attempt.
  let daySpent = false;
  const release = async () => {
    try {
      if (daySpent) await refundRateLimit(redis, GLOBAL_DAY_KEY);
    } catch {
      // Nothing to do. The window rolls the counter anyway.
    }
    if (own.receipt) await refundAiFeature(own.receipt);
  };

  const refuseGlobally = async (error: string): Promise<AiFeatureCharge> => {
    await release();
    return { response: NextResponse.json({ error }, { status: 429 }), receipt: null };
  };

  try {
    // Platform-wide, and worded without numbers: a student has no way to act on a global ceiling,
    // so telling them the count would only read as a broken feature.
    if (await bumpRateLimit(redis, GLOBAL_DAY_KEY, GLOBAL_DAILY_LIMIT, DAY_SECONDS)) {
      return refuseGlobally('The tutor has reached its limit for today. Please try again tomorrow.');
    }
    daySpent = true;
    if (await bumpRateLimit(redis, GLOBAL_HOUR_KEY, GLOBAL_HOURLY_LIMIT, HOUR_SECONDS)) {
      // Without this, an hour spent retrying through a busy spell would eat the whole day's budget
      // without a single question ever reaching the model.
      return refuseGlobally('The tutor is busy right now. Please try again in a little while.');
    }
  } catch {
    await release();
    return unavailable();
  }

  return own;
}

const stripHtml = (v: unknown, cap: number) =>
  typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap) : '';

export async function POST(req: NextRequest) {
  // Checked before anything else: without its own key the tutor has no isolated quota, and
  // running it on the platform key is worse than not running it at all.
  if (!TUTOR_KEY) {
    console.warn('[lesson-tutor] GEMINI_TUTOR_API_KEY is not configured; refusing the request.');
    return NextResponse.json({ error: 'The tutor is not available right now.' }, { status: 503 });
  }

  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const courseId = typeof body?.courseId === 'string' ? body.courseId : '';
  const slideId = typeof body?.slideId === 'string' ? body.slideId : '';

  if (!courseId || !slideId) {
    return NextResponse.json({ error: 'courseId and slideId are required.' }, { status: 400 });
  }

  const question = stripHtml(body?.question, MAX_QUESTION_CHARS + 1);
  if (!question) return NextResponse.json({ error: 'Type a question first.' }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Question must be ${MAX_QUESTION_CHARS} characters or fewer.` },
      { status: 400 },
    );
  }

  const { data: course } = await auth.getActorDb()
    .from('courses')
    .select('title, questions, ai_tutor_enabled')
    .eq(UUID_RE.test(courseId) ? 'id' : 'slug', courseId)
    .maybeSingle();

  if (!course) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!course.ai_tutor_enabled) {
    return NextResponse.json({ error: 'The tutor is not enabled for this course.' }, { status: 403 });
  }

  // The tutor only answers on lesson slides. A quiz slide carries its own marked answer,
  // so grounding a helper in one is a different feature with a different risk.
  const slide = (Array.isArray(course.questions) ? course.questions : [])
    .find((q: any) => q?.id === slideId);
  if (!slide?.lessonOnly) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const lessonNode = slide.lesson ?? {};
  // Runnable-code content rides along only when the learner actually asked about code. Left on
  // for every question it would be a per-question cost paid by every learner who only ever asks
  // about the concept. Even then it is the learner-visible code plus schema and imports, never
  // the seed rows -- see lessonPlainText.
  const includeCode = asksAboutCode(question);
  // `doc` is canonical; `body` is the HTML fallback for lessons authored before it existed.
  // Fall through to `body` when the doc yields nothing, so a malformed doc degrades to the
  // fallback instead of reporting the lesson as unreadable.
  const lessonText = (lessonNode.doc ? lessonPlainText(lessonNode.doc, MAX_LESSON_CHARS, { includeCode }) : '')
    || stripHtml(lessonNode.body, MAX_LESSON_CHARS);

  if (!lessonText) {
    return NextResponse.json({ error: 'This lesson has no text for the tutor to read yet.' }, { status: 422 });
  }

  const lesson: TutorLesson = {
    courseTitle: stripHtml(course.title, 200),
    lessonTitle: stripHtml(lessonNode.title, 200),
    lessonText,
  };

  // Counted LAST, immediately before the only call that actually spends AI quota. Checking it
  // earlier meant a request that was about to be rejected -- unknown course, tutor disabled,
  // wrong slide type, empty lesson -- still consumed a slot from the shared platform
  // allowance, so a bad or hostile caller could drain the day's budget without ever reaching
  // the model.
  const charge = await checkRateLimit(auth);
  if (charge.response) return charge.response;

  try {
    // The tutor's own system instruction replaces lib/ai's ASCII-only default, which would
    // otherwise outrank the prompt and flatten every reply into plain prose.
    const reply = await generateText(
      buildTutorPrompt(lesson, question, normalizeHistory(body?.history)),
      { ...AI_OPTS, temperature: 0.6, systemInstruction: TUTOR_SYSTEM_INSTRUCTION },
    );
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[lesson-tutor]', (err as Error).message);
    // The tutor never answered, so it should not have cost them a question. Only the learner's own
    // allowance is given back -- the platform-wide ceilings are a spend brake, not an entitlement.
    if (charge.receipt) await refundAiFeature(charge.receipt);
    return NextResponse.json({ error: 'The tutor could not answer right now. Please try again.' }, { status: 502 });
  }
}
