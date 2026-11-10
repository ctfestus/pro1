import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';

const paystack = vi.hoisted(() => ({
  verifyPaystackTransaction: vi.fn(),
  initializePaystackTransaction: vi.fn(),
  sendReceipt: vi.fn(),
}));
vi.mock('@/lib/paystack', async (orig) => ({
  ...(await orig<typeof import('@/lib/paystack')>()),
  verifyPaystackTransaction: paystack.verifyPaystackTransaction,
  initializePaystackTransaction: paystack.initializePaystackTransaction,
  paystackBookCallbackUrl: (ref: string) => `https://app.test/student?book_reference=${ref}#books`,
}));

import { PaystackApiError } from '@/lib/paystack';
vi.mock('@/lib/books/receipt-email', () => ({ sendBookPurchaseReceipt: paystack.sendReceipt }));
import { isBookReference, settleBookPurchase, startBookCheckout, sweepBookPurchases } from '@/lib/books/purchases';

type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

function recording(base: any) {
  const wrap = (builder: any, table: string): any => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
      return (...args: unknown[]) => {
        calls.push({ table, method: String(prop), args });
        return wrap(target[prop](...args), table);
      };
    },
  });
  return { ...base, from: (table: string) => wrap(base.from(table), table) };
}
const callsTo = (table: string, method: string) => calls.filter(c => c.table === table && c.method === method);

function makeDb(purchases: QueryResult | QueryResult[], rpc?: (fn: string, args: any) => QueryResult) {
  return recording(makeSupabaseStub({ book_purchases: purchases }, rpc)) as any;
}

const verified = (status: string, amount = 50, currency = 'GHS') =>
  ({ status, reference: 'book-1', amount, currency, transactionId: 777 });

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

describe('isBookReference', () => {
  it('recognises only book references', () => {
    expect(isBookReference('book-abc')).toBe(true);
    expect(isBookReference('sub-abc')).toBe(false);
    expect(isBookReference(null)).toBe(false);
  });
});

describe('settleBookPurchase', () => {
  it('fulfils a successful charge through the locked database function', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('success'));
    const rpc = vi.fn(() => ({ data: { status: 'paid', purchaseId: 'p1', bookId: 'b1', alreadyProcessed: false }, error: null }));
    const db = makeDb({ data: { id: 'p1', book_id: 'b1', status: 'pending' } }, rpc);
    await expect(settleBookPurchase(db, 'book-1')).resolves.toEqual({ status: 'paid', purchaseId: 'p1', bookId: 'b1', alreadyProcessed: false });
    expect(rpc).toHaveBeenCalledWith('fulfil_book_purchase', { p_reference: 'book-1', p_amount: 50, p_currency: 'GHS', p_transaction_id: 777 });
  });

  it('does not ask Paystack again about a purchase already settled', async () => {
    const db = makeDb({ data: { id: 'p1', book_id: 'b1', status: 'paid' } });
    await expect(settleBookPurchase(db, 'book-1')).resolves.toMatchObject({ status: 'paid', alreadyProcessed: true });
    expect(paystack.verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  it('closes a checkout Paystack says failed, but leaves an abandoned one open', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('failed'));
    let db = makeDb({ data: { id: 'p1', book_id: 'b1', status: 'pending' } });
    await expect(settleBookPurchase(db, 'book-1')).resolves.toEqual({ status: 'unpaid', providerStatus: 'failed' });
    expect(callsTo('book_purchases', 'update')).toEqual([{ table: 'book_purchases', method: 'update', args: [{ status: 'failed' }] }]);

    calls = [];
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('abandoned'));
    db = makeDb({ data: { id: 'p1', book_id: 'b1', status: 'pending' } });
    await expect(settleBookPurchase(db, 'book-1')).resolves.toEqual({ status: 'unpaid', providerStatus: 'abandoned' });
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
  });

  it('reports an unknown reference without calling Paystack', async () => {
    const db = makeDb({ data: null });
    await expect(settleBookPurchase(db, 'book-x')).resolves.toEqual({ status: 'unknown' });
    expect(paystack.verifyPaystackTransaction).not.toHaveBeenCalled();
  });
});

