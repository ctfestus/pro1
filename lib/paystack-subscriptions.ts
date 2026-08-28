import type { SupabaseClient } from '@supabase/supabase-js';
import {
  initializePaystackTransaction,
  makePaystackReference,
  PaystackApiError,
  paystackCallbackUrl,
  verifyPaystackTransaction,
} from '@/lib/paystack';
import { PaymentError } from '@/lib/payment-errors';

export interface PaystackCheckoutResult {
  reference: string;
  authorizationUrl: string;
}

/**
 * A direct checkout does not always end with somewhere to send the learner. Recovering a stuck one
 * can discover that Paystack already took the payment, in which case there is nothing left to buy
 * and the page needs to reload rather than show an error -- telling them it is "still processing"
 * after crediting them invites a second payment for something they already own.
 */
export type PaystackDirectCheckoutOutcome =
  | ({ kind: 'checkout' } & PaystackCheckoutResult)
  | { kind: 'settled'; reference: string; status: string };

export interface PaystackProcessResult {
  ok: boolean;
  reference: string;
  status: string;
  paymentId?: string;
  subscriptionId?: string;
  alreadyProcessed?: boolean;
  skipped?: boolean;
  reason?: string;
  incidentId?: string;
}

const INITIALIZATION_STALE_MS = 5 * 60 * 1000;
const CHECKOUT_URL_STALE_MS = 30 * 60 * 1000;
const PAYSTACK_IN_FLIGHT_STATUSES = ['pending', 'ongoing', 'processing', 'queued'];
const PAYSTACK_TERMINAL_FAILURE_STATUSES = ['failed', 'abandoned', 'reversed'];

function cents(value: number) {
  return Math.round(Number(value || 0) * 100);
}

/** " for Pro, 3 months" -- or nothing at all if the reservation did not say. */
function describeOpenCheckout(reservation: { openPlanName?: string | null; openDurationMonths?: number | null }) {
  const name = String(reservation.openPlanName ?? '').trim();
  const months = Number(reservation.openDurationMonths);
  if (!name) return '';
  if (!Number.isFinite(months) || months <= 0) return ` for ${name}`;
  return ` for ${name}, ${months === 12 ? '1 year' : `${months} month${months > 1 ? 's' : ''}`}`;
}

