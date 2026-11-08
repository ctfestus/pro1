import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const state: { book: any; signed: { path: string; opts: any }[] } = { book: null, signed: [] };

vi.mock('@/lib/admin-client', async () => {
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  return {
    adminClient: () => ({
      ...makeSupabaseStub({ books: { data: state.book } }),
      storage: {
        from: () => ({
          createSignedUrl: async (path: string, _ttl: number, opts?: any) => {
            state.signed.push({ path, opts });
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
        }),
      },
    }),
  };
});
const redis = vi.hoisted(() => ({ client: null as any, limited: false }));
vi.mock('@/lib/redis', () => ({ getRedis: () => redis.client }));
vi.mock('@/lib/rate-limit', () => ({ bumpRateLimit: vi.fn(async () => redis.limited) }));

import { GET } from '@/app/api/books/[id]/sample/route';
import { verifyHtmlTicket } from '@/lib/books/html-ticket';

const book = (format: string, extra: Record<string, unknown> = {}) => ({
  id: BOOK_ID,
  slug: 'field-guide',
  status: 'published',
  purchasable: true,
  license_expires_at: null,
  format,
  preview_file_path: `${BOOK_ID}/preview-${U}.${format}`,
  ...extra,
});

const call = (id = BOOK_ID) => GET(new NextRequest(`http://localhost/api/books/${id}/sample`), { params: Promise.resolve({ id }) });

const ORIGINAL_SECRET = process.env.BOOK_HTML_TICKET_SECRET;
beforeEach(() => {
  process.env.BOOK_HTML_TICKET_SECRET = 'test-secret';
  state.signed = [];
  redis.client = null;
  redis.limited = false;
});
afterEach(() => { process.env.BOOK_HTML_TICKET_SECRET = ORIGINAL_SECRET; });

describe('GET /api/books/[id]/sample (public)', () => {
  it('opens a PDF sample inline, signing only the sample object', async () => {
    state.book = book('pdf');
    const res = await call();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ format: 'pdf', download: false });
    expect(state.signed).toEqual([{ path: `${BOOK_ID}/preview-${U}.pdf`, opts: undefined }]);
  });

  it('never reaches the full file, even when the row carries one', async () => {
    state.book = { ...book('pdf'), file_path: `${BOOK_ID}/file-${U}.pdf` };
    await call();
    expect(state.signed.map(s => s.path)).toEqual([`${BOOK_ID}/preview-${U}.pdf`]);
  });

  it('downloads an EPUB sample under a sample filename', async () => {
    state.book = book('epub');
    const d = await (await call()).json();
    expect(d.download).toBe(true);
    expect(state.signed[0].opts).toEqual({ download: 'field-guide-sample.epub' });
  });

  it('gives an HTML sample a public-sample ticket for the sandboxed page, signing nothing', async () => {
    state.book = book('html');
    const d = await (await call()).json();
    expect(state.signed).toEqual([]);
    const ticket = new URL(d.url, 'http://localhost').searchParams.get('t');
    expect(d.url.startsWith(`/api/books/${BOOK_ID}/html?t=`)).toBe(true);
    expect(verifyHtmlTicket(ticket, BOOK_ID)).toMatchObject({ variant: 'public-sample', userId: null });
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['an archived book', { status: 'archived' }],
    ['a book not for sale', { purchasable: false }],
    ['an expired licence', { license_expires_at: '2020-01-01T00:00:00Z' }],
    ['no sample', { preview_file_path: null }],
    ["another book's object", { preview_file_path: `22222222-2222-4222-8222-222222222222/preview-${U}.pdf` }],
  ])('is a 404 for %s', async (_label, extra) => {
    state.book = book('pdf', extra);
    expect((await call()).status).toBe(404);
    expect(state.signed).toEqual([]);
  });

  it('is a 404 for an unknown or malformed id', async () => {
    state.book = null;
    expect((await call()).status).toBe(404);
    expect((await call('not-a-uuid')).status).toBe(404);
  });

  it('is rate limited per visitor when Redis is available', async () => {
    state.book = book('pdf');
    redis.client = {};
    redis.limited = true;
    expect((await call()).status).toBe(429);
    expect(state.signed).toEqual([]);
  });
});
