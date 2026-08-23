/**
 * The admission decision for a signup whose email has just been proved, in ONE place.
 *
 * Two routes now confirm an email: /auth/confirm/verify (hashed token, works from any device,
 * survives mail scanners) and /auth/callback (PKCE, same-browser only, kept for links already in
 * inboxes). Both must reach the same verdict about who gets in. Duplicating that decision is how
 * the two copies drift, and lib/account-state.ts already opens with the scar from the last time
 * this platform reconstructed the same facts in three places and had them disagree.
 *
 * Scope: everything AFTER ownership of the address is proved, and nothing about how it was proved.
 * This function performs every database write the decision implies and returns a verdict. It
 * deliberately does NOT touch the session or build a redirect -- ending a session and choosing a
 * landing page belong to the route, which is the only thing that knows how the caller arrived.
 *
 * Two rules the shape of this file exists to enforce:
 *
 *   1. Only a CONFIRMED negative result may deny. A database or network failure looks identical to
 *      "not allowed" if you only check the returned value, and a denial is a lasting mark on a real
 *      person's account.
 *   2. An operational failure leaves the account pending and recoverable. Pending is resolvable --
 *      by a fresh link, or a retry -- and denied is not.
 */
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activateEnrollment } from '@/lib/db-payments';
import { markSelfSignupApproved, markSelfSignupDenied } from '@/lib/account-state-server';
import { isDisposableEmailDomain } from '@/lib/disposable-email-domains';

/** Why a denial happened, in the vocabulary /auth reads to choose its message. */
export type DenialReason = 'not_allowed' | 'email_not_supported';

export type AdmissionOutcome =
  /** Allowlisted: enrollment activated and cohort assigned. */
  | { status: 'admitted'; cohortId: string }
  /** Public self-serve signup: active, no cohort, no enrollment model. */
  | { status: 'admitted_free' }
  /** A confirmed negative. The caller should also end the session. */
  | { status: 'denied'; errorParam: DenialReason }
  /** Something broke. The account is untouched and still pending. */
  | { status: 'retry' };

export async function admitConfirmedSignup(
  db: SupabaseClient,
  user: { id: string; email?: string | null },
  /** Which route is asking, so Sentry can tell the two entry points apart. */
  flow: 'signup_callback' | 'signup_confirm',
): Promise<AdmissionOutcome> {
  const deny = async (reason: string, errorParam: DenialReason): Promise<AdmissionOutcome> => {
    console.warn(`[${flow}] denying signup: ${reason}`, user.id);
    // A denial is the policy working, not a fault, so it is reported as a warning rather than an
    // exception. Once signups are open, uninvited attempts are ordinary traffic, and filing each
    // as an error would bury the failures below that do need a person. Account id only -- no
    // email, no token, no cookie.
    Sentry.captureMessage(`${flow} denied signup: ${reason}`, {
      level: 'warning',
      user: { id: user.id },
      tags: { flow, outcome: 'denied', reason },
    });
    await markSelfSignupDenied(db, user.id);
    return { status: 'denied', errorParam };
  };

  const retry = async (reason: string, detail?: unknown): Promise<AdmissionOutcome> => {
    console.error(`[${flow}] leaving signup pending: ${reason}`, user.id, detail ?? '');
    // THE failure this exists to survive, and the one nobody finds out about: the account is
    // eligible, something broke, and the student is left pending with no way to say why. Report
    // the original error where there is one, so the stack points at the real call.
    Sentry.captureException(
      detail instanceof Error ? detail : new Error(`${flow}: ${reason}`),
      {
        user: { id: user.id },
        tags: { flow, outcome: 'pending', reason },
        ...(typeof detail === 'string' && detail ? { extra: { detail } } : {}),
      },
    );
    return { status: 'retry' };
  };

  if (!user.email) return deny('authenticated user has no email', 'not_allowed');
  const email = user.email;

  const { data: cohortId, error: allowlistError } = await db.rpc(
    'check_email_allowlist', { p_email: email },
  );
  if (allowlistError) return retry('allowlist lookup failed', allowlistError.message);

  // No allowlist entry used to be the end of it. It still is, unless the platform has public
  // signup switched on -- in which case this becomes a FREE account: active, but with no cohort,
  // which limits it to content tagged available_to_everyone.
  //
  // Read straight from the table rather than through getTenantSettings(), which caches for 60
  // seconds. This is an access gate: switching signups off must take effect immediately, not
  // within the minute, or a flood keeps being admitted after someone has pulled the lever.
  if (!cohortId) {
    const { data: settings, error: settingsError } = await db
      .from('platform_settings')
      .select('public_signup_enabled')
      .eq('id', 'default')
      .maybeSingle();
    // A failed lookup is not a refusal. "The settings query broke" is no evidence at all about
    // who this person is.
    if (settingsError) return retry('public signup lookup failed', settingsError.message);
    if (!settings?.public_signup_enabled) return deny('not on any cohort allowlist', 'not_allowed');

    if (isDisposableEmailDomain(email)) {
      return deny('disposable email domain', 'email_not_supported');
    }

    // No cohort, and deliberately no enrollment_model claim: this account is neither a bootcamp
    // admission nor a subscriber. Leaving that column null keeps both doors open, and
    // claim_student_enrollment_model already treats null as unclaimed if one is bought later.
    try {
      await markSelfSignupApproved(db, user.id);
    } catch (e: any) {
      return retry('could not record public signup', e?.message ?? e);
    }
    return { status: 'admitted_free' };
  }

  try {
    await activateEnrollment(db, email, cohortId, user.id);
  } catch (e: any) {
    // Their email IS on an allowlist, so this is a data or infrastructure problem, not a verdict
    // on their eligibility. Leave them pending and recoverable either way.
    // no_admission_record = allowlisted but with no bootcamp_enrollments pre-signup row.
    const isNoRecord = typeof e?.message === 'string' && e.message.includes('No admission record');
    return isNoRecord
      ? retry('allowlisted but no admission record', e?.message)
      : retry('enrollment activation failed', e?.message ?? e);
  }

  // The account is only marked active once it actually has its cohort, or an activation that
  // half-failed would leave an active student with nothing to study.
  const { error: cohortError } = await db
    .from('students').update({ cohort_id: cohortId }).eq('id', user.id);
  if (cohortError) return retry('cohort assignment failed', cohortError.message);

  const { error: allowlistCleanupError } = await db
    .from('cohort_allowed_emails').delete().eq('email', email.toLowerCase());
  // Cleanup only -- a stale allowlist row does not affect this student's access.
  if (allowlistCleanupError) {
    console.error(`[${flow}] allowlist cleanup failed`, allowlistCleanupError.message);
  }

  try {
    await markSelfSignupApproved(db, user.id);
  } catch (e: any) {
    return retry('could not record admission', e?.message ?? e);
  }

  return { status: 'admitted', cohortId };
}
