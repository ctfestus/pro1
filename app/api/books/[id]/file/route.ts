import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { BOOK_ACCESS_COLUMNS, canReadBook, type BookAccessRow } from '@/lib/books/access';
import { isBookObjectPath } from '@/lib/books/schema';
import { BOOK_BUCKET, BOOK_SIGNED_URL_TTL_SECONDS } from '@/lib/books/storage';

// GET /api/books/[id]/file
//
// How a buyer (or a cohort reader, or the owner) downloads a book, and how anyone browsing a for-sale
// book gets its free sample. Access is decided by canReadBook on the service role; the answer is a
// short-lived signed storage URL.
//
//   full access  -> the whole file, as a download (any format, including HTML: it is saved to disk,
//                   never rendered on this app's origin)
//   sample, PDF  -> opens in the browser's own PDF viewer
//   sample, EPUB -> a download (browsers cannot show EPUB)
//   sample, HTML -> refused here; it is shown through the sandboxed /api/books/[id]/html route
//
// Query options, used by the editor's preview buttons:
//   ?variant=sample -> someone with full access (the owner, an admin) gets the sample instead, to
//                      check what non-buyers will see
//   ?view=1         -> a PDF opens in the browser instead of downloading
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { id } = await params;

  const db = auth.serviceDb;
  try {
    const { data: book, error } = await db
      .from('books')
      .select(`${BOOK_ACCESS_COLUMNS}, format, file_path, slug`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

    const row = book as unknown as BookAccessRow & { format: string | null; file_path: string | null; slug: string | null };
    // Access first: a reader who may not see this book learns nothing about it, not even its format.
    const access = await canReadBook(db, auth.user.id, row);
    if (access.level === 'none') {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const wantsSample = req.nextUrl.searchParams.get('variant') === 'sample';
    const kind = access.level === 'full' && !wantsSample ? 'file' : 'preview';
    if (kind === 'preview' && row.format === 'html') {
      return NextResponse.json({ error: 'HTML samples open in the preview.' }, { status: 400 });
    }
    const path = kind === 'file' ? row.file_path : row.preview_file_path;
    // Only ever sign an object this book's own upload issued -- never a path copied from another
    // book (file_path is author-writable; the service role would sign anything).
    if (!isBookObjectPath(row.id, path, kind, row.format)) {
      return NextResponse.json({ error: 'This book has no file yet.' }, { status: 404 });
    }

    const inline = row.format === 'pdf' && (kind === 'preview' || req.nextUrl.searchParams.get('view') === '1');
    const filename = `${row.slug || 'book'}${kind === 'preview' ? '-sample' : ''}.${row.format}`;
    const { data: signed, error: signError } = await db.storage
      .from(BOOK_BUCKET)
      .createSignedUrl(path, BOOK_SIGNED_URL_TTL_SECONDS, inline ? undefined : { download: filename });
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL returned.');

    return NextResponse.json(
      { url: signed.signedUrl, variant: access.level, format: row.format, download: !inline },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    console.error('[books/file]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not get the book file.' }, { status: 500 });
  }
}
