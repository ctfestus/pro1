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

import { settleUnfinishedCheckout } from '@/lib/paystack-subscriptions';

/** Returns one transaction row for reads and swallows writes, so the real code path can run. */
function stubDb(transaction: any, rpcResult: any = null) {
  const rpc = vi.fn(() => Promise.resolve({ data: rpcResult, error: null }));
  const chain = (): any => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve({ data: transaction, error: null });
        return (p as any)[prop].bind(p);
      }
      return () => chain();
    },
    apply: () => chain(),
  });
  return { rpc, db: { rpc, from: () => chain() } as any };
}

const TRANSACTION = {
  reference: 'sub-a', amount: 300, currency: 'GHS', status: 'initialized',
  processed_payment_id: null, request_id: null,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// Releasing a checkout frees the learner to buy again. Doing that on anything short of proof it
// collected nothing is how somebody pays twice for one subscription.
describe('settling an unfinished checkout', () => {
  it('releases only on an explicit terminal failure', async () => {
    for (const status of ['failed', 'abandoned', 'reversed']) {
      verifyPaystackTransaction.mockResolvedValue({ status, amount: 300, currency: 'GHS' });
      const { db } = stubDb(TRANSACTION);
      await expect(settleUnfinishedCheckout(db, 'sub-a')).resolves.toEqual({ abandoned: true });
    }
  });

  it('releases when Paystack has never heard of the reference', async () => {
    verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(404, 'not found'));
    const { db } = stubDb(TRANSACTION);
    await expect(settleUnfinishedCheckout(db, 'sub-a')).resolves.toEqual({ abandoned: true });
  });

  // Silence is not evidence. An empty or unrecognised status used to release the checkout, which
  // permitted clearing one Paystack may well have charged.
  it('refuses to release on a blank status', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: '', amount: 300, currency: 'GHS' });
    const { db } = stubDb(TRANSACTION);
    await expect(settleUnfinishedCheckout(db, 'sub-a')).resolves.toEqual({ abandoned: false, result: null });
  });

  it('refuses to release on a status it does not recognise', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'something_new', amount: 300, currency: 'GHS' });
    const { db } = stubDb(TRANSACTION);
    await expect(settleUnfinishedCheckout(db, 'sub-a')).resolves.toEqual({ abandoned: false, result: null });
  });

  // A payment discovered here has to be applied, not merely noticed: if the webhook and the
  // callback were both missed, this is the only thing that will credit it.
  it('credits a success it discovers rather than reporting it', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'success', amount: 300, currency: 'GHS', transactionId: 5 });
    const { db, rpc } = stubDb(TRANSACTION, { ok: true, status: 'success', paymentId: 'payment-1' });

    const settled = await settleUnfinishedCheckout(db, 'sub-a');
    expect(settled.abandoned).toBe(false);
    expect(rpc).toHaveBeenCalledWith('finalize_paystack_subscription_transaction', expect.anything());
  });

  it('does not release one the provider still calls pending', async () => {
    verifyPaystackTransaction.mockResolvedValue({ status: 'pending', amount: 300, currency: 'GHS' });
    const { db } = stubDb(TRANSACTION);
    await expect(settleUnfinishedCheckout(db, 'sub-a')).resolves.toMatchObject({ abandoned: false });
  });
});
