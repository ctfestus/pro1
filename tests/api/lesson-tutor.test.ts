import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(),
}));

// GEMINI_MODEL is pinned here so the platform default is deterministic and the tests assert
// the route's own resolution rather than whatever the machine's env happens to hold.
vi.mock('@/lib/ai', () => ({
  generateText: vi.fn(),
  GEMINI_MODEL: 'gemini-3.5-flash',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { generateText } from '@/lib/ai';
import { createClient } from '@supabase/supabase-js';

const mockRequireUser = vi.mocked(requireUser);
const mockGetRedis = vi.mocked(getRedis);
const mockGenerateText = vi.mocked(generateText);
const mockCreateClient = vi.mocked(createClient);

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
    incr: vi.fn(async () => 1),
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
  mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, serviceDb: {} as any, token: 't' } as any);
  mockCreateClient.mockReturnValue(courseStub(COURSE) as any);
  mockGenerateText.mockResolvedValue('An answer.');
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('POST /api/lesson-tutor - model selection', () => {
  it('sends the resolved tutor model, not the raw env value', async () => {
    const POST = await loadRoute({ GEMINI_TUTOR_MODEL: 'gemini-3.1-flash-lite' });
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ geminiModel: 'gemini-3.1-flash-lite' });
  });

  it('falls back to the platform model when no tutor model is configured', async () => {
    // Previously the raw env var was passed through, so this case sent `undefined` and let
    // lib/ai resolve it -- which could disagree with the model the thinking gate was judged on.
    const POST = await loadRoute();
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ geminiModel: 'gemini-3.5-flash' });
  });

  it('caps thinking on the 3.x model the tutor actually ships on', async () => {
    const POST = await loadRoute({ GEMINI_TUTOR_MODEL: 'gemini-3.1-flash-lite' });
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ thinkingLevel: 'low' });
  });

  it('omits thinkingLevel on a pre-3 model, which rejects the parameter', async () => {
    // Version-gate coverage rather than a deployable configuration: the 2.x line is closed to
    // new keys, but an existing deployment may still have one pinned in its env.
    const POST = await loadRoute({ GEMINI_TUTOR_MODEL: 'gemini-2.0-flash' });
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).not.toHaveProperty('thinkingLevel');
  });
});

describe('POST /api/lesson-tutor - spend controls', () => {
  it('never retries automatically, since a retry doubles what one question costs', async () => {
    const POST = await loadRoute();
    await post(POST, ask('What is a median?'));
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ geminiRetries: 0 });
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
    expect(mockGenerateText.mock.calls[0][1]).toMatchObject({ geminiApiKey: 'tutor-key' });
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
    mockCreateClient.mockReturnValue(courseStub({ ...COURSE, ai_tutor_enabled: false }) as any);
    const POST = await loadRoute();
    const res = await post(POST, ask('What is a median?'));
    expect(res.status).toBe(403);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('returns 404 for a course the caller cannot read', async () => {
    mockCreateClient.mockReturnValue(courseStub(null) as any);
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
