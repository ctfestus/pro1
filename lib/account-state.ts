// One definition of what an account is allowed to do, shared by every boundary.
//
// This file exists because the same facts were previously reconstructed in three
// places -- a claim written at provisioning, a timestamp condition in a migration, and
// an absence-of-columns heuristic in /auth/callback -- and those three definitions
// disagreed with each other. Everything now derives from two recorded columns
// (students.account_origin, students.access_state, migration 159).
//
// SOURCE OF TRUTH is the database. The auth user's app_metadata carries a CACHED copy
// of both facts so middleware can gate a request without a per-request database read,
// and because app_metadata is service-role only a client cannot forge it.
// lib/account-state-server.ts holds the only writers; nothing else may set these
// claims, or the cache drifts from the truth and we are back where we started.
//
// Keep this module free of imports. Next middleware runs on the edge runtime, and it
// must be able to pull these predicates in without dragging a Supabase client along.

export const ACCESS_STATE_CLAIM   = 'access_state';
export const PASSWORD_SETUP_CLAIM = 'needs_password_setup';

export type AccessState   = 'pending' | 'active' | 'denied';
export type AccountOrigin = 'self_signup' | 'admissions' | 'unknown';

/** Completing password setup is the one thing a restricted session may still do. */
export const PASSWORD_SETUP_PATH            = '/auth/reset-password';
export const PASSWORD_SETUP_COMPLETION_PATH = '/api/account/complete-setup';

/**
 * APIs that must answer while a session is restricted. Kept to the minimum: the
 * endpoint that completes setup, and the public tenant-branding read the password form
 * itself renders with. Everything else under /api is refused.
 */
const OPEN_API_PATHS = new Set<string>([
  PASSWORD_SETUP_COMPLETION_PATH,
  '/api/platform-settings',
]);

function claims(user: { app_metadata?: unknown } | null | undefined): Record<string, unknown> {
  const meta = user?.app_metadata;
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
}

/**
 * The cached access state. An ABSENT claim reads as 'active' on purpose: every account
 * that predates migration 159 has no claim, and treating absence as a restriction would
 * lock the whole platform out on deploy. Only an explicit 'pending' or 'denied'
 * restricts, so a malformed or missing value can never cause a mass lockout.
 */
export function accessStateOf(user: { app_metadata?: unknown } | null | undefined): AccessState {
  const value = claims(user)[ACCESS_STATE_CLAIM];
  return value === 'pending' || value === 'denied' ? value : 'active';
}

/** True only when the claim is exactly `true`, for the same fail-open reason. */
export function needsPasswordSetup(user: { app_metadata?: unknown } | null | undefined): boolean {
  return claims(user)[PASSWORD_SETUP_CLAIM] === true;
}

export type Restriction =
  | 'none'
  | 'password_setup'        // authenticated, but has never chosen a password
  | 'awaiting_confirmation' // signed up, email not confirmed yet -- the PERSON can resolve this
  | 'not_approved';         // admission refused -- only staff can revisit this

/**
 * What, if anything, is wrong with this session. Order matters: approval outranks setup.
 *
 * 'pending' and 'denied' are both non-active, but they are NOT the same situation and must not be
 * told the same thing. Pending is usually an unconfirmed or expired email link -- something the
 * person can fix themselves in a minute. Denied is a decision only staff can revisit. Collapsing
 * the two sent every stranded signup to "contact your Learning Advisor", which is a dead end for
 * a problem they could have solved and a support ticket that should never have existed.
 */
export function restrictionFor(user: { app_metadata?: unknown } | null | undefined): Restriction {
  if (!user) return 'none';
  const state = accessStateOf(user);
  if (state === 'pending') return 'awaiting_confirmation';
  if (state === 'denied')  return 'not_approved';
  if (needsPasswordSetup(user)) return 'password_setup';
  return 'none';
}

/**
 * Whether a restricted session may still reach `pathname`.
 *
 * /auth is always open -- it carries the password form, the sign-in screen and the
 * message explaining why access was refused, so closing it would make the restriction
 * impossible to resolve or even understand.
 *
 * An unapproved account gets nothing else at all, including the setup-completion
 * endpoint: choosing a password does not make an unadmitted account admitted.
 */
export function isPathOpenTo(restriction: Restriction, pathname: string): boolean {
  if (restriction === 'none') return true;

  const isAuthArea = pathname === '/auth' || pathname.startsWith('/auth/');
  if (isAuthArea) return true;

  if (restriction === 'not_approved' || restriction === 'awaiting_confirmation') return false;
  return OPEN_API_PATHS.has(pathname);
}

/**
 * The bearer-token boundary (lib/api-auth) is deliberately stricter than the cookie
 * boundary: it exempts the setup-completion endpoint and NOTHING else. There are no
 * pages here to keep reachable, and the public branding read that middleware allows is
 * a no-auth GET that never reaches this check -- so allowing it here would only widen
 * the hole for an authenticated caller.
 */
export function isPathOpenToBearer(restriction: Restriction, pathname: string): boolean {
  if (restriction === 'none') return true;
  if (restriction === 'not_approved' || restriction === 'awaiting_confirmation') return false;
  return pathname === PASSWORD_SETUP_COMPLETION_PATH;
}

/** Where a restricted page request is sent. */
export function redirectPathFor(restriction: Restriction): string {
  if (restriction === 'awaiting_confirmation') return '/auth?error=confirm_email';
  return restriction === 'not_approved' ? '/auth?error=not_allowed' : PASSWORD_SETUP_PATH;
}

/** The message an API returns instead of a redirect, so JSON clients get JSON. */
export function denialMessageFor(restriction: Restriction): string {
  if (restriction === 'awaiting_confirmation') return 'Please confirm your email address to finish signing up.';
  return restriction === 'not_approved'
    ? 'This account has not been approved.'
    : 'Password setup required.';
}
