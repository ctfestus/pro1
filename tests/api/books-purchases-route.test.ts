import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET, PATCH } from '@/app/api/books/purchases/route';

const mockRequireRole = vi.mocked(requireRole);
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let eqCalls: unknown[][];

function authAs(userId: string, role: string, purchases: any) {
  const base = makeSupabaseStub({ book_purchases: purchases });
  eqCalls = [];
  const wrap = (b: any): any => new Proxy(b, {
    get(t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return t[prop];
      return (...args: unknown[]) => { if (prop === 'eq') eqCalls.push(args); return wrap(t[prop](...args)); };
    },
  });
  const serviceDb = { ...base, from: (table: string) => wrap(base.from(table)) };
  mockRequireRole.mockResolvedValue({ user: { id: userId }, role, serviceDb } as any);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/books/purchases', () => {
  const row = {
    id: P, book_id: 'b1', book_title: 'SQL', amount: '50.00', currency: 'GHS', status: 'needs_review',
    review_reason: 'already_owned', paystack_reference: 'book-1', paid_at: '2026-11-08T10:00:00Z',
    students: { email: 'buyer@example.test', full_name: 'Ama' }, books: { user_id: 'author-1' },
  };

  it('lists payments that need attention', async () => {
    authAs('admin-1', 'admin', { data: [row] });
    const res = await GET(new NextRequest('http://localhost/api/books/purchases'));
    expect((await res.json()).attention[0]).toMatchObject({ id: P, amount: 50, reason: 'already_owned', buyerEmail: 'buyer@example.test' });
    expect(eqCalls).toEqual([]);
  });

  it("limits an instructor to their own books' payments", async () => {
    authAs('author-1', 'instructor', { data: [] });
    await GET(new NextRequest('http://localhost/api/books/purchases'));
    expect(eqCalls).toEqual([['books.user_id', 'author-1']]);
  });
});

describe('PATCH /api/books/purchases', () => {
  const patch = (body: any) => PATCH(new NextRequest('http://localhost/api/books/purchases', { method: 'PATCH', body: JSON.stringify(body) }));

  it("refuses an instructor resolving another author's payment", async () => {
    authAs('author-2', 'instructor', { data: { id: P, books: { user_id: 'author-1' } } });
    expect((await patch({ id: P })).status).toBe(403);
  });

  it('marks a payment resolved for its author', async () => {
    authAs('author-1', 'instructor', { data: { id: P, books: { user_id: 'author-1' } } });
    expect((await patch({ id: P })).status).toBe(200);
  });

  it('validates the id', async () => {
    authAs('admin-1', 'admin', { data: null });
    expect((await patch({ id: 'x' })).status).toBe(400);
    expect((await patch({ id: P })).status).toBe(404);
  });
});
