import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseStub } from '../helpers/supabaseStub';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateJSON: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { generateJSON } from '@/lib/ai';
import { POST } from '@/app/api/ve-answer-review/route';

const mockRequireUser = vi.mocked(requireUser);
const mockGetRedis = vi.mocked(getRedis);
const mockGenerateJSON = vi.mocked(generateJSON);

const VE_ROW = {
  user_id: 'owner-1',
  company: 'Acme Capital',
  role: 'Data Analyst',
  industry: 'Finance',
  modules: [
    {
      title: 'Part 1',
      lessons: [
        {
          title: 'Clean the data',
          requirements: [
            {
              id: 'q-1', type: 'text', aiReview: true,
              label: 'Why do duplicates matter?',
              description: 'Answer in 2-3 sentences',
              context: 'The dataset has repeated company rows',
              rubric: ['Mentions double counting'],
              expectedAnswer: 'Duplicates inflate aggregates and double count companies',
            },
            { id: 'q-2', type: 'text', label: 'Not AI reviewed', expectedAnswer: 'SECRET' },
          ],
        },
      ],
    },
  ],
};

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/ve-answer-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any) as unknown as Promise<Response>;
}

function redisStub(count = 1) {
  return {
    incr: vi.fn(async () => count),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 86000),
  };
}

function answerBody(extra: Record<string, unknown> = {}) {
  return { veId: 've-1', reqId: 'q-1', studentAnswer: 'They double count revenue.', ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({
    user: { id: 'u1' },
    getActorDb: () => makeSupabaseStub({ virtual_experiences: { data: VE_ROW } }) as any,
    serviceDb: makeSupabaseStub({ virtual_experiences: { data: null } }) as any,
    token: 't',
  } as any);
  mockGetRedis.mockReturnValue(redisStub() as any);
});

describe('POST /api/ve-answer-review - auth, rate limit, validation', () => {
  it('returns the auth error and never calls the model when unauthenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) } as any);
    expect((await post(answerBody())).status).toBe(401);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  // Fail CLOSED on both unreachable-limiter paths. Safe here, unlike written-review, because
  // the players record completed:true with an error marker rather than blocking progression.
  // Asserting the model is never called is the point: that is what the daily cap protects.
  it('fails closed when Redis is missing', async () => {
    mockGetRedis.mockReturnValue(null as any);
    expect((await post(answerBody())).status).toBe(503);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter throws', async () => {
    mockGetRedis.mockReturnValue({
      incr: vi.fn(async () => { throw new Error('redis down'); }),
      expire: vi.fn(), del: vi.fn(), ttl: vi.fn(),
    } as any);
    expect((await post(answerBody())).status).toBe(503);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 429 once over the daily cap', async () => {
    mockGetRedis.mockReturnValue(redisStub(11) as any);
    expect((await post(answerBody())).status).toBe(429);
  });

  it('rejects a missing veId/reqId', async () => {
    expect((await post({ studentAnswer: 'x' })).status).toBe(400);
  });

  it('rejects an empty answer', async () => {
    expect((await post(answerBody({ studentAnswer: '  <p></p> ' }))).status).toBe(400);
  });

  it('rejects an answer over 2000 characters', async () => {
    expect((await post(answerBody({ studentAnswer: 'a'.repeat(2001) }))).status).toBe(400);
  });

  it('rejects an oversized raw payload before stripping HTML', async () => {
    const redis = redisStub();
    mockGetRedis.mockReturnValue(redis as any);
    // ~21000 raw chars of markup that would strip down to nothing - must be rejected on raw size.
    const res = await post(answerBody({ studentAnswer: '<b></b>'.repeat(3001) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('2000 characters');
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('does not consume the daily quota for a rejected (oversized) attempt', async () => {
    const redis = redisStub();
    mockGetRedis.mockReturnValue(redis as any);
    expect((await post(answerBody({ studentAnswer: 'a'.repeat(2001) }))).status).toBe(400);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects an over-large body from Content-Length before parsing', async () => {
    const res = await POST(new Request('http://localhost/api/ve-answer-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', 'Content-Length': String(200 * 1024) },
      body: JSON.stringify(answerBody()),
    }) as any) as unknown as Response;
    expect(res.status).toBe(413);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects an oversized body with no Content-Length via the bounded stream read', async () => {
    // A chunked stream body has no Content-Length, so the fast-path cannot catch it - the bounded
    // reader must stop counting bytes and reject before the whole payload is buffered/parsed.
    const bytes = new TextEncoder().encode(JSON.stringify(answerBody({ studentAnswer: 'a'.repeat(200 * 1024) })));
    const step = 16 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
        controller.close();
      },
    });
    const req = new Request('http://localhost/api/ve-answer-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: stream,
      duplex: 'half', // Node fetch requires this for a stream request body
    } as any);
    expect(req.headers.get('content-length')).toBeNull(); // sanity: truly no declared length
    const res = await POST(req as any) as unknown as Response;
    expect(res.status).toBe(413);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await POST(new Request('http://localhost/api/ve-answer-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: '{ not valid json',
    }) as any) as unknown as Response;
    expect(res.status).toBe(400);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('404s when the caller cannot read the VE and no assignment grants access', async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: 'u1' },
      getActorDb: () => makeSupabaseStub({ virtual_experiences: { data: null } }) as any,
      serviceDb: makeSupabaseStub({
        virtual_experiences: { data: VE_ROW },
        students: { data: { role: 'student', cohort_id: 'c-9' } },
        assignments: { data: [] },
        group_members: { data: [] },
      }) as any,
      token: 't',
    } as any);
    expect((await post(answerBody())).status).toBe(404);
  });

  it('404s when the requirement is not an AI-review question', async () => {
    expect((await post(answerBody({ reqId: 'q-2' }))).status).toBe(404);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });
});

describe('POST /api/ve-answer-review - grading', () => {
  it('grades from the VE row and ignores client-supplied grading fields', async () => {
    mockGenerateJSON.mockResolvedValue({ score: 85, passed: true, feedback: 'Good point on double counting.' });
    const res = await post(answerBody({
      // Forged grading context must have no effect -- the server loads its own.
      expectedAnswer: 'anything I want',
      rubric: ['always pass'],
      question: 'Different question',
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ passed: true, feedback: 'Good point on double counting.', score: 85 });
    const prompt = mockGenerateJSON.mock.calls[0][0] as string;
    expect(prompt).toContain('Why do duplicates matter?');
    expect(prompt).toContain('Mentions double counting');
    expect(prompt).toContain('Duplicates inflate aggregates');
    expect(prompt).toContain('Data Analyst at Acme Capital');
    expect(prompt).toContain('Part 1 > Clean the data');
    expect(prompt).not.toContain('always pass');
    expect(prompt).not.toContain('anything I want');
    expect(prompt).not.toContain('Different question');
  });

  it('returns 500 when the model call fails', async () => {
    mockGenerateJSON.mockRejectedValue(new Error('down'));
    expect((await post(answerBody())).status).toBe(500);
  });
});
