// Free products without an account (migration 239): the link is only ever emailed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
type Call = { table: string; method: string; args: unknown[] };
const state = vi.hoisted(() => ({ tables: {} as Record<string, any>, calls: [] as Call[], after: [] as (() => unknown)[], rpc: [] as { fn: string; args: any }[], claim: { id: 'c1', existing: false } as any }));
const mail = vi.hoisted(() => ({ receipt: vi.fn(), resend: vi.fn() }));

vi.mock('@/lib/admin-client', async () => {
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  const wrap = (builder: any, table: string): any => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
      return (...args: unknown[]) => { state.calls.push({ table, method: String(prop), args }); return wrap(target[prop](...args), table); };
    },
  });
  return { adminClient: () => { const base = makeSupabaseStub(state.tables, (fn, args) => { state.rpc.push({ fn, args }); return { data: state.claim, error: null }; }); return { ...base, from: (t: string) => wrap(base.from(t), t) }; } };
});
vi.mock('@/lib/books/receipt-email', () => ({ sendBookPurchaseReceipt: mail.receipt, resendGuestAccessEmail: mail.resend }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { state.after.push(fn); } }));

import { POST } from '@/app/api/books/free-claim/route';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOOK = { id: BOOK_ID, title: 'Free Guide', status: 'published', available_to_everyone: true, license_expires_at: null, format: 'pdf', file_path: `${BOOK_ID}/file-${U}.pdf` };
const claim = (body: Record<string, unknown> = {}) =>
  POST(new NextRequest('http://localhost/api/books/free-claim', { method: 'POST', body: JSON.stringify({ bookId: BOOK_ID, name: ' Ama  Mensah ', email: 'Ama@Example.test', ...body }) }));
const claims = () => state.rpc.filter(r => r.fn === 'claim_free_book').map(r => r.args);

beforeEach(() => { state.calls = []; state.after = []; state.rpc = []; state.claim = { id: 'c1', existing: false }; vi.clearAllMocks(); });

describe('POST /api/books/free-claim', () => {
  it('claims through the locked database function and emails the link, never returning it', async () => {
    state.tables = { books: { data: BOOK } };
    const res = await claim();
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/access|token|download\?/i);
    expect(claims()).toEqual([{ p_book_id: BOOK_ID, p_book_title: 'Free Guide', p_email: 'ama@example.test', p_name: 'Ama Mensah', p_return_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    for (const fn of state.after) await fn();
    expect(mail.receipt).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('an open claim is resent, with the same answer as a new one', async () => {
    state.tables = { books: { data: BOOK } };
    state.claim = { id: 'c1', existing: true };
    const first = await (await claim()).json();
    for (const fn of state.after) await fn();
    expect(mail.resend).toHaveBeenCalledWith(expect.anything(), 'c1');
    expect(mail.receipt).not.toHaveBeenCalled();
    state.claim = { id: 'c2', existing: false };
    expect(await (await claim()).json()).toEqual(first);
  });

  it('refuses past the hourly limits the database enforces, and sends nothing', async () => {
    state.tables = { books: { data: BOOK } };
    state.claim = { limited: true };
    expect((await claim()).status).toBe(429);
    expect(state.after).toHaveLength(0);
  });

  it.each([
    ['for sale, not free', { available_to_everyone: false }],
    ['a draft', { status: 'draft' }],
    ['archived', { status: 'archived' }],
    ['past its licence', { license_expires_at: '2020-01-01T00:00:00Z' }],
    ["without its own file", { file_path: `22222222-2222-4222-8222-222222222222/file-${U}.pdf` }],
  ])('refuses a product that is %s, and records nothing', async (_label, extra) => {
    state.tables = { books: { data: { ...BOOK, ...extra } } };
    expect((await claim()).status).toBeGreaterThanOrEqual(400);
    expect(claims()).toHaveLength(0);
    expect(state.after).toHaveLength(0);
  });

  it('needs a name and a valid email', async () => {
    state.tables = { books: { data: BOOK } };
    expect((await claim({ name: '  ' })).status).toBe(400);
    expect((await claim({ email: 'nope' })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
    expect(claims()).toHaveLength(0);
  });
});
