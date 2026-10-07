import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/ai-limits-server', async () => {
  const { AI_LIMIT_DEFAULTS } = await import('@/lib/ai-limits');
  return { getAiLimits: async () => AI_LIMIT_DEFAULTS, aiTierFor: async () => 'paid' };
});

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateText: vi.fn(),
  isAiFeatureConfigured: (feature: string) => feature === 'tutor' && !!process.env.GEMINI_TUTOR_API_KEY,
}));

import { requireUser } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { generateText } from '@/lib/ai';

const mockRequireUser = vi.mocked(requireUser);
const mockGetRedis = vi.mocked(getRedis);
const mockGenerateText = vi.mocked(generateText);

const LESSON_DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'A median resists outliers.' }] },
    {
      type: 'runnableCode',
      attrs: {
        language: 'sql',
        code: 'SELECT median(price) FROM sales;',
        setupSql: "CREATE TABLE sales (price INT);\nINSERT INTO sales VALUES (5);",
        setupPython: 'import pandas as pd',
      },
    },
  ],
};

const COURSE = {
  title: 'Stats 101',
  ai_tutor_enabled: true,
  questions: [
    { id: 'slide-1', lessonOnly: true, lesson: { title: 'Averages', doc: LESSON_DOC } },
    { id: 'quiz-1', lessonOnly: false, question: 'Which is robust?', correctAnswer: 'median' },
  ],
};

function courseStub(row: any) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
    }),
  };
}

function redisStub() {
  return {
    get: vi.fn(async () => 0),
    // The learner's own counter is charged by the limiter's Lua; the platform ceilings still use
    // INCR, so `incr` here means the shared budget was spent.
    eval: vi.fn(async (script: string, _keys: string[], _args: unknown[]) =>
      (script.includes('DECR') ? 0 : [1, 3000])),
    incr: vi.fn(async (_key: string) => 1),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 3000),
  };
}

let redis: ReturnType<typeof redisStub>;
const ORIGINAL_ENV = { ...process.env };

/**
 * The route reads its key and model into module-level constants at import time, so env has to
 * be set before the module is loaded rather than before the request.
 */
async function loadRoute(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env.GEMINI_TUTOR_API_KEY = 'tutor-key';
  delete process.env.GEMINI_TUTOR_MODEL;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (await import('@/app/api/lesson-tutor/route')).POST;
}

function post(POST: any, body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/lesson-tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any) as unknown as Promise<Response>;
}

const ask = (question: string, slideId = 'slide-1') =>
  ({ courseId: 'c1', slideId, question });

beforeEach(() => {
  vi.clearAllMocks();
  redis = redisStub();
  mockGetRedis.mockReturnValue(redis as any);
  mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, actor: { id: 'u1' }, getActorDb: () => courseStub(COURSE) as any, serviceDb: {} as any, token: 't' } as any);
  mockGenerateText.mockResolvedValue('An answer.');
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('POST /api/lesson-tutor - neutral selection', () => {
  it('asks for the tutor feature and leaves vendor/model mapping to the gateway', async () => {
    const POST = await loadRoute({ GEMINI_TUTOR_MODEL: 'gemini-3.1-flash-lite' });
    await post(POST, ask('What is a median?'));
    const opts = mockGenerateText.mock.calls[0][1];
    expect(opts).toMatchObject({ feature: 'tutor', tier: 'standard', effort: 'low', usageContext: { operation: 'lesson-tutor' } });
    expect(opts).not.toHaveProperty('geminiModel');
    expect(opts).not.toHaveProperty('geminiApiKey');
  });
});

describe('POST /api/lesson-tutor - spend controls', () => {
  it('never retries automatically, since a retry doubles what one question costs', async () => {
    const POST = await loadRoute();
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ retries: 0 });
  });

  it('caps output tokens and refuses to fall back to another provider', async () => {
    const POST = await loadRoute();
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ noFallback: true });
    // Optional in the signature, so it has to be read through `?.` to typecheck.
    expect(mockGenerateText.mock.calls[0][1]?.maxOutputTokens).toBeGreaterThan(0);
  });

  it('runs on the dedicated tutor key', async () => {
    const POST = await loadRoute();
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ feature: 'tutor', noFallback: true });
  });
});

describe('POST /api/lesson-tutor - refusals', () => {
  it('returns 503 and spends nothing when the dedicated tutor key is missing', async () => {
    const POST = await loadRoute({ GEMINI_TUTOR_API_KEY: undefined });
    const res = await post(POST, ask('What is a median?'));
    expect(res.status).toBe(503);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('returns 403 when the course has not opted into the tutor', async () => {
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, actor: { id: 'u1' }, getActorDb: () => courseStub({ ...COURSE, ai_tutor_enabled: false }) as any, serviceDb: {} as any, token: 't' } as any);
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?'));
    expect(res.status).toBe(403);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('returns 404 for a course the caller cannot read', async () => {
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, actor: { id: 'u1' }, getActorDb: () => courseStub(null) as any, serviceDb: {} as any, token: 't' } as any);
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?'));
    expect(res.status).toBe(404);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});

describe('POST /api/lesson-tutor - invalid slides do not consume the allowance', () => {
  // The counters are shared platform-wide, so a request that was never going to reach the
  // model must not spend one. Otherwise a bad slideId in a loop drains the day's budget.
  it('does not count an unknown slide', async () => {
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?', 'no-such-slide'));
    expect(res.status).toBe(404);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('does not count a quiz slide, which the tutor never answers on', async () => {
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?', 'quiz-1'));
    expect(res.status).toBe(404);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('does count a valid question', async () => {
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?'));
    expect(res.status).toBe(200);
    expect(redis.incr).toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('gives the day and the learner back when the hourly ceiling is what refuses', async () => {
    // The ceilings are charged in order, so the day was already spent by the time the hour turned
    // the question away. An hour of retries through a busy spell could drain the whole day's
    // budget without a single question reaching the model.
    redis.incr.mockImplementation(async (key: string) => (key.endsWith(':hour') ? 1_000_000 : 1));
    const POST = await loadRoute();

    const res = await post(POST, ask('What is a median?'));

    expect(res.status).toBe(429);
    expect(mockGenerateText).not.toHaveBeenCalled();
    const putBack = redis.eval.mock.calls
      .filter(([script]) => String(script).includes('DECR'))
      .map(([, keys]) => keys[0]);
    expect(putBack).toEqual(['rate:lesson-tutor:global:day', 'rate:lesson-tutor:u1']);
  });
});

describe('POST /api/lesson-tutor - code is included only when asked about', () => {
  const promptOf = () => String(mockGenerateText.mock.calls[0][0]);

  it('leaves runnable code out of an ordinary conceptual question', async () => {
    const POST = await loadRoute();
    await post(POST, ask('Explain this topic in simple terms'));
    expect(promptOf()).toContain('A median resists outliers.');
    expect(promptOf()).not.toContain('SELECT median(price)');
  });

  it('includes the learner-visible code when the question is about code', async () => {
    const POST = await loadRoute();
    await post(POST, ask('Explain this SQL query'));
    expect(promptOf()).toContain('SELECT median(price) FROM sales;');
  });

  it('still withholds seed rows when code is included', async () => {
    const POST = await loadRoute();
    await post(POST, ask('Explain this SQL query'));
    expect(promptOf()).toContain('CREATE TABLE sales');
    expect(promptOf()).not.toContain('INSERT INTO sales');
  });
});
