import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const initializePaystackTransaction = vi.hoisted(() => vi.fn());
const makePaystackReference = vi.hoisted(() => vi.fn());
const paystackCallbackUrl = vi.hoisted(() => vi.fn());
const verifyPaystackTransaction = vi.hoisted(() => vi.fn());
const purchaseOrRenewSubscription = vi.hoisted(() => vi.fn());
const PaystackApiError = vi.hoisted(() => class PaystackApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
});

vi.mock('@/lib/paystack', () => ({
  initializePaystackTransaction,
  makePaystackReference,
  paystackCallbackUrl,
  PaystackApiError,
  verifyPaystackTransaction,
}));
vi.mock('@/lib/db-subscriptions', () => ({ purchaseOrRenewSubscription }));

import {
  createPaystackSubscriptionCheckout,
  processPaystackSubscriptionReference,
} from '@/lib/paystack-subscriptions';

beforeEach(() => {
  vi.clearAllMocks();
  makePaystackReference.mockReturnValue('sub-new-ref');
  paystackCallbackUrl.mockReturnValue('https://app.test/api/paystack/callback/sub-new-ref');
  initializePaystackTransaction.mockResolvedValue({
    reference: 'sub-new-ref',
    authorizationUrl: 'https://checkout.paystack.com/sub-new-ref',
  });
  verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(404, 'not found'));
});

