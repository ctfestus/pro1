import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { BOOK_ACCESS_COLUMNS, canReadBook, type BookAccessRow } from '@/lib/books/access';
import { isBookObjectPath } from '@/lib/books/schema';
import { BOOK_BUCKET, BOOK_SIGNED_URL_TTL_SECONDS } from '@/lib/books/storage';

// GET /api/books/[id]/file
//
// The only way to read an EPUB or PDF book. Access is decided by canReadBook on the service role;
// the answer is a short-lived signed URL to the full file, or to the sample when the reader has no
// access but the book has one. HTML books are refused here: they render through the sandboxed,
// ticketed /api/books/[id]/html route instead, never from a raw storage URL.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { id } = await params;

  const db = auth.serviceDb;
  try {
    const { data: book, error } = await db
      .from('books')
      .select(`${BOOK_ACCESS_COLUMNS}, format, file_path`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

    const row = book as unknown as BookAccessRow & { format: string | null; file_path: string | null };
    // Access first: a reader who may not see this book learns nothing about it, not even its format.
    const access = await canReadBook(db, auth.user.id, row);
    if (access.level === 'none') {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (row.format === 'html') {
      return NextResponse.json({ error: 'HTML books open through the reader.' }, { status: 400 });
    }

    const kind = access.level === 'full' ? 'file' : 'preview';
    const path = kind === 'file' ? row.file_path : row.preview_file_path;
    // Only ever sign an object this book's own upload issued -- never a path copied from another
    // book (file_path is author-writable; the service role would sign anything).
    if (!isBookObjectPath(row.id, path, kind, row.format)) {
      return NextResponse.json({ error: 'This book has no file yet.' }, { status: 404 });
    }

    const { data: signed, error: signError } = await db.storage
      .from(BOOK_BUCKET)
      .createSignedUrl(path, BOOK_SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL returned.');

    return NextResponse.json(
      { url: signed.signedUrl, variant: access.level, format: row.format },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    console.error('[books/file]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not open the book.' }, { status: 500 });
  }
}
