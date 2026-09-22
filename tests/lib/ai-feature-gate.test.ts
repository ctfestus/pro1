import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai-limits-server', () => ({
  aiTierFor: vi.fn(),
  getAiLimits: vi.fn(),
}));

import { aiTierFor, getAiLimits } from '@/lib/ai-limits-server';
import {
  chargeAiFeature,
  refundAiFeature,
  reserveAiFeatureLimit,
  spendAiFeatureReservation,
} from '@/lib/ai-feature-gate';
import { AI_LIMIT_DEFAULTS, type AiLimits } from '@/lib/ai-limits';

const mockTier = vi.mocked(aiTierFor);
const mockLimits = vi.mocked(getAiLimits);

const auth = { actor: { id: 'u1' }, serviceDb: {} } as any;

/** The gate's answer on its own, for the cases where the receipt is beside the point. */
const refusal = async (...args: Parameters<typeof chargeAiFeature>) => (await chargeAiFeature(...args)).response;

/** `count` is the attempt this caller is making, so a high one forces them past any limit. */
function redisStub(count = 1) {
  const used = Math.max(0, count - 1);
  return {
    get: vi.fn(async () => used),
    incr: vi.fn(async () => count),
    decr: vi.fn(async () => used),
    // Stands in for the limiter's Lua: refuse at the limit, otherwise count one and report how much
    // of the charged window is left.
    eval: vi.fn(async (script: string, _keys: string[], args: unknown[]) =>
      (script.includes('DECR') ? 0 : (used >= Number(args[0]) ? [0, 0] : [1, 3600]))),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 3600),
  };
}

const spendScripts = (redis: ReturnType<typeof redisStub>) =>
  redis.eval.mock.calls.filter(([script]) => !String(script).includes('DECR'));

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

    const res = await refusal(auth, null, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(402);
  });

  it('refuses before spending anything from the counter', async () => {
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 3 } }));
    const redis = redisStub();

    const res = await refusal(auth, redis as any, 'excelReview');

    expect(res?.status).toBe(402);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('does not tell a learner to wait for something that is off', async () => {
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 0 } }));

    const body = await (await refusal(auth, redisStub() as any, 'excelReview'))!.json();

    expect(body.error).not.toMatch(/reset|try again|later/i);
  });
});

describe('an allowance that has been spent', () => {
  it('says what they had and that it comes back, never that the feature is off', async () => {
    const body = await (await refusal(auth, redisStub(99) as any, 'practiceChecks'))!.json();

    expect(body.code).toBe('daily_limit_reached');
    expect(body.error).toMatch(/resets/i);
    expect(body.error).not.toMatch(/turned off/i);
  });

  it('lets a caller under the limit through', async () => {
    expect(await refusal(auth, redisStub(1) as any, 'practiceChecks')).toBeNull();
  });

  it('checks availability without spending until the caller commits', async () => {
    const redis = redisStub(1);

    const reservation = await reserveAiFeatureLimit(auth, redis as any, 'practiceChecks');

    expect(reservation).not.toBeInstanceOf(Response);
    expect(redis.get).toHaveBeenCalledOnce();
    expect(spendScripts(redis)).toHaveLength(0);
    const charge = await spendAiFeatureReservation(reservation as any);
    expect(charge.response).toBeNull();
    expect(charge.receipt).not.toBeNull();
    expect(spendScripts(redis)).toHaveLength(1);
  });
});

describe('who gets offered an upgrade', () => {
  it('offers one to a free learner when the paid column is better', async () => {
    const body = await (await refusal(auth, redisStub(99) as any, 'writtenReviews'))!.json();
    expect(body.upgradeUrl).toBeTruthy();
  });

  it('offers none when upgrading would not improve that feature', async () => {
    // Nothing stops an admin setting paid at or below free. Selling an upgrade there sells a
    // reduction.
    mockLimits.mockResolvedValue(withLimits({ writtenReviews: { free: 10, paid: 2 } }));

    const body = await (await refusal(auth, redisStub(99) as any, 'writtenReviews'))!.json();

    expect(body.upgradeUrl).toBeUndefined();
  });

  it('offers none to a subscriber, who has nothing above them to buy', async () => {
    mockTier.mockResolvedValue('paid');

    const body = await (await refusal(auth, redisStub(99) as any, 'writtenReviews'))!.json();

    expect(body.upgradeUrl).toBeUndefined();
  });
});

