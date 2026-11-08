import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { BOOK_ACCESS_COLUMNS, canReadBook, isPublicSampleAvailable, type BookAccessRow } from '@/lib/books/access';
import { verifyHtmlTicket } from '@/lib/books/html-ticket';
import { BOOK_HTML_MAX_BYTES, isBookObjectPath } from '@/lib/books/schema';
import { limitBodyStream } from '@/lib/read-body-with-limit';
import { BOOK_BUCKET } from '@/lib/books/storage';

// GET /api/books/[id]/html?t=<ticket>
//
// Shows a self-contained HTML book (usually its free sample) in a sandboxed iframe, so people can
// preview it before buying. Modelled on /api/html-embed, except the file is private: it is read
// with the service role after a ticket check instead of a public-URL allowlist. The page is served
// exactly as uploaded; nothing is injected.
//
// The CSP sandbox gives the document an opaque origin -- the book's scripts run, but it cannot read
// this app's cookies, storage, or DOM. allow-same-origin must never be added: with allow-scripts
// it would let the book remove its own sandbox. middleware.ts skips the app CSP for this path so
// the sandbox policy is the only one (two CSP headers enforce the intersection, and the app's
// nonce-based script-src would block the book's inline scripts).
//
// Unauthenticated by header on purpose: iframe navigations cannot send Bearer tokens. The ticket is
// the credential, and access is re-checked here so a refund or archive inside the ticket's few
// minutes still takes effect.
export const dynamic = 'force-dynamic';

const SANDBOX_CSP = 'sandbox allow-scripts allow-popups';

function plain(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claims = verifyHtmlTicket(req.nextUrl.searchParams.get('t'), id);
  if (!claims) return plain(401, 'This preview link has expired. Open the preview again.');

  const db = adminClient();
  try {
    const { data: book, error } = await db
      .from('books')
      .select(`${BOOK_ACCESS_COLUMNS}, format, file_path`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!book) return plain(404, 'Book not found.');

    const row = book as unknown as BookAccessRow & { format: string | null; file_path: string | null };
    if (claims.variant === 'public-sample') {
      // The store's open sample: nobody signed in, so the public rule decides, re-checked here so
      // unpublishing (or a licence ending) inside the ticket's few minutes still takes effect.
      if (!isPublicSampleAvailable(row)) return plain(404, 'Book not found.');
    } else {
      const access = await canReadBook(db, claims.userId as string, row);
      if (access.level === 'none') return plain(access.status, access.error);
      // A ticket for the full book is only honoured while the reader still has full access.
      if (claims.variant === 'full' && access.level !== 'full') return plain(403, 'You do not have access to this book.');
    }
    if (row.format !== 'html') return plain(400, 'This book is not an HTML book.');

    // Only a 'full' ticket ever reaches the full file; 'preview' and 'public-sample' get the sample.
    const kind = claims.variant === 'full' ? 'file' : 'preview';
    const path = kind === 'file' ? row.file_path : row.preview_file_path;
    // Only an object this book's own upload issued -- never a path copied from another book.
    if (!isBookObjectPath(row.id, path, kind, 'html')) return plain(404, 'This book has no file yet.');

    // Fetched through a short-lived signed URL rather than storage.download(), which buffers the
    // whole object: the bucket allows 100 MB, so the 10 MB HTML cap is enforced while streaming.
    const { data: signed, error: signError } = await db.storage.from(BOOK_BUCKET).createSignedUrl(path, 60);
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL returned.');
    // The timeout covers getting a response from storage; once it answers, the body streams to the
    // reader at their pace (a slow connection must not cut a large book off half way).
    const abort = new AbortController();
    const headerTimer = setTimeout(() => abort.abort(new Error('Storage did not respond in time')), 15_000);
    let upstream: Response;
    try {
      // identity: a compressed transfer would make Content-Length the compressed size, not the
      // size of the body we read.
      upstream = await fetch(signed.signedUrl, { redirect: 'error', signal: abort.signal, headers: { 'Accept-Encoding': 'identity' } });
    } finally {
      clearTimeout(headerTimer);
    }
    if (!upstream.ok) throw new Error(`Storage returned ${upstream.status}`);
    const rawLength = upstream.headers.get('content-length');
    const declared = rawLength === null ? NaN : Number(rawLength);
    if (Number.isFinite(declared) && declared > BOOK_HTML_MAX_BYTES) {
      await upstream.body?.cancel('Book exceeds size limit');
      return plain(413, 'This book file is too large to open.');
    }

    // Always streamed, never buffered: a buffered serverless response is capped (about 4.5 MB on
    // Vercel), well under the 10 MB HTML limit, and storage may answer chunked with no length. The
    // guard cuts the stream off once more bytes arrive than the cap allows. An undeclared oversized
    // body therefore ends as a truncated page rather than a 413; that is acceptable because the
    // save route already checked the stored object's real size, so this is only a backstop.
    const body = upstream.body ? limitBodyStream(upstream.body, BOOK_HTML_MAX_BYTES) : new Uint8Array(0);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': SANDBOX_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e: any) {
    console.error('[books/html]', e?.message ?? e);
    return plain(500, 'Could not open the book.');
  }
}
