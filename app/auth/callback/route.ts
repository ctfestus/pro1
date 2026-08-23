import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { admitConfirmedSignup } from '@/lib/signup-admission';

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

  // The decision itself lives in lib/signup-admission, so this route and /auth/confirm/verify
  // cannot drift apart about who gets in. What stays here is only what this route alone knows:
  // the session to end on a refusal, and where to send the browser next.
  const outcome = await admitConfirmedSignup(db, user, 'signup_callback');

  if (outcome.status === 'denied') {
    // End the session so the refusal takes effect immediately, rather than only on the next
    // request. The account is refused, not removed -- losing a real learner is unrecoverable.
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL(`/auth?error=${outcome.errorParam}`, request.url));
  }

  if (outcome.status === 'retry') {
    // Deliberately NOT signing out. Once the one-time code has been consumed, the restricted
    // session is the only credential left for /auth/callback?retry=1.
    return NextResponse.redirect(new URL('/auth?error=try_again', request.url));
  }

  return NextResponse.redirect(new URL('/onboarding', request.url));
}
