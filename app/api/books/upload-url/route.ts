import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import {
  BOOK_FILE_MAX_BYTES,
  BOOK_FORMATS,
  BOOK_HTML_MAX_BYTES,
  BOOK_MIME_BY_FORMAT,
  bookObjectPath,
  type BookFormat,
} from '@/lib/books/schema';
import { BOOK_BUCKET } from '@/lib/books/storage';

// POST /api/books/upload-url  { bookId, kind: 'file' | 'preview', format, size }
//
// Mints a signed upload URL into the private book-files bucket. The file goes straight from the
// browser to storage (uploadToSignedUrl), so a 50 MB EPUB never passes through a serverless body
// limit. Nothing is recorded on the book here: the editor saves the returned path through
// /api/books once the upload has finished, which is also where the previous object is removed.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const bookId = typeof body?.bookId === 'string' ? body.bookId : '';
  const kind = body?.kind === 'preview' ? 'preview' : body?.kind === 'file' ? 'file' : null;
  const format = (BOOK_FORMATS as readonly string[]).includes(body?.format) ? (body.format as BookFormat) : null;
  const size = typeof body?.size === 'number' && Number.isFinite(body.size) ? body.size : 0;
  if (!bookId || !kind || !format) {
    return NextResponse.json({ error: 'bookId, kind and format are required.' }, { status: 400 });
  }
  const max = format === 'html' ? BOOK_HTML_MAX_BYTES : BOOK_FILE_MAX_BYTES;
  if (size <= 0 || size > max) {
    return NextResponse.json(
      { error: `File must be under ${Math.round(max / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  const db = auth.serviceDb;
  const { data: book, error } = await db.from('books').select('id, user_id').eq('id', bookId).maybeSingle();
  if (error) {
    console.error('[books/upload-url] book lookup failed', error.message);
    return NextResponse.json({ error: 'Could not prepare the upload.' }, { status: 500 });
  }
  if (!book) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  if (book.user_id !== auth.user.id && auth.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // From the stored id, not the request's: Postgres matches a UUID in any case, but the
  // books_*_path_scoped CHECKs compare against id::text, which is lowercase. An uppercase request
  // id would mint a folder the save could never store.
  const path = bookObjectPath(book.id, kind, format, randomUUID());
  const { data, error: signError } = await db.storage.from(BOOK_BUCKET).createSignedUploadUrl(path);
  if (signError || !data?.token) {
    console.error('[books/upload-url] signing failed', signError?.message);
    return NextResponse.json({ error: 'Could not prepare the upload.' }, { status: 502 });
  }

  return NextResponse.json(
    { bucket: BOOK_BUCKET, path, uploadToken: data.token, contentType: BOOK_MIME_BY_FORMAT[format] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
