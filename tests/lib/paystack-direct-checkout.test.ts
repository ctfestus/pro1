import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializePaystackTransaction = vi.hoisted(() => vi.fn());
const makePaystackReference = vi.hoisted(() => vi.fn());
const paystackCallbackUrl = vi.hoisted(() => vi.fn());
const verifyPaystackTransaction = vi.hoisted(() => vi.fn());
const PaystackApiError = vi.hoisted(() => class PaystackApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
});

vi.mock('@/lib/paystack', () => ({
  initializePaystackTransaction, makePaystackReference, paystackCallbackUrl,
  verifyPaystackTransaction, PaystackApiError,
}));

import { createPaystackDirectCheckout } from '@/lib/paystack-subscriptions';
import { PaymentError } from '@/lib/payment-errors';

const PRICE = {
  studentId: 'student-1', email: 'learner@example.com', planId: 'plan-1',
  planName: 'Pro', durationMonths: 3, amount: 300, currency: 'GHS',
};

/**
 * Reservation is a single database call on purpose, so what this asserts is the contract with it:
 * the arguments handed over, and that its answer is honoured. Whether the reservation itself is
 * safe under two concurrent tabs is a property of the SQL, asserted in the schema tests.
 */
function stubDb(rpcResult: any, laterResults: any[] = [], readRow: any = null, finalizeResult: any = null) {
  const queue = [rpcResult, ...laterResults];
  const rpc = vi.fn((fn: string) => {
    // Reservation and crediting are different questions; answering both with the same payload
    // made the recovery tests pass for the wrong reason.
    if (fn === 'finalize_paystack_subscription_transaction') {
      return Promise.resolve({ data: finalizeResult, error: null });
    }
    return Promise.resolve({ data: queue.length > 1 ? queue.shift() : queue[0], error: null });
  });
  const writes: Array<Record<string, any>> = [];
  const chain = (): any => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve({ data: readRow, error: null });
        return (p as any)[prop].bind(p);
      }
      if (prop === 'update' || prop === 'insert') {
        return (values: any) => { writes.push(values); return chain(); };
      }
      return () => chain();
    },
    apply: () => chain(),
  });
  return { rpc, writes, db: { rpc, from: () => chain() } as any };
}

beforeEach(() => {
  vi.clearAllMocks();
  makePaystackReference.mockReturnValue('sub-new');
  paystackCallbackUrl.mockReturnValue('https://app.test/student?paystack_reference=sub-new');
  initializePaystackTransaction.mockResolvedValue({
    reference: 'sub-new', authorizationUrl: 'https://checkout.paystack.com/sub-new',
  });
});

