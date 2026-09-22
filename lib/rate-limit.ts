import type { Redis } from '@upstash/redis';

// Shared windowed rate-limit counter for the AI routes.
//
// The naive INCR-then-EXPIRE pattern has a failure mode: if INCR succeeds but
// EXPIRE fails (network blip, crash between calls), the key never gets a TTL,
// the count only ever grows, and that user is blocked from the feature forever.
//
// This helper self-heals both ways:
// - at creation, a key that cannot get a TTL is deleted (fail open, never immortal)
// - on the over-limit path, a TTL-less key is given one so a stuck key drains
//
// Returns true when the caller is over the limit. Throws only if Redis itself
// fails mid-call -- each route decides whether that fails open or closed.
// A counter that can also be handed back needs two things this one cannot give:
//
// 1. It must not count a request it refuses. INCR-then-compare leaves the counter above the limit
//    after an over-limit request, so a refund from a concurrent request that was accepted and then
//    failed only brings it back down to the limit, and the learner stays blocked for a review they
//    never received.
// 2. It must say which window was charged. A model call can outlive the window it was charged in,
//    and a refund that arrives afterwards would credit whichever window is running by then.
//
// Both are answered here: the check and the increment happen inside one script, so nothing can
// interleave, and the charged window's remaining seconds come back with it.
const SPEND_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1])) or 0
if used >= tonumber(ARGV[1]) then
  if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
  return {0, 0}
end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return {1, redis.call('TTL', KEYS[1])}
`;

export interface RateLimitSpend {
  allowed: boolean;
  /** Seconds left in the window this charge landed in, or null when it has no expiry. */
  ttlSeconds: number | null;
}

/**
 * Take one from the counter, but only if there is one to take.
 *
 * Throws if Redis itself fails, like `bumpRateLimit` -- each caller decides whether that fails
 * open or closed.
 */
export async function spendRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitSpend> {
  const [allowed, ttl] = await redis.eval<[number, number], [number, number]>(
    SPEND_SCRIPT,
    [key],
    [limit, windowSeconds],
  );
  return { allowed: allowed === 1, ttlSeconds: ttl > 0 ? ttl : null };
}

// Decrement only a counter that still exists and is above zero, in one round trip. Reading and then
// decrementing leaves a window for the key to expire in between, and Redis recreates it at -1 with
// no expiry: a counter that never drains, and a learner credited forever.
const REFUND_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]))
if used and used > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

/** Put one back. Never creates the key, so a window that has since rolled is left alone. */
export async function refundRateLimit(redis: Redis, key: string): Promise<void> {
  await redis.eval(REFUND_SCRIPT, [key], []);
}

export async function bumpRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    const ok = await redis.expire(key, windowSeconds).catch(() => 0);
    if (!ok) await redis.del(key).catch(() => {});
  }
  if (count > limit) {
    const ttl = await redis.ttl(key).catch(() => -2);
    if (ttl === -1) await redis.expire(key, windowSeconds).catch(() => {});
    return true;
  }
  return false;
}
