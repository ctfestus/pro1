import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';
import { DELETE, GET, POST, PUT } from '@/app/api/books/route';

const mockRequireRole = vi.mocked(requireRole);

const BOOK_ID = 'abcdef12-3456-4abc-8def-abcdef123456';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const COHORT = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 24 * 60 * 60 * 1000;

const BOOK = {
  id: BOOK_ID, user_id: 'author-1', slug: 'sql-a1b2', title: 'SQL', status: 'draft',
  cohort_ids: [], available_to_everyone: false, purchasable: false, royalty_pct: 0,
  format: 'epub', file_path: `${BOOK_ID}/file-${U}.epub`, file_size: 1000, preview_file_path: null,
  license_type: 'own', license_expires_at: null, updated_at: '2026-11-08T10:00:00.000Z',
};

type Storage = { info: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
let storage: Storage;
let rpc: Mock<(fn: string, args: Record<string, any>) => QueryResult>;
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

/** Wrap the stub so every query-builder call is recorded, to assert what was read and written. */
function recording(base: any) {
  const wrap = (builder: any, table: string): any => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
      return (...args: unknown[]) => {
        calls.push({ table, method: String(prop), args });
        return wrap(target[prop](...args), table);
      };
    },
  });
  return { ...base, from: (table: string) => wrap(base.from(table), table) };
}
const callsTo = (table: string, method: string) => calls.filter(c => c.table === table && c.method === method);

/**
 * `row` is the stored book. save_book answers like the database: the stored row with the patch
 * applied, unless `saveResult` overrides it (an error, say).
 */
