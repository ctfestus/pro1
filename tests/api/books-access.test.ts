import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireUser } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET } from '@/app/api/books/[id]/access/route';

const mockAuth = vi.mocked(requireUser);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const BOOK = {
  id: BOOK_ID, user_id: 'owner-1', status: 'published', cohort_ids: ['cohort-a'], available_to_everyone: false,
  purchasable: true, license_expires_at: null, preview_file_path: null,
};

function authAs(userId: string, tables: Record<string, any>) {
  mockAuth.mockResolvedValue({ user: { id: userId }, serviceDb: makeSupabaseStub(tables) } as any);
}
const call = (id = BOOK_ID) => GET(new NextRequest(`http://localhost/api/books/${id}/access`), { params: Promise.resolve({ id }) });
const owned = async () => (await (await call()).json()).owned;

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/[id]/access', () => {
  it('requires a signed-in user', async () => {
    mockAuth.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
  });

  it('is owned with an active purchase', async () => {
    authAs('buyer', {
      books: { data: BOOK },
      students: { data: { role: 'student', cohort_id: null } },
      learning_paths: { data: null },
      book_entitlements: { data: { id: 'e1' } },
    });
    expect(await owned()).toBe(true);
  });

  it('is owned through the cohort the book is assigned to', async () => {
    authAs('cohort-member', {
      books: { data: BOOK },
      students: { data: { role: 'student', cohort_id: 'cohort-a' } },
      learning_paths: { data: null },
      book_entitlements: { data: null },
    });
    expect(await owned()).toBe(true);
  });

  it('is not owned by a stranger, who still gets to buy it', async () => {
    authAs('stranger', {
      books: { data: BOOK },
      students: { data: { role: 'student', cohort_id: null } },
      learning_paths: { data: null },
      book_entitlements: { data: null },
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).owned).toBe(false);
  });

  it('is simply not owned for an unknown book', async () => {
    authAs('stranger', { books: { data: null } });
    expect(await owned()).toBe(false);
    expect((await call('nope')).status).toBe(404);
  });
});
