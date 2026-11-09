// Guest checkout (migration 238): buying a product with only an email, then downloading it.
// Written as attacks first: what a stranger, a scanner, a second browser or a refund must not get.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

type Call = { table: string; method: string; args: unknown[] };
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any>,
  rpc: (() => ({ data: null, error: null })) as (fn: string, args: any) => any,
  rpcCalls: [] as { fn: string; args: any }[],
  calls: [] as Call[],
  signed: [] as { path: string; opts: any }[],
  signFail: false,
  after: [] as (() => unknown)[],
}));
const paystack = vi.hoisted(() => ({ init: vi.fn(), verify: vi.fn() }));
const mail = vi.hoisted(() => ({ receipt: vi.fn(), resend: vi.fn() }));

vi.mock('@/lib/admin-client', async () => {
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  const wrap = (builder: any, table: string): any => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
      return (...args: unknown[]) => {
        state.calls.push({ table, method: String(prop), args });
        return wrap(target[prop](...args), table);
      };
    },
  });
  return {
    adminClient: () => {
      const base = makeSupabaseStub(state.tables, (fn, args) => {
        state.rpcCalls.push({ fn, args });
        return state.rpc(fn, args);
      });
      return {
        ...base,
        from: (table: string) => wrap(base.from(table), table),
        storage: {
          from: () => ({
            createSignedUrl: async (path: string, _ttl: number, opts: any) => {
              if (state.signFail) return { data: null, error: new Error('storage down') };
              state.signed.push({ path, opts });
              return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
            },
          }),
        },
      };
    },
  };
});
vi.mock('@/lib/paystack', async (orig) => ({
  ...(await orig<typeof import('@/lib/paystack')>()),
  paystackIsConfigured: () => true,
  initializePaystackTransaction: paystack.init,
  verifyPaystackTransaction: paystack.verify,
}));
vi.mock('@/lib/books/receipt-email', () => ({ sendBookPurchaseReceipt: mail.receipt, resendGuestAccessEmail: mail.resend }));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { state.after.push(fn); },
}));

import { POST as startGuest } from '@/app/api/books/guest-checkout/route';
import { POST as confirmGuest } from '@/app/api/books/guest-checkout/confirm/route';
import { POST as accessInfo } from '@/app/api/books/guest-access/route';
import { POST as download } from '@/app/api/books/guest-access/download/route';
import { POST as openHtml } from '@/app/api/books/guest-access/open/route';
import { POST as resendLink } from '@/app/api/books/guest-access/resend/route';
import { guestAccessToken, hashReturnCode, newReturnCode } from '@/lib/books/guest-access';
import { verifyHtmlTicket } from '@/lib/books/html-ticket';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const PURCHASE = '33333333-3333-4333-8333-333333333333';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE = `${BOOK_ID}/file-${U}.html`;
const BOOK = {
  id: BOOK_ID, slug: 'field-guide-1a2b', title: 'Field Guide', status: 'published', purchasable: true,
  license_expires_at: null, format: 'html', file_path: FILE, royalty_pct: 10, cover_image: null,
};
const PRICE = { data: [{ currency: 'GHS', amount: '120.00', sale_amount: null, sale_ends_at: null }] };
const FUTURE = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const paidPurchase = (extra: Record<string, unknown> = {}) => ({
  id: PURCHASE, book_id: BOOK_ID, status: 'paid', is_guest: true,
  guest_access_expires_at: FUTURE(), guest_downloads_used: 0, ...extra,
});

const post = (handler: (req: NextRequest) => Promise<Response>, body: unknown) =>
  handler(new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) }));
const callsTo = (table: string, method: string) => state.calls.filter(c => c.table === table && c.method === method);
const rpcNames = () => state.rpcCalls.map(c => c.fn);