describe('Paystack subscription checkout helper', () => {
  it('reuses an initialized checkout for the same payment request', async () => {
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1',
          student_id: 'student-1',
          plan_id: 'plan-1',
          plan_name: 'Professional',
          duration_months: 3,
          amount: 300,
          currency: 'GHS',
          status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: {
        data: {
          id: 'transaction-1',
          reference: 'sub-existing-ref',
          authorization_url: 'https://checkout.paystack.com/sub-existing-ref',
          amount: 300,
          currency: 'GHS',
          status: 'initialized',
          updated_at: new Date().toISOString(),
        },
        error: null,
      },
    }) as any;

    const checkout = await createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    });

    expect(checkout).toEqual({
      reference: 'sub-existing-ref',
      authorizationUrl: 'https://checkout.paystack.com/sub-existing-ref',
    });
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('reclaims an initialized checkout that never received an authorization URL', async () => {
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1',
          student_id: 'student-1',
          plan_id: 'plan-1',
          plan_name: 'Professional',
          duration_months: 3,
          amount: 300,
          currency: 'GHS',
          status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: [
        {
          data: {
            id: 'transaction-stale',
            reference: 'sub-stale-ref',
            authorization_url: null,
            amount: 300,
            currency: 'GHS',
            status: 'initialized',
            updated_at: '2020-01-01T00:00:00.000Z',
          },
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
        // Attaching the link is conditional on the row still being open, and reads back what it
        // matched. A checkout closed underneath must not be handed to the learner as payable.
        { data: { reference: 'sub-new-ref' }, error: null },
      ],
    }) as any;

    const checkout = await createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    });

    expect(checkout.reference).toBe('sub-new-ref');
    expect(initializePaystackTransaction).toHaveBeenCalledOnce();
  });

  it('reclaims an expired initialized checkout URL instead of returning it forever', async () => {
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1', student_id: 'student-1', plan_id: 'plan-1', plan_name: 'Professional',
          duration_months: 3, amount: 300, currency: 'GHS', status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: [
        {
          data: {
            id: 'transaction-stale', reference: 'sub-stale-ref',
            authorization_url: 'https://checkout.paystack.com/sub-stale-ref',
            amount: 300, currency: 'GHS', status: 'initialized', updated_at: '2020-01-01T00:00:00.000Z',
          },
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
        // Attaching the link is conditional on the row still being open, and reads back what it
        // matched. A checkout closed underneath must not be handed to the learner as payable.
        { data: { reference: 'sub-new-ref' }, error: null },
      ],
    }) as any;

    const checkout = await createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1', studentId: 'student-1', email: 'student@example.com',
    });

    expect(checkout.reference).toBe('sub-new-ref');
    expect(initializePaystackTransaction).toHaveBeenCalledOnce();
  });

  it('keeps a stale checkout when Paystack says the payment is still in flight', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'pending', amount: 300, currency: 'GHS', transactionId: 47,
    });
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1', student_id: 'student-1', plan_id: 'plan-1', plan_name: 'Professional',
          duration_months: 3, amount: 300, currency: 'GHS', status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: {
        data: {
          id: 'transaction-stale', reference: 'sub-stale-ref',
          authorization_url: 'https://checkout.paystack.com/sub-stale-ref',
          amount: 300, currency: 'GHS', status: 'initialized', updated_at: '2020-01-01T00:00:00.000Z',
        },
        error: null,
      },
    }) as any;

    await expect(createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1', studentId: 'student-1', email: 'student@example.com',
    })).resolves.toEqual({
      reference: 'sub-stale-ref', authorizationUrl: 'https://checkout.paystack.com/sub-stale-ref',
    });
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('blocks another checkout while a payment is under reconciliation', async () => {
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1',
          student_id: 'student-1',
          amount: 300,
          currency: 'GHS',
          status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: {
        data: {
          id: 'transaction-1',
          reference: 'sub-review-ref',
          authorization_url: 'https://checkout.paystack.com/sub-review-ref',
          amount: 300,
          currency: 'GHS',
          status: 'needs_review',
          updated_at: new Date().toISOString(),
        },
        error: null,
      },
    }) as any;

    await expect(createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    })).rejects.toThrow('under review');
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('does not reuse a checkout escalated during a concurrent insert', async () => {
    const db = makeSupabaseStub({
      subscription_payment_requests: {
        data: {
          id: 'request-1',
          student_id: 'student-1',
          plan_id: 'plan-1',
          plan_name: 'Professional',
          duration_months: 3,
          amount: 300,
          currency: 'GHS',
          status: 'pending',
        },
        error: null,
      },
      paystack_subscription_transactions: [
        { data: null, error: null },
        { data: null, error: { code: '23505', message: 'duplicate key value' } },
        {
          data: {
            id: 'transaction-review',
            reference: 'sub-review-ref',
            authorization_url: 'https://checkout.paystack.com/sub-review-ref',
            amount: 300,
            currency: 'GHS',
            status: 'needs_review',
            updated_at: new Date().toISOString(),
          },
          error: null,
        },
      ],
    }) as any;

    await expect(createPaystackSubscriptionCheckout(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    })).rejects.toThrow('under review');
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });
});

