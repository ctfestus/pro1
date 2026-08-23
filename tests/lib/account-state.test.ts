import { describe, expect, it } from 'vitest';

import {
  accessStateOf,
  needsPasswordSetup,
  restrictionFor,
  isPathOpenTo,
  isPathOpenToBearer,
  redirectPathFor,
  ACCESS_STATE_CLAIM,
  PASSWORD_SETUP_CLAIM,
  PASSWORD_SETUP_COMPLETION_PATH,
} from '@/lib/account-state';

const user = (app_metadata: Record<string, unknown>) => ({ app_metadata });
const PENDING  = user({ [ACCESS_STATE_CLAIM]: 'pending' });
const DENIED   = user({ [ACCESS_STATE_CLAIM]: 'denied' });
const OWES_PW  = user({ [PASSWORD_SETUP_CLAIM]: true });

describe('accessStateOf', () => {
  it('reads an explicit state', () => {
    expect(accessStateOf(PENDING)).toBe('pending');
    expect(accessStateOf(DENIED)).toBe('denied');
    expect(accessStateOf(user({ [ACCESS_STATE_CLAIM]: 'active' }))).toBe('active');
  });

  // Every account predating migration 159 has no claim. Reading absence as a
  // restriction would lock the entire platform out on deploy.
  it('treats an absent, unknown, or malformed claim as active', () => {
    expect(accessStateOf(user({}))).toBe('active');
    expect(accessStateOf(user({ [ACCESS_STATE_CLAIM]: 'nonsense' }))).toBe('active');
    expect(accessStateOf(user({ [ACCESS_STATE_CLAIM]: null }))).toBe('active');
    expect(accessStateOf({})).toBe('active');
    expect(accessStateOf(null)).toBe('active');
  });
});

describe('needsPasswordSetup', () => {
  it('requires the claim to be exactly true', () => {
    expect(needsPasswordSetup(OWES_PW)).toBe(true);
    expect(needsPasswordSetup(user({ [PASSWORD_SETUP_CLAIM]: false }))).toBe(false);
    expect(needsPasswordSetup(user({ [PASSWORD_SETUP_CLAIM]: 'true' }))).toBe(false);
    expect(needsPasswordSetup(user({}))).toBe(false);
    expect(needsPasswordSetup(null)).toBe(false);
  });
});

describe('restrictionFor', () => {
  it('reports an unrestricted session', () => {
    expect(restrictionFor(user({ [ACCESS_STATE_CLAIM]: 'active' }))).toBe('none');
    expect(restrictionFor(null)).toBe('none');
  });

  it('reports an outstanding password setup', () => {
    expect(restrictionFor(OWES_PW)).toBe('password_setup');
  });

  // Pending and denied are both closed, but a person can resolve pending themselves and cannot
  // resolve denied at all, so they must not collapse into one message.
  it('separates an unconfirmed signup from a refused one', () => {
    expect(restrictionFor(PENDING)).toBe('awaiting_confirmation');
    expect(restrictionFor(DENIED)).toBe('not_approved');
  });

  // Choosing a password does not make an unadmitted account admitted.
  it('ranks approval above password setup when both apply', () => {
    expect(restrictionFor(user({
      [ACCESS_STATE_CLAIM]: 'denied',
      [PASSWORD_SETUP_CLAIM]: true,
    }))).toBe('not_approved');
  });
});

describe('isPathOpenTo (cookie boundary)', () => {
  it('lets an unrestricted session anywhere', () => {
    expect(isPathOpenTo('none', '/student')).toBe(true);
    expect(isPathOpenTo('none', '/api/forms')).toBe(true);
  });

  // Closing /auth would make the restriction impossible to resolve or even read.
  it('always leaves the auth area reachable', () => {
    for (const restriction of ['password_setup', 'not_approved', 'awaiting_confirmation'] as const) {
      expect(isPathOpenTo(restriction, '/auth')).toBe(true);
      expect(isPathOpenTo(restriction, '/auth/reset-password')).toBe(true);
      expect(isPathOpenTo(restriction, '/auth/confirm')).toBe(true);
      expect(isPathOpenTo(restriction, '/auth/callback')).toBe(true);
      expect(isPathOpenTo(restriction, '/auth/recover')).toBe(true);
    }
  });

  it('opens only the completion and branding endpoints during password setup', () => {
    expect(isPathOpenTo('password_setup', PASSWORD_SETUP_COMPLETION_PATH)).toBe(true);
    expect(isPathOpenTo('password_setup', '/api/platform-settings')).toBe(true);
    expect(isPathOpenTo('password_setup', '/api/forms')).toBe(false);
    expect(isPathOpenTo('password_setup', '/student')).toBe(false);
    expect(isPathOpenTo('password_setup', '/some-course-slug')).toBe(false);
    expect(isPathOpenTo('password_setup', '/')).toBe(false);
  });

  it('gives an unadmitted account nothing outside the auth area', () => {
    expect(isPathOpenTo('not_approved', PASSWORD_SETUP_COMPLETION_PATH)).toBe(false);
    expect(isPathOpenTo('not_approved', '/api/platform-settings')).toBe(false);
    expect(isPathOpenTo('not_approved', '/onboarding')).toBe(false);
    expect(isPathOpenTo('not_approved', '/student')).toBe(false);
    expect(isPathOpenTo('not_approved', '/')).toBe(false);
    // Awaiting confirmation is exactly as closed as refused. Only the message differs.
    expect(isPathOpenTo('awaiting_confirmation', PASSWORD_SETUP_COMPLETION_PATH)).toBe(false);
    expect(isPathOpenTo('awaiting_confirmation', '/student')).toBe(false);
    expect(isPathOpenTo('awaiting_confirmation', '/')).toBe(false);
  });
});

describe('isPathOpenToBearer (token boundary)', () => {
  // Stricter than the cookie boundary on purpose: no pages to keep reachable.
  it('exempts the completion endpoint and nothing else', () => {
    expect(isPathOpenToBearer('password_setup', PASSWORD_SETUP_COMPLETION_PATH)).toBe(true);
    expect(isPathOpenToBearer('password_setup', '/api/platform-settings')).toBe(false);
    expect(isPathOpenToBearer('password_setup', '/auth/reset-password')).toBe(false);
    expect(isPathOpenToBearer('password_setup', '/api/forms')).toBe(false);
  });

  it('refuses an unadmitted account everything', () => {
    expect(isPathOpenToBearer('not_approved', PASSWORD_SETUP_COMPLETION_PATH)).toBe(false);
    expect(isPathOpenToBearer('not_approved', '/api/forms')).toBe(false);
    expect(isPathOpenToBearer('awaiting_confirmation', PASSWORD_SETUP_COMPLETION_PATH)).toBe(false);
    expect(isPathOpenToBearer('awaiting_confirmation', '/api/forms')).toBe(false);
  });

  it('lets an unrestricted session through', () => {
    expect(isPathOpenToBearer('none', '/api/forms')).toBe(true);
  });
});

describe('redirectPathFor', () => {
  it('sends each restriction somewhere that explains it', () => {
    expect(redirectPathFor('password_setup')).toBe('/auth/reset-password');
    expect(redirectPathFor('not_approved')).toBe('/auth?error=not_allowed');
    // Its own destination, because /auth?error=confirm_email opens the request-a-new-link form
    // instead of telling the person to contact staff.
    expect(redirectPathFor('awaiting_confirmation')).toBe('/auth?error=confirm_email');
  });
});
