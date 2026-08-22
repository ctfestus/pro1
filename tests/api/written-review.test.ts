// Pins the rate-limit CONTRACT of /api/written-review, which is deliberately different from the
// other AI routes: it fails OPEN when the limiter is unreachable.
//
// This file exists because that difference was already flattened once by a sweep making AI spend
// fail closed everywhere. The reason it must not be is behavioural, not stylistic:
// WrittenResponsePlayer only calls onComplete() after a successful review, so refusing here leaves
// a graded written_response question uncompletable until Redis returns. A few uncounted AI calls
// during an outage is the cheaper failure. ve-brief-chat and ve-answer-review fail closed instead,
// because their players record completion with an error marker and never block progression.
//
// bumpRateLimit and readBoundedJson are intentionally NOT mocked -- the point is to exercise the
// real limiter path, since that is where the regression lived.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { POST } from '@/app/api/written-review/route';

const mockRequireUser = vi.mocked(requireUser);
const mockGetRedis = vi.mocked(getRedis);
const mockGenerateJSON = vi.mocked(generateJSON);

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/written-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any) as unknown as Promise<Response>;
}

function redisStub(count = 1) {
  return {
    incr: vi.fn(async (_key: string) => count),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 86000),
  };
}

function throwingRedis() {
  return {
    incr: vi.fn(async (_key: string) => { throw new Error('redis unreachable'); }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 86000),
  };
}

// depth 'full' is the graded written_response question; 'brief' is the lesson knowledge check.
const answerBody = (extra: Record<string, unknown> = {}) => ({
  depth: 'full',
  question: 'Why is the Q3 revenue figure double counted?',
  rubric: ['Identifies the duplicated invoice'],
  studentAnswer: 'The same invoice is recorded in both August and September.',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ user: { id: 'student-1' }, token: 'test-token' } as any);
  mockGetRedis.mockReturnValue(redisStub() as any);
  mockGenerateJSON.mockResolvedValue({
    overallScore: 82,
    executiveSummary: 'Correctly identifies the duplication.',
    categories: [], sections: [], topRecommendations: [], rubricGrades: [],
  });
});

describe('POST /api/written-review - fails open by design', () => {
  it('still reviews the answer when Redis is missing', async () => {
    mockGetRedis.mockReturnValue(null as any);
    const res = await post(answerBody());
    expect(res.status).toBe(200);
    // The assertion that matters: the student's graded answer was actually marked.
    expect(mockGenerateJSON).toHaveBeenCalledTimes(1);
  });

  it('still reviews the answer when the limiter throws', async () => {
    mockGetRedis.mockReturnValue(throwingRedis() as any);
    const res = await post(answerBody());
    expect(res.status).toBe(200);
    expect(mockGenerateJSON).toHaveBeenCalledTimes(1);
  });

  it('returns 429 once over the graded daily cap, and does not call the model', async () => {
    // RATE_LIMITS.full is 10, so an eleventh attempt is over.
    mockGetRedis.mockReturnValue(redisStub(11) as any);
    const res = await post(answerBody());
    expect(res.status).toBe(429);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('meters practice and graded work on separate counters', async () => {
    // Sharing one counter would let a student's ungraded knowledge checks lock them out of the
    // graded question, which is why the route keys the two depths apart.
    const graded = redisStub();
    mockGetRedis.mockReturnValue(graded as any);
    await post(answerBody({ depth: 'full' }));

    const practice = redisStub();
    mockGetRedis.mockReturnValue(practice as any);
    await post(answerBody({ depth: 'brief' }));

    const gradedKey = graded.incr.mock.calls[0][0];
    const practiceKey = practice.incr.mock.calls[0][0];
    expect(gradedKey).not.toBe(practiceKey);
    expect(gradedKey).toContain('full');
    expect(practiceKey).toContain('brief');
  });
});
