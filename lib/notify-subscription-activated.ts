import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { LearnerSetupState } from '@/lib/notify-individual-learner-welcome';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { subscriptionActivatedEmail } from '@/lib/email-templates';
import { LEARNER_SETUP_FIELDS, learnerNeedsSetup, sendIndividualLearnerWelcome } from '@/lib/notify-individual-learner-welcome';

const resend = new Resend(process.env.RESEND_API_KEY);

const BATCH_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 3;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Everything the learner needs is on the payment row -- plan name, duration and the period
// it bought -- so this reads one row rather than reassembling details at each call site.
// is_activating distinguishes a first purchase from an extension, which the copy depends
// on: telling a renewing subscriber their access "is now active" reads as though something
// changed. Amount, payment method and reference are deliberately left out; this is an
// access notice, not a receipt.
const PAYMENT_SELECT =
  `id, student_id, plan_name, duration_months, period_start, period_end, is_activating, activation_email_sent_at, students!subscription_payments_student_id_fkey ( email, full_name, ${LEARNER_SETUP_FIELDS} )`;

type PaymentRow = {
  id: string;
  student_id: string | null;
  plan_name: string;
  duration_months: number;
  period_start: string;
  period_end: string;
  is_activating: boolean;
  activation_email_sent_at: string | null;
  students?: ({ email?: string; full_name?: string } & LearnerSetupState) | null;
};

function isRateLimitError(error: any) {
  return error?.statusCode === 429
    || error?.name === 'rate_limit_exceeded'
    || /too many requests|rate limit/i.test(error?.message ?? '');
}

// activation_email_sent_at is the permanent guard: it records that this payment's learner
// has been told, independently of which request created the payment. Resend idempotency
// keys are kept for 24 hours only, so they cover a crash between sending and stamping and
// nothing longer.
//
// Order matters. Stamping before sending would mark a payment as emailed and then lose the
// message if delivery failed -- silent and unrecoverable. Sending first can duplicate on a
// crash instead, which the per-payment Resend key absorbs, and that is the better failure
// because it is visible rather than silent.
function activationKey(paymentId: string) {
  return `subscription-activated/${paymentId}`;
}

function renderMessage(payment: PaymentRow, ctx: {
  from: string;
  dashboardUrl: string;
  branding: any;
}) {
  return {
    from: ctx.from,
    to: payment.students?.email as string,
    subject: payment.is_activating
      ? `Your ${payment.plan_name} subscription is active`
      : `Your ${payment.plan_name} subscription has been extended`,
    html: subscriptionActivatedEmail({
      name: payment.students?.full_name || 'there',
      planName: payment.plan_name,
      durationMonths: payment.duration_months,
      periodStart: payment.period_start,
      periodEnd: payment.period_end,
      isActivation: payment.is_activating === true,
      dashboardUrl: ctx.dashboardUrl,
      branding: ctx.branding,
    }),
  };
}