const ORIGINAL_SECRET = process.env.BOOK_GUEST_ACCESS_SECRET;
beforeEach(() => {
  process.env.BOOK_GUEST_ACCESS_SECRET = 'guest-test-secret';
  state.tables = {};
  state.rpc = () => ({ data: null, error: null });
  state.rpcCalls = [];
  state.calls = [];
  state.signed = [];
  state.signFail = false;
  state.after = [];
  vi.clearAllMocks();
  paystack.init.mockResolvedValue({ authorizationUrl: 'https://paystack.test/new' });
});
afterEach(() => { process.env.BOOK_GUEST_ACCESS_SECRET = ORIGINAL_SECRET; });

describe('POST /api/books/guest-checkout', () => {
  const start = (extra: Record<string, unknown> = {}) =>
    post(startGuest, { bookId: BOOK_ID, email: ' Buyer@Example.TEST ', currency: 'GHS', expectedAmount: 120, ...extra });

  it('opens a guest purchase with no account, the email lowercased, and only a hash of the return code', async () => {
    state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: { data: { id: 'p-new' } } };
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorizationUrl).toBe('https://paystack.test/new');
    const row = callsTo('book_purchases', 'insert')[0].args[0] as any;
    expect(row).toMatchObject({ student_id: null, is_guest: true, guest_email: 'buyer@example.test', amount: 120, currency: 'GHS' });
    expect(row.guest_return_hash).toBe(hashReturnCode(body.returnCode));
    expect(JSON.stringify(row)).not.toContain(body.returnCode);
    expect(paystack.init.mock.calls[0][0]).toMatchObject({ email: 'buyer@example.test', amount: 120 });
    expect(paystack.init.mock.calls[0][0].callbackUrl).toContain(`/products/${BOOK.slug}?guest_reference=`);
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['an archived product', { status: 'archived' }],
    ['a product not for sale (cohort-only or free)', { purchasable: false }],
    ['an expired licence', { license_expires_at: '2020-01-01T00:00:00Z' }],
    ["a file that is not this product's", { file_path: `22222222-2222-4222-8222-222222222222/file-${U}.html` }],
  ])('refuses %s and charges nothing', async (_label, extra) => {
    state.tables = { books: { data: { ...BOOK, ...extra } }, book_prices: PRICE, book_purchases: { data: { id: 'p-new' } } };
    expect((await start()).status).toBeGreaterThanOrEqual(400);
    expect(paystack.init).not.toHaveBeenCalled();
    expect(callsTo('book_purchases', 'insert')).toHaveLength(0);
  });

  it('refuses a free product: free stays sign-in only', async () => {
    state.tables = { books: { data: { ...BOOK, available_to_everyone: true } }, book_prices: PRICE, book_purchases: { data: { id: 'p-new' } } };
    expect((await start()).status).toBe(400);
    expect(paystack.init).not.toHaveBeenCalled();
  });

  it('refuses a product with no price, a bad email, and a stale price', async () => {
    state.tables = { books: { data: BOOK }, book_prices: { data: [] }, book_purchases: { data: { id: 'p-new' } } };
    expect((await start()).status).toBe(409);
    state.tables.book_prices = PRICE;
    expect((await start({ email: 'not-an-email' })).status).toBe(400);
    const stale = await start({ expectedAmount: 90 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).priceChanged).toBe(true);
    expect(paystack.init).not.toHaveBeenCalled();
  });

  describe('retries belong to the browser that started the checkout', () => {
    const { code, hash } = newReturnCode();
    const open = (extra: Record<string, unknown> = {}) => ({
      id: 'p-old', paystack_reference: 'book-old', authorization_url: 'https://paystack.test/old', amount: '120.00', currency: 'GHS',
      created_at: new Date().toISOString(), status: 'pending', is_guest: true, guest_email: 'buyer@example.test',
      guest_return_hash: hash, book_id: BOOK_ID, ...extra,
    });

    it('gives the same browser its own open checkout back', async () => {
      state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: { data: open() } };
      const body = await (await start({ resume: { reference: 'book-old', code } })).json();
      expect(body).toMatchObject({ authorizationUrl: 'https://paystack.test/old', reference: 'book-old', returnCode: code });
      expect(paystack.init).not.toHaveBeenCalled();
    });

    it('never hands another browser (same email, no or wrong code) an existing checkout or its code', async () => {
      for (const resume of [null, { reference: 'book-old', code: newReturnCode().code }]) {
        state.calls = [];
        state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: [{ data: open() }, { data: { id: 'p-new' } }] };
        const body = await (await start({ resume })).json();
        expect(body.authorizationUrl).toBe('https://paystack.test/new');
        expect(body.reference).not.toBe('book-old');
        expect(body.returnCode).not.toBe(code);
      }
    });

    describe('a stale or repriced checkout is checked with Paystack before another opens (no double charge)', () => {
      const stale = () => open({ created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

      it('returns the earlier checkout as paid when its money arrived', async () => {
        state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: [{ data: stale() }, { data: { id: 'p-old', book_id: BOOK_ID, status: 'pending' } }] };
        paystack.verify.mockResolvedValue({ status: 'success', amount: 120, currency: 'GHS', transactionId: 9 });
        state.rpc = () => ({ data: { status: 'paid', purchaseId: 'p-old', bookId: BOOK_ID }, error: null });
        const body = await (await start({ resume: { reference: 'book-old', code } })).json();
        expect(body).toMatchObject({ status: 'paid', reference: 'book-old', returnCode: code });
        expect(paystack.init).not.toHaveBeenCalled();
      });

      it('refuses while the earlier payment is still moving (a mobile money approval)', async () => {
        state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: [{ data: stale() }, { data: { id: 'p-old', book_id: BOOK_ID, status: 'pending' } }] };
        paystack.verify.mockResolvedValue({ status: 'ongoing' });
        expect((await start({ resume: { reference: 'book-old', code } })).status).toBe(409);
        expect(paystack.init).not.toHaveBeenCalled();
      });

      it('closes an abandoned one, then opens a new checkout', async () => {
        state.tables = {
          books: { data: BOOK }, book_prices: PRICE,
          book_purchases: [{ data: stale() }, { data: { id: 'p-old', book_id: BOOK_ID, status: 'pending' } }, { data: null }, { data: null, count: 0 }, { data: { id: 'p-new' } }],
        };
        paystack.verify.mockResolvedValue({ status: 'abandoned' });
        const body = await (await start({ resume: { reference: 'book-old', code } })).json();
        expect(body.authorizationUrl).toBe('https://paystack.test/new');
        expect(callsTo('book_purchases', 'update')[0].args[0]).toEqual({ status: 'failed' });
      });
    });

    it('caps new checkouts per email and product, counting only the last half hour (no long lockout)', async () => {
      state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: { data: null, count: 3 } };
      expect((await start()).status).toBe(429);
      expect(paystack.init).not.toHaveBeenCalled();
      const since = state.calls.find(c => c.table === 'book_purchases' && c.method === 'gt' && c.args[0] === 'created_at')!.args[1] as string;
      expect(Date.now() - Date.parse(since)).toBeLessThanOrEqual(31 * 60 * 1000);
    });

    it('does not resume a checkout under a different email, even with the right code', async () => {
      state.tables = { books: { data: BOOK }, book_prices: PRICE, book_purchases: [{ data: open({ guest_email: 'someone@else.test' }) }, { data: { id: 'p-new' } }] };
      const body = await (await start({ resume: { reference: 'book-old', code } })).json();
      expect(body.reference).not.toBe('book-old');
    });
  });
});

