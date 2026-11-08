import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireStudentUser } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET } from '@/app/api/books/library/route';

const mockAuth = vi.mocked(requireStudentUser);

const book = (id: string, extra: Record<string, unknown> = {}) => ({
  id, slug: `book-${id}`, title: `Book ${id}`, subtitle: null, cover_image: null, authors: ['A. Writer'],
  format: 'pdf', file_size: 1000, status: 'published', license_expires_at: null,
  // A real row would carry these; the route must never pass them on.
  file_path: `${id}/file-x.pdf`, preview_file_path: `${id}/preview-x.pdf`,
  ...extra,
});

function authAs(tables: Record<string, any>) {
  mockAuth.mockResolvedValue({ user: { id: 'u1' }, serviceDb: makeSupabaseStub(tables) } as any);
}

const call = () => GET(new NextRequest('http://localhost/api/books/library'));

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/library', () => {
  it('requires a signed-in student', async () => {
    mockAuth.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
  });

  it('lists bought and granted books with display columns only', async () => {
    authAs({
      students: { data: { cohort_id: null } },
      learning_paths: { data: [] },
      book_entitlements: { data: [
        { book_id: 'b1', source: 'purchase', granted_at: '2026-11-01T00:00:00Z' },
        { book_id: 'b2', source: 'grant', granted_at: '2026-11-05T00:00:00Z' },
        { book_id: 'gone', source: 'purchase', granted_at: '2026-11-06T00:00:00Z' }, // draft now: hidden
      ] },
      book_purchases: { data: [] },
      books: { data: [book('b1'), book('b2', { status: 'archived' })] },
    });
    const res = await call();
    expect(res.status).toBe(200);
    const { books } = await res.json();
    expect(books.map((b: any) => [b.id, b.source])).toEqual([['b2', 'grant'], ['b1', 'purchase']]);
    const json = JSON.stringify(books);
    expect(json).not.toContain('file_path');
    expect(json).not.toContain('preview');
    expect(json).not.toContain('file-x');
  });

  it('adds books assigned to the cohort, directly or through a path, once each', async () => {
    authAs({
      students: { data: { cohort_id: 'c1' } },
      book_entitlements: { data: [{ book_id: 'b1', source: 'purchase', granted_at: '2026-11-01T00:00:00Z' }] },
      book_purchases: { data: [] },
      books: [
        { data: [book('b1')] },                 // entitlements
        { data: [book('b1'), book('b3')] },      // direct cohort books (b1 already owned)
        { data: [book('b4')] },                  // books reached through a path
      ],
      learning_paths: { data: [{ item_ids: ['course-x', 'b4', 'b3'] }] },
    });
    const { books } = await (await call()).json();
    expect(books.map((b: any) => [b.id, b.source])).toEqual([
      ['b1', 'purchase'], ['b3', 'cohort'], ['b4', 'cohort'],
    ]);
  });

  it('adds a book inside a learning path open to everyone, even with no cohort', async () => {
    authAs({
      students: { data: { cohort_id: null } },
      book_entitlements: { data: [] },
      book_purchases: { data: [] },
      learning_paths: { data: [{ item_ids: ['course-x', 'b5'] }] },
      books: { data: [book('b5')] },
    });
    const { books } = await (await call()).json();
    expect(books.map((b: any) => [b.id, b.source])).toEqual([['b5', 'cohort']]);
  });

  it('keeps a book whose licence has ended, marked unavailable', async () => {
    authAs({
      students: { data: { cohort_id: null } },
      learning_paths: { data: [] },
      book_entitlements: { data: [{ book_id: 'b1', source: 'purchase', granted_at: '2026-11-01T00:00:00Z' }] },
      book_purchases: { data: [] },
      books: { data: [book('b1', { license_expires_at: '2020-01-01T00:00:00Z' })] },
    });
    const { books } = await (await call()).json();
    expect(books).toHaveLength(1);
    expect(books[0].available).toBe(false);
  });

  it('returns every book payment, including ones still processing or under review', async () => {
    authAs({
      students: { data: { cohort_id: null } },
      learning_paths: { data: [] },
      book_entitlements: { data: [] },
      book_purchases: { data: [
        { id: 'p1', book_id: 'b1', book_title: 'Book b1', amount: '120.00', currency: 'GHS', status: 'paid', paid_at: '2026-11-01', created_at: '2026-11-01' },
        { id: 'p2', book_id: 'b2', book_title: 'Book b2', amount: '50', currency: 'GHS', status: 'needs_review', paid_at: '2026-11-02', created_at: '2026-11-02' },
        { id: 'p3', book_id: 'b3', book_title: 'Book b3', amount: '50', currency: 'GHS', status: 'pending', paid_at: null, created_at: '2026-11-03' },
      ] },
    });
    const { books, purchases } = await (await call()).json();
    expect(books).toEqual([]);
    expect(purchases.map((p: any) => [p.status, p.amount])).toEqual([['paid', 120], ['needs_review', 50], ['pending', 50]]);
  });

  it('reports a database failure as a 500 without details', async () => {
    authAs({
      students: { data: null, error: { message: 'boom' } },
      book_entitlements: { data: [] },
      book_purchases: { data: [] },
    });
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Could not load your books.');
  });
});