describe('direct Paystack checkout', () => {
  it('reserves the checkout in one call, with no payment request attached', async () => {
    const { db, rpc } = stubDb({ status: 'created', reference: 'sub-new' });

    await expect(createPaystackDirectCheckout(db, PRICE)).resolves.toMatchObject({
      kind: 'checkout',
      authorizationUrl: 'https://checkout.paystack.com/sub-new',
    });
    expect(rpc).toHaveBeenCalledWith('open_paystack_direct_checkout', expect.objectContaining({
      p_student_id: 'student-1',
      p_reference: 'sub-new',
      p_plan_id: 'plan-1',
      p_duration_months: 3,
      p_amount: 300,
      p_currency: 'GHS',
    }));
  });

  // A learner who already has a checkout gets the same link back. Creating a second one is how
  // two payable links came to exist: the lock is released before the caller reaches Paystack, so a
  // replace-then-insert let both tabs come back holding one.
  it('returns the checkout already open instead of starting another', async () => {
    const { db } = stubDb({
      status: 'existing', reference: 'sub-old',
      authorizationUrl: 'https://checkout.paystack.com/sub-old',
    });

    await expect(createPaystackDirectCheckout(db, PRICE)).resolves.toEqual({
      kind: 'checkout',
      reference: 'sub-old',
      authorizationUrl: 'https://checkout.paystack.com/sub-old',
    });
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('asks the learner to clear a checkout for a different plan first', async () => {
    const { db } = stubDb({ status: 'payment_in_progress', blockingStatus: 'initialized' });

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toThrow(/remove it/i);
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  // The payment request used to make this safe by being one-per-learner. Without it, this refusal
  // is the only thing stopping a learner with two tabs open from paying twice.
  it('refuses when the reservation reports a payment already in progress', async () => {
    const { db } = stubDb({ status: 'payment_in_progress', blockingStatus: 'pending' });

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toBeInstanceOf(PaymentError);
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  // Disabling a button in the browser stops nobody with a stale tab, a second device, or a direct
  // API call. Starting Paystack while a bank transfer is outstanding is how a learner pays twice.
  it('refuses while a genuine payment request is open', async () => {
    const { db } = stubDb({ status: 'open_request', requestStatus: 'pending' });

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toThrow(/awaiting confirmation/i);
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  // The lock is released the moment reservation returns, and the first tab then spends a second
  // or two talking to Paystack with its row still link-less. A second tab arriving in that gap
  // must wait -- treating the row as unverified let it ask Paystack, get a 404 only because the
  // first tab had not finished, release that row and start its own, leaving two payable links.
  it('makes a second tab wait while the first is still initializing', async () => {
    const { db } = stubDb({ status: 'payment_in_progress', blockingStatus: 'initializing' });

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toThrow(/being prepared/i);
    expect(verifyPaystackTransaction).not.toHaveBeenCalled();
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  // A provider timeout leaves the row initialized with no link on purpose -- we cannot know what
  // Paystack did. Treating that as live locked the learner out for good, so Paystack is asked.
  it('recovers a checkout Paystack never created', async () => {
    const { db, rpc } = stubDb(
      { status: 'unverified', reference: 'sub-stuck' },
      [{ status: 'created', reference: 'sub-new' }],
    );
    verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(404, 'not found'));

    await expect(createPaystackDirectCheckout(db, PRICE)).resolves.toMatchObject({
      kind: 'checkout',
      authorizationUrl: 'https://checkout.paystack.com/sub-new',
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  // Recovery can discover Paystack already took the money. Crediting them and then reporting an
  // error left the page stale and invited a second payment for access they now own.
  it('reports a stuck checkout that had already been paid as settled', async () => {
    const { db } = stubDb(
      { status: 'unverified', reference: 'sub-paid' },
      [],
      {
        reference: 'sub-paid', amount: 300, currency: 'GHS', status: 'initialized',
        processed_payment_id: null, request_id: null,
      },
      { ok: true, status: 'success', paymentId: 'payment-1', subscriptionId: 'sub-1' },
    );
    verifyPaystackTransaction.mockResolvedValue({
      status: 'success', amount: 300, currency: 'GHS', transactionId: 9,
    });

    const outcome = await createPaystackDirectCheckout(db, PRICE);
    expect(outcome).toMatchObject({ kind: 'settled', reference: 'sub-paid' });
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('does not start a second checkout when the stuck one turns out to be real', async () => {
    // A real transaction the provider still calls pending: processing leaves it pending, so the
    // learner is told to wait rather than being handed a second thing to pay.
    const { db } = stubDb({ status: 'unverified', reference: 'sub-stuck' }, [], {
      reference: 'sub-stuck', amount: 300, currency: 'GHS', status: 'initialized',
      processed_payment_id: null, request_id: null,
    });
    verifyPaystackTransaction.mockResolvedValue({
      status: 'pending', amount: 300, currency: 'GHS', transactionId: 7,
    });

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toBeInstanceOf(PaymentError);
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
  });

  // The recovery path reserves again, so it has to be capped or a database that keeps answering
  // 'unverified' would loop, calling Paystack every time round.
  it('gives up rather than looping when recovery does not settle it', async () => {
    const { db, rpc } = stubDb({ status: 'unverified', reference: 'sub-stuck' });
    verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(404, 'not found'));

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toBeInstanceOf(PaymentError);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('stores the checkout link against the reserved reference', async () => {
    const { db, writes } = stubDb({ status: 'created', reference: 'sub-new' });

    await createPaystackDirectCheckout(db, PRICE);
    expect(writes.some(w => w.authorization_url === 'https://checkout.paystack.com/sub-new')).toBe(true);
  });

  // Paystack rejecting the request means no checkout exists there, so the reserved row must not
  // sit in the way of the learner trying again.
  it('releases the reservation when Paystack rejects the request', async () => {
    const { db, writes } = stubDb({ status: 'created', reference: 'sub-new' });
    initializePaystackTransaction.mockRejectedValue(new PaystackApiError(400, 'bad request'));

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toBeTruthy();
    expect(writes.some(w => w.status === 'failed')).toBe(true);
  });

  // A timeout says nothing about whether Paystack created the checkout, so the reservation stays
  // put rather than being freed for a second attempt that could become a second payment.
  it('keeps the reservation when the provider call times out', async () => {
    const { db, writes } = stubDb({ status: 'created', reference: 'sub-new' });
    initializePaystackTransaction.mockRejectedValue(new PaystackApiError(504, 'timed out'));

    await expect(createPaystackDirectCheckout(db, PRICE)).rejects.toBeTruthy();
    expect(writes.some(w => w.status === 'failed')).toBe(false);
  });
});
