import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));
const lib = vi.hoisted(() => ({
  startBookCheckout: vi.fn(),
  settleBookPurchase: vi.fn(),
  sendBookPurchaseReceipt: vi.fn(),
  after: vi.fn(),
}));
vi.mock('@/lib/books/purchases', async (orig) => ({
  ...(await orig<typeof import('@/lib/books/purchases')>()),
  startBookCheckout: lib.startBookCheckout,
  settleBookPurchase: lib.settleBookPurchase,
}));
vi.mock('@/lib/books/receipt-email', () => ({ sendBookPurchaseReceipt: lib.sendBookPurchaseReceipt }));
vi.mock('@/lib/paystack', async (orig) => ({
  ...(await orig<typeof import('@/lib/paystack')>()),
  paystackIsConfigured: () => true,
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { lib.after(fn); },
}));

import { requireUser } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET, POST } from '@/app/api/books/checkout/route';

const mockRequireUser = vi.mocked(requireUser);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOOK = {
  id: BOOK_ID, user_id: 'owner-1', status: 'published', cohort_ids: [], available_to_everyone: false,
  purchasable: true, license_expires_at: null, preview_file_path: null,
  title: 'SQL', royalty_pct: 20, format: 'pdf', file_path: `${BOOK_ID}/file-${U}.pdf`,
};
const buyer = {
  students: { data: { role: 'student', cohort_id: null } },
  learning_paths: { data: null },
  book_entitlements: { data: null },
};

function authAs(userId: string, tables: Record<string, any>, email: string | null = 'buyer@example.test') {
  mockRequireUser.mockResolvedValue({ user: { id: userId, email: email ?? undefined }, serviceDb: makeSupabaseStub(tables) } as any);
}
const buy = (body: any) => POST(new NextRequest('http://localhost/api/books/checkout', { method: 'POST', body: JSON.stringify(body) }));
const confirm = (ref: string) => GET(new NextRequest(`http://localhost/api/books/checkout?reference=${ref}`));

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /api/books/checkout', () => {
  it('returns 401 when not signed in', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await buy({ bookId: BOOK_ID })).status).toBe(401);
  });

  it('opens a checkout at the only price', async () => {
    authAs('u1', { books: { data: BOOK }, ...buyer, book_prices: { data: [{ currency: 'GHS', amount: '50.00' }] } });
    lib.startBookCheckout.mockResolvedValue({ kind: 'checkout', reference: 'book-1', authorizationUrl: 'https://pay.test/1' });
    const res = await buy({ bookId: BOOK_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizationUrl: 'https://pay.test/1', reference: 'book-1' });
    expect(lib.startBookCheckout.mock.calls[0][1]).toEqual({
      studentId: 'u1', email: 'buyer@example.test', amount: 50, currency: 'GHS',
      book: { id: BOOK_ID, title: 'SQL', royalty_pct: 20 },
    });
  });

  it('asks for a currency when the book has several prices', async () => {
    authAs('u1', { books: { data: BOOK }, ...buyer, book_prices: { data: [{ currency: 'GHS', amount: 50 }, { currency: 'USD', amount: 5 }] } });
    const res = await buy({ bookId: BOOK_ID });
    expect(res.status).toBe(400);
    expect((await res.json()).currencies).toEqual(['GHS', 'USD']);
    lib.startBookCheckout.mockResolvedValue({ kind: 'checkout', reference: 'book-1', authorizationUrl: 'u' });
    authAs('u1', { books: { data: BOOK }, ...buyer, book_prices: { data: [{ currency: 'GHS', amount: 50 }, { currency: 'USD', amount: 5 }] } });
    expect((await buy({ bookId: BOOK_ID, currency: 'usd' })).status).toBe(200);
    expect(lib.startBookCheckout.mock.calls[0][1]).toMatchObject({ amount: 5, currency: 'USD' });
  });

  it('refuses a buyer who already has the book', async () => {
    authAs('u1', { books: { data: BOOK }, ...buyer, book_entitlements: { data: { id: 'ent-1' } } });
    expect((await buy({ bookId: BOOK_ID })).status).toBe(409);
    expect(lib.startBookCheckout).not.toHaveBeenCalled();
  });

  it('refuses a book that is not for sale, without revealing a hidden one', async () => {
    authAs('u1', { books: { data: { ...BOOK, purchasable: false } }, ...buyer });
    expect((await buy({ bookId: BOOK_ID })).status).toBe(404);
    authAs('u1', { books: { data: { ...BOOK, purchasable: false, available_to_everyone: true, preview_file_path: null } }, ...buyer });
    // Open to everyone: the buyer already has it.
    expect((await buy({ bookId: BOOK_ID })).status).toBe(409);
    expect(lib.startBookCheckout).not.toHaveBeenCalled();
  });

  it('refuses a draft, an expired licence, and a book with no file', async () => {
    authAs('u1', { books: { data: { ...BOOK, status: 'draft' } }, ...buyer });
    expect((await buy({ bookId: BOOK_ID })).status).toBe(404);
    authAs('u1', { books: { data: { ...BOOK, license_expires_at: '2000-01-01T00:00:00Z' } }, ...buyer });
    expect((await buy({ bookId: BOOK_ID })).status).toBe(403);
    authAs('u1', { books: { data: { ...BOOK, file_path: null } }, ...buyer });
    expect((await buy({ bookId: BOOK_ID })).status).toBe(409);
    expect(lib.startBookCheckout).not.toHaveBeenCalled();
  });

  it('needs an email address and a valid id', async () => {
    authAs('u1', {}, null);
    expect((await buy({ bookId: BOOK_ID })).status).toBe(400);
    authAs('u1', {});
    expect((await buy({ bookId: 'nope' })).status).toBe(400);
  });
});

describe('GET /api/books/checkout', () => {
  it('confirms a paid purchase and sends the receipt after responding', async () => {
    authAs('u1', { book_purchases: { data: { id: 'p1', book_id: BOOK_ID } } });
    lib.settleBookPurchase.mockResolvedValue({ status: 'paid', purchaseId: 'p1', bookId: BOOK_ID, alreadyProcessed: false });
    const res = await confirm('book-1');
    expect(await res.json()).toEqual({ status: 'paid', bookId: BOOK_ID });
    expect(lib.after).toHaveBeenCalledOnce();
    await lib.after.mock.calls[0][0]();
    expect(lib.sendBookPurchaseReceipt).toHaveBeenCalledWith(expect.anything(), 'p1');
  });

  it("will not confirm someone else's purchase", async () => {
    authAs('u2', { book_purchases: { data: null } });
    expect((await confirm('book-1')).status).toBe(404);
    expect(lib.settleBookPurchase).not.toHaveBeenCalled();
  });

  it('reports a checkout still in progress as pending, and a failed one as failed', async () => {
    authAs('u1', { book_purchases: { data: { id: 'p1', book_id: BOOK_ID } } });
    lib.settleBookPurchase.mockResolvedValue({ status: 'unpaid', providerStatus: 'abandoned' });
    expect(await (await confirm('book-1')).json()).toMatchObject({ status: 'pending' });
    lib.settleBookPurchase.mockResolvedValue({ status: 'unpaid', providerStatus: 'failed' });
    expect(await (await confirm('book-1')).json()).toMatchObject({ status: 'failed' });
    expect(lib.after).not.toHaveBeenCalled();
  });

  it('rejects anything that is not a book reference', async () => {
    authAs('u1', {});
    expect((await confirm('sub-123')).status).toBe(400);
  });
});
