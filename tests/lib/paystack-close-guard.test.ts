import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyPaystackTransaction = vi.hoisted(() => vi.fn());
const initializePaystackTransaction = vi.hoisted(() => vi.fn());
const makePaystackReference = vi.hoisted(() => vi.fn(() => 'sub-new'));
const paystackCallbackUrl = vi.hoisted(() => vi.fn(() => 'https://app.test/return'));
const PaystackApiError = vi.hoisted(() => class PaystackApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'PaystackApiError'; }
});

vi.mock('@/lib/paystack', () => ({
  verifyPaystackTransaction, initializePaystackTransaction, makePaystackReference,
  paystackCallbackUrl, PaystackApiError,
}));
vi.mock('@/lib/db-subscriptions', () => ({ purchaseOrRenewSubscription: vi.fn() }));

import { assertNothingCollected, createPaystackDirectCheckout } from '@/lib/paystack-subscriptions';

/**
 * Two reads happen on one table: the guard lists candidate references, and settling reads a single
 * row. maybeSingle() is what separates them, so the stub answers on that.
 */
function stubDb(rows: any[], transaction: any, rpcResult: any = null) {
  const filters: Array<[string, any]> = [];
  const writes: any[] = [];
  const rpc = vi.fn(() => Promise.resolve({ data: rpcResult, error: null }));
  const chain = (single: boolean): any => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve({ data: single ? transaction : rows, error: null });
        return (p as any)[prop].bind(p);
      }
      if (prop === 'maybeSingle' || prop === 'single') return () => chain(true);
      if (prop === 'update') return (patch: any) => { writes.push(patch); return chain(single); };
      if (prop === 'eq' || prop === 'in') return (column: string, value: any) => { filters.push([column, value]); return chain(single); };
      return () => chain(single);
    },
    apply: () => chain(single),
  });
  return { rpc, filters, writes, db: { rpc, from: () => chain(false) } as any };
}

const TRANSACTION = {
  reference: 'sub-a', amount: 300, currency: 'GHS', status: 'initialized',
  processed_payment_id: null, request_id: null,
};