describe('Paystack subscription processing helper', () => {
  it('ignores a reference that does not belong to this integration', async () => {
    const db = makeSupabaseStub({
      paystack_subscription_transactions: { data: null, error: null },
    }) as any;

    await expect(processPaystackSubscriptionReference(db, 'unrelated-ref')).resolves.toMatchObject({
      ok: true,
      status: 'ignored',
      skipped: true,
      reason: 'unknown_reference',
    });
    expect(verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  it('records reconciliation when a verified payment request is no longer open', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success',
      amount: 300,
      currency: 'GHS',
      transactionId: 42,
      raw: {},
    });
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-paid-ref',
            request_id: 'request-1',
            student_id: 'student-1',
            plan_id: 'plan-1',
            duration_months: 3,
            amount: 300,
            currency: 'GHS',
            processed_payment_id: null,
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }, (fn) => {
      expect(fn).toBe('finalize_paystack_subscription_transaction');
      return {
        data: { status: 'needs_review', reason: 'payment_request_not_open' },
        error: null,
      };
    }) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-paid-ref')).resolves.toMatchObject({
      status: 'needs_review',
      skipped: true,
      reason: 'payment_request_not_open',
    });
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('delegates successful crediting and transaction linkage to one database RPC', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success',
      amount: 300,
      currency: 'GHS',
      transactionId: 44,
      channel: 'card',
      raw: {},
    });
    const rpc = vi.fn(() => ({
      data: {
        status: 'success',
        paymentId: 'payment-1',
        subscriptionId: 'subscription-1',
        alreadyProcessed: false,
      },
      error: null,
    }));
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-success-ref',
            request_id: 'request-1',
            amount: 300,
            currency: 'GHS',
            processed_payment_id: null,
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }, rpc) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-success-ref')).resolves.toMatchObject({
      status: 'success',
      paymentId: 'payment-1',
      subscriptionId: 'subscription-1',
    });
    expect(rpc).toHaveBeenCalledWith('finalize_paystack_subscription_transaction', expect.objectContaining({
      p_reference: 'sub-success-ref',
    }));
  });

  it('records reconciliation when Paystack verifies different payment terms', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success',
      amount: 200,
      currency: 'GHS',
      transactionId: 43,
      raw: {},
    });
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-mismatch-ref',
            request_id: 'request-1',
            amount: 300,
            currency: 'GHS',
            processed_payment_id: null,
          },
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
      ],
    }, (fn) => {
      expect(fn).toBe('open_paystack_transaction_incident');
      return { data: { id: 'incident-1', status: 'needs_review' }, error: null };
    }) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-mismatch-ref')).resolves.toMatchObject({
      ok: false,
      status: 'needs_review',
      reason: 'amount_or_currency_mismatch',
    });
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('preserves a non-terminal Paystack status without enabling credit', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'pending',
      amount: 300,
      currency: 'GHS',
      transactionId: 45,
      raw: {},
    });
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-pending-ref',
            request_id: 'request-1',
            amount: 300,
            currency: 'GHS',
            processed_payment_id: null,
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-pending-ref')).resolves.toMatchObject({
      ok: true,
      status: 'pending',
    });
  });

  // Reversals are a person's call now. Verifying a credited transaction that Paystack reports
  // as reversed must report what it found and change nothing: no access revoked, no payment
  // relabelled, no lifecycle RPC.
  it('does not act on a reversal found while verifying a credited transaction', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'reversed', amount: 300, currency: 'GHS', transactionId: 46,
    });
    const rpc = vi.fn();
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-reversed-ref', request_id: 'request-1', amount: 300, currency: 'GHS',
            status: 'success', processed_payment_id: 'payment-1',
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }, rpc) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-reversed-ref')).resolves.toMatchObject({
      status: 'success', paymentId: 'payment-1', alreadyProcessed: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('delegates the pre-credit incident interlock to the finalizer', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success', amount: 300, currency: 'GHS', transactionId: 50,
    });
    const rpc = vi.fn((fn: string, args: any) => {
      expect(fn).toBe('finalize_paystack_subscription_transaction');
      expect(args.p_enforce_incidents).toBe(true);
      return { data: { status: 'needs_review', reason: 'open_review_incident' }, error: null };
    });
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-precredit-dispute', amount: 300, currency: 'GHS', status: 'pending',
            processed_payment_id: null,
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }, rpc) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-precredit-dispute')).resolves.toMatchObject({
      status: 'needs_review', skipped: true, reason: 'open_review_incident',
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('does not clear a refund or dispute state when charge verification still says success', async () => {
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success', amount: 300, currency: 'GHS', transactionId: 49,
    });
    const db = makeSupabaseStub({
      paystack_subscription_transactions: [
        {
          data: {
            reference: 'sub-refunded-ref', amount: 300, currency: 'GHS', status: 'reversed',
            processed_payment_id: 'payment-1',
          },
          error: null,
        },
        { data: null, error: null },
      ],
    }) as any;

    await expect(processPaystackSubscriptionReference(db, 'sub-refunded-ref')).resolves.toMatchObject({
      status: 'reversed', paymentId: 'payment-1', alreadyProcessed: true,
    });
  });
});