describe('POST /api/books/guest-checkout/confirm', () => {
  const { code, hash } = newReturnCode();
  const row = (extra: Record<string, unknown> = {}) => ({ id: PURCHASE, is_guest: true, guest_return_hash: hash, book_id: BOOK_ID, status: 'paid', ...extra });

  it('answers 404 without the return code, and never asks Paystack', async () => {
    state.tables = { book_purchases: { data: row() } };
    for (const body of [{ reference: 'book-x' }, { reference: 'book-x', code: newReturnCode().code }, { reference: 'book-x', code: '' }]) {
      expect((await post(confirmGuest, body)).status).toBe(404);
    }
    expect(paystack.verify).not.toHaveBeenCalled();
  });

  it('answers 404 for a signed-in purchase, whatever code is sent', async () => {
    state.tables = { book_purchases: { data: row({ is_guest: false, guest_return_hash: null }) } };
    expect((await post(confirmGuest, { reference: 'book-x', code })).status).toBe(404);
  });

  it('gives the same link however often it is confirmed, without re-fulfilling or touching the allowance', async () => {
    state.tables = { book_purchases: { data: row() } };
    const first = await (await post(confirmGuest, { reference: 'book-x', code })).json();
    const second = await (await post(confirmGuest, { reference: 'book-x', code })).json();
    expect(first).toEqual({ status: 'paid', access: guestAccessToken(PURCHASE) });
    expect(second).toEqual(first);
    // Already paid: settled from the row, so Paystack is not asked and the database function not run.
    expect(paystack.verify).not.toHaveBeenCalled();
    expect(rpcNames()).toEqual([]);
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
  });

  it('tells the page when the buyer left Paystack without paying, so they can try again', async () => {
    state.tables = { book_purchases: [{ data: row({ status: 'pending' }) }, { data: { id: PURCHASE, book_id: BOOK_ID, status: 'pending' } }] };
    paystack.verify.mockResolvedValue({ status: 'abandoned' });
    expect(await (await post(confirmGuest, { reference: 'book-x', code })).json()).toEqual({ status: 'abandoned' });
  });

  it('gives no link while the payment is pending, failed, refunded or under review', async () => {
    for (const status of ['refunded', 'needs_review']) {
      state.tables = { book_purchases: { data: row({ status }) } };
      const body = await (await post(confirmGuest, { reference: 'book-x', code })).json();
      expect(body.access).toBeUndefined();
    }
  });
});