/** A checkout the learner could reach: link issued, so initialization is long finished. */
const LISTED = {
  reference: 'sub-a', status: 'initialized', authorization_url: 'https://paystack.test/sub-a',
  updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// Four places close a payment and free the learner to start another: they clear their cart or
// withdraw their own invoice, staff clear a cart or cancel an invoice. This is the single rule all
// four ask, so what it lets through is what somebody can end up paying for twice.
describe('refusing to close a payment that may have collected', () => {
  it('allows closing when there is nothing unsettled in scope', async () => {
    const { db } = stubDb([], TRANSACTION);
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your')).resolves.toBeUndefined();
    expect(verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  it('allows closing a checkout Paystack calls failed', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'failed', amount: 300, currency: 'GHS' });
    const { db } = stubDb([LISTED], TRANSACTION);
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your')).resolves.toBeUndefined();
  });

  // The whole point. Our own row still reads 'initialized' until the webhook lands, so without
  // asking the provider this releases a paid checkout and lets them buy the same thing again.
  it('refuses when Paystack says the payment went through', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'success', amount: 300, currency: 'GHS', transactionId: 7 });
    const { db } = stubDb([LISTED], TRANSACTION, { ok: true, status: 'success', paymentId: 'payment-1' });
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your'))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('Your access has been updated') });
  });

  // Discovered, therefore credited. Noticing a payment and refusing without applying it leaves the
  // learner having paid for access they do not have.
  it('credits the payment it discovers rather than only refusing', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'success', amount: 300, currency: 'GHS', transactionId: 7 });
    const { db, rpc } = stubDb([LISTED], TRANSACTION, { ok: true, status: 'success', paymentId: 'payment-1' });
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Their')).rejects.toThrow();
    expect(rpc).toHaveBeenCalledWith('finalize_paystack_subscription_transaction', expect.anything());
  });

  it('refuses while the provider still calls it pending', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'pending', amount: 300, currency: 'GHS' });
    const { db, writes } = stubDb([LISTED], TRANSACTION, { ok: true, status: 'pending' });
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your'))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('still being processed') });
    // Unlike an untouched checkout session, pending can represent a real bank payment awaiting
    // confirmation. The cancel path must preserve that durable payment state.
    expect(writes).toContainEqual(expect.objectContaining({ status: 'pending' }));
    expect(verifyPaystackTransaction).toHaveBeenCalledOnce();
  });

  it('keeps an untouched ongoing checkout resumable until Paystack abandons it', async () => {
    const transaction = {
      ...TRANSACTION,
      plan_id: 'plan-1',
      plan_name: 'Professional',
      duration_months: 3,
      authorization_url: 'https://paystack.test/sub-a',
      // Older than the direct-checkout reservation's 30-minute link threshold. This must take the
      // unverified recovery branch rather than the ordinary existing-link branch.
      updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    };
    verifyPaystackTransaction
      .mockResolvedValueOnce({ status: 'ongoing', amount: 300, currency: 'GHS' })
      .mockResolvedValueOnce({ status: 'ongoing', amount: 300, currency: 'GHS' })
      .mockResolvedValueOnce({ status: 'ongoing', amount: 300, currency: 'GHS' })
      .mockResolvedValueOnce({ status: 'abandoned', amount: 300, currency: 'GHS' });

    const writes: any[] = [];
    const chain = (patch?: any, filters: Array<[string, string, any]> = []): any => new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          if (patch) {
            const matches = filters.every(([kind, column, value]) => kind === 'eq'
              ? transaction[column as keyof typeof transaction] === value
              : value.includes(transaction[column as keyof typeof transaction]));
            if (matches) { Object.assign(transaction, patch); writes.push(patch); }
          }
          const data = patch ? null : [transaction];
          const promise = Promise.resolve({ data, error: null });
          return (promise as any)[prop].bind(promise);
        }
        if (prop === 'update') return (next: any) => chain(next, []);
        if (prop === 'eq') return (column: string, value: any) => chain(patch, [...filters, ['eq', column, value]]);
        if (prop === 'in') return (column: string, value: any[]) => chain(patch, [...filters, ['in', column, value]]);
        return () => chain(patch, filters);
      },
      apply: () => chain(patch, filters),
    });
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'open_paystack_direct_checkout') {
        if (transaction.status !== 'initialized') {
          return { data: { status: 'payment_in_progress', blockingStatus: transaction.status }, error: null };
        }
        const stale = new Date(transaction.updated_at).getTime() <= Date.now() - 30 * 60 * 1000;
        return stale
          ? { data: { status: 'unverified', reference: transaction.reference, authorizationUrl: transaction.authorization_url }, error: null }
          : { data: { status: 'existing', reference: transaction.reference, authorizationUrl: transaction.authorization_url }, error: null };
      }
      if (fn === 'dismiss_paystack_cart') {
        if (transaction.status !== 'initialized') return { data: { ok: false, status: 'not_dismissable' }, error: null };
        transaction.status = 'abandoned';
        return { data: { ok: true, status: 'dismissed' }, error: null };
      }
      throw new Error(`Unexpected RPC ${fn}`);
    });
    const db = { from: () => chain(), rpc } as any;

    // Remove verifies the real guard and refuses while the provider calls the customer session
    // ongoing, but that transient answer must not replace our initialized cart state.
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your'))
      .rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/still open at Paystack.*Continue/),
      });
    expect(transaction.status).toBe('initialized');
    expect(writes).toEqual([]);

    // Continue and a later refresh both cross stale-link recovery and recover the same reference
    // rather than persisting ongoing or minting another.
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(createPaystackDirectCheckout(db, {
        studentId: 'student-1', email: 'student@example.com', planId: 'plan-1',
        planName: 'Professional', durationMonths: 3, amount: 300, currency: 'GHS',
      })).resolves.toEqual({
        kind: 'checkout', reference: 'sub-a', authorizationUrl: 'https://paystack.test/sub-a',
      });
    }
    expect(initializePaystackTransaction).not.toHaveBeenCalled();
    expect(transaction.status).toBe('initialized');
    expect(writes).toEqual([]);

    // Once Paystack supplies a terminal no-payment verdict, the guard permits the ordinary
    // dismiss operation and the learner is free to choose again.
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your')).resolves.toBeUndefined();
    expect(transaction.status).toBe('initialized');
    await expect(db.rpc('dismiss_paystack_cart', {})).resolves.toMatchObject({ data: { ok: true } });
    expect(transaction.status).toBe('abandoned');
    expect(verifyPaystackTransaction).toHaveBeenCalledTimes(4);
  });

  // Silence is not evidence that nothing was collected.
  it('refuses on a status it cannot place', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: '', amount: 300, currency: 'GHS' });
    const { db } = stubDb([LISTED], TRANSACTION);
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your')).rejects.toMatchObject({ status: 409 });
  });

  // Cancelling an invoice has to cover every checkout opened against it, not just one reference.
  it('scopes by request when asked about an invoice', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'abandoned', amount: 300, currency: 'GHS' });
    const { db, filters } = stubDb([LISTED, { ...LISTED, reference: 'sub-b' }], TRANSACTION);
    await assertNothingCollected(db, { requestId: 'request-1' }, 'Their');
    expect(filters).toContainEqual(['request_id', 'request-1']);
    // Both of them, so a second checkout on the same invoice cannot slip through.
    expect(verifyPaystackTransaction.mock.calls.map(call => call[0])).toEqual(['sub-a', 'sub-b']);
  });

  // Staff and the learner see the same facts phrased for who is reading.
  it('addresses the reader it was called for', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'success', amount: 300, currency: 'GHS', transactionId: 7 });
    const { db } = stubDb([LISTED], TRANSACTION, { ok: true, status: 'success', paymentId: 'payment-1' });
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Their'))
      .rejects.toMatchObject({ message: expect.stringContaining('Their access has been updated') });
  });

  // The row is inserted before Paystack is called, so for a few seconds there is a real checkout
  // with no link yet -- and verifying it returns a 404 because nothing exists at the provider yet.
  // Reading that as "nothing was collected" closes a checkout that is about to become payable, and
  // the learner is then handed a link to a transaction nothing will credit.
  it('leaves a checkout that is still being opened alone', async () => {
    const fresh = { reference: 'sub-a', status: 'initialized', authorization_url: null, updated_at: new Date().toISOString() };
    const { db } = stubDb([fresh], TRANSACTION);
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your'))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('still being opened') });
    // Never asked, because a 404 here would have meant the opposite of what it says.
    expect(verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  // Once the initialization is old enough to be dead, the same 404 means what it says.
  it('closes one whose initialization went stale', async () => {
    const stale = {
      reference: 'sub-a', status: 'initialized', authorization_url: null,
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(404, 'not found'));
    const { db } = stubDb([stale], TRANSACTION);
    await expect(assertNothingCollected(db, { reference: 'sub-a' }, 'Your')).resolves.toBeUndefined();
  });

  // Every closer acts on 'initialized'. A checkout stored as 'pending' that Paystack now calls
  // failed was released by nothing: the guard said "safe to close" and the close then refused,
  // leaving the learner blocked behind a payment that had already failed.
  it('records the provider verdict on a row that would otherwise stay stuck', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'failed', amount: 300, currency: 'GHS' });
    const stuck = { ...LISTED, status: 'pending' };
    const { db, writes, filters } = stubDb([stuck], { ...TRANSACTION, status: 'pending' });
    await assertNothingCollected(db, { reference: 'sub-a' }, 'Your');
    expect(writes).toContainEqual(expect.objectContaining({ status: 'failed', processing_error: 'paystack_failed' }));
    expect(filters).toContainEqual(['reference', 'sub-a']);
  });

  // And not on 'initialized'. Clearing a cart needs the row in exactly that status, so rewriting it
  // here would make a learner unable to remove their own.
  it('leaves an initialized row alone so the learner can still clear it', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'abandoned', amount: 300, currency: 'GHS' });
    const { db, filters } = stubDb([LISTED], TRANSACTION);
    await assertNothingCollected(db, { reference: 'sub-a' }, 'Your');
    // Scoped to the statuses nothing else releases. 'initialized' is not among them.
    expect(filters).toContainEqual(['status', ['pending', 'ongoing', 'processing', 'queued']]);
  });
});