async function openCheckoutForRequest(db: SupabaseClient, requestId: string) {
  const { data, error } = await db
    .from('paystack_subscription_transactions')
    .select('id, reference, authorization_url, amount, currency, status, updated_at')
    .eq('request_id', requestId)
    .in('status', ['initialized', ...PAYSTACK_IN_FLIGHT_STATUSES, 'success', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export interface PaystackDirectCheckoutInput {
  studentId: string;
  email: string;
  planId: string;
  planName: string;
  durationMonths: number;
  amount: number;
  currency: string;
}

/**
 * Buying a plan online, with no payment request attached.
 *
 * A payment request means someone asked the learner to pay -- it carries a deadline, a chasing
 * email, and a place in the admin's receivables, and only one can be open per learner. Raising one
 * because somebody clicked a plan turned an abandoned checkout into a debt they could not clear
 * and locked them out of every other plan. Choosing a plan now records only this transaction.
 *
 * A request is still created for bank transfer and mobile money, where the learner needs somewhere
 * to submit a receipt, and that path is unchanged.
 */
export async function createPaystackDirectCheckout(
  db: SupabaseClient,
  input: PaystackDirectCheckoutInput,
  // One retry only, after a checkout with no usable link has been verified dead at Paystack.
  attempt = 0,
): Promise<PaystackDirectCheckoutOutcome> {
  const reference = makePaystackReference('sub');
  const callbackUrl = paystackCallbackUrl(reference);
  const currency = String(input.currency || 'GHS').toUpperCase();

  // Reserved in one database call, under a lock on the learner's own row. Checking for an
  // in-flight payment and then inserting from here would let two tabs both pass the check and
  // walk away holding two payable Paystack links -- the protection the payment request used to
  // provide as a side effect of being one-per-learner.
  const { data: reservation, error: reservationError } = await db.rpc('open_paystack_direct_checkout', {
    p_student_id: input.studentId,
    p_reference: reference,
    p_plan_id: input.planId,
    p_plan_name: input.planName,
    p_duration_months: input.durationMonths,
    p_amount: input.amount,
    p_currency: currency,
  });
  if (reservationError) throw reservationError;

  // Already holding a checkout for this plan: the same link comes back and Paystack is not asked
  // for a second one. This is what keeps it a cart rather than a pile of half-started payments.
  if (reservation?.status === 'existing') {
    return { kind: 'checkout', reference: reservation.reference, authorizationUrl: reservation.authorizationUrl };
  }
  if (reservation?.status === 'open_request') {
    throw new PaymentError(
      'conflict',
      'You have a payment awaiting confirmation. Complete or cancel it before starting another.',
      409,
    );
  }

  // A checkout with no usable link -- most often a provider timeout, where the row is deliberately
  // left alone because we cannot know whether Paystack created anything. Paystack is the only
  // authority, so ask it, exactly as the payment-request path already does for a stale checkout.
  // Without this the learner is stuck for good: no link to continue, and no way to choose again.
  if (reservation?.status === 'unverified') {
    if (attempt >= 1) {
      throw new PaymentError('conflict', 'This payment is still being confirmed. Please try again shortly.', 409);
    }
    let verifiedStatus: string | null = null;
    try {
      const verified = await verifyPaystackTransaction(reservation.reference);
      verifiedStatus = String(verified.status || '').toLowerCase();
    } catch (error) {
      // Paystack has never heard of it, so nothing was created and the row is safe to release.
      if (!(error instanceof PaystackApiError) || error.status !== 404) throw error;
    }
    if (verifiedStatus && !PAYSTACK_TERMINAL_FAILURE_STATUSES.includes(verifiedStatus)) {
      // Real, and possibly already paid. Processing settles the row -- and what it settles to
      // decides what the learner is told. Crediting them and then reporting "still processing"
      // showed an error, left the page stale, and invited a second payment for what they now own.
      const settled = await processPaystackSubscriptionReference(db, reservation.reference);
      if (settled.status === 'success' || settled.status === 'needs_review') {
        return { kind: 'settled', reference: reservation.reference, status: settled.status };
      }
      throw new PaymentError('conflict', 'A payment is already being processed for your account. Please wait for it to finish.', 409);
    }
    const { error: releaseError } = await db.from('paystack_subscription_transactions').update({
      status: verifiedStatus || 'failed',
      processing_error: verifiedStatus ? `paystack_${verifiedStatus}` : 'transaction_not_found_at_paystack',
    }).eq('reference', reservation.reference).eq('status', 'initialized');
    if (releaseError) throw releaseError;
    return createPaystackDirectCheckout(db, input, attempt + 1);
  }

  if (reservation?.status === 'payment_in_progress') {
    throw new PaymentError(
      'conflict',
      reservation.blockingStatus === 'initializing'
        ? 'Your checkout is being prepared. Give it a moment and try again.'
        // Names the unfinished checkout rather than calling it "another plan". Most learners who
        // hit this are renewing, so the open one is their own plan at a different length, and
        // being told about another plan sent them looking for something that was not there.
        : reservation.blockingStatus === 'initialized'
        ? `You have an unfinished checkout${describeOpenCheckout(reservation)}. Finish it or remove it above before choosing a different option.`
        : 'A payment is already being processed for your account. Please wait for it to finish before starting another.',
      409,
    );
  }

  try {
    const initialized = await initializePaystackTransaction({
      email: input.email,
      amount: input.amount,
      currency,
      reference,
      callbackUrl,
      metadata: {
        kind: 'individual_subscription',
        studentId: input.studentId,
        planId: input.planId,
        durationMonths: input.durationMonths,
      },
    });
    const { error: updateError } = await db.from('paystack_subscription_transactions').update({
      authorization_url: initialized.authorizationUrl,
    }).eq('reference', reference);
    if (updateError) throw updateError;
    return { kind: 'checkout', ...initialized };
  } catch (err) {
    if (err instanceof PaystackApiError && err.status >= 400 && err.status < 500) {
      await db.from('paystack_subscription_transactions').update({ status: 'failed' }).eq('reference', reference);
    }
    throw err;
  }
}

export async function createPaystackSubscriptionCheckout(
  db: SupabaseClient,
  input: { requestId: string; studentId: string; email: string },
  // A racing checkout can insert the row this call was about to insert. One retry re-reads it
  // and returns the 409; the cap is here because the retry path also calls out to Paystack.
  attempt = 0,
): Promise<PaystackCheckoutResult> {
  const { data: request, error } = await db
    .from('subscription_payment_requests')
    .select('id, student_id, plan_id, plan_name, duration_months, amount, currency, status')
    .eq('id', input.requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request || request.student_id !== input.studentId) {
    throw new PaymentError('not_found', 'Payment request not found.', 404);
  }
  if (request.status !== 'pending') {
    throw new PaymentError('conflict', 'Payment request is not open.', 409);
  }

  const requestAmount = Number(request.amount);
  const requestCurrency = String(request.currency || 'GHS').toUpperCase();
  const existingCheckout = await openCheckoutForRequest(db, request.id);
  if (existingCheckout) {
    const termsMatch = cents(Number(existingCheckout.amount)) === cents(requestAmount)
      && String(existingCheckout.currency || '').toUpperCase() === requestCurrency;
    const staleAfterMs = existingCheckout.authorization_url ? CHECKOUT_URL_STALE_MS : INITIALIZATION_STALE_MS;
    const isStale = existingCheckout.status === 'initialized'
      && new Date(existingCheckout.updated_at).getTime() <= Date.now() - staleAfterMs;
    if (existingCheckout.status === 'needs_review') {
      throw new PaymentError('conflict', 'This payment is under review. Please contact support before trying again.', 409);
    }
    if (existingCheckout.status === 'success') {
      throw new PaymentError('conflict', 'Payment has already been received and is being processed.', 409);
    }
    if (PAYSTACK_IN_FLIGHT_STATUSES.includes(existingCheckout.status)) {
      if (existingCheckout.authorization_url && termsMatch) {
        return {
          reference: existingCheckout.reference,
          authorizationUrl: existingCheckout.authorization_url,
        };
      }
      throw new PaymentError('conflict', 'This payment is still processing. Please wait before trying again.', 409);
    }
    if (!isStale && existingCheckout.authorization_url && termsMatch) {
      return {
        reference: existingCheckout.reference,
        authorizationUrl: existingCheckout.authorization_url,
      };
    }
    if (!termsMatch || isStale) {
      let verifiedStatus: string | null = null;
      try {
        const verified = await verifyPaystackTransaction(existingCheckout.reference);
        verifiedStatus = String(verified.status || '').toLowerCase();
      } catch (error) {
        if (!(error instanceof PaystackApiError) || error.status !== 404) throw error;
      }
      if (verifiedStatus === 'success') {
        const result = await processPaystackSubscriptionReference(db, existingCheckout.reference);
        const message = result.status === 'needs_review'
          ? 'This payment is under review. Please contact support before trying again.'
          : 'Payment has already been received and is being processed.';
        throw new PaymentError('conflict', message, 409);
      }
      if (verifiedStatus && !PAYSTACK_TERMINAL_FAILURE_STATUSES.includes(verifiedStatus)) {
        if (!termsMatch) {
          const { error: incidentError } = await db.rpc('open_paystack_transaction_incident', {
            p_reference: existingCheckout.reference,
            p_kind: 'checkout_terms_changed',
            p_reason: 'checkout_terms_changed_while_processing',
            p_blocks_credit: true,
          });
          if (incidentError) throw incidentError;
          throw new PaymentError('conflict', 'This payment is under review. Please contact support before trying again.', 409);
        }
        if (existingCheckout.authorization_url) {
          return { reference: existingCheckout.reference, authorizationUrl: existingCheckout.authorization_url };
        }
        throw new PaymentError('conflict', 'This payment is still processing. Please wait before trying again.', 409);
      }
      const { error: releaseError } = await db.from('paystack_subscription_transactions').update({
        status: verifiedStatus || 'failed',
        processing_error: verifiedStatus ? `paystack_${verifiedStatus}` : 'transaction_not_found_at_paystack',
      }).eq('id', existingCheckout.id).eq('status', 'initialized');
      if (releaseError) throw releaseError;
    } else {
      throw new PaymentError('conflict', 'A checkout is already starting for this payment request.', 409);
    }
  }

  const reference = makePaystackReference('sub');
  const callbackUrl = paystackCallbackUrl(reference);
  const { error: insertError } = await db.from('paystack_subscription_transactions').insert({
    reference,
    student_id: input.studentId,
    request_id: request.id,
    plan_id: request.plan_id,
    plan_name: request.plan_name,
    duration_months: request.duration_months,
    amount: Number(request.amount),
    currency: request.currency || 'GHS',
    status: 'initialized',
  });
  if (insertError) {
    const duplicate = insertError.code === '23505' || String(insertError.message ?? '').includes('duplicate');
    if (duplicate) {
      if (attempt >= 1) {
        throw new PaymentError('conflict', 'A checkout is already starting for this payment request.', 409);
      }
      return createPaystackSubscriptionCheckout(db, input, attempt + 1);
    }
    throw insertError;
  }

  try {
    const initialized = await initializePaystackTransaction({
      email: input.email,
      amount: Number(request.amount),
      currency: request.currency || 'GHS',
      reference,
      callbackUrl,
      metadata: {
        kind: 'individual_subscription',
        studentId: input.studentId,
        requestId: request.id,
        planId: request.plan_id,
        durationMonths: request.duration_months,
      },
    });
    const { error: updateError } = await db.from('paystack_subscription_transactions').update({
      authorization_url: initialized.authorizationUrl,
    }).eq('reference', reference);
    if (updateError) throw updateError;
    return initialized;
  } catch (err) {
    if (err instanceof PaystackApiError && err.status >= 400 && err.status < 500) {
      await db.from('paystack_subscription_transactions').update({ status: 'failed' }).eq('reference', reference);
    }
    throw err;
  }
}

export async function processPaystackSubscriptionReference(
  db: SupabaseClient,
  reference: string,
): Promise<PaystackProcessResult> {
  const { data: transaction, error } = await db
    .from('paystack_subscription_transactions')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  if (!transaction) {
    return {
      ok: !reference.startsWith('sub-'),
      reference,
      status: reference.startsWith('sub-') ? 'needs_review' : 'ignored',
      skipped: true,
      reason: reference.startsWith('sub-') ? 'unknown_subscription_reference' : 'unknown_reference',
    };
  }

  const verified = await verifyPaystackTransaction(reference);
  const matches = cents(verified.amount) === cents(Number(transaction.amount))
    && verified.currency.toUpperCase() === String(transaction.currency || '').toUpperCase();
  const status = verified.status === 'success' && matches ? 'success' : verified.status || 'failed';
  const supportedStatuses = ['success', 'failed', 'abandoned', 'reversed', 'pending', 'ongoing', 'processing', 'queued'];
  const normalizedStatus = supportedStatuses.includes(status) ? status : 'pending';
  const storedStatus = transaction.processed_payment_id
    ? (transaction.status === 'success' ? 'success' : transaction.status)
    : verified.status === 'success' && !matches ? 'needs_review' : normalizedStatus;

  const { error: verifyUpdateError } = await db.from('paystack_subscription_transactions').update({
    status: storedStatus,
    // Only ever set, never cleared. This id is how a refund that carries no reference is matched
    // back to its payment, so a verify response that happens to omit it must not erase one we
    // already hold.
    ...(verified.transactionId ? { paystack_transaction_id: verified.transactionId } : {}),
    channel: verified.channel ?? null,
    gateway_response: verified.gatewayResponse ?? null,
    verified_at: new Date().toISOString(),
  }).eq('reference', reference);
  if (verifyUpdateError) throw verifyUpdateError;

  if (transaction.processed_payment_id) {
    return {
      ok: true,
      reference,
      status: storedStatus,
      paymentId: transaction.processed_payment_id,
      alreadyProcessed: true,
    };
  }

  if (verified.status !== 'success') return { ok: true, reference, status: normalizedStatus };
  if (!matches) {
    const { data: incident, error: incidentError } = await db.rpc('open_paystack_transaction_incident', {
      p_reference: reference,
      p_kind: 'amount_or_currency_mismatch',
      p_reason: 'amount_or_currency_mismatch',
      p_blocks_credit: true,
    });
    if (incidentError) throw incidentError;
    return {
      ok: false,
      reference,
      status: 'needs_review',
      skipped: true,
      reason: 'amount_or_currency_mismatch',
      incidentId: incident?.id,
    };
  }

  const { data: finalized, error: finalizeError } = await db.rpc('finalize_paystack_subscription_transaction', {
    p_reference: reference,
    p_payment_method: verified.channel ? `Paystack ${verified.channel}` : 'Paystack',
    p_notes: verified.gatewayResponse ?? null,
    p_enforce_incidents: true,
  });
  if (finalizeError) throw finalizeError;
  if (finalized?.status === 'needs_review') {
    return {
      ok: true,
      reference,
      status: 'needs_review',
      skipped: true,
      reason: finalized.reason ?? 'crediting_failed',
    };
  }

  return {
    ok: true,
    reference,
    status: 'success',
    paymentId: finalized?.paymentId,
    subscriptionId: finalized?.subscriptionId,
    alreadyProcessed: finalized?.alreadyProcessed,
  };
}

/**
 * Asks Paystack what really became of a checkout we still hold as unfinished.
 *
 * Our own status is not evidence. A learner can pay and have the row still read 'initialized'
 * for as long as the webhook takes to arrive, so anything that acts on "this was abandoned" --
 * clearing a cart, or nudging someone to pay again -- has to confirm it with the provider first.
 * Both of those were trusting the local row, which meant a learner could be told to pay for
 * something they had already bought, or could clear a paid checkout and be free to buy it twice.
 *
 * Anything the provider does not call finished is handed to the normal crediting path rather than
 * merely reported, so a payment discovered here is applied instead of noticed and dropped.
 */
export async function settleUnfinishedCheckout(
  db: SupabaseClient,
  reference: string,
): Promise<{ abandoned: true } | { abandoned: false; result: PaystackProcessResult | null }> {
  let verifiedStatus: string | null = null;
  try {
    const verified = await verifyPaystackTransaction(reference);
    verifiedStatus = String(verified.status || '').toLowerCase();
  } catch (error) {
    // Paystack has never heard of it, so nothing was ever collected against it.
    if (error instanceof PaystackApiError && error.status === 404) return { abandoned: true };
    throw error;
  }
  // Released only on an explicit terminal failure. A blank or unrecognised status is Paystack
  // telling us nothing, and reading silence as "nothing was collected" is how a paid checkout gets
  // cleared and bought a second time. Anything we cannot place is left alone rather than freed.
  if (PAYSTACK_TERMINAL_FAILURE_STATUSES.includes(verifiedStatus)) return { abandoned: true };
  if (!PAYSTACK_IN_FLIGHT_STATUSES.includes(verifiedStatus) && verifiedStatus !== 'success') {
    return { abandoned: false, result: null };
  }
  return { abandoned: false, result: await processPaystackSubscriptionReference(db, reference) };
}