describe('the download page and its buttons', () => {
  const access = () => guestAccessToken(PURCHASE);

  it('looking at the page (or an email scanner following the link) uses nothing', async () => {
    state.tables = { book_purchases: { data: paidPurchase({ guest_downloads_used: 2 }) }, books: { data: BOOK } };
    const res = await post(accessInfo, { access: access() });
    expect(await res.json()).toMatchObject({ title: 'Field Guide', state: 'ready', downloadsLeft: 3 });
    expect(rpcNames()).toEqual([]);
    expect(state.signed).toEqual([]);
    expect(callsTo('book_purchases', 'update')).toHaveLength(0);
  });

  it('refuses a forged, edited or swapped link before touching the database', async () => {
    const real = access();
    const other = guestAccessToken('44444444-4444-4444-8444-444444444444');
    const forged = [
      'nope', `${PURCHASE}.AAAA`, real.toUpperCase(), `${PURCHASE}.${other.split('.')[1]}`, `${real}x`,
    ];
    for (const token of forged) {
      for (const handler of [accessInfo, download, openHtml]) {
        expect((await post(handler, { access: token })).status).toBe(404);
      }
    }
    expect(state.calls).toHaveLength(0);
  });

  it('Download takes one of the five and hands out a short-lived link to the full file', async () => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: BOOK } };
    state.rpc = () => ({ data: { ok: true, remaining: 4 }, error: null });
    const body = await (await post(download, { access: access() })).json();
    expect(body).toEqual({ url: `https://storage.test/${FILE}`, remaining: 4 });
    expect(state.rpcCalls).toEqual([{ fn: 'take_guest_book_download', args: { p_purchase_id: PURCHASE } }]);
    expect(state.signed[0].opts).toEqual({ download: `${BOOK.slug}.html` });
  });

  it.each(['used_up', 'expired', 'not_paid'])('hands out nothing when the database says %s (refunds included)', async (reason) => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: BOOK } };
    state.rpc = () => ({ data: { ok: false, reason }, error: null });
    const res = await post(download, { access: access() });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe(reason);
    expect(state.signed).toEqual([]);
  });

  it('gives the download back when the file link could not be made', async () => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: BOOK } };
    state.rpc = (fn) => ({ data: fn === 'take_guest_book_download' ? { ok: true, remaining: 4 } : null, error: null });
    state.signFail = true;
    expect((await post(download, { access: access() })).status).toBe(500);
    expect(rpcNames()).toEqual(['take_guest_book_download', 'release_guest_book_download']);
  });

  it.each([
    ['pulled back to draft', { status: 'draft' }],
    ['past its licence', { license_expires_at: '2020-01-01T00:00:00Z' }],
  ])('a product %s is refused to guests, as to account holders, and costs nothing', async (_label, extra) => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: { ...BOOK, ...extra } } };
    expect((await post(download, { access: access() })).status).toBe(403);
    expect((await post(openHtml, { access: access() })).status).toBe(403);
    expect((await (await post(accessInfo, { access: access() })).json()).state).toBe('unavailable');
    expect(rpcNames()).toEqual([]);
    expect(state.signed).toEqual([]);
  });

  it('a product without its file costs no download', async () => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: { ...BOOK, file_path: null } } };
    expect((await post(download, { access: access() })).status).toBe(409);
    expect(rpcNames()).toEqual([]);
  });

  it('a signed-in purchase is never reachable through a guest link', async () => {
    state.tables = { book_purchases: { data: paidPurchase({ is_guest: false }) }, books: { data: BOOK } };
    for (const handler of [accessInfo, download, openHtml]) expect((await post(handler, { access: access() })).status).toBe(404);
    expect(rpcNames()).toEqual([]);
  });

  it('Open in browser is free, for HTML only, and only while paid and inside the seven days', async () => {
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: BOOK } };
    const body = await (await post(openHtml, { access: access() })).json();
    const ticket = new URL(body.url, 'http://localhost').searchParams.get('t');
    expect(verifyHtmlTicket(ticket, BOOK_ID)).toMatchObject({ variant: 'guest', purchaseId: PURCHASE, userId: null });
    expect(rpcNames()).toEqual([]);

    for (const extra of [{ status: 'refunded' }, { guest_access_expires_at: new Date(Date.now() - 1000).toISOString() }]) {
      state.tables = { book_purchases: { data: paidPurchase(extra) }, books: { data: BOOK } };
      expect((await post(openHtml, { access: access() })).status).toBe(403);
    }
    state.tables = { book_purchases: { data: paidPurchase() }, books: { data: { ...BOOK, format: 'pdf', file_path: `${BOOK_ID}/file-${U}.pdf` } } };
    expect((await post(openHtml, { access: access() })).status).toBe(400);
  });
});

