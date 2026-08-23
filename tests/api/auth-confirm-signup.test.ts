// The DURABLE signup-confirmation path: POST /auth/confirm/verify with type=signup.
//
// This exists because the other path, /auth/callback, verifies through PKCE, which only works in
// the browser the signup started in and is consumed by any mail scanner that follows the link.
// Students overwhelmingly sign up on one device and open email on another, so that path fails for
// reasons that look like "expired" and are not. This one carries no browser-bound secret.
//
// lib/signup-admission is deliberately NOT mocked: the point of these tests is that this route
// reaches the same verdicts as /auth/callback, so they exercise the real shared decision.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const verifyOtp = vi.fn(async () => ({ error: null as { message: string } | null }));
  const getUser   = vi.fn();
  const signOut   = vi.fn(async () => ({ error: null }));
  const ssrUpdate = vi.fn(async () => ({ error: null }));
  const profile   = vi.fn<() => { data: Record<string, unknown> | null }>(() => ({ data: null }));
  const settings  = vi.fn<() => { data: { public_signup_enabled: boolean } | null; error: { message: string } | null }>(
    () => ({ data: { public_signup_enabled: false }, error: null }),
  );
  const rpc = vi.fn();
  const cohortUpdateError = vi.fn<() => { message: string } | null>(() => null);
  const activateEnrollment     = vi.fn(async () => undefined);
  const markSelfSignupApproved = vi.fn(async () => undefined);
  const markSelfSignupDenied   = vi.fn(async () => undefined);
  const adminFrom = vi.fn((table: string) => (table === 'platform_settings'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => h.settings() }) }) }
    : {
      select: () => ({ eq: () => ({ maybeSingle: async () => h.profile() }) }),
      update: () => ({ eq: async () => ({ error: h.cohortUpdateError() }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }));
  return {
    verifyOtp, getUser, signOut, ssrUpdate, profile, settings, rpc, cohortUpdateError,
    activateEnrollment, markSelfSignupApproved, markSelfSignupDenied, adminFrom,
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { verifyOtp: h.verifyOtp, getUser: h.getUser, signOut: h.signOut },
    from: () => ({ update: () => ({ eq: h.ssrUpdate }) }),
  }),
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({ from: h.adminFrom, rpc: h.rpc }),
}));

vi.mock('@/lib/db-payments', () => ({ activateEnrollment: h.activateEnrollment }));

vi.mock('@/lib/account-state-server', () => ({
  markSelfSignupApproved: h.markSelfSignupApproved,
  markSelfSignupDenied:   h.markSelfSignupDenied,
}));

import { POST } from '@/app/auth/confirm/verify/route';

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return POST(new NextRequest('http://localhost/auth/confirm/verify', { method: 'POST', body }));
}
const signup = (extra: Record<string, string> = {}) =>
  post({ token_hash: 'hash-1', type: 'signup', ...extra });

function location(response: Response) {
  return response.headers.get('location');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyOtp.mockResolvedValue({ error: null });
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.com' } } });
  h.profile.mockReturnValue({ data: { cohort_id: null, access_state: 'pending' } });
  h.settings.mockReturnValue({ data: { public_signup_enabled: false }, error: null });
  h.cohortUpdateError.mockReturnValue(null);
  h.activateEnrollment.mockResolvedValue(undefined);
  h.markSelfSignupApproved.mockResolvedValue(undefined);
});

describe('POST /auth/confirm/verify - type=signup', () => {
  it('admits a public signup as a free account with no cohort', async () => {
    h.settings.mockReturnValue({ data: { public_signup_enabled: true }, error: null });
    h.rpc.mockResolvedValue({ data: null });

    const response = await signup();

    expect(h.markSelfSignupApproved).toHaveBeenCalledWith(expect.anything(), 'user-1');
    // Neither a bootcamp admission nor a subscriber: claiming either would put the account in an
    // enrollment model it never asked for.
    expect(h.activateEnrollment).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/onboarding');
  });

  it('admits an allowlisted signup through enrollment activation', async () => {
    h.rpc.mockResolvedValue({ data: 'cohort-9' });

    const response = await signup();

    expect(h.activateEnrollment).toHaveBeenCalled();
    expect(h.markSelfSignupApproved).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(location(response)).toBe('http://localhost/onboarding');
  });

  it('denies a signup on no allowlist while public signup is off', async () => {
    h.rpc.mockResolvedValue({ data: null });

    const response = await signup();

    expect(h.markSelfSignupDenied).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(h.signOut).toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/auth?error=not_allowed');
  });

  it('denies a throwaway address even with public signup on', async () => {
    h.settings.mockReturnValue({ data: { public_signup_enabled: true }, error: null });
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'x@mailinator.com' } } });
    h.rpc.mockResolvedValue({ data: null });

    const response = await signup();

    expect(h.markSelfSignupApproved).not.toHaveBeenCalled();
    expect(h.markSelfSignupDenied).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(location(response)).toBe('http://localhost/auth?error=email_not_supported');
  });

  // An outage is not a verdict. Denial is a lasting mark on a real person's account.
  it('leaves the account pending when the settings lookup fails', async () => {
    h.rpc.mockResolvedValue({ data: null });
    h.settings.mockReturnValue({ data: null, error: { message: 'connection reset' } });

    const response = await signup();

    expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/auth?error=try_again');
  });

  it('leaves the account pending when enrollment activation fails', async () => {
    h.rpc.mockResolvedValue({ data: 'cohort-9' });
    h.activateEnrollment.mockRejectedValue(new Error('upstream timeout'));

    const response = await signup();

    expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/auth?error=try_again');
  });

  // A confirmation link must not re-provision an account whose admission was already decided.
  it('routes an already-resolved account without re-running admission', async () => {
    h.profile.mockReturnValue({ data: { cohort_id: 'cohort-9', access_state: 'active' } });

    const response = await signup();

    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.activateEnrollment).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/student');
  });

  // A spent signup token needs a NEW CONFIRMATION link. 'invalid_link' opens the password-reset
  // form, which would send the wrong kind of email and strand the student again.
  it('sends a spent signup token to the resend-confirmation form', async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });

    const response = await signup();

    expect(location(response)).toBe('http://localhost/auth?error=confirm_email');
  });
});

describe('POST /auth/confirm/verify - recovery is unchanged', () => {
  it('stamps password setup and opens the password form', async () => {
    const response = await post({ token_hash: 'hash-1', type: 'recovery' });

    expect(h.ssrUpdate).toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/auth/reset-password');
  });

  it('sends a spent recovery token to the request-a-new-link form', async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });

    const response = await post({ token_hash: 'hash-1', type: 'recovery' });

    expect(location(response)).toBe('http://localhost/auth?error=invalid_link');
  });
});
