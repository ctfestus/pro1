import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireUser } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { POST } from '@/app/api/books/[id]/html-ticket/route';
import { verifyHtmlTicket } from '@/lib/books/html-ticket';

const mockRequireUser = vi.mocked(requireUser);

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const BOOK = {
  id: BOOK_ID,
  user_id: 'owner-1',
  status: 'published',
  cohort_ids: ['cohort-a'],
  available_to_everyone: false,
  purchasable: false,
  license_expires_at: null,
  preview_file_path: `${BOOK_ID}/preview-${U}.html`,
  format: 'html',
  file_path: `${BOOK_ID}/file-${U}.html`,
};

const outsider = {
  students: { data: { role: 'student', cohort_id: null } },
  learning_paths: { data: null },
  book_entitlements: { data: null },
};

function authAs(userId: string, tables: Record<string, any>) {
  mockRequireUser.mockResolvedValue({ user: { id: userId }, serviceDb: makeSupabaseStub(tables) } as any);
}

const call = () =>
  POST(new NextRequest(`http://localhost/api/books/${BOOK_ID}/html-ticket`, { method: 'POST' }),
    { params: Promise.resolve({ id: BOOK_ID }) });

/** Pull the ticket back out of the returned URL and check what it actually grants. */
async function grantedVariant(res: Response) {
  const { url, variant } = await res.json();
  const ticket = new URL(url, 'http://localhost').searchParams.get('t');
  return { variant, claims: verifyHtmlTicket(ticket, BOOK_ID) };
}

const ORIGINAL_SECRET = process.env.BOOK_HTML_TICKET_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.BOOK_HTML_TICKET_SECRET = 'test-secret';
});
afterEach(() => { process.env.BOOK_HTML_TICKET_SECRET = ORIGINAL_SECRET; });

describe('POST /api/books/[id]/html-ticket', () => {
  it('returns 401 when not signed in', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
  });

  it('refuses books that are not HTML', async () => {
    authAs('u1', { books: { data: { ...BOOK, format: 'pdf' } }, students: { data: { role: 'student', cohort_id: 'cohort-a' } } });
    expect((await call()).status).toBe(400);
  });

  it("does not reveal a hidden book's format to an outsider (404 before any format check)", async () => {
    authAs('u1', { books: { data: { ...BOOK, format: 'pdf' } }, ...outsider });
    expect((await call()).status).toBe(404);
  });

  it('issues a full-book ticket bound to this reader for a cohort member', async () => {
    authAs('u1', { books: { data: BOOK }, students: { data: { role: 'student', cohort_id: 'cohort-a' } } });
    const res = await call();
    expect(res.status).toBe(200);
    const { variant, claims } = await grantedVariant(res);
    expect(variant).toBe('full');
    expect(claims).toMatchObject({ bookId: BOOK_ID, userId: 'u1', variant: 'full' });
  });

  it('issues only a sample ticket to a non-owner of a for-sale book', async () => {
    authAs('u1', { books: { data: { ...BOOK, purchasable: true } }, ...outsider });
    const { variant, claims } = await grantedVariant(await call());
    expect(variant).toBe('preview');
    expect(claims?.variant).toBe('preview');
  });

  it('issues nothing for a cohort-only book outside the cohort, sample or not', async () => {
    authAs('u1', { books: { data: BOOK }, ...outsider });
    expect((await call()).status).toBe(404);
  });

  it("issues nothing when the book's path points at another book's object", async () => {
    authAs('owner-1', {
      books: { data: { ...BOOK, status: 'draft', file_path: `${OTHER_ID}/file-${U}.html` } },
      students: { data: { role: 'instructor', cohort_id: null } },
    });
    expect((await call()).status).toBe(404);
  });
});