describe('POST /api/books/guest-access/resend', () => {
  it('answers the same whatever the email, and sends only for paid purchases still inside their window', async () => {
    state.tables = { book_purchases: { data: [] } };
    const unknown = await (await post(resendLink, { email: 'nobody@example.test' })).json();
    state.after = [];
    state.tables = { book_purchases: { data: [{ id: PURCHASE }] } };
    const known = await (await post(resendLink, { email: 'buyer@example.test' })).json();
    expect(known).toEqual(unknown);

    // The lookup and sending happen after the answer.
    expect(mail.resend).not.toHaveBeenCalled();
    for (const fn of state.after) await fn();
    expect(mail.resend).toHaveBeenCalledTimes(1);
    expect(mail.resend.mock.calls[0][1]).toBe(PURCHASE);
    const filters = state.calls.filter(c => c.table === 'book_purchases' && (c.method === 'eq' || c.method === 'gt')).map(c => c.args);
    expect(filters).toEqual(expect.arrayContaining([['is_guest', true], ['guest_email', 'buyer@example.test'], ['status', 'paid']]));
    expect(filters.some(a => a[0] === 'guest_access_expires_at')).toBe(true);
  });

  it('refuses a malformed email without looking anything up', async () => {
    expect((await post(resendLink, { email: 'x' })).status).toBe(400);
    expect(state.after).toHaveLength(0);
  });
});
