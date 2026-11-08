import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE = `${BOOK_ID}/file-${U}.html`;
const PREVIEW = `${BOOK_ID}/preview-${U}.html`;

const state: { tables: Record<string, any>; signed: string[] } = { tables: {}, signed: [] };

vi.mock('@/lib/admin-client', async () => {
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  return {
    adminClient: () => ({
      ...makeSupabaseStub(state.tables),
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => {
            state.signed.push(path);
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
        }),
      },
    }),
  };
});

import { GET } from '@/app/api/books/[id]/html/route';
import { issueHtmlTicket } from '@/lib/books/html-ticket';

const BOOK = {
  id: BOOK_ID,
  user_id: 'owner-1',
  status: 'published',
  cohort_ids: ['cohort-a'],
  available_to_everyone: false,
  purchasable: false,
  license_expires_at: null,
  preview_file_path: PREVIEW,
  format: 'html',
  file_path: FILE,
};

const HTML = '<html><body><section data-chapter id="ch1"><h1>One</h1></section></body></html>';
let fetchMock: ReturnType<typeof vi.fn>;

/** A storage response streamed in chunks, optionally without a Content-Length. */
function streamed(totalBytes: number, opts: { declare?: boolean } = {}) {
  let sent = 0;
  const pulls = { count: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls.count += 1;
      if (sent >= totalBytes) { controller.close(); return; }
      const n = Math.min(1024 * 1024, totalBytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(120));
    },
  });
  const headers = opts.declare ? { 'content-length': String(totalBytes) } : undefined;
  return { response: new Response(body, { status: 200, headers }), pulls };
}

const ORIGINAL_SECRET = process.env.BOOK_HTML_TICKET_SECRET;
beforeEach(() => {
  process.env.BOOK_HTML_TICKET_SECRET = 'test-secret';
  state.signed = [];
  state.tables = {
    books: { data: BOOK },
    students: { data: { role: 'student', cohort_id: 'cohort-a' } },
    learning_paths: { data: null },
    book_entitlements: { data: null },
  };
  fetchMock = vi.fn(async () => new Response(HTML, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  process.env.BOOK_HTML_TICKET_SECRET = ORIGINAL_SECRET;
  vi.unstubAllGlobals();
});

const ticketFor = (variant: 'full' | 'preview' = 'full', bookId = BOOK_ID, nowMs?: number) =>
  issueHtmlTicket({ bookId, userId: 'u1', variant }, nowMs).ticket;

const call = (ticket: string | null, id = BOOK_ID) =>
  GET(
    new NextRequest(`http://localhost/api/books/${id}/html${ticket ? `?t=${encodeURIComponent(ticket)}` : ''}`),
    { params: Promise.resolve({ id }) },
  );

describe('GET /api/books/[id]/html', () => {
  it('refuses a request without a ticket', async () => {
    expect((await call(null)).status).toBe(401);
  });

  it('refuses a ticket issued for another book', async () => {
    expect((await call(ticketFor('full', OTHER_ID))).status).toBe(401);
  });

  it('refuses an expired ticket', async () => {
    expect((await call(ticketFor('full', BOOK_ID, Date.now() - 10 * 60 * 1000))).status).toBe(401);
  });

  it('serves the book sandboxed, without same-origin, exactly as uploaded', async () => {
    const res = await call(ticketFor());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await res.text();
    expect(body).not.toContain('<script data-book-bridge');
    expect(body).toContain('<h1>One</h1>');
    expect(state.signed).toEqual([FILE]);
  });

  it('stops honouring a full-book ticket once access is gone (refund inside the ticket window)', async () => {
    state.tables.books = { data: { ...BOOK, purchasable: true } };
    state.tables.students = { data: { role: 'student', cohort_id: null } };
    expect((await call(ticketFor('full'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not serve the sample of a cohort-only book outside the cohort', async () => {
    state.tables.students = { data: { role: 'student', cohort_id: null } };
    expect((await call(ticketFor('preview'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fetches another book's object, even for the book's own author", async () => {
    state.tables.books = { data: { ...BOOK, user_id: 'u1', status: 'draft', file_path: `${OTHER_ID}/file-${U}.html` } };
    expect((await call(ticketFor('full'))).status).toBe(404);
    expect(state.signed).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a declared oversize file without reading its body', async () => {
    const { response, pulls } = streamed(50 * 1024 * 1024, { declare: true });
    fetchMock.mockResolvedValue(response);
    expect((await call(ticketFor())).status).toBe(413);
    expect(pulls.count).toBeLessThanOrEqual(1);
  });

  it('stops reading an undeclared oversize file at the cap, not at the end', async () => {
    const { response, pulls } = streamed(50 * 1024 * 1024);
    fetchMock.mockResolvedValue(response);
    const res = await call(ticketFor());
    // Streamed without a declared size, so it cannot be refused up front; the stream errors instead.
    await expect(res.arrayBuffer()).rejects.toThrow();
    // 10 MB cap in 1 MB chunks: it gives up around chunk 11, far short of 50.
    expect(pulls.count).toBeLessThan(15);
  });

  it('streams a large chunked file with no Content-Length instead of buffering it', async () => {
    const size = Math.round(8.2 * 1024 * 1024);
    const { response, pulls } = streamed(size);
    fetchMock.mockResolvedValue(response);
    const res = await call(ticketFor());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
    // Passed through, not buffered: only stream read-ahead has happened when the response returns.
    expect(pulls.count).toBeLessThanOrEqual(3);
    expect((await res.arrayBuffer()).byteLength).toBe(size);
  });

  it('streams a declared file under the cap instead of buffering it (serverless response cap)', async () => {
    const size = 9 * 1024 * 1024;
    const { response, pulls } = streamed(size, { declare: true });
    fetchMock.mockResolvedValue(response);
    const res = await call(ticketFor());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
    // Passed through, not buffered: only stream read-ahead (a chunk or two of nine) has happened.
    expect(pulls.count).toBeLessThanOrEqual(3);
    expect((await res.arrayBuffer()).byteLength).toBe(size);
  });

  it('asks storage for an uncompressed body so the declared size is the real size', async () => {
    await call(ticketFor());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Accept-Encoding']).toBe('identity');
  });

  it('cuts off a streamed body that runs past the cap despite a small declared size', async () => {
    const { response } = streamed(50 * 1024 * 1024);
    response.headers.set('content-length', '1000');
    fetchMock.mockResolvedValue(response);
    const res = await call(ticketFor());
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
