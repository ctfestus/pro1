import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireRole: vi.fn(), isAuthError: (v: any) => !!v?.error }));
import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET } from '@/app/api/books/stats/route';

const mockRole = vi.mocked(requireRole);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const call = (qs = '') => GET(new NextRequest(`http://localhost/api/books/stats${qs}`));
// rpc returns a builder that can be ordered and ranged, as the real client's does.
const pagedRpc = () => { const q: any = { order: () => q, range: () => Promise.resolve({ data: [], count: 0, error: null }) }; return q; };
const as = (role: string, userId: string, tables: Record<string, any>) =>
  mockRole.mockResolvedValue({ user: { id: userId }, role, serviceDb: { ...makeSupabaseStub(tables), rpc: pagedRpc } } as any);

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/stats', () => {
  it('needs a product id (totals come with GET /api/books)', async () => {
    as('admin', 'boss', {});
    expect((await call()).status).toBe(400);
  });

  it('is for instructors and admins only', async () => {
    mockRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await call()).status).toBe(403);
  });

  it("never shows an instructor the people of another instructor's product", async () => {
    as('instructor', 'me', { books: { data: { id: BOOK_ID, user_id: 'someone-else', available_to_everyone: false } } });
    expect((await call(`?bookId=${BOOK_ID}`)).status).toBe(404);
  });

  it("shows an admin any product's people, and refuses a malformed id", async () => {
    as('admin', 'boss', {
      books: { data: { id: BOOK_ID, user_id: 'someone-else', available_to_everyone: false } },
      book_purchases: { data: [] }, book_entitlements: { data: [] },
    });
    expect((await call(`?bookId=${BOOK_ID}`)).status).toBe(200);
    expect((await call('?bookId=nope')).status).toBe(400);
  });
});

