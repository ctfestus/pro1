import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Middleware is one of the two places account restrictions are enforced, and until now
// only the pure predicates it calls were tested. That leaves the wiring unproven: a
// middleware that computed the right restriction and then forgot to act on it would
// have passed every existing test while letting a restricted session browse the app.
//
// These cases exercise the middleware itself -- the decision, the response shape, and
// the paths that must stay reachable so a restriction can actually be resolved.

const h = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: h.getUser } }),
}));

import { middleware } from '@/middleware';

const OWES_PASSWORD = { app_metadata: { needs_password_setup: true } };
const PENDING       = { app_metadata: { access_state: 'pending' } };
const DENIED        = { app_metadata: { access_state: 'denied' } };
const UNRESTRICTED  = { app_metadata: { access_state: 'active' } };

function signedInAs(user: unknown) {
  h.getUser.mockResolvedValue({ data: { user } });
}

const go = (pathname: string, withSession = true) => middleware(new NextRequest(
  `http://localhost${pathname}`,
  withSession ? { headers: { cookie: 'sb-test-auth-token=session' } } : undefined,
));

describe('middleware account gate', () => {
  beforeEach(() => {
    h.getUser.mockReset();
    signedInAs(null);
  });

  it('lets an anonymous request through', async () => {
    const response = await go('/student', false);

    expect(response.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it('lets an unrestricted session through', async () => {
    signedInAs(UNRESTRICTED);

    expect((await go('/student')).status).toBe(200);
    expect((await go('/api/forms')).status).toBe(200);
  });

  // A page gets a redirect a browser can follow...
  describe('a session that owes a password', () => {
    beforeEach(() => signedInAs(OWES_PASSWORD));

    it.each(['/student', '/dashboard', '/onboarding', '/settings', '/some-course-slug', '/'])(
      'redirects the page request for %s to the password form',
      async (pathname) => {
        const response = await go(pathname);

        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe('http://localhost/auth/reset-password');
      },
    );

    // ...while an API gets JSON, because handing a fetch() an HTML redirect produces a
    // confusing parse failure instead of a usable error.
    it('answers a restricted API call with 403 JSON', async () => {
      const response = await go('/api/forms');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Password setup required.' });
    });

    it('leaves setup completion to its bearer-authenticated Route Handler', async () => {
      expect((await go('/api/account/complete-setup')).status).toBe(200);
      expect(h.getUser).not.toHaveBeenCalled();
    });
  });

  // Both are equally locked out of the app. What differs is what they are TOLD, because one of
  // them can fix it without a person: an unconfirmed email lands on the request-a-new-link form,
  // a refused admission does not.
  describe.each([
    ['a pending account', PENDING, 'confirm_email', 'Please confirm your email address to finish signing up.'],
    ['a denied account',  DENIED,  'not_allowed',   'This account has not been approved.'],
  ])('%s', (_label, user, errorParam, apiMessage) => {
    beforeEach(() => signedInAs(user));

    it('is redirected away from the app with a reason', async () => {
      const response = await go('/student');

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`http://localhost/auth?error=${errorParam}`);
    });

    it('gets 403 JSON on an API call', async () => {
      const response = await go('/api/forms');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: apiMessage });
    });

    // The Route Handler verifies the bearer token and applies this same restriction.
    // Duplicating that remote lookup in middleware overloaded the setup flow.
    it('leaves setup completion to its bearer-authenticated Route Handler', async () => {
      expect((await go('/api/account/complete-setup')).status).toBe(200);
      expect(h.getUser).not.toHaveBeenCalled();
    });
  });

  // Blocking these would make every restriction unresolvable: the student could not
  // reach the form, the link that establishes their session, or the message explaining
  // what went wrong.
  describe.each([
    ['a session that owes a password', OWES_PASSWORD],
    ['an unapproved account',          PENDING],
  ])('%s can still reach the auth area', (_label, user) => {
    beforeEach(() => signedInAs(user));

    it.each([
      '/auth',
      '/auth/reset-password',
      '/auth/recover',
      '/auth/callback',
      '/auth/confirm',
      '/auth/confirm/verify',
    ])('%s is not blocked', async (pathname) => {
      expect((await go(pathname)).status).toBe(200);
      expect(h.getUser).not.toHaveBeenCalled();
    });
  });

  it('does not authenticate the public tenant-settings read', async () => {
    signedInAs(OWES_PASSWORD);

    expect((await go('/api/platform-settings')).status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it('leaves activity-feed authentication to its bearer-authenticated Route Handler', async () => {
    signedInAs(OWES_PASSWORD);

    expect((await go('/api/activity/feed')).status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  // The gate must never be the reason a session cannot be read. If getUser throws, the
  // request proceeds unrestricted rather than locking the platform on an auth outage.
  it('fails open when the session cannot be read', async () => {
    h.getUser.mockRejectedValue(new Error('auth unreachable'));

    expect((await go('/student')).status).toBe(200);
  });
});
