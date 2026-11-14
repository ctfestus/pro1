// The adapter between the browser Supabase session and postWithFreshSession.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

import { supabaseSession } from '@/lib/fresh-session-supabase';

const session = (token: string | null) => ({ data: { session: token ? { access_token: token } : null } });

describe('supabaseSession', () => {
  beforeEach(() => { auth.getSession.mockReset(); auth.refreshSession.mockReset(); });

  it('returns the current token and tells the caller about it', async () => {
    auth.getSession.mockResolvedValue(session('current'));
    const onToken = vi.fn();
    expect(await supabaseSession(onToken, () => 'old').getToken()).toBe('current');
    expect(onToken).toHaveBeenCalledWith('current');
  });

  it('falls back to the token the caller already holds when no session is found', async () => {
    auth.getSession.mockResolvedValue(session(null));
    const onToken = vi.fn();
    expect(await supabaseSession(onToken, () => 'held').getToken()).toBe('held');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('returns null when there is no session and nothing held', async () => {
    auth.getSession.mockResolvedValue(session(null));
    expect(await supabaseSession().getToken()).toBeNull();
  });

  it('never offers the held token as a renewed one', async () => {
    auth.refreshSession.mockResolvedValue(session(null));
    expect(await supabaseSession(undefined, () => 'held').refreshToken()).toBeNull();
    auth.refreshSession.mockResolvedValue(session('renewed'));
    const onToken = vi.fn();
    expect(await supabaseSession(onToken).refreshToken()).toBe('renewed');
    expect(onToken).toHaveBeenCalledWith('renewed');
  });
});
