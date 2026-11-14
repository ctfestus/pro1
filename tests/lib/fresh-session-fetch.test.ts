// Submit Answer used to send the token the page saw when it loaded. Once that expired the learner
// got a bare "Unauthorized" and blamed their query. These pin the recovery: read the token at send
// time, refresh once on a 401, and say plainly when signing in again is the only way out.
import { describe, expect, it, vi } from 'vitest';
import { postWithFreshSession, SESSION_EXPIRED_MESSAGE, SIGN_IN_REQUIRED_MESSAGE, SignInError } from '@/lib/fresh-session-fetch';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const authOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

describe('postWithFreshSession', () => {
  it('sends the token read at send time', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { passed: true }));
    const out = await postWithFreshSession('/api/course', { a: 1 }, 'fail', {
      getToken: async () => 'current', refreshToken: async () => 'unused', fetchImpl,
    });
    expect(out).toEqual({ passed: true });
    expect(authOf(fetchImpl.mock.calls[0])).toBe('Bearer current');
  });

  it('refreshes once and retries after a 401', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(401, { error: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { passed: true, proof: 'v1:x' }));
    const refreshToken = vi.fn().mockResolvedValue('renewed');
    const out = await postWithFreshSession('/api/course', {}, 'fail', { getToken: async () => 'stale', refreshToken, fetchImpl });
    expect(out).toEqual({ passed: true, proof: 'v1:x' });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(authOf(fetchImpl.mock.calls[1])).toBe('Bearer renewed');
  });

  it('asks the learner to sign in again when the session cannot be renewed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { error: 'Unauthorized' }));
    await expect(postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => 'stale', refreshToken: async () => null, fetchImpl,
    })).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('tells a learner who was never signed in to sign in, not that a sign-in expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { error: 'Unauthorized' }));
    await expect(postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => null, refreshToken: async () => null, fetchImpl,
    })).rejects.toThrow(SIGN_IN_REQUIRED_MESSAGE);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('still sends the request when reading the session throws', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(401, { error: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const out = await postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => { throw new Error('storage unavailable'); }, refreshToken: async () => 'renewed', fetchImpl,
    });
    expect(out).toEqual({ ok: true });
  });

  it('does not loop when the retry is also refused', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { error: 'Unauthorized' }));
    await expect(postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => 'stale', refreshToken: async () => 'renewed', fetchImpl,
    })).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // The players count a failed attempt for any error except this one.
  it('marks sign-in failures apart from every other error', async () => {
    const refused = vi.fn().mockResolvedValue(json(401, { error: 'Unauthorized' }));
    const signIn = await postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => 'stale', refreshToken: async () => null, fetchImpl: refused,
    }).catch(e => e);
    expect(signIn).toBeInstanceOf(SignInError);

    const broken = vi.fn().mockResolvedValue(json(500, { error: 'Failed to check SQL answer.' }));
    const other = await postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => 't', refreshToken: async () => 't', fetchImpl: broken,
    }).catch(e => e);
    expect(other).not.toBeInstanceOf(SignInError);
  });

  it('passes other server errors through unchanged', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(404, { error: 'SQL exercise not found.' }));
    await expect(postWithFreshSession('/api/course', {}, 'fail', {
      getToken: async () => 't', refreshToken: async () => 't', fetchImpl,
    })).rejects.toThrow('SQL exercise not found.');
  });
});
