// Overdue notice delivery, claimed before it is sent.
//
// DELIVERY POLICY: AT MOST ONCE. One overdue episode earns one notice, and where the outcome of a
// send cannot be established, the episode is closed WITHOUT sending rather than risk a second
// payment demand. A student who misses the email is still shown the restriction banner in the
// app; a student sent two demands for one debt is not something the banner makes up for.
//
// The episode is the due date of the installment that caused the overdue status, so a standing
// debt is never re-mailed while falling behind on a later installment still is. Migration 181
// holds that state on the enrollment and documents the four phases in full.
//
// The order below is what makes the policy hold. The claim is taken before the send, so a
// concurrent worker stands down instead of mailing. The claim carries a token, so a worker that
// stalls past its TTL and wakes to find itself replaced cannot write over the newer claim. The
// send is marked as begun before Resend is contacted, so an outcome that never gets recorded is
// distinguishable from a worker that died before sending anything -- and a recorded failure
// clears that marker, which is what keeps a genuinely failed send retryable.
//
// Resend's idempotency keys last 24 hours and the sweep runs daily, landing either side of that
// boundary, so they cannot carry the guarantee. They remain as a safeguard for a retry that lands
// inside the window.

import { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { overdueNotificationEmail } from './email-templates';
import { getTenantSettings } from './get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);

// The stamp is retried in process because the email is already out by then: a transient error
// here, left alone, would leave an ambiguous claim and cost this student their notice under the
// at-most-once rule. Short and few -- this runs inside a cron with a duration budget.
const FINALIZE_ATTEMPTS   = 3;
const FINALIZE_RETRY_MS   = 150;

export type OverdueNoticeOutcome =
  | 'sent'             // delivered and recorded
  | 'finalized'        // closed without sending: an earlier attempt's outcome was never recorded
  | 'finalize_failed'  // that close could not be written; the episode is still open
  | 'skipped'          // already delivered, or another worker owns it
  | 'failed';          // known not to have sent; the episode stays retryable

export interface OverdueNoticeSettings {
  from: string;
  dashboardUrl: string;
  branding: {
    logoUrl?: string;
    emailBannerUrl?: string;
    teamName?: string;
    appName?: string;
    appUrl?: string;
  };
}

/** Loaded once per run and passed in, so a sweep of many students does not refetch per email. */
export async function loadOverdueNoticeSettings(): Promise<OverdueNoticeSettings> {
  const t = await getTenantSettings();
  return {
    from:         process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`,
    dashboardUrl: t.appUrl || process.env.APP_URL || '',
    branding:     { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl },
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Record the episode as delivered, retrying a transient database failure.
 *
 * Returns false only when every attempt failed, which leaves the claim and the begun-marker in
 * place: the next worker to claim this episode will close it without sending.
 */
async function finalize(db: SupabaseClient, enrollmentId: string, dueDate: string, token: string): Promise<boolean> {
  for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt++) {
    const { data, error } = await db.rpc('mark_overdue_notice_sent', {
      p_enrollment_id: enrollmentId,
      p_due_date:      dueDate,
      p_claim_token:   token,
    });
    if (!error) {
      // false means the claim was taken over while this worker held it. The newer owner is
      // responsible for the episode now, so there is nothing to retry.
      if (data === false) console.warn(`[overdue-notice] claim lost before recording delivery for ${enrollmentId}`);
      return true;
    }
    console.error(`[overdue-notice] recording delivery failed (attempt ${attempt}/${FINALIZE_ATTEMPTS}):`, error.message);
    if (attempt < FINALIZE_ATTEMPTS) await wait(FINALIZE_RETRY_MS * attempt);
  }
  return false;
}

/**
 * Tell a student their payment is overdue, at most once for this episode.
 *
 * `skipped` and `finalized` are both terminal and neither should be retried. `failed` means this
 * episode is still owed a notice: the claim has been released, so the next run picks it up.
 */
export async function sendOverdueNotice(
  db: SupabaseClient,
  input: { enrollmentId: string; studentName: string; email: string; dueDate: string },
  settings: OverdueNoticeSettings,
): Promise<OverdueNoticeOutcome> {
  const { enrollmentId, studentName, email, dueDate } = input;

  // No claim is taken when there is no mail provider, so the episode stays notifiable and a run
  // made once the key is configured still tells them.
  if (!process.env.RESEND_API_KEY) return 'skipped';

  const { data: claim, error: claimErr } = await db.rpc('claim_overdue_notice', {
    p_enrollment_id: enrollmentId,
    p_due_date:      dueDate,
  });
  if (claimErr) {
    console.error('[overdue-notice] claim failed:', claimErr.message);
    return 'failed';
  }

  // A set-returning function comes back as rows; no row means the claim was not granted.
  const granted = Array.isArray(claim) ? claim[0] : claim;
  if (!granted?.claim_token) return 'skipped';
  const token: string = granted.claim_token;

  // An earlier worker began a send for this same episode and never recorded how it went. Under
  // the at-most-once policy that is closed without sending.
  //
  // Reported separately when the close itself cannot be written. Counting it as finalized would
  // report a clean run at the exact moment the database is refusing writes, which is the case the
  // count exists to surface. The episode stays claimed until its TTL lapses and is reconsidered
  // then -- still without sending, since the begun-marker is untouched.
  if (granted.resume_ambiguous) {
    const closed = await finalize(db, enrollmentId, dueDate, token);
    if (!closed) {
      console.error(`[overdue-notice] ambiguous claim could not be closed: enrollment=${enrollmentId} episode=${dueDate}`);
      return 'finalize_failed';
    }
    console.warn(`[overdue-notice] ambiguous claim closed without resending: enrollment=${enrollmentId} episode=${dueDate}`);
    return 'finalized';
  }

  // Before Resend, never after: this marker is the only thing that distinguishes "we may have
  // sent" from "we certainly did not".
  const { data: begun, error: beginErr } = await db.rpc('begin_overdue_notice_send', {
    p_enrollment_id: enrollmentId,
    p_due_date:      dueDate,
    p_claim_token:   token,
  });
  if (beginErr || begun === false) {
    // Nothing has been sent, so this is safely retryable. The claim is left to expire rather than
    // released, because a release records a failed attempt against an episode that never had one.
    console.error('[overdue-notice] could not record send start:', beginErr?.message ?? 'claim lost');
    return 'failed';
  }

  try {
    // Resend reports API failures by resolving with { error }, not by throwing.
    const { error: sendErr } = await resend.emails.send({
      from:    settings.from,
      to:      email,
      subject: 'Your account has an overdue payment',
      html:    overdueNotificationEmail({ name: studentName, dashboardUrl: settings.dashboardUrl, branding: settings.branding }),
    }, {
      // Stable for the episode, so a retry inside Resend's window cannot deliver a second copy.
      idempotencyKey: `overdue-notice:${enrollmentId}:${dueDate}`,
    });
    if (sendErr) throw new Error(sendErr.message);
  } catch (err: any) {
    // A rejected send is proof no mail went out, so this clears the begun-marker and keeps the
    // episode retryable -- the one case the at-most-once rule must not swallow.
    const { error: releaseErr } = await db.rpc('release_overdue_notice_claim', {
      p_enrollment_id: enrollmentId,
      p_due_date:      dueDate,
      p_claim_token:   token,
      p_error:         String(err?.message ?? err),
    });
    if (releaseErr) {
      // The marker still says a send was begun, so the next worker will close this episode
      // without sending even though it is known to have failed. Rare, and it costs one notice.
      console.error('[overdue-notice] claim release failed, episode will be closed unsent:', releaseErr.message);
    }
    console.error('[overdue-notice] send failed:', err);
    return 'failed';
  }

  if (!await finalize(db, enrollmentId, dueDate, token)) {
    console.error(`[overdue-notice] delivered but not recorded: enrollment=${enrollmentId} episode=${dueDate}`);
  }

  return 'sent';
}
