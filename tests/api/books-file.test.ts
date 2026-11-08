import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireUser } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET } from '@/app/api/books/[id]/file/route';

const mockRequireUser = vi.mocked(requireUser);

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE = `${BOOK_ID}/file-${U}.pdf`;
const PREVIEW = `${BOOK_ID}/preview-${U}.pdf`;

const BOOK = {
  id: BOOK_ID,
  user_id: 'owner-1',
  status: 'published',
  cohort_ids: ['cohort-a'],
  available_to_everyone: false,
  purchasable: false,
  license_expires_at: null,
  preview_file_path: PREVIEW,
  format: 'pdf',
  file_path: FILE,
};

let createSignedUrl: ReturnType<typeof vi.fn>;

function authAs(userId: string, tables: Record<string, any>) {
  createSignedUrl = vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}` }, error: null }));
  const serviceDb = {
    ...makeSupabaseStub(tables),
    storage: { from: () => ({ createSignedUrl }) },
  };
  mockRequireUser.mockResolvedValue({ user: { id: userId }, serviceDb } as any);
}

const outsider = {
  students: { data: { role: 'student', cohort_id: null } },
  learning_paths: { data: null },
  book_entitlements: { data: null },
};

const call = (id = BOOK_ID) =>
  GET(new NextRequest(`http://localhost/api/books/${id}/file`), { params: Promise.resolve({ id }) });

describe('GET /api/books/[id]/file', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when not signed in', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
  });

  it('returns 404 for an unknown book', async () => {
    authAs('u1', { books: { data: null } });
    expect((await call()).status).toBe(404);
  });

  it('refuses HTML books, which only open through the sandboxed route', async () => {
    authAs('u1', { books: { data: { ...BOOK, format: 'html' } }, students: { data: { role: 'student', cohort_id: 'cohort-a' } } });
    expect((await call()).status).toBe(400);
  });

  it("does not reveal a hidden book's format to an outsider (404 before any format check)", async () => {
    authAs('u1', { books: { data: { ...BOOK, format: 'html' } }, ...outsider });
    expect((await call()).status).toBe(404);
  });

  it('signs the full file for a reader in an assigned cohort', async () => {
    authAs('u1', { books: { data: BOOK }, students: { data: { role: 'student', cohort_id: 'cohort-a' } } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ variant: 'full', url: `https://storage.test/${FILE}` });
    expect(createSignedUrl).toHaveBeenCalledWith(FILE, 300);
  });

  it('signs only the sample for a non-owner of a for-sale book', async () => {
    authAs('u1', { books: { data: { ...BOOK, purchasable: true } }, ...outsider });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ variant: 'preview', url: `https://storage.test/${PREVIEW}` });
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(PREVIEW, 300);
  });

  it('returns 404, not the sample, for a cohort-only book outside the cohort', async () => {
    authAs('u1', { books: { data: BOOK }, ...outsider });
    expect((await call()).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 403 for a for-sale book with no sample', async () => {
    authAs('u1', { books: { data: { ...BOOK, purchasable: true, preview_file_path: null } }, ...outsider });
    expect((await call()).status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 403 once the licence has expired, even for a buyer', async () => {
    authAs('u1', {
      books: { data: { ...BOOK, license_expires_at: '2000-01-01T00:00:00Z' } },
      students: { data: { role: 'student', cohort_id: 'cohort-a' } },
      book_entitlements: { data: { id: 'ent-1' } },
    });
    expect((await call()).status).toBe(403);
  });

  it("never signs another book's object, even for the book's own author", async () => {
    // An author points their own draft at a purchasable book's file, copied from its catalogue row.
    authAs('owner-1', {
      books: { data: { ...BOOK, status: 'draft', file_path: `${OTHER_ID}/file-${U}.pdf` } },
      students: { data: { role: 'instructor', cohort_id: null } },
    });
    expect((await call()).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('never signs a path of the wrong kind or format', async () => {
    authAs('owner-1', {
      books: { data: { ...BOOK, file_path: PREVIEW.replace('.pdf', '.epub') } },
      students: { data: { role: 'instructor', cohort_id: null } },
    });
    expect((await call()).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
