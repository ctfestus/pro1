import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializePaystackTransaction, PaystackApiError, verifyPaystackTransaction } from '@/lib/paystack';

// A hung provider call is the failure that costs a whole serverless invocation, and the hourly
// sweep makes up to 25 in a row. Two things are load-bearing: that a bound is attached at all,
// and the status the resulting error carries. Two callers branch on that status, and both must
// read "we never heard back" as telling them nothing about the transaction, not as a rejection.

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_example';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Rejects the way an aborted fetch does, without waiting out the real timer. */
function abortingFetch() {
  return vi.fn(async () => {
    const error: any = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    throw error;
  });
}

describe('Paystack provider timeouts', () => {
  it('attaches an abort bound to verification and initialization', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: true, data: { status: 'success', reference: 'sub-ref', amount: 30000, currency: 'GHS', authorization_url: 'https://checkout.test/x' } }) }));
    globalThis.fetch = fetchMock as any;

    await verifyPaystackTransaction('sub-ref');
    await initializePaystackTransaction({ email: 'l@example.com', amount: 300, currency: 'GHS', reference: 'sub-ref' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as any[]) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  // The status is the part that changes behaviour. createPaystackSubscriptionCheckout marks a
  // transaction failed on 4xx and releases a stale checkout on 404. A timeout means Paystack may
  // well have created the transaction, so it must match neither branch.
  it('maps an abort to a status meaning neither rejected nor not-found', async () => {
    globalThis.fetch = abortingFetch() as any;
    const error: any = await verifyPaystackTransaction('sub-ref').catch(e => e);

    expect(error).toBeInstanceOf(PaystackApiError);
    expect(error.status).not.toBe(404);
    expect(error.status >= 400 && error.status < 500).toBe(false);
  });

  it('maps an aborted initialization the same way', async () => {
    globalThis.fetch = abortingFetch() as any;
    const error: any = await initializePaystackTransaction({
      email: 'l@example.com', amount: 300, currency: 'GHS', reference: 'sub-ref',
    }).catch(e => e);

    expect(error).toBeInstanceOf(PaystackApiError);
    expect(error.status >= 400 && error.status < 500).toBe(false);
  });
});
