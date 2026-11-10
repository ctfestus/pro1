import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => { throw new Error('tests pass a db'); } }));

import { loadProductsForCourse, loadStoreBook, loadStoreBooks, toStoreBook, toStoreInstructor } from '@/lib/books/store';
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

  it('shows a running sale with the regular price as the original, and drops an ended one', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const db = makeSupabaseStub({
      books: { data: [row()] },
      book_prices: { data: [
        { book_id: ID, currency: 'GHS', amount: '120.00', sale_amount: '90.00', sale_ends_at: future },
        { book_id: ID, currency: 'USD', amount: '10', sale_amount: '8', sale_ends_at: '2020-01-01T00:00:00Z' },
      ] },
    });
    const [book] = await loadStoreBooks(db);
    expect(book.prices).toEqual([{ currency: 'GHS', amount: 90, original: 120, saleEndsAt: future }, { currency: 'USD', amount: 10 }]);
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

describe('the instructor shown on a product page', () => {
  it('keeps name, photo, bio and well-formed social links only', () => {
    expect(toStoreInstructor({
      full_name: ' Ama Mensah ', avatar_url: 'https://res.cloudinary.com/x/a.jpg', bio: '<b>Data</b> coach',
      social_links: { linkedin: 'https://linkedin.com/in/ama', twitter: 'javascript:alert(1)', website: 'ama.dev', github: '', youtube: 5, evil: 'https://x.test' },
      email: 'ama@example.test', role: 'instructor',
    })).toEqual({
      name: 'Ama Mensah', avatar: 'https://res.cloudinary.com/x/a.jpg', bio: 'Data coach',
      links: [{ key: 'linkedin', url: 'https://linkedin.com/in/ama' }, { key: 'website', url: 'https://ama.dev/' }],
    });
  });

  it('drops an unsafe photo and needs a name', () => {
    expect(toStoreInstructor({ full_name: 'Ama', avatar_url: 'javascript:alert(1)' })!.avatar).toBeNull();
    expect(toStoreInstructor({ full_name: 'Ama', avatar_url: 'data:image/png;base64,xx' })!.avatar).toBeNull();
    expect(toStoreInstructor({ full_name: '  ' })).toBeNull();
    expect(toStoreInstructor(null)).toBeNull();
  });

  it('is loaded with the product, and is simply absent without a profile', async () => {
    const db = makeSupabaseStub({
      books: { data: row({ user_id: 'owner-1' }) },
      book_prices: { data: [{ book_id: ID, currency: 'GHS', amount: 120 }] },
      book_chapters: { data: [] },
      students: { data: { full_name: 'Ama Mensah', avatar_url: null, bio: null, social_links: {} } },
    });
    const book = await loadStoreBook('field-guide', db);
    expect(book!.instructor).toEqual({ name: 'Ama Mensah', avatar: null, bio: null, links: [] });
    expect(JSON.stringify(book)).not.toContain('owner-1');

    const none = makeSupabaseStub({ books: { data: row() }, book_prices: { data: [{ book_id: ID, currency: 'GHS', amount: 120 }] }, book_chapters: { data: [] } });
    expect((await loadStoreBook('field-guide', none))!.instructor).toBeNull();
  });
});

describe('products recommended with a course (migration 240)', () => {
  const COURSE = '55555555-5555-4555-8555-555555555555';

  it('returns only products the public may get, at most three, without object paths', async () => {
    const draft = row({ id: '22222222-2222-4222-8222-222222222222', status: 'draft' });
    const rows = [row(), draft, ...Array.from({ length: 4 }, (_, i) => row({ id: `3333333${i}-3333-4333-8333-333333333333`, slug: `p${i}`, file_path: `3333333${i}-3333-4333-8333-333333333333/file-${U}.pdf`, preview_file_path: null }))];
    const db = makeSupabaseStub({ books: { data: rows }, book_prices: { data: rows.map(r => ({ book_id: r.id, currency: 'GHS', amount: 10 })) } });
    const out = await loadProductsForCourse(COURSE, db);
    expect(out).toHaveLength(3);
    expect(out.map(b => b.id)).not.toContain(draft.id);
    expect(JSON.stringify(out)).not.toContain(U);
  });

  it('refuses a malformed course id without querying', async () => {
    expect(await loadProductsForCourse('nope', makeSupabaseStub({}))).toEqual([]);
  });
});