function authAs(
  userId: string,
  role: string,
  row: any,
  extra: Record<string, QueryResult | QueryResult[]> = {},
  saveResult?: QueryResult,
) {
  storage = {
    info: vi.fn(async () => ({ data: { size: 5000, contentType: 'application/epub+zip' }, error: null })),
    remove: vi.fn(async () => ({ data: null, error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
  };
  rpc = vi.fn((fn: string, args: Record<string, any>): QueryResult => (
    fn === 'save_book'
      ? saveResult ?? { data: { ...row, ...args.p_patch }, error: null }
      : { data: { ok: true }, error: null }
  ));
  calls = [];
  const tables = { books: { data: row }, book_prices: { data: [] }, ...extra };
  const serviceDb = {
    ...recording(makeSupabaseStub(tables, (fn, args) => rpc(fn, args))),
    storage: { from: () => storage },
  };
  mockRequireRole.mockResolvedValue({ user: { id: userId }, role, serviceDb } as any);
}

const saveArgs = () => rpc.mock.calls.find(c => c[0] === 'save_book')?.[1];

const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/books', { method: 'PUT', body: JSON.stringify(body) }));

describe('PUT /api/books', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("refuses an instructor editing someone else's book", async () => {
    authAs('author-2', 'instructor', BOOK);
    expect((await put({ id: BOOK_ID, title: 'Mine now' })).status).toBe(403);
    expect(saveArgs()).toBeUndefined();
  });

  it('saves everything in one save_book call, with the version it read', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, title: 'SQL 2', chapters: [{ id: U, title: 'One', locator: { href: 'one.xhtml', pageStart: 4 } }] });
    expect(res.status).toBe(200);
    expect(rpc.mock.calls.filter(c => c[0] === 'save_book')).toHaveLength(1);
    expect(saveArgs()).toMatchObject({
      p_book_id: BOOK_ID,
      p_expected_updated_at: BOOK.updated_at,
      p_patch: { title: 'SQL 2', status: 'draft' },
      p_chapters: [{ id: U, title: 'One', locator: { href: 'one.xhtml' }, estimated_minutes: null, required: true, is_preview: false }],
      p_clear_chapters: false,
      p_prices: null,
    });
    // Nothing is written outside the transaction.
    for (const [table, method] of [['books', 'update'], ['book_prices', 'upsert'], ['book_prices', 'delete'], ['cohort_assignments', 'upsert']]) {
      expect(callsTo(table, method)).toHaveLength(0);
    }
  });

  it('passes the version the editor loaded, so the database refuses an outdated save', async () => {
    authAs('author-1', 'instructor', BOOK);
    await put({ id: BOOK_ID, title: 'x', expectedUpdatedAt: BOOK.updated_at });
    expect(saveArgs()?.p_expected_updated_at).toBe(BOOK.updated_at);
  });

  it('refuses early when the editor loaded an older version', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, title: 'Stale', expectedUpdatedAt: '2026-11-08T09:00:00Z' });
    expect(res.status).toBe(409);
    expect(saveArgs()).toBeUndefined();
  });

  it('reports a save that lost the race to a concurrent one as 409, touching no files', async () => {
    authAs('author-1', 'instructor', BOOK, {}, { data: null, error: { code: 'BK409', message: 'book changed' } });
    expect((await put({ id: BOOK_ID, title: 'x' })).status).toBe(409);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('reports an unintended empty chapter list as 400', async () => {
    authAs('author-1', 'instructor', BOOK, {}, { data: null, error: { code: 'BK400', message: 'would remove every chapter' } });
    expect((await put({ id: BOOK_ID, chapters: [] })).status).toBe(400);
  });

  it('passes an explicit clear when the author removed every chapter', async () => {
    authAs('author-1', 'instructor', BOOK);
    expect((await put({ id: BOOK_ID, chapters: [], clearChapters: true })).status).toBe(200);
    expect(saveArgs()).toMatchObject({ p_chapters: [], p_clear_chapters: true });
  });

  it('turns any other database failure into a 500, touching no files', async () => {
    authAs('author-1', 'instructor', BOOK, {}, { data: null, error: { code: 'XX000', message: 'boom' } });
    expect((await put({ id: BOOK_ID, title: 'x', file: { path: `${BOOK_ID}/file-${U2}.epub`, format: 'epub' } })).status).toBe(500);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('lets the owning instructor sell their book and set its price and royalty', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, purchasable: true, royaltyPct: 30, prices: [{ currency: 'GHS', amount: 120 }] });
    expect(res.status).toBe(200);
    expect(saveArgs()).toMatchObject({
      p_patch: { purchasable: true, royalty_pct: 30 },
      p_prices: [{ currency: 'GHS', amount: 120 }],
    });
  });

  it("refuses an instructor setting sale terms on someone else's book", async () => {
    authAs('author-2', 'instructor', BOOK);
    expect((await put({ id: BOOK_ID, purchasable: true, prices: [{ currency: 'GHS', amount: 1 }] })).status).toBe(403);
  });

  it("lets an admin put any author's book on sale", async () => {
    authAs('admin-1', 'admin', BOOK);
    expect((await put({ id: BOOK_ID, purchasable: true, prices: [{ currency: 'USD', amount: 9 }] })).status).toBe(200);
  });

  it('refuses to publish a for-sale book with no price', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, status: 'published', purchasable: true, prices: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).problems).toContain('Set at least one price to sell this book.');
    expect(saveArgs()).toBeUndefined();
  });

  it('refuses to publish a book without a licence, and says why', async () => {
    authAs('author-1', 'instructor', { ...BOOK, license_type: null });
    const res = await put({ id: BOOK_ID, status: 'published', cohortIds: [COHORT] });
    expect(res.status).toBe(400);
    expect((await res.json()).problems).toContain('Choose a licence type.');
  });

  it('refuses to publish a book that reaches nobody', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, status: 'published' });
    expect(res.status).toBe(400);
    expect((await res.json()).problems).toContain('Choose who can read it: everyone, a cohort, or sell it.');
  });

  it('publishes to a cohort', async () => {
    authAs('author-1', 'instructor', BOOK);
    expect((await put({ id: BOOK_ID, status: 'published', cohortIds: [COHORT] })).status).toBe(200);
    expect(saveArgs()?.p_patch).toMatchObject({ status: 'published', cohort_ids: [COHORT], available_to_everyone: false });
  });

  it('refuses a file path that belongs to another book, and never asks storage about it', async () => {
    authAs('author-1', 'instructor', BOOK);
    const res = await put({ id: BOOK_ID, file: { path: `${OTHER_ID}/file-${U2}.epub`, format: 'epub' } });
    expect(res.status).toBe(400);
    expect(storage.info).not.toHaveBeenCalled();
  });

  it('refuses an oversized upload by its real stored size, deleting it', async () => {
    authAs('author-1', 'instructor', BOOK);
    storage.info.mockResolvedValue({ data: { size: 50 * 1024 * 1024, contentType: 'text/html' }, error: null });
    const path = `${BOOK_ID}/file-${U2}.html`;
    expect((await put({ id: BOOK_ID, file: { path, format: 'html' } })).status).toBe(400);
    expect(storage.remove).toHaveBeenCalledWith([path]);
    expect(saveArgs()).toBeUndefined();
  });

  it('saves a replacement file with its real size, then removes only the replaced object', async () => {
    authAs('author-1', 'instructor', BOOK);
    const path = `${BOOK_ID}/file-${U2}.epub`;
    expect((await put({ id: BOOK_ID, file: { path, format: 'epub' } })).status).toBe(200);
    expect(saveArgs()?.p_patch).toMatchObject({ file_path: path, file_size: 5000, format: 'epub' });
    expect(storage.remove).toHaveBeenCalledWith([BOOK.file_path]);
  });

  it('clears the old sample when a new file changes the format', async () => {
    const book = { ...BOOK, preview_file_path: `${BOOK_ID}/preview-${U}.epub` };
    authAs('author-1', 'instructor', book);
    storage.info.mockResolvedValue({ data: { size: 2000, contentType: 'text/html' }, error: null });
    const path = `${BOOK_ID}/file-${U2}.html`;
    expect((await put({ id: BOOK_ID, file: { path, format: 'html' } })).status).toBe(200);
    expect(saveArgs()?.p_patch).toMatchObject({ format: 'html', preview_file_path: null });
    expect(storage.remove.mock.calls[0][0]).toEqual(expect.arrayContaining([book.file_path, book.preview_file_path]));
  });

  it("leaves another tab's fresh unsaved upload alone, but removes abandoned ones", async () => {
    authAs('author-1', 'instructor', BOOK);
    const fresh = `file-${U2}.epub`;
    const old = 'preview-cccccccc-cccc-4ccc-8ccc-cccccccccccc.epub';
    storage.list.mockResolvedValue({
      data: [
        { name: `file-${U}.epub`, created_at: new Date(Date.now() - 3 * DAY).toISOString() },
        { name: fresh, created_at: new Date(Date.now() - 60 * 1000).toISOString() },
        { name: old, created_at: new Date(Date.now() - 2 * DAY).toISOString() },
      ],
      error: null,
    });
    expect((await put({ id: BOOK_ID, title: 'Metadata only' })).status).toBe(200);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([`${BOOK_ID}/${old}`]);
  });

  it('rejects an untitled chapter before writing anything', async () => {
    authAs('author-1', 'instructor', BOOK);
    expect((await put({ id: BOOK_ID, chapters: [{ title: '' }] })).status).toBe(400);
    expect(saveArgs()).toBeUndefined();
  });

  it('rejects a malformed id with 400', async () => {
    authAs('author-1', 'instructor', BOOK);
    expect((await put({ id: 'not-a-uuid' })).status).toBe(400);
  });
});