describe('startBookCheckout', () => {
  const input = {
    studentId: 's1', email: 'buyer@example.test', amount: 50, currency: 'GHS',
    book: { id: 'b1', title: 'SQL', royalty_pct: 20 },
  };
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

  it('hands back the same link for a recent open checkout at the same price', async () => {
    const db = makeDb({ data: { id: 'p1', paystack_reference: 'book-1', authorization_url: 'https://pay.test/1', amount: 50, currency: 'GHS', created_at: minutesAgo(5) } });
    await expect(startBookCheckout(db, input)).resolves.toEqual({ kind: 'checkout', reference: 'book-1', authorizationUrl: 'https://pay.test/1' });
    expect(paystack.initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('asks the buyer to wait while a checkout is still being created', async () => {
    const db = makeDb({ data: { id: 'p1', paystack_reference: 'book-1', authorization_url: null, amount: 50, currency: 'GHS', created_at: minutesAgo(0) } });
    await expect(startBookCheckout(db, input)).rejects.toMatchObject({ status: 409 });
  });

  it('replaces a stale unpaid checkout with a new one', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('abandoned'));
    paystack.initializePaystackTransaction.mockResolvedValue({ authorizationUrl: 'https://pay.test/2', reference: 'x' });
    const db = makeDb([
      { data: { id: 'p1', paystack_reference: 'book-1', authorization_url: 'https://pay.test/1', amount: 50, currency: 'GHS', created_at: minutesAgo(45) } },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } }, // settle reads the row
      { data: null },                                            // close the old one
      { data: null },                                            // no open checkout now
      { data: { id: 'p2' } },                                    // insert
      { data: null },                                            // save the link
    ]);
    const out = await startBookCheckout(db, input);
    expect(out).toMatchObject({ kind: 'checkout', authorizationUrl: 'https://pay.test/2' });
    expect(out.reference.startsWith('book-')).toBe(true);
    expect(callsTo('book_purchases', 'insert')[0].args[0]).toMatchObject({
      student_id: 's1', book_id: 'b1', book_title: 'SQL', amount: 50, currency: 'GHS', royalty_pct: 20,
    });
    const init = paystack.initializePaystackTransaction.mock.calls[0][0];
    expect(init).toMatchObject({ email: 'buyer@example.test', amount: 50, currency: 'GHS', metadata: { kind: 'book_purchase', purchase_id: 'p2', book_id: 'b1' } });
    expect(init.callbackUrl).toContain('book_reference=book-');
  });

  it('reports a stale checkout that was in fact paid, instead of charging again', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('success'));
    const rpc = vi.fn(() => ({ data: { status: 'paid', purchaseId: 'p1', bookId: 'b1' }, error: null }));
    const db = makeDb([
      { data: { id: 'p1', paystack_reference: 'book-1', authorization_url: 'https://pay.test/1', amount: 50, currency: 'GHS', created_at: minutesAgo(45) } },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },
    ], rpc);
    await expect(startBookCheckout(db, input)).resolves.toEqual({ kind: 'settled', reference: 'book-1', status: 'paid' });
    expect(paystack.initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('refuses to replace a checkout Paystack is still processing, so nobody pays twice', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('ongoing'));
    const db = makeDb([
      { data: { id: 'p1', paystack_reference: 'book-1', authorization_url: 'https://pay.test/1', amount: 40, currency: 'GHS', created_at: minutesAgo(5) } },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },
    ]);
    // The price changed since, so the old link is not reusable -- but it must not be closed either.
    await expect(startBookCheckout(db, input)).rejects.toMatchObject({ status: 409 });
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
    expect(paystack.initializePaystackTransaction).not.toHaveBeenCalled();
  });

  it('frees a checkout whose creation never reached Paystack (verify says reference not found)', async () => {
    paystack.verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(400, 'Transaction reference not found'));
    paystack.initializePaystackTransaction.mockResolvedValue({ authorizationUrl: 'https://pay.test/2', reference: 'x' });
    const db = makeDb([
      { data: { id: 'p1', paystack_reference: 'book-1', authorization_url: null, amount: 50, currency: 'GHS', created_at: minutesAgo(10) } },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },
      { data: null }, { data: null }, { data: { id: 'p2' } }, { data: null },
    ]);
    await expect(startBookCheckout(db, input)).resolves.toMatchObject({ kind: 'checkout', authorizationUrl: 'https://pay.test/2' });
  });

  it('does not treat a 400 as not-created when the checkout had a link', async () => {
    paystack.verifyPaystackTransaction.mockRejectedValue(new PaystackApiError(400, 'odd'));
    const db = makeDb([
      { data: { id: 'p1', paystack_reference: 'book-1', authorization_url: 'https://pay.test/1', amount: 50, currency: 'GHS', created_at: minutesAgo(45) } },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },
    ]);
    await expect(startBookCheckout(db, input)).rejects.toBeInstanceOf(PaystackApiError);
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
  });

  it('closes the row when Paystack refuses to create the transaction', async () => {
    paystack.initializePaystackTransaction.mockRejectedValue(new PaystackApiError(400, 'bad currency'));
    const db = makeDb([{ data: null }, { data: { id: 'p2' } }, { data: null }]);
    await expect(startBookCheckout(db, input)).rejects.toBeInstanceOf(PaystackApiError);
    expect(callsTo('book_purchases', 'update')).toEqual([{ table: 'book_purchases', method: 'update', args: [{ status: 'failed' }] }]);
  });

  it('leaves the row on a timeout, since Paystack may have created it', async () => {
    paystack.initializePaystackTransaction.mockRejectedValue(new PaystackApiError(504, 'timed out'));
    const db = makeDb([{ data: null }, { data: { id: 'p2' } }]);
    await expect(startBookCheckout(db, input)).rejects.toBeInstanceOf(PaystackApiError);
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
  });

  it('turns a race with another tab into a retryable 409', async () => {
    const db = makeDb([{ data: null }, { data: null, error: { code: '23505', message: 'duplicate' } }]);
    await expect(startBookCheckout(db, input)).rejects.toMatchObject({ status: 409 });
    expect(paystack.initializePaystackTransaction).not.toHaveBeenCalled();
  });
});

