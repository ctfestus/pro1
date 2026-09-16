import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai-limits-server', () => ({
  aiTierFor: vi.fn(),
  getAiLimits: vi.fn(),
}));

import { aiTierFor, getAiLimits } from '@/lib/ai-limits-server';
import { enforceAiFeatureLimit } from '@/lib/ai-feature-gate';
import { AI_LIMIT_DEFAULTS, type AiLimits } from '@/lib/ai-limits';

const mockTier = vi.mocked(aiTierFor);
const mockLimits = vi.mocked(getAiLimits);

const auth = { actor: { id: 'u1' }, serviceDb: {} } as any;

/** Counts from 1 upward, so `over` forces the limiter past whatever limit is in force. */
function redisStub(count = 1) {
  return {
    incr: vi.fn(async () => count),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 3600),
  };
}

const withLimits = (patch: Partial<AiLimits>) => ({ ...AI_LIMIT_DEFAULTS, ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  mockTier.mockResolvedValue('free');
  mockLimits.mockResolvedValue(AI_LIMIT_DEFAULTS);
});

describe('a feature switched off', () => {
  it('refuses even when the counter is unreachable on a fail-open route', async () => {
    // Being off is policy, not metering. A fail-open route reached its early return before ever
    // reading the limit, so a reviewer an admin had closed quietly ran during a Redis blip.
    mockLimits.mockResolvedValue(withLimits({ practiceChecks: { free: 0, paid: 20 } }));

    const res = await enforceAiFeatureLimit(auth, null, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(402);
  });

  it('refuses before spending anything from the counter', async () => {
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 3 } }));
    const redis = redisStub();

    const res = await enforceAiFeatureLimit(auth, redis as any, 'excelReview');

    expect(res?.status).toBe(402);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does not tell a learner to wait for something that is off', async () => {
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 0 } }));

    const body = await (await enforceAiFeatureLimit(auth, redisStub() as any, 'excelReview'))!.json();

    expect(body.error).not.toMatch(/reset|try again|later/i);
  });
});

describe('an allowance that has been spent', () => {
  it('says what they had and that it comes back, never that the feature is off', async () => {
    const body = await (await enforceAiFeatureLimit(auth, redisStub(99) as any, 'practiceChecks'))!.json();

    expect(body.code).toBe('daily_limit_reached');
    expect(body.error).toMatch(/resets/i);
    expect(body.error).not.toMatch(/turned off/i);
  });

  it('lets a caller under the limit through', async () => {
    expect(await enforceAiFeatureLimit(auth, redisStub(1) as any, 'practiceChecks')).toBeNull();
  });
});

describe('who gets offered an upgrade', () => {
  it('offers one to a free learner when the paid column is better', async () => {
    const body = await (await enforceAiFeatureLimit(auth, redisStub(99) as any, 'writtenReviews'))!.json();
    expect(body.upgradeUrl).toBeTruthy();
  });

  it('offers none when upgrading would not improve that feature', async () => {
    // Nothing stops an admin setting paid at or below free. Selling an upgrade there sells a
    // reduction.
    mockLimits.mockResolvedValue(withLimits({ writtenReviews: { free: 10, paid: 2 } }));

    const body = await (await enforceAiFeatureLimit(auth, redisStub(99) as any, 'writtenReviews'))!.json();

    expect(body.upgradeUrl).toBeUndefined();
  });

  it('offers none to a subscriber, who has nothing above them to buy', async () => {
    mockTier.mockResolvedValue('paid');

    const body = await (await enforceAiFeatureLimit(auth, redisStub(99) as any, 'writtenReviews'))!.json();

    expect(body.upgradeUrl).toBeUndefined();
  });
});

describe('staff', () => {
  it('reads the shipped numbers rather than whatever learners were given', async () => {
    // The settings page is scoped to learners. Closing a reviewer for students must not stop an
    // instructor previewing their own course.
    mockTier.mockResolvedValue('staff');
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 0 } }));

    expect(await enforceAiFeatureLimit(auth, redisStub(1) as any, 'excelReview')).toBeNull();
  });
});

describe('when the limiter cannot be reached', () => {
  it('refuses on a fail-closed route', async () => {
    // A feature the plan DOES include, so the refusal is about the missing limiter rather than
    // the feature being off -- those two are decided in that order, and it matters.
    const res = await enforceAiFeatureLimit(auth, null, 'veAnswers');
    expect(res?.status).toBe(503);
  });

  it('lets the cheap text reviewers through', async () => {
    expect(await enforceAiFeatureLimit(auth, null, 'practiceChecks', { failOpen: true })).toBeNull();
  });

  it('refuses a caller it cannot identify, since there is no counter to spend', async () => {
    const res = await enforceAiFeatureLimit({ actor: undefined, serviceDb: {} } as any, redisStub() as any, 'excelReview');
    expect(res?.status).toBe(503);
  });
});

describe('when the policy itself cannot be read', () => {
  it('refuses even on a fail-open route, because "off" cannot be ruled out', async () => {
    // failOpen answers a counting failure, not a policy one. Running the feature here would mean
    // running something an admin may have switched off, at the moment nobody can tell.
    mockLimits.mockRejectedValue(new Error('settings unavailable'));

    const res = await enforceAiFeatureLimit(auth, redisStub(1) as any, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(503);
  });

  it('refuses when the caller cannot be classified', async () => {
    mockTier.mockRejectedValue(new Error('students lookup failed'));

    const res = await enforceAiFeatureLimit(auth, redisStub(1) as any, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(503);
  });

  it('spends nothing from the counter when it refuses', async () => {
    mockLimits.mockRejectedValue(new Error('settings unavailable'));
    const redis = redisStub(1);

    await enforceAiFeatureLimit(auth, redis as any, 'practiceChecks', { failOpen: true });

    expect(redis.incr).not.toHaveBeenCalled();
  });
});
