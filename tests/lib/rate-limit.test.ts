import { describe, expect, it, vi } from 'vitest';
import { bumpRateLimit, refundRateLimit, spendRateLimit } from '@/lib/rate-limit';

function redisStub(over: Partial<Record<'incr' | 'expire' | 'del' | 'ttl', any>> = {}) {
  return {
    incr:   vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    del:    vi.fn(async () => 1),
    ttl:    vi.fn(async () => 3000),
    ...over,
  } as any;
}

describe('bumpRateLimit', () => {
  it('sets the TTL when the key is created and reports under-limit', async () => {
    const redis = redisStub();
    expect(await bumpRateLimit(redis, 'k', 10, 3600)).toBe(false);
    expect(redis.expire).toHaveBeenCalledWith('k', 3600);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('deletes the key if it cannot get a TTL, so it can never become immortal', async () => {
    const redis = redisStub({ expire: vi.fn(async () => 0) });
    await bumpRateLimit(redis, 'k', 10, 3600);
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('deletes the key when EXPIRE throws', async () => {
    const redis = redisStub({ expire: vi.fn(async () => { throw new Error('boom'); }) });
    await bumpRateLimit(redis, 'k', 10, 3600);
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('reports over-limit without touching the TTL when one exists', async () => {
    const redis = redisStub({ incr: vi.fn(async () => 11) });
    expect(await bumpRateLimit(redis, 'k', 10, 3600)).toBe(true);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('repairs a TTL-less key on the over-limit path so a stuck key drains', async () => {
    const redis = redisStub({ incr: vi.fn(async () => 11), ttl: vi.fn(async () => -1) });
    expect(await bumpRateLimit(redis, 'k', 10, 3600)).toBe(true);
    expect(redis.expire).toHaveBeenCalledWith('k', 3600);
  });

  it('propagates an INCR failure so callers keep their own fail-open/closed choice', async () => {
    const redis = redisStub({ incr: vi.fn(async () => { throw new Error('down'); }) });
    await expect(bumpRateLimit(redis, 'k', 10, 3600)).rejects.toThrow('down');
  });
});

// spendRateLimit and refundRateLimit do their deciding inside a Lua script, which is the whole
// point: the check and the increment cannot be interleaved, and a refund cannot land between a read
// and a decrement. Redis runs that script, so what is testable here is the seam -- what gets sent,
// and how the answer is read back.
describe('spendRateLimit', () => {
  const evalStub = (reply: [number, number]) => ({ eval: vi.fn(async () => reply) } as any);

  it('sends the counter, the limit and the window in one call', async () => {
    const redis = evalStub([1, 3600]);

    await spendRateLimit(redis, 'k', 10, 3600);

    expect(redis.eval).toHaveBeenCalledOnce();
    expect(redis.eval.mock.calls[0][1]).toEqual(['k']);
    expect(redis.eval.mock.calls[0][2]).toEqual([10, 3600]);
  });

  it('reports the charged window so a late refund can tell it has rolled', async () => {
    expect(await spendRateLimit(evalStub([1, 900]), 'k', 10, 3600)).toEqual({ allowed: true, ttlSeconds: 900 });
  });

  it('reads a refusal as nothing counted', async () => {
    expect(await spendRateLimit(evalStub([0, 0]), 'k', 10, 3600)).toEqual({ allowed: false, ttlSeconds: null });
  });

  it('reports no deadline for a counter that has no expiry, since it never rolls', async () => {
    expect(await spendRateLimit(evalStub([1, -1]), 'k', 10, 3600)).toEqual({ allowed: true, ttlSeconds: null });
  });

  it('refuses at the limit before reaching INCR', async () => {
    // Counting a request that is then turned away leaves the counter above the limit, and a refund
    // from a concurrent request that was accepted and failed only undoes that refusal.
    const script = String(evalScriptFrom(await (async () => {
      const redis = evalStub([0, 0]);
      await spendRateLimit(redis, 'k', 1, 3600);
      return redis;
    })()));
    expect(script.indexOf('return {0, 0}')).toBeLessThan(script.indexOf('INCR'));
  });

  it('propagates a limiter failure so callers keep their own fail-open/closed choice', async () => {
    const redis = { eval: vi.fn(async () => { throw new Error('down'); }) } as any;
    await expect(spendRateLimit(redis, 'k', 10, 3600)).rejects.toThrow('down');
  });
});

describe('refundRateLimit', () => {
  it('never creates the key, so a window that has rolled is left alone', async () => {
    const redis = { eval: vi.fn(async () => 0) } as any;

    await refundRateLimit(redis, 'k');

    const script = String(redis.eval.mock.calls[0][0]);
    expect(redis.eval.mock.calls[0][1]).toEqual(['k']);
    // The decrement is reached only through a positive count, which a missing key cannot produce.
    expect(script.indexOf('> 0')).toBeLessThan(script.indexOf('DECR'));
  });
});

/** The script text a stub was called with, so the order of its branches can be asserted. */
function evalScriptFrom(redis: { eval: { mock: { calls: unknown[][] } } }) {
  return redis.eval.mock.calls[0][0];
}