describe('POST /api/books', () => {
  it('creates a draft owned by the caller', async () => {
    authAs('author-1', 'instructor', { id: BOOK_ID, slug: 'sql-x' });
    const res = await POST(new NextRequest('http://localhost/api/books', { method: 'POST', body: JSON.stringify({ title: 'SQL' }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: BOOK_ID, slug: 'sql-x' });
    expect(callsTo('books', 'insert')[0].args[0]).toMatchObject({ user_id: 'author-1', title: 'SQL', status: 'draft' });
  });

  it('needs a title', async () => {
    authAs('author-1', 'instructor', null);
    const res = await POST(new NextRequest('http://localhost/api/books', { method: 'POST', body: JSON.stringify({ title: ' ' }) }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/books', () => {
  const del = (id = BOOK_ID) => DELETE(new NextRequest(`http://localhost/api/books?id=${id}`, { method: 'DELETE' }));
  const counts = (purchases: number, owners: number) => ({
    book_purchases: { data: null, count: purchases },
    book_entitlements: { data: null, count: owners },
    cohort_assignments: { data: null },
  });

  it('refuses to delete a book someone bought; it must be archived', async () => {
    authAs('author-1', 'instructor', BOOK, counts(1, 1));
    expect((await del()).status).toBe(409);
    expect(callsTo('books', 'delete')).toHaveLength(0);
  });

  it('refuses to delete a book with an unfinished order', async () => {
    authAs('author-1', 'instructor', BOOK, counts(1, 0));
    expect((await del()).status).toBe(409);
    expect(callsTo('books', 'delete')).toHaveLength(0);
  });

  it("refuses an instructor deleting someone else's book", async () => {
    authAs('author-2', 'instructor', BOOK);
    expect((await del()).status).toBe(403);
  });

  it('deletes an unowned book and its files, using the stored id', async () => {
    authAs('author-1', 'instructor', BOOK, counts(0, 0));
    storage.list.mockResolvedValue({ data: [{ name: `file-${U}.epub` }], error: null });
    expect((await del(BOOK_ID.toUpperCase())).status).toBe(200);
    expect(storage.list).toHaveBeenCalledWith(BOOK_ID, { limit: 1000 });
    expect(storage.remove).toHaveBeenCalledWith([`${BOOK_ID}/file-${U}.epub`]);
  });
});

describe('GET /api/books', () => {
  it('limits an instructor to their own books, but not an admin', async () => {
    authAs('author-1', 'instructor', []);
    await GET(new NextRequest('http://localhost/api/books'));
    expect(callsTo('books', 'eq')).toEqual([{ table: 'books', method: 'eq', args: ['user_id', 'author-1'] }]);
    authAs('admin-1', 'admin', []);
    await GET(new NextRequest('http://localhost/api/books'));
    expect(callsTo('books', 'eq')).toEqual([]);
  });

  it('lists books with paid sales counts', async () => {
    authAs('author-1', 'instructor', [{ id: BOOK_ID, title: 'SQL' }], {
      book_purchases: { data: [{ book_id: BOOK_ID }, { book_id: BOOK_ID }], count: 2 },
    });
    const res = await GET(new NextRequest('http://localhost/api/books'));
    expect(res.status).toBe(200);
    expect((await res.json()).books[0]).toMatchObject({ id: BOOK_ID, sold: 2 });
    expect(callsTo('book_purchases', 'eq')).toContainEqual({ table: 'book_purchases', method: 'eq', args: ['status', 'paid'] });
  });
});
