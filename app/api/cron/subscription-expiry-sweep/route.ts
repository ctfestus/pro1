/**
 * Hourly subscription maintenance: expire lapsed subscriptions, warn learners whose access
 * ends soon, then retry any subscription email whose delivery failed after the record was
 * already committed.
 * QStash schedule: 0 * * * * POST /api/cron/subscription-expiry-sweep
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { expireSubscription } from '@/lib/db-subscriptions';
import { notifySubscriptionActivatedBatch } from '@/lib/notify-subscription-activated';
import { notifySubscriptionPaymentRequest } from '@/lib/notify-subscription-payment-request';
import { notifySubscriptionExpiring } from '@/lib/notify-subscription-expiring';
import { retryPaystackIncidentNotifications, retryStoredPaystackWebhookEvents } from '@/lib/paystack-webhook-processing';
import { verifyQStashRequest } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
// Every send is a network round trip, so a backlog can outlast the default serverless
// budget. The run stops cleanly at TIME_BUDGET_MS and the rest is picked up next hour --
// the delivery stamps are what decide eligibility, so stopping early loses nothing.
export const maxDuration = 300;

// Bounded so one run cannot exceed the function timeout. Anything left over is picked up
// on the next hour, since the delivery stamp is what decides eligibility.
const EMAIL_RETRY_BATCH = 200;
// Request emails are retried one at a time rather than batched, because recovery volume is
// by definition small -- only sends that already failed. Kept well under the activation cap
// so a backlog cannot dominate the run.
const REQUEST_EMAIL_RETRY_BATCH = 25;
// Rows that keep failing stop being retried, so one permanently broken address cannot hold
// the oldest slot and starve every newer learner. email_last_error records why.
const MAX_EMAIL_ATTEMPTS = 5;
// Comfortably inside maxDuration, leaving room for the response and the expiry pass.
const TIME_BUDGET_MS = 240_000;
const EXPIRY_WARNING_DAYS = 7;

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const db = adminClient();
  let paystackEventsRetried = 0;
  let paystackEventFailures = 0;
  let reconciliationAlertsSent = 0;
  let paystackEventsPurged = 0;
  let paystackRecoverySkipped = false;
  // Paystack recovery runs AFTER the expiry pass, further down. Expiring access is the reason
  // this job exists and it is the only thing that ever revokes it, so cleanup must never get to
  // spend the budget first: 25 webhook retries each calling out to Paystack, plus 50 emails, can
  // exhaust it between them, and the expiry pass would then be skipped with the run still
  // reporting success.
  // No reversal polling either. Refunds and disputes arrive as webhook events, are recorded, and
  // are alerted to support; acting on them is a person's job. See migration 191.
  const { data: candidates, error } = await db
    .from('individual_subscriptions')
    .select('id')
    .eq('status', 'active')
    .lt('current_period_end', new Date().toISOString())
    .order('current_period_end', { ascending: true })
    .limit(EMAIL_RETRY_BATCH);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let expired = 0;
  let skipped = 0;
  let failed = 0;
  let expiryPassCompleted = true;

  for (const candidate of candidates ?? []) {
    if (outOfTime()) {
      expiryPassCompleted = false;
      break;
    }
    try {
      const result = await expireSubscription(db, candidate.id);
      if (result.skipped) skipped++;
      else expired++;
    } catch (err) {
      failed++;
      console.error('[cron/subscription-expiry-sweep]', candidate.id, err);
    }
  }

  // A learner whose payment committed but whose email failed is otherwise never told:
  // approval removes the item from the instructor's queue, and the email runs after the
  // response, so the failure is invisible. Without this, the replay path the approval
  // function supports has nothing that triggers it.
  let emailsRetried = 0;
  let emailRetriesFailed = 0;
  let emailRetryError: string | null = null;
  try {
    const { data: pending, error: pendingError } = await db
      .from('subscription_payments')
      .select('id')
      .eq('status', 'completed')
      .is('activation_email_sent_at', null)
      .lt('email_attempts', MAX_EMAIL_ATTEMPTS)
      // Deleted learners are deliberately included. The sender settles their rows as
      // nothing-to-do; excluding them here would leave those rows unstamped forever,
      // permanently resident in the pending index.
      .order('created_at', { ascending: true })
      .limit(EMAIL_RETRY_BATCH);
    if (pendingError) throw pendingError;

    const paymentIds = (pending ?? []).map(row => row.id);
    if (paymentIds.length) {
      const { sent, failed: deliveryFailures } = await notifySubscriptionActivatedBatch(db, { paymentIds });
      emailsRetried = sent;
      emailRetriesFailed = deliveryFailures;
      if (deliveryFailures > 0) {
        emailRetryError = `${deliveryFailures} activation email${deliveryFailures === 1 ? '' : 's'} could not be sent`;
      }
    }
  } catch (err: any) {
    // Expiry already succeeded; a mail outage must not turn the whole sweep into a failure
    // that QStash keeps retrying.
    emailRetryError = err?.message ?? 'Activation email retry failed';
    console.error('[cron/subscription-expiry-sweep] activation email retry', err);
  }

  // Same recovery for the payment-request email. A learner whose welcome or request email
  // failed has no idea they owe anything, and nothing in the instructor's screens surfaces
  // that.
  let requestEmailsRetried = 0;
  let requestEmailRetriesFailed = 0;
  try {
    const { data: pendingRequests, error: pendingRequestError } = await db
      .from('subscription_payment_requests')
      .select('id')
      .is('request_email_sent_at', null)
      .lt('email_attempts', MAX_EMAIL_ATTEMPTS)
      // Deleted learners and settled requests are included for the same reason: the sender
      // stamps them as nothing-to-do rather than leaving them pending forever.
      .order('created_at', { ascending: true })
      .limit(REQUEST_EMAIL_RETRY_BATCH);
    if (pendingRequestError) throw pendingRequestError;

    for (const row of pendingRequests ?? []) {
      if (outOfTime()) break;
      try {
        const { sent } = await notifySubscriptionPaymentRequest(db, { requestId: row.id });
        if (sent) requestEmailsRetried++;
      } catch (err) {
        // Keep this row unstamped for the next run, but do not let it starve every request
        // behind it in the queue.
        requestEmailRetriesFailed++;
        // Charge the attempt so a permanently broken row eventually drops out of the queue.
        await db.rpc('record_subscription_email_failure', {
          p_payment_id: null,
          p_request_id: row.id,
          p_error: err instanceof Error ? err.message : String(err),
        });
        console.error('[cron/subscription-expiry-sweep] payment request email retry', row.id, err);
      }
    }
  } catch (err: any) {
    emailRetryError = emailRetryError ?? (err?.message ?? 'Payment request email retry failed');
    console.error('[cron/subscription-expiry-sweep] request email retry', err);
  }

  // Expiry is automatic, so without this a learner's courses simply vanish one morning with
  // nothing sent. Warned once per period; a renewal moves the period end and re-arms it.
  let expiryWarningsSent = 0;
  let expiryWarningsFailed = 0;
  try {
    const horizon = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86_400_000).toISOString();
    // Served by a function because the queue has to exclude rows already warned for the
    // period they are currently in, and that compares two columns
    // (expiry_warning_for_period_end vs current_period_end) which PostgREST cannot express.
    // Filtering only by expiry window would re-select the same warned rows every hour and
    // never reach the 26th learner.
    const { data: expiringSoon, error: expiringError } = await db
      .rpc('list_subscriptions_needing_expiry_warning', {
        p_horizon: horizon,
        p_limit: REQUEST_EMAIL_RETRY_BATCH,
        p_max_attempts: MAX_EMAIL_ATTEMPTS,
      });
    if (expiringError) throw expiringError;

    for (const row of expiringSoon ?? []) {
      if (outOfTime()) break;
      try {
        const { sent } = await notifySubscriptionExpiring(db, {
          subscriptionId: row.id,
          periodEnd: row.current_period_end,
        });
        if (sent) expiryWarningsSent++;
      } catch (err) {
        // Isolated per learner. The period guard is only written on success, so this one is
        // retried next hour while everyone else is warned now -- but the attempt is charged,
        // so a permanently invalid address eventually leaves the warning window.
        expiryWarningsFailed++;
        // Charged against the period it was selected for, so a renewal starts a fresh
        // allowance instead of inheriting a stale total.
        await db.rpc('record_expiry_warning_failure', {
          p_subscription_id: row.id,
          p_period_end: row.current_period_end,
          p_error: err instanceof Error ? err.message : String(err),
        });
        console.error('[cron/subscription-expiry-sweep] expiry warning', row.id, err);
      }
    }
  } catch (err: any) {
    emailRetryError = emailRetryError ?? (err?.message ?? 'Expiry warning sweep failed');
    console.error('[cron/subscription-expiry-sweep] expiry warning sweep', err);
  }

  // Paystack recovery last, and only with budget left. Every step here is retried on the next
  // run, so dropping it costs an hour; letting it run long costs the expiry pass entirely.
  if (outOfTime()) {
    paystackRecoverySkipped = true;
  } else {
    try {
      const webhookRetry = await retryStoredPaystackWebhookEvents(db, REQUEST_EMAIL_RETRY_BATCH, outOfTime);
      paystackEventsRetried = webhookRetry.processed;
      paystackEventFailures = webhookRetry.failed;
      if (!outOfTime()) {
        const alerts = await retryPaystackIncidentNotifications(db, REQUEST_EMAIL_RETRY_BATCH, outOfTime);
        reconciliationAlertsSent = alerts.sent;
      } else {
        paystackRecoverySkipped = true;
      }
      if (!outOfTime()) {
        const { data: purged, error: purgeError } = await db.rpc('purge_paystack_operational_data', {
          p_before: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        });
        if (purgeError) throw purgeError;
        paystackEventsPurged = Number(purged || 0);
      } else {
        paystackRecoverySkipped = true;
      }
    } catch (err) {
      paystackEventFailures++;
      console.error('[cron/subscription-expiry-sweep] Paystack recovery', err);
    }
  }

  const sweepSucceeded = expiryPassCompleted && failed === 0;
  if (sweepSucceeded) {
    const { error: heartbeatError } = await db.from('cron_heartbeats').upsert({
      job_name: 'subscription-expiry-sweep',
      last_success_at: new Date().toISOString(),
      last_summary: { expired, failed, paystackEventsRetried, paystackRecoverySkipped },
    }, { onConflict: 'job_name' });
    if (heartbeatError) console.error('[cron/subscription-expiry-sweep] heartbeat', heartbeatError);
  }

  return NextResponse.json({
    ok: sweepSucceeded,
    timedOut: outOfTime(),
    paystackRecoverySkipped,
    processed: (candidates ?? []).length,
    expired,
    skipped,
    failed,
    emailsRetried,
    emailRetriesFailed,
    requestEmailsRetried,
    requestEmailRetriesFailed,
    expiryWarningsSent,
    expiryWarningsFailed,
    paystackEventsRetried,
    paystackEventFailures,
    reconciliationAlertsSent,
    paystackEventsPurged,
    emailRetryError,
  }, { status: sweepSucceeded ? 200 : 500 });
}
