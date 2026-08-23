import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Actor matrix for /auth/callback, which is now signup confirmation ONLY -- recovery
// has its own route and never arrives here.
//
// Two invariants carry this file:
//   1. The callback never deletes an account. Deletion was irreversible, cascaded to
//      the students row, and fired on an absence-of-columns test that caught
//      instructors, admins, staff, and every student whose cohort had been archived
//      (cohort_id is ON DELETE SET NULL).
//   2. Admission runs only for an account RECORDED as pending. Anything already active
//      or denied has been decided, so a confirmation link cannot alter it.

const h = vi.hoisted(() => {
  type Res = Promise<{ error: { message: string } | null }>;
  const exchangeCodeForSession = vi.fn(async (): Res => ({ error: null }));
  const getUser     = vi.fn();
  const signOut     = vi.fn(async () => ({ error: null }));
  const maybeSingle = vi.fn();
  const rpc         = vi.fn();
  const deleteUser  = vi.fn(async () => ({ error: null }));
  // Per-operation error stubs so a case can fail one write without failing the others.
  const cohortUpdateError   = vi.fn<() => { message: string } | null>(() => null);
  const allowlistDeleteError = vi.fn<() => { message: string } | null>(() => null);
  // Defaults to signups CLOSED, which is both the migration default and the state every
  // pre-existing test in this file was written against.
  const platformSettings = vi.fn<() => { data: { public_signup_enabled: boolean } | null; error: { message: string } | null }>(
    () => ({ data: { public_signup_enabled: false }, error: null }),
  );
  const adminFrom   = vi.fn((table: string) => (table === 'platform_settings'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => h.platformSettings() }) }) }
    : {
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
      update: () => ({ eq: async () => ({ error: h.cohortUpdateError() }) }),
      delete: () => ({ eq: async () => ({ error: h.allowlistDeleteError() }) }),
    }));
  const activateEnrollment    = vi.fn(async () => undefined);
  const markSelfSignupApproved = vi.fn(async () => undefined);
  const markSelfSignupDenied   = vi.fn(async () => undefined);
  return {
    exchangeCodeForSession, getUser, signOut, maybeSingle, rpc, deleteUser, adminFrom, platformSettings,
    cohortUpdateError, allowlistDeleteError,
    activateEnrollment, markSelfSignupApproved, markSelfSignupDenied,
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: h.exchangeCodeForSession,
      getUser: h.getUser,
      signOut: h.signOut,
    },
  }),
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: h.adminFrom,
    rpc: h.rpc,
    auth: { admin: { deleteUser: h.deleteUser } },
  }),
}));

vi.mock('@/lib/db-payments', () => ({ activateEnrollment: h.activateEnrollment }));

vi.mock('@/lib/account-state-server', () => ({
  markSelfSignupApproved: h.markSelfSignupApproved,
  markSelfSignupDenied:   h.markSelfSignupDenied,
}));

import { GET } from '@/app/auth/callback/route';

