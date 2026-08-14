import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { individualLearnerWelcomeEmail } from '@/lib/email-templates';

const resend = new Resend(process.env.RESEND_API_KEY);

// Long enough for a slow send, short enough that a crashed worker's learner is retried on
// the next hourly sweep rather than the one after.
const WELCOME_CLAIM_TTL_SECONDS = 300;

/** Fields that decide whether a learner still needs account setup. */
export type LearnerSetupState = {
  account_origin?: string | null;
  password_set_at?: string | null;
  setup_email_sent_at?: string | null;
};

/**
 * Whether this learner was created by staff and still has no way in.
 *
 * All three conditions are load-bearing:
 *
 * - account_origin = 'admissions' is what separates a staff-created account from a learner
 *   who signed up themselves. password_set_at is written only by the new setup form
 *   (lib/account-state-server.ts), so it is null for every account predating that work --
 *   on its own it would classify the entire existing learner base as locked out and mail
 *   them a password reset instead of their subscription notice. scripts/
 *   preview-password-setup-backfill.sql documents that exact trap. account_origin is safe
 *   to lean on because markExistingAccountAdmitted deliberately leaves it alone.
 * - password_set_at empty means they have not completed setup.
 * - setup_email_sent_at empty is what makes this a once-per-learner decision. Once a
 *   welcome lands, every later payment or request for the same learner takes the ordinary
 *   activation or payment-request email instead of a second "your account is ready".
 *
 * Deliberately not derived from "did this request create the account": that is true only
 * during the creating request, so a welcome that failed would be retried as a plan-only
 * message and the learner would be told their subscription is active while still locked out.
 */
export function learnerNeedsSetup(student: LearnerSetupState | null | undefined): boolean {
  if (!student) return false;
  return student.account_origin === 'admissions'
    && !student.password_set_at
    && !student.setup_email_sent_at;
}

export const LEARNER_SETUP_FIELDS = 'account_origin, password_set_at, setup_email_sent_at';

/**
 * The single email a staff-created learner receives, covering both their account setup and
 * the plan they were enrolled on.
 *
 * Previously two messages sent moments apart, which could arrive in either order -- "go to
 * your dashboard" reaching them before they could sign in.
 *
 * Delivery is stamped through one database function so the payment (or request) and the
 * learner's setup record are recorded together. Stamping them separately left a window
 * where a failure between the two writes made the sweep re-send the whole welcome.
 */
export async function sendIndividualLearnerWelcome(
  db: SupabaseClient,
  input:
    | { studentId: string; email: string; fullName?: string | null; paymentId: string }
    | { studentId: string; email: string; fullName?: string | null; requestId: string },
): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('Account created, but RESEND_API_KEY is not configured.');
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName?.trim() || null;
  const paymentId = 'paymentId' in input ? input.paymentId : null;
  const requestId = 'requestId' in input ? input.requestId : null;

  let planName: string;
  let durationMonths: number;
  let isRenewal: boolean;
  let access: Parameters<typeof individualLearnerWelcomeEmail>[0]['access'];

  if (paymentId) {
    const { data, error } = await db
      .from('subscription_payments')
      .select('plan_name, duration_months, period_start, period_end, is_activating, activation_email_sent_at')
      .eq('id', paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Subscription payment not found.');
    if (data.activation_email_sent_at) return { sent: false };
    planName = data.plan_name;
    durationMonths = data.duration_months;
    // A learner can be enrolled, never open their setup email, and later be renewed. That
    // second payment still needs the setup link, but it must not read as a brand-new
    // subscription.
    isRenewal = data.is_activating === false;
    access = { kind: 'active', periodStart: data.period_start, periodEnd: data.period_end };
  } else {
    const { data, error } = await db
      .from('subscription_payment_requests')
      .select('plan_name, duration_months, amount, currency, due_date, kind, request_email_sent_at')
      .eq('id', requestId as string)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Subscription payment request not found.');
    if (data.request_email_sent_at) return { sent: false };
    planName = data.plan_name;
    durationMonths = data.duration_months;
    isRenewal = data.kind === 'renewal';
    access = {
      kind: 'awaiting_payment',
      amount: Number(data.amount),
      currency: data.currency,
      dueDate: data.due_date,
    };
  }

  const tenant = await getTenantSettings();
  const appUrl = (process.env.APP_URL || tenant.appUrl || '').replace(/\/$/, '');
  if (!appUrl) throw new Error('APP_URL or platform App URL must be configured.');
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`.trim();
  if (from === '<>') throw new Error('RESEND_FROM_EMAIL or the platform sender name and support email must be configured.');

  // Claim the learner before sending. Choosing one welcome per learner within a batch does
  // not help when the admin route and the hourly sweep run at the same moment: both read
  // setup_email_sent_at IS NULL, both send, and stamping atomically afterwards cannot undo
  // two emails. The claim moves the decision before the send, and expires so a crashed
  // worker does not strand the learner.
  const { data: claimed, error: claimError } = await db.rpc('claim_learner_welcome_email', {
    p_student_id: input.studentId,
    p_ttl_seconds: WELCOME_CLAIM_TTL_SECONDS,
  });
  if (claimError) throw claimError;
  // Another worker holds the claim and is sending. The record stays unstamped, so if that
  // worker fails the sweep picks it up again.
  if (claimed !== true) return { sent: false };

  const deliver = async (): Promise<{ sent: boolean }> => {
    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'recovery', email });
    if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error('Could not generate setup link.');
    const setupUrl = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

    const { error: sendError } = await resend.emails.send({
      from,
      to: email,
      subject: `Your ${tenant.appName || 'learning'} account is ready`,
      html: individualLearnerWelcomeEmail({
        name: fullName || 'there',
        planName,
        durationMonths,
        setupUrl,
        isRenewal,
        access,
        branding: {
          appName: tenant.appName,
          appUrl,
          logoUrl: tenant.logoUrl,
          emailBannerUrl: tenant.emailBannerUrl,
          teamName: tenant.teamName,
        },
      }),
      // Deliberately no Resend idempotency key. Each attempt regenerates the setup link, so
      // the payload differs every time, and Resend rejects a reused key with a different
      // payload (409 invalid_idempotent_request) -- which would block the retry for 24 hours,
      // the opposite of what it is for. The claim above stops ordinary concurrent duplicates;
      // the stamps below are the permanent guard. A crash between Resend accepting and
      // stamping can still duplicate this email, which is far better than permanently
      // locking a learner out of account setup.
    });
    if (sendError) throw new Error(sendError.message);

    // One transaction: the payment or request that was announced, the learner's setup state
    // that stops a second welcome, and the claim it was sent under.
    const { error: stampError } = await db.rpc('mark_subscription_email_delivered', {
      p_student_id: input.studentId,
      p_payment_id: paymentId,
      p_request_id: requestId,
      p_mark_setup: true,
    });
    if (stampError) throw stampError;

    return { sent: true };
  };

  try {
    return await deliver();
  } catch (error) {
    // Hand the claim back so the retry does not have to wait out the whole TTL. The record
    // stays unstamped either way, so the sweep will pick it up.
    const { error: releaseError } = await db.rpc('release_learner_welcome_claim', {
      p_student_id: input.studentId,
    });
    if (releaseError) console.error('[individual-learner-welcome] could not release claim', releaseError);
    throw error;
  }
}