describe('sweepBookPurchases', () => {
  it('settles open checkouts and resends missing receipts', async () => {
    paystack.verifyPaystackTransaction.mockResolvedValue(verified('success'));
    paystack.sendReceipt.mockResolvedValue({ sent: true });
    const rpc = vi.fn(() => ({ data: { status: 'paid', purchaseId: 'p1', bookId: 'b1' }, error: null }));
    const db = makeDb([
      { data: [{ id: 'p1', paystack_reference: 'book-1' }] },  // open checkouts (signed-in queue)
      { data: [] },                                              // open checkouts (guest queue)
      { data: null },                                            // stamp last_checked_at
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },  // settle reads the row
      { data: [{ id: 'p1' }, { id: 'p9' }] },                    // sales paid without receipt
      { data: [] },                                              // free claims without their email
    ], rpc);
    await expect(sweepBookPurchases(db)).resolves.toEqual({ settled: 1, receipts: 2, failed: 0 });
    expect(paystack.sendReceipt).toHaveBeenCalledWith(db, 'p9');
    expect(callsTo('book_purchases', 'eq')).toContainEqual({ table: 'book_purchases', method: 'eq', args: ['status', 'pending'] });
    // Sales receipts and free-claim emails are separate queues, sales first.
    const kinds = callsTo('book_purchases', 'eq').filter(c => c.args[0] === 'kind').map(c => c.args[1]);
    expect(kinds).toEqual(['sale', 'free_claim']);
    // Rotates: least recently checked first, and every check is stamped.
    expect(callsTo('book_purchases', 'order')[0].args).toEqual(['last_checked_at', { ascending: true, nullsFirst: true }]);
    expect(callsTo('book_purchases', 'update')[0].args[0]).toHaveProperty('last_checked_at');
  });

  it('keeps going past one failure', async () => {
    paystack.verifyPaystackTransaction.mockRejectedValue(new Error('down'));
    paystack.sendReceipt.mockRejectedValue(new Error('mail down'));
    const db = makeDb([
      { data: [{ id: 'p1', paystack_reference: 'book-1' }] },
      { data: [] },
      { data: null },
      { data: { id: 'p1', book_id: 'b1', status: 'pending' } },
      { data: [{ id: 'p2' }] },
      { data: [] },
    ]);
    await expect(sweepBookPurchases(db)).resolves.toEqual({ settled: 0, receipts: 0, failed: 2 });
  });
});
