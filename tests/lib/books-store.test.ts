import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => { throw new Error('tests pass a db'); } }));

import { loadStoreBook, loadStoreBooks, toStoreBook } from '@/lib/books/store';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const ID = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = (extra: Record<string, unknown> = {}) => ({
  id: ID, slug: 'field-guide', title: 'Field Guide', subtitle: 'Sub', description: 'About', cover_image: 'covers/x',
  authors: ['A. Writer'], category: 'Data', topics: ['SQL'], skills: [], difficulty: 'beginner', estimated_minutes: 300,
  format: 'pdf', file_size: 2048, purchasable: true, available_to_everyone: false, license_expires_at: null,
  updated_at: '2026-11-01', status: 'published',
  file_path: `${ID}/file-${U}.pdf`, preview_file_path: `${ID}/preview-${U}.pdf`,
  ...extra,
});
const GHS = [{ currency: 'GHS', amount: 120 }];

describe('toStoreBook (what the public store may show)', () => {
  it('never carries an object path, whatever the row holds', () => {
    const book = toStoreBook(row(), GHS)!;
    const json = JSON.stringify(book);
    expect(json).not.toContain(U);
    expect(json).not.toContain('file_path');
    expect(json).not.toContain('preview_file_path');
    expect(book).toMatchObject({ slug: 'field-guide', free: false, prices: GHS, hasSample: true, format: 'pdf' });
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['an archived book', { status: 'archived' }],
    ['a book with no file', { file_path: null }],
    ["a file that is not this book's", { file_path: `22222222-2222-4222-8222-222222222222/file-${U}.pdf` }],
    ['an expired licence', { license_expires_at: '2020-01-01T00:00:00Z' }],
    ['a cohort-only book', { purchasable: false, available_to_everyone: false }],
  ])('hides %s', (_label, extra) => {
    expect(toStoreBook(row(extra), GHS)).toBeNull();
  });

  it('hides a book for sale that has no price yet (checkout would refuse it)', () => {
    expect(toStoreBook(row(), [])).toBeNull();
  });

  it('shows a book open to everyone as free, with no prices and no sample button', () => {
    const book = toStoreBook(row({ purchasable: false, available_to_everyone: true }), [])!;
    expect(book).toMatchObject({ free: true, prices: [], hasSample: false });
  });

  it('only offers a sample this book uploaded', () => {
    expect(toStoreBook(row({ preview_file_path: null }), GHS)!.hasSample).toBe(false);
    expect(toStoreBook(row({ preview_file_path: `${ID}/preview-${U}.epub` }), GHS)!.hasSample).toBe(false);
  });
});

describe('loadStoreBooks / loadStoreBook', () => {
  it('lists only visible books, with their prices', async () => {
    const db = makeSupabaseStub({
      books: { data: [row(), row({ id: '22222222-2222-4222-8222-222222222222', slug: 'draft', status: 'draft' })] },
      book_prices: { data: [{ book_id: ID, currency: 'GHS', amount: '120.00' }, { book_id: ID, currency: 'USD', amount: '10' }] },
    });
    const books = await loadStoreBooks(db);
    expect(books.map(b => b.slug)).toEqual(['field-guide']);
    expect(books[0].prices).toEqual([{ currency: 'GHS', amount: 120 }, { currency: 'USD', amount: 10 }]);
  });

  it('returns a book with its contents, marking sample chapters only when there is a sample', async () => {
    const db = makeSupabaseStub({
      books: { data: row() },
      book_prices: { data: [{ book_id: ID, currency: 'GHS', amount: 120 }] },
      book_chapters: { data: [{ title: 'One', is_preview: true }, { title: 'Two', is_preview: false }, { title: '  ', is_preview: false }] },
    });
    const book = await loadStoreBook('field-guide', db);
    expect(book!.chapters).toEqual([{ title: 'One', inSample: true }, { title: 'Two', inSample: false }]);
    expect(JSON.stringify(book)).not.toContain(U);
  });

  it('refuses a malformed slug without querying', async () => {
    const db = makeSupabaseStub({});
    expect(await loadStoreBook('../etc', db)).toBeNull();
    expect(await loadStoreBook('Field Guide', db)).toBeNull();
  });
});
