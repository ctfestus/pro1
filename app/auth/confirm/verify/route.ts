import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { adminClient } from '@/lib/admin-client';
import { admitConfirmedSignup } from '@/lib/signup-admission';

// POST only. The one-time token is consumed here rather than on the GET of
// /auth/confirm so an email scanner prefetching the link cannot burn it before
// the student clicks Continue.
//
// This is the DURABLE email-confirmation path, and the canonical one going forward. A hashed
// token carries no browser-bound secret, so a link works from any device -- sign up on a laptop,
// confirm on a phone. /auth/callback does the same job through PKCE, which only works in the
// browser the signup started in and is consumed by any mail scanner that follows the URL; it
// stays for links already sitting in inboxes.
//
// Redirects use 303 so the browser follows them as a GET instead of re-POSTing.
export async function POST(request: NextRequest) {
  const invalid = () =>
    NextResponse.redirect(new URL('/auth?error=invalid_link', request.url), 303);

  // A malformed or non-form body throws; treat it as a bad link rather than a 500.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid();
  }

  const token_hash = String(form.get('token_hash') ?? '');
  const type       = String(form.get('type') ?? '') as EmailOtpType;

  if (!token_hash || !type) return invalid();

  // A spent or expired SIGNUP token belongs on the resend-confirmation form, not the
  // password-reset one. The account exists and simply was never confirmed, so a new confirmation
  // link is the only thing that helps -- and 'invalid_link' opens the reset form, which would
  // send the wrong kind of email and leave the student stuck again.
  const linkFailed = () => NextResponse.redirect(
    new URL(type === 'signup' ? '/auth?error=confirm_email' : '/auth?error=invalid_link', request.url),
    303,
  );

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          ),
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) return linkFailed();

  if (type === 'recovery') {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      await supabase
        .from('students')
        .update({ password_setup_started_at: new Date().toISOString() })
        .eq('id', user.id);
    }
    return NextResponse.redirect(new URL('/auth/reset-password', request.url), 303);
  }

  // A signup confirmation. The address is now proved, so the admission decision runs -- the same
  // one /auth/callback runs, from lib/signup-admission, so the two entry points cannot disagree
  // about who gets in.
  if (type === 'signup') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return linkFailed();

    const db = adminClient();
    const { data: existing } = await db
      .from('students')
      .select('cohort_id, access_state')
      .eq('id', user.id)
      .maybeSingle();

    // Admission runs on a RECORDED fact, not on inference. Only an account still sitting at
    // 'pending' is an unresolved signup; anything already active or denied has been decided, and
    // a confirmation link must not re-provision or alter it.
    if (existing?.access_state !== 'pending') {
      const landing = existing?.cohort_id ? '/student' : '/onboarding';
      return NextResponse.redirect(new URL(landing, request.url), 303);
    }

    const outcome = await admitConfirmedSignup(db, user, 'signup_confirm');

    if (outcome.status === 'denied') {
      // End the session so the refusal takes effect now rather than on the next request.
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL(`/auth?error=${outcome.errorParam}`, request.url), 303);
    }

    if (outcome.status === 'retry') {
      // Deliberately NOT signing out. The account stays pending, and a pending session is bounced
      // to /auth?error=confirm_email, which offers a fresh link -- so the student can recover
      // without contacting anyone.
      return NextResponse.redirect(new URL('/auth?error=try_again', request.url), 303);
    }

    return NextResponse.redirect(new URL('/onboarding', request.url), 303);
  }

  return NextResponse.redirect(new URL('/auth/reset-password', request.url), 303);
}
