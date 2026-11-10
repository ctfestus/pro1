import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireRole: vi.fn(), isAuthError: (v: any) => !!v?.error }));
vi.mock('@/lib/books/store-cache', () => ({ refreshBookStore: vi.fn() }));
import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { PATCH } from '@/app/api/books/address/route';

const mockRole = vi.mocked(requireRole);
const ID = '11111111-1111-4111-8111-111111111111';
const V = '2026-11-10T10:00:00.000Z';
const BOOK = { id: ID, user_id: 'author-1', slug: 'old-address-1a2b', updated_at: V };
const updates: any[] = [];
function as(role: string, userId: string, updateResult: any = { data: { slug: 'sql-for-analysts', updated_at: '2026-11-10T11:00:00.000Z' } }) {
  const base = makeSupabaseStub({ books: [{ data: BOOK }, updateResult] });
  const db = { ...base, from: (t: string) => { const b: any = base.from(t); return new Proxy(b, { get: (o: any, p) => (p === 'update' ? (row: any) => { updates.push(row); return o.update(row); } : o[p]) }); } };
  mockRole.mockResolvedValue({ user: { id: userId }, role, serviceDb: db } as any);
}
const patch = (slug: unknown, expectedUpdatedAt: unknown = V) => PATCH(new NextRequest('http://localhost/api/books/address', { method: 'PATCH', body: JSON.stringify({ id: ID, slug, expectedUpdatedAt }) }));

beforeEach(() => { vi.clearAllMocks(); updates.length = 0; });

describe('PATCH /api/books/address', () => {
  it('is for instructors and admins, and only the owner (or an admin) may change it', async () => {
    mockRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await patch('new-one')).status).toBe(403);
    as('instructor', 'author-2');
    expect((await patch('new-one')).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('tidies and saves a new address', async () => {
    as('instructor', 'author-1');
    const res = await patch('  SQL For Analysts ');
    expect(await res.json()).toEqual({ slug: 'sql-for-analysts', updatedAt: '2026-11-10T11:00:00.000Z' });
    expect(updates).toHaveLength(1);
    expect(updates[0].slug).toBe('sql-for-analysts');
    // The version moves on, so an editor tab on the older version cannot save over the change.
    expect(Date.parse(updates[0].updated_at)).toBeGreaterThan(Date.parse(V));
  });

  it('refuses a malformed or reserved address, and one another product has', async () => {
    as('admin', 'boss');
    expect((await patch('x')).status).toBe(400);
    expect((await patch('download')).status).toBe(400);
    expect(updates).toHaveLength(0);
    as('admin', 'boss', { data: null, error: { code: '23505', message: 'duplicate' } });
    expect((await patch('taken-address')).status).toBe(409);
  });

  it('refuses an editor on an older version, and a save that lands in between', async () => {
    as('instructor', 'author-1');
    const stale = await patch('new-address', '2026-11-10T09:00:00.000Z');
    expect(stale.status).toBe(409);
    expect(updates).toHaveLength(0);
    // Read at the right version, but someone saved before the update: no row matched.
    as('instructor', 'author-1', { data: null });
    expect((await patch('new-address')).status).toBe(409);
    expect((await patch('new-address', null)).status).toBe(400);
  });
});
