import * as Sentry from '@sentry/nextjs';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { activateEnrollment } from '@/lib/db-payments';
import { markSelfSignupApproved, markSelfSignupDenied } from '@/lib/account-state-server';

// Signup confirmation is the normal responsibility. Password recovery has its own
// direct token-hash route and never reaches this handler, except for compatibility with
// an older/in-flight Supabase link that fell back to the configured Site URL. That
// fallback is marked by middleware and is resolved from recorded account state after a
// successful code exchange -- never from a caller-selected landing path.
//
// This route never deletes an account.
//
// DEPLOYMENT REQUIREMENT. Both signup confirmation (emailRedirectTo) and password
// recovery (resetPasswordForEmail redirectTo) hand Supabase a redirect target, and
// Supabase matches those EXACTLY against Authentication -> URL Configuration ->
// Redirect URLs. An unlisted target is discarded and the link falls back to the Site
// URL. List BOTH, per environment:
//
//     https://<host>/auth/callback     -- signup confirmation
//     https://<host>/auth/recover      -- password recovery
//     http://localhost:3000/auth/callback
//     http://localhost:3000/auth/recover
//
// The site_fallback path below survives a missing entry -- a recovery code that lands
// on the Site URL still reaches the password form rather than a signed-in dashboard --
// but that is defensive compatibility, not a substitute for configuring both URLs.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const retry = searchParams.get('retry') === '1';
  const siteFallback = searchParams.get('site_fallback') === '1';

  const invalidLink = () =>
    NextResponse.redirect(new URL('/auth?error=invalid_link', request.url));

  // A missing or expired code must never fall through to whatever session the browser
  // already holds, or a stale link opened while signed in as someone else would act on
  // that account instead. The one exception is an explicit retry, which is a deliberate
  // re-run against the restricted session the first exchange left behind; it opens no
  // password form and every admission check below still runs.
  if (!code && !retry) return invalidLink();

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        ),
      },
    }
  );

  // A retry deliberately reuses the restricted session established by the first
  // exchange. Supabase auth codes are one-use, so exchanging the original link again
  // can never work. The retry flag grants nothing by itself: the account must still
  // have a valid session and every allowlist/enrollment check below runs again.
  let exchangedThisRequest = false;
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return invalidLink();
    exchangedThisRequest = true;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return invalidLink();

  const db = adminClient();

  const { data: existing } = await db
    .from('students')
    .select('id, cohort_id, role, access_state')
    .eq('id', user.id)
    .maybeSingle();

  // A Site-URL fallback for an established account is a legacy recovery link. Opening
  // the password form is only justified by ownership proved IN THIS REQUEST, so it
  // requires a code exchanged just now -- site_fallback is a caller-supplied flag, and
  // without this it could be combined with retry=1 to open the form against whatever
  // session the browser already held. A pending account continues through admission
  // below, which keeps signup fail-closed.
  if (siteFallback && exchangedThisRequest && existing?.access_state === 'active') {
    return NextResponse.redirect(new URL('/auth/reset-password', request.url));
  }

  // Admission runs on a RECORDED fact, not on inference. Only an account still sitting
  // at 'pending' is an unresolved signup; anything already active or denied has been
  // decided and must not be re-provisioned. That is what stops a confirmation link from
  // altering an established account's enrollment.
  const isUnresolved = existing?.access_state === 'pending';

  if (!isUnresolved) {
    const landing = existing?.cohort_id ? '/student' : '/onboarding';
    return NextResponse.redirect(new URL(landing, request.url));
  }

  // Refuse the account rather than remove it, and end the session so the refusal takes
  // effect immediately instead of only on the next request.
  //
  // ONLY a confirmed negative eligibility result may land here. A database or network
  // failure looks identical to "not allowed" if you only check the returned value, and
  // denial is a lasting mark on a real person's account.
  const refuse = async (reason: string, errorParam: string) => {
    console.warn(`[auth/callback] denying signup: ${reason}`, user.id);
    // A denial is the policy working, not a fault, so it is reported as a warning
    // rather than an exception. Once signups open, uninvited attempts become ordinary
    // traffic, and filing each one as an error would bury the failures below that do
    // need a person. Account id only -- no email, no token, no cookie.
    Sentry.captureMessage(`auth/callback denied signup: ${reason}`, {
      level: 'warning',
      user: { id: user.id },
      tags: { flow: 'signup_callback', outcome: 'denied', reason },
    });
    await markSelfSignupDenied(db, user.id);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL(`/auth?error=${errorParam}`, request.url));
  };

  // Something broke. Change nothing: the account stays pending and the restricted
  // session stays available for /auth/callback?retry=1. Signing out here would destroy
  // the only retry credential after the one-time auth code had already been consumed.
  const retryLater = async (reason: string, detail?: unknown) => {
    console.error(`[auth/callback] leaving signup pending: ${reason}`, user.id, detail ?? '');
    // THE failure this route exists to survive, and the one nobody finds out about:
    // the account is eligible, something broke, and the student is left pending with
    // no way to say why. Report the original error where there is one, so the stack
    // points at the real call rather than at this helper.
    Sentry.captureException(
      detail instanceof Error ? detail : new Error(`auth/callback: ${reason}`),
      {
        user: { id: user.id },
        tags: { flow: 'signup_callback', outcome: 'pending', reason },
        ...(typeof detail === 'string' && detail ? { extra: { detail } } : {}),
      },
    );
    return NextResponse.redirect(new URL('/auth?error=try_again', request.url));
  };

  if (!user.email) return refuse('authenticated user has no email', 'not_allowed');

  const { data: cohortId, error: allowlistError } = await db.rpc(
    'check_email_allowlist', { p_email: user.email },
  );
  if (allowlistError) return retryLater('allowlist lookup failed', allowlistError.message);
  if (!cohortId)      return refuse('not on any cohort allowlist', 'not_allowed');

  try {
    await activateEnrollment(db, user.email, cohortId, user.id);
  } catch (e: any) {
    // Their email IS on an allowlist, so this is a data or infrastructure problem, not
    // a verdict on their eligibility. Leave them pending and recoverable either way.
    // no_admission_record = allowlisted but with no bootcamp_enrollments pre-signup row.
    const isNoRecord = typeof e?.message === 'string' && e.message.includes('No admission record');
    return isNoRecord
      ? retryLater('allowlisted but no admission record', e?.message)
      : retryLater('enrollment activation failed', e?.message ?? e);
  }

  // The account is only marked active once it actually has its cohort, or an activation
  // that half-failed would leave an active student with nothing to study.
  const { error: cohortError } = await db
    .from('students').update({ cohort_id: cohortId }).eq('id', user.id);
  if (cohortError) return retryLater('cohort assignment failed', cohortError.message);

  const { error: allowlistCleanupError } = await db
    .from('cohort_allowed_emails').delete().eq('email', user.email.toLowerCase());
  // Cleanup only -- a stale allowlist row does not affect this student's access.
  if (allowlistCleanupError) {
    console.error('[auth/callback] allowlist cleanup failed', allowlistCleanupError.message);
  }

  try {
    await markSelfSignupApproved(db, user.id);
  } catch (e: any) {
    return retryLater('could not record admission', e?.message ?? e);
  }

  return NextResponse.redirect(new URL('/onboarding', request.url));
}