describe('staff', () => {
  it('reads the shipped numbers rather than whatever learners were given', async () => {
    // The settings page is scoped to learners. Closing a reviewer for students must not stop an
    // instructor previewing their own course.
    mockTier.mockResolvedValue('staff');
    mockLimits.mockResolvedValue(withLimits({ excelReview: { free: 0, paid: 0 } }));

    expect(await refusal(auth, redisStub(1) as any, 'excelReview')).toBeNull();
  });
});

describe('when the limiter cannot be reached', () => {
  it('refuses on a fail-closed route', async () => {
    // A feature the plan DOES include, so the refusal is about the missing limiter rather than
    // the feature being off -- those two are decided in that order, and it matters.
    const res = await refusal(auth, null, 'veAnswers');
    expect(res?.status).toBe(503);
  });

  it('lets the cheap text reviewers through', async () => {
    expect(await refusal(auth, null, 'practiceChecks', { failOpen: true })).toBeNull();
  });

  it('refuses a caller it cannot identify, since there is no counter to spend', async () => {
    const res = await refusal({ actor: undefined, serviceDb: {} } as any, redisStub() as any, 'excelReview');
    expect(res?.status).toBe(503);
  });
});

describe('when the policy itself cannot be read', () => {
  it('refuses even on a fail-open route, because "off" cannot be ruled out', async () => {
    // failOpen answers a counting failure, not a policy one. Running the feature here would mean
    // running something an admin may have switched off, at the moment nobody can tell.
    mockLimits.mockRejectedValue(new Error('settings unavailable'));

    const res = await refusal(auth, redisStub(1) as any, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(503);
  });

  it('refuses when the caller cannot be classified', async () => {
    mockTier.mockRejectedValue(new Error('students lookup failed'));

    const res = await refusal(auth, redisStub(1) as any, 'practiceChecks', { failOpen: true });

    expect(res?.status).toBe(503);
  });

  it('spends nothing from the counter when it refuses', async () => {
    mockLimits.mockRejectedValue(new Error('settings unavailable'));
    const redis = redisStub(1);

    await refusal(auth, redis as any, 'practiceChecks', { failOpen: true });

    expect(redis.eval).not.toHaveBeenCalled();
  });
});

describe('giving an attempt back', () => {
  // Excel review is closed on the free column by default, so these charge as a subscriber.
  beforeEach(() => mockTier.mockResolvedValue('paid'));

  /** A receipt for an attempt this caller really took. */
  async function charge(redis: ReturnType<typeof redisStub>) {
    const { receipt } = await chargeAiFeature(auth, redis as any, 'excelReview');
    expect(receipt).not.toBeNull();
    return receipt!;
  }

  it('returns one when the work it paid for never happened', async () => {
    // The counter has to be spent before the model runs, or it is not a spend limit at all. The
    // cost of that order is that a timeout took a review nobody received -- on the free plan, a
    // learner's whole day.
    const redis = redisStub(2);

    await refundAiFeature(await charge(redis));

    const [script, keys] = redis.eval.mock.calls.at(-1)!;
    expect(String(script)).toMatch(/DECR/);
    expect(keys).toEqual(['rate:excel-review:u1']);
  });

  it('decides whether to decrement inside the script, not between two round trips', async () => {
    // Reading first and decrementing after leaves a window for the key to expire in between, and
    // Redis then recreates it at -1 with no expiry: a counter that never drains, and a learner
    // credited forever. The guard has to travel with the decrement.
    const redis = redisStub(2);

    await refundAiFeature(await charge(redis));

    expect(redis.decr).not.toHaveBeenCalled();
    expect(String(redis.eval.mock.calls.at(-1)![0])).toMatch(/> 0/);
  });

  it('leaves the next window alone when the charged one has already rolled', async () => {
    // A model call can outlive the window it was charged in. Decrementing afterwards would take
    // one off whichever window is running by then, which is somebody's fresh allowance.
    const redis = redisStub(2);
    const receipt = { ...(await charge(redis)), windowEndsAt: Date.now() - 1 };
    redis.eval.mockClear();

    await refundAiFeature(receipt);

    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('refunds a counter that has no expiry at all, since it can never roll', async () => {
    const redis = redisStub(2);
    const receipt = { ...(await charge(redis)), windowEndsAt: Infinity };
    redis.eval.mockClear();

    await refundAiFeature(receipt);

    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('survives a limiter that throws mid-refund', async () => {
    // A refund that fails must not turn a model error into a second error.
    const redis = redisStub(2);
    const receipt = await charge(redis);
    redis.eval.mockRejectedValue(new Error('redis down'));

    await expect(refundAiFeature(receipt)).resolves.toBeUndefined();
  });
});

describe('what an instructor gets', () => {
  it('reads a staff allowance well above the learner one', async () => {
    // Authoring runs the same reviewer over and over against a rubric still being written. Giving
    // staff the learner figure meant three Excel reviews a day, with no way to raise it: the
    // settings page is scoped to learners by design.
    mockTier.mockResolvedValue('staff');

    // Under the staff allowance but far past the paid one.
    expect(await refusal(auth, redisStub(10) as any, 'excelReview')).toBeNull();
  });

  it('still stops somewhere, so a looping script has a brake', async () => {
    mockTier.mockResolvedValue('staff');

    const res = await refusal(auth, redisStub(999) as any, 'excelReview');

    expect(res?.status).toBe(429);
  });
});

describe('whether a charge actually landed', () => {
  it('issues no receipt when the limiter itself refuses after the reservation', async () => {
    // The gap between checking and spending is where a concurrent request takes the last slot. The
    // limiter decides again at the moment it counts, and that refusal carries no receipt -- so
    // nothing can later refund an attempt that the refusal never took.
    const redis = { ...redisStub(1), eval: vi.fn(async () => [0, 0]) };

    const charge = await chargeAiFeature(auth, redis as any, 'practiceChecks');

    expect(charge.response?.status).toBe(429);
    expect(charge.receipt).toBeNull();
  });

  it('issues a receipt for a real spend', async () => {
    const charge = await chargeAiFeature(auth, redisStub(1) as any, 'practiceChecks');

    expect(charge.response).toBeNull();
    expect(charge.receipt).not.toBeNull();
  });

  it('reports no spend when a fail-open route was waved past a broken counter', async () => {
    // Nothing was counted, so nothing can be given back. Refunding here would credit the learner
    // against somebody else's earlier, real attempt.
    const charge = await chargeAiFeature(auth, null, 'practiceChecks', { failOpen: true });

    expect(charge.response).toBeNull();
    expect(charge.receipt).toBeNull();
  });

  it('reports no spend when the increment itself failed on a fail-open route', async () => {
    // The route is let through, which is the point of failing open -- but nothing was counted, so
    // a later model failure must not hand back an attempt taken by an earlier, real request.
    const redis = { ...redisStub(1), eval: vi.fn(async () => { throw new Error('redis down'); }) };

    const charge = await chargeAiFeature(auth, redis as any, 'practiceChecks', { failOpen: true });

    expect(charge.response).toBeNull();
    expect(charge.receipt).toBeNull();
  });

  it('reports no spend when it refused', async () => {
    const charge = await chargeAiFeature(auth, redisStub(99) as any, 'practiceChecks');

    expect(charge.response?.status).toBe(429);
    expect(charge.receipt).toBeNull();
  });
});