function callback(query: string) {
  return new NextRequest(`http://localhost/auth/callback?${query}`);
}
function location(response: Response) {
  return response.headers.get('location');
}
function profile(row: Record<string, unknown> | null) {
  h.maybeSingle.mockResolvedValue({ data: row });
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    h.exchangeCodeForSession.mockReset();
    h.exchangeCodeForSession.mockResolvedValue({ error: null });
    h.getUser.mockReset();
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.com' } } });
    h.maybeSingle.mockReset();
    h.rpc.mockReset();
    h.signOut.mockClear();
    h.deleteUser.mockClear();
    h.adminFrom.mockClear();
    h.activateEnrollment.mockClear();
    h.activateEnrollment.mockResolvedValue(undefined);
    h.markSelfSignupApproved.mockClear();
    h.markSelfSignupApproved.mockResolvedValue(undefined);
    h.markSelfSignupDenied.mockClear();
    h.cohortUpdateError.mockReset();
    h.cohortUpdateError.mockReturnValue(null);
    h.allowlistDeleteError.mockReset();
    h.allowlistDeleteError.mockReturnValue(null);
    h.platformSettings.mockReset();
    h.platformSettings.mockReturnValue({ data: { public_signup_enabled: false }, error: null });
  });

  describe('the code exchange', () => {
    it('refuses a request with no code, without inspecting any existing session', async () => {
      const response = await GET(callback(''));

      expect(location(response)).toBe('http://localhost/auth?error=invalid_link');
      expect(h.getUser).not.toHaveBeenCalled();
    });

    it('refuses an expired code instead of falling through to the current session', async () => {
      h.exchangeCodeForSession.mockResolvedValue({ error: { message: 'expired' } });

      const response = await GET(callback('code=abc'));

      expect(location(response)).toBe('http://localhost/auth?error=invalid_link');
      expect(h.getUser).not.toHaveBeenCalled();
    });

    it('routes an established Site-URL fallback to password reset', async () => {
      profile({ id: 'user-1', cohort_id: 'c1', role: 'student', access_state: 'active' });

      const response = await GET(callback('code=abc&site_fallback=1'));

      expect(h.exchangeCodeForSession).toHaveBeenCalledWith('abc');
      expect(h.activateEnrollment).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth/reset-password');
    });

    it('does not let Site-URL fallback skip admission for a pending signup', async () => {
      profile({ id: 'user-1', cohort_id: null, role: 'student', access_state: 'pending' });
      h.rpc.mockResolvedValue({ data: null });

      const response = await GET(callback('code=abc&site_fallback=1'));

      expect(h.markSelfSignupDenied).toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=not_allowed');
    });

    // site_fallback is a caller-supplied flag, so it may only open the password form on
    // ownership proved in THIS request. Combined with retry=1 there is no code to
    // exchange, and it would otherwise hand the form to whatever session was already in
    // the browser.
    it('ignores Site-URL fallback on a retry, where no code was exchanged', async () => {
      profile({ id: 'user-1', cohort_id: 'c1', role: 'student', access_state: 'active' });

      const response = await GET(callback('retry=1&site_fallback=1'));

      expect(h.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(location(response)).not.toBe('http://localhost/auth/reset-password');
      expect(location(response)).toBe('http://localhost/student');
    });
  });

  // Anything not recorded as pending has already been decided. These are the actors the
  // old absence-based test misread, and the ones deletion used to destroy.
  describe.each([
    ['an enrolled student',           { cohort_id: 'c1', role: 'student',    access_state: 'active' }, '/student'],
    ['an instructor',                 { cohort_id: null, role: 'instructor', access_state: 'active' }, '/onboarding'],
    ['an admin',                      { cohort_id: null, role: 'admin',      access_state: 'active' }, '/onboarding'],
    ['a staff member',                { cohort_id: null, role: 'staff',      access_state: 'active' }, '/onboarding'],
    ['a student with an archived cohort', { cohort_id: null, role: 'student', access_state: 'active' }, '/onboarding'],
    ['an already-denied signup',      { cohort_id: null, role: 'student',    access_state: 'denied' }, '/onboarding'],
  ])('%s', (_label, row, landing) => {
    beforeEach(() => {
      profile({ id: 'user-1', ...row });
      h.rpc.mockResolvedValue({ data: null });
    });

    it('is routed without re-running admission, and never deleted', async () => {
      const response = await GET(callback('code=abc'));

      expect(location(response)).toBe(`http://localhost${landing}`);
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.activateEnrollment).not.toHaveBeenCalled();
      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(h.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('an unresolved signup', () => {
    beforeEach(() => profile({ id: 'user-1', cohort_id: null, role: 'student', access_state: 'pending' }));

    it('is admitted when its email is on an allowlist', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });

      const response = await GET(callback('code=abc'));

      expect(h.activateEnrollment).toHaveBeenCalled();
      expect(h.markSelfSignupApproved).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(h.signOut).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/onboarding');
    });

    // Denial has to be persistent and immediate. An error redirect alone left the
    // session live, and the account walked to /onboarding and carried on.
    it('is recorded as denied and signed out when on no allowlist', async () => {
      h.rpc.mockResolvedValue({ data: null });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupDenied).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(h.signOut).toHaveBeenCalled();
      expect(h.deleteUser).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=not_allowed');
    });

    it('is recorded as denied and signed out when it has no email', async () => {
      h.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: null } } });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupDenied).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(h.signOut).toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=not_allowed');
    });

  });

  // Public self-serve signup (migration 183). The switch is off by default, so everything above
  // describes the invite-only behaviour that must survive this feature existing.
  describe('an unresolved signup when public signup is ON', () => {
    beforeEach(() => {
      profile({ id: 'user-1', cohort_id: null, role: 'student', access_state: 'pending' });
      h.platformSettings.mockReturnValue({ data: { public_signup_enabled: true }, error: null });
    });

    it('is admitted as a free account with no cohort and no enrollment', async () => {
      h.rpc.mockResolvedValue({ data: null });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupApproved).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(h.signOut).not.toHaveBeenCalled();
      // A free account is neither a bootcamp admission nor a subscriber: claiming either would
      // put it in an enrollment model it never asked for and cannot leave.
      expect(h.activateEnrollment).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/onboarding');
    });

    it('still refuses a throwaway email address', async () => {
      h.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'nope@mailinator.com' } } });
      h.rpc.mockResolvedValue({ data: null });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupApproved).not.toHaveBeenCalled();
      expect(h.markSelfSignupDenied).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(h.signOut).toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=email_not_supported');
    });

    it('still admits an allowlisted email through the invited path, not the free one', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });

      const response = await GET(callback('code=abc'));

      expect(h.activateEnrollment).toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/onboarding');
    });
  });

  // Denial is a lasting mark on a real person's account, so only a confirmed negative
  // eligibility result may produce it. An outage must not look like a rejection.
  describe('an unresolved signup hitting an operational failure', () => {
    beforeEach(() => profile({ id: 'user-1', cohort_id: null, role: 'student', access_state: 'pending' }));

    it('stays pending when the allowlist lookup errors', async () => {
      h.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(h.signOut).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=try_again');
    });

    it('stays pending when the public-signup lookup errors', async () => {
      h.rpc.mockResolvedValue({ data: null });
      h.platformSettings.mockReturnValue({ data: null, error: { message: 'connection reset' } });

      const response = await GET(callback('code=abc'));

      // "The settings query broke" is no evidence about who this person is.
      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(h.signOut).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=try_again');
    });

    it('stays pending when enrollment activation fails', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });
      h.activateEnrollment.mockRejectedValue(new Error('upstream timeout'));

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=try_again');
    });

    // Allowlisted but missing an admission row is a data gap, not a verdict on the
    // student. An admin can fix the record and the account is still recoverable.
    it('stays pending when allowlisted with no admission record', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });
      h.activateEnrollment.mockRejectedValue(new Error('No admission record'));

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupDenied).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=try_again');
    });

    it('does not mark the account active if the cohort assignment fails', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });
      h.cohortUpdateError.mockReturnValue({ message: 'write conflict' });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupApproved).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=try_again');
    });

    it('still admits the student when only the allowlist cleanup fails', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });
      h.allowlistDeleteError.mockReturnValue({ message: 'row locked' });

      const response = await GET(callback('code=abc'));

      expect(h.markSelfSignupApproved).toHaveBeenCalledWith(expect.anything(), 'user-1');
      expect(location(response)).toBe('http://localhost/onboarding');
    });
  });

  describe('a retry using the retained restricted session', () => {
    beforeEach(() => profile({ id: 'user-1', cohort_id: null, role: 'student', access_state: 'pending' }));

    it('reruns admission without trying to exchange the consumed code', async () => {
      h.rpc.mockResolvedValue({ data: 'cohort-9' });

      const response = await GET(callback('retry=1'));

      expect(h.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(h.getUser).toHaveBeenCalled();
      expect(h.activateEnrollment).toHaveBeenCalled();
      expect(h.markSelfSignupApproved).toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/onboarding');
    });

    it('still refuses a retry that has no authenticated session', async () => {
      h.getUser.mockResolvedValue({ data: { user: null } });

      const response = await GET(callback('retry=1'));

      expect(h.rpc).not.toHaveBeenCalled();
      expect(location(response)).toBe('http://localhost/auth?error=invalid_link');
    });
  });

  // A row the trigger has not created yet is not pending, so admission does not run and
  // nothing is destroyed. The account stays at the schema default and is gated.
  it('routes an account with no profile row without deleting or admitting it', async () => {
    profile(null);
    h.rpc.mockResolvedValue({ data: null });

    const response = await GET(callback('code=abc'));

    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(location(response)).toBe('http://localhost/onboarding');
  });

  // next was the parameter that used to decide whether admission logic ran at all.
  it('ignores a next parameter entirely', async () => {
    profile({ id: 'user-1', cohort_id: 'c1', role: 'student', access_state: 'active' });

    const response = await GET(callback('code=abc&next=%2Fauth%2Freset-password'));

    expect(location(response)).toBe('http://localhost/student');
  });
});
