import { describe, expect, it } from 'vitest';
import { canReadBook, type BookAccessRow } from '@/lib/books/access';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const BOOK: BookAccessRow = {
  id: 'book-1',
  user_id: 'owner-1',
  status: 'published',
  cohort_ids: ['cohort-a'],
  available_to_everyone: false,
  purchasable: false,
  license_expires_at: null,
  preview_file_path: null,
};

function db(opts: { role?: string; cohortId?: string | null; entitled?: boolean; viaPath?: boolean } = {}) {
  return makeSupabaseStub({
    students: { data: { role: opts.role ?? 'student', cohort_id: opts.cohortId ?? null } },
    learning_paths: { data: opts.viaPath ? { id: 'path-1' } : null },
    book_entitlements: { data: opts.entitled ? { id: 'ent-1' } : null },
  });
}

describe('canReadBook', () => {
  it('gives the owner full access even to a draft', async () => {
    const r = await canReadBook(db(), 'owner-1', { ...BOOK, status: 'draft' });
    expect(r).toEqual({ level: 'full', reason: 'owner' });
  });

  it('gives an admin full access even after the licence expired', async () => {
    const r = await canReadBook(db({ role: 'admin' }), 'u1', { ...BOOK, license_expires_at: '2000-01-01T00:00:00Z' });
    expect(r).toEqual({ level: 'full', reason: 'admin' });
  });

  it('hides an unpublished book from a buyer', async () => {
    const r = await canReadBook(db({ entitled: true }), 'u1', { ...BOOK, status: 'archived' });
    expect(r.level).toBe('none');
    expect(r.level === 'none' && r.status).toBe(404);
  });

  it('refuses a granted reader once the licence has expired', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-a', entitled: true }), 'u1', {
      ...BOOK,
      license_expires_at: '2000-01-01T00:00:00Z',
    });
    expect(r.level).toBe('none');
    expect(r.level === 'none' && r.status).toBe(403);
  });

  it('does not reveal an expired cohort-only book to an outsider', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b' }), 'u1', {
      ...BOOK,
      license_expires_at: '2000-01-01T00:00:00Z',
    });
    expect(r.level === 'none' && r.status).toBe(404);
  });

  it('grants a reader in an assigned cohort', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-a' }), 'u1', BOOK);
    expect(r).toEqual({ level: 'full', reason: 'cohort' });
  });

  it('grants a reader whose cohort reaches the book through a learning path', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b', viaPath: true }), 'u1', BOOK);
    expect(r).toEqual({ level: 'full', reason: 'cohort' });
  });

  it('grants every signed-in reader when open to everyone', async () => {
    const r = await canReadBook(db(), 'u1', { ...BOOK, cohort_ids: [], available_to_everyone: true });
    expect(r).toEqual({ level: 'full', reason: 'cohort' });
  });

  it('grants a reader holding an active entitlement', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b', entitled: true }), 'u1', BOOK);
    expect(r).toEqual({ level: 'full', reason: 'entitlement' });
  });

  it('gives a non-owner the sample of a book that is for sale', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b' }), 'u1', {
      ...BOOK, purchasable: true, preview_file_path: 'book-1/preview-x.pdf',
    });
    expect(r).toEqual({ level: 'preview' });
  });

  it('refuses a non-owner of a for-sale book with no sample', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b' }), 'u1', { ...BOOK, purchasable: true });
    expect(r.level === 'none' && r.status).toBe(403);
  });

  it('never serves the sample of a cohort-only book outside the cohort (404, not preview)', async () => {
    const r = await canReadBook(db({ cohortId: 'cohort-b' }), 'u1', {
      ...BOOK, preview_file_path: 'book-1/preview-x.pdf',
    });
    expect(r.level).toBe('none');
    expect(r.level === 'none' && r.status).toBe(404);
  });
});