async function mailContext() {
  const tenant = await getTenantSettings();
  const dashboardUrl = tenant.appUrl || process.env.APP_URL || '';
  if (!dashboardUrl) throw new Error('Platform App URL is not configured.');
  return {
    from: process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`,
    dashboardUrl,
    branding: {
      appName: tenant.appName,
      appUrl: tenant.appUrl,
      logoUrl: tenant.logoUrl,
      emailBannerUrl: tenant.emailBannerUrl,
      teamName: tenant.teamName,
    },
  };
}

// Counted in the database so concurrent sweeps cannot lose an increment. Recording a
// failure must never itself throw: it runs inside a catch, and losing the sweep here would
// undo the per-row isolation it exists to support.
async function recordFailure(
  db: SupabaseClient,
  input: { paymentId?: string; requestId?: string; error: unknown },
) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const { error } = await db.rpc('record_subscription_email_failure', {
    p_payment_id: input.paymentId ?? null,
    p_request_id: input.requestId ?? null,
    p_error: message,
  });
  if (error) console.error('[subscription-activation-email] could not record failure', error);
}

async function stampSent(db: SupabaseClient, paymentIds: string[]) {
  if (!paymentIds.length) return;
  const { error } = await db
    .from('subscription_payments')
    .update({ activation_email_sent_at: new Date().toISOString() })
    .in('id', paymentIds)
    .is('activation_email_sent_at', null);
  if (error) throw error;
}

/**
 * Idempotent per payment. Safe to call on every attempt, including one where the payment
 * itself was already processed -- that is what makes a failed email retryable.
 */
export async function notifySubscriptionActivated(
  db: SupabaseClient,
  input: { paymentId: string },
): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data, error } = await db
    .from('subscription_payments')
    .select(PAYMENT_SELECT)
    .eq('id', input.paymentId)
    .maybeSingle();
  if (error) throw error;
  const payment = data as unknown as PaymentRow | null;
  if (!payment) throw new Error('Subscription payment not found.');

  if (payment.activation_email_sent_at) return { sent: false };
  // student_id is nulled when an account is deleted (migration 176). There is nobody left
  // to notify, so stamp it and stop retrying rather than failing forever.
  if (!payment.student_id || !payment.students?.email) {
    await stampSent(db, [payment.id]);
    return { sent: false };
  }

  // A learner who still has no way into their account needs the combined welcome, not a
  // plan-only notice. Decided here from durable state rather than by the caller, because
  // every caller that tried to decide it got the retry case wrong.
  if (learnerNeedsSetup(payment.students)) {
    return sendIndividualLearnerWelcome(db, {
      studentId: payment.student_id,
      email: payment.students!.email as string,
      fullName: payment.students?.full_name ?? null,
      paymentId: payment.id,
    });
  }

  const ctx = await mailContext();
  const { error: sendError } = await resend.emails.send(
    renderMessage(payment, ctx),
    { idempotencyKey: activationKey(payment.id) },
  );
  if (sendError) throw new Error(sendError.message);

  await stampSent(db, [payment.id]);
  return { sent: true };
}

/**
 * Bulk equivalent. Callers pass every payment id they touched, including ones the payment
 * RPC reported as already processed, because an earlier attempt may have committed the
 * payment and then failed to deliver. The delivery record decides what still needs sending.
 */
export async function notifySubscriptionActivatedBatch(
  db: SupabaseClient,
  input: { paymentIds: string[] },
): Promise<{ sent: number; skipped: number; failed: number }> {
  if (!input.paymentIds.length) return { sent: 0, skipped: 0, failed: 0 };
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data, error } = await db
    .from('subscription_payments')
    .select(PAYMENT_SELECT)
    .in('id', input.paymentIds)
    .is('activation_email_sent_at', null);
  if (error) throw error;
  const payments = (data ?? []) as unknown as PaymentRow[];
  if (!payments.length) return { sent: 0, skipped: 0, failed: 0 };

  const unreachable = payments.filter(p => !p.student_id || !p.students?.email);
  await stampSent(db, unreachable.map(p => p.id));

  const reachable = payments.filter(p => p.student_id && p.students?.email);

  // At most ONE welcome per learner, not per payment. Two unstamped payments for the same
  // student are read from the same snapshot, so both would otherwise look eligible and the
  // learner would receive two "your account is ready" emails with different expiry dates.
  // The extra rows are not dropped -- they fall through to the ordinary activation email
  // below, which is what they should have been all along.
  const welcomeByStudent = new Map<string, PaymentRow>();
  const deliverable: PaymentRow[] = [];
  for (const payment of reachable) {
    const studentId = payment.student_id as string;
    if (learnerNeedsSetup(payment.students) && !welcomeByStudent.has(studentId)) {
      welcomeByStudent.set(studentId, payment);
    } else {
      deliverable.push(payment);
    }
  }
  const needsWelcome = [...welcomeByStudent.values()];

  let sent = 0;
  let failed = 0;
  for (const payment of needsWelcome) {
    try {
      const result = await sendIndividualLearnerWelcome(db, {
        studentId: payment.student_id as string,
        email: payment.students!.email as string,
        fullName: payment.students?.full_name ?? null,
        paymentId: payment.id,
      });
      if (result.sent) sent += 1;
    } catch (error) {
      // Each setup link is personalized. One broken account must remain unstamped for the
      // next sweep without preventing every later learner from being notified now.
      failed += 1;
      await recordFailure(db, { paymentId: payment.id, error });
      console.error('[subscription-activation-email] combined welcome failed', payment.id, error);
    }
  }

  if (!deliverable.length) return { sent, skipped: unreachable.length, failed };

  const ctx = await mailContext();

  for (let i = 0; i < deliverable.length; i += BATCH_SIZE) {
    const slice = deliverable.slice(i, i + BATCH_SIZE);
    const messages = slice.map(p => renderMessage(p, ctx));
    let chunkFailed = false;
    // Derived from the exact payments in this chunk, so a retry carrying a different set of
    // still-unsent learners cannot collide with an earlier key and be discarded as a
    // duplicate. resend.batch.send takes one key per call, not per message.
    const chunkKey = `subscription-activated/batch/${createHash('sha256')
      .update(slice.map(p => p.id).sort().join(','))
      .digest('hex')
      .slice(0, 32)}`;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        const { error: sendError } = await resend.batch.send(messages, { idempotencyKey: chunkKey });
        if (!sendError) break;
        if (!isRateLimitError(sendError) || attempt === MAX_RATE_LIMIT_RETRIES) {
          throw new Error(`${sendError.name ?? ''} ${sendError.message ?? 'Batch send failed'}`.trim());
        }
        // rate limited with retries left: fall through to the backoff below
      } catch (sendError) {
        if (isRateLimitError(sendError) && attempt < MAX_RATE_LIMIT_RETRIES) {
          await wait(1000 * (2 ** attempt));
          continue;
        }
        // Charge the attempt to every row in the chunk and move on. Rethrowing here used to
        // abandon all later chunks AND leave these rows unstamped at attempt zero, so the
        // same failing slice reoccupied the head of the queue on every run, forever.
        for (const payment of slice) {
          await recordFailure(db, { paymentId: payment.id, error: sendError });
        }
        failed += slice.length;
        chunkFailed = true;
        console.error('[subscription-activation-email] batch send failed', sendError);
        break;
      }
      await wait(1000 * (2 ** attempt));
    }
    if (chunkFailed) continue;

    // Stamped per chunk, so a chunk that already succeeded stays sent even if a later one
    // throws. Only the undelivered remainder is retried.
    await stampSent(db, slice.map(p => p.id));
    sent += slice.length;
  }

  return { sent, skipped: unreachable.length, failed };
}
