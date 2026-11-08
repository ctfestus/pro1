import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { BOOK_ACCESS_COLUMNS, canReadBook, type BookAccessRow } from '@/lib/books/access';
import { issueHtmlTicket } from '@/lib/books/html-ticket';
import { isBookObjectPath } from '@/lib/books/schema';

// POST /api/books/[id]/html-ticket
//
// Step one of opening an HTML book: a Bearer-authenticated access check that returns a short-lived
// ticketed URL for the sandboxed iframe (see lib/books/html-ticket.ts for why an iframe needs one).
// The reader asks again when the ticket lapses; the page already loaded keeps working.
// Body { variant: 'sample' } (optional) lets someone with full access open the sample instead, so the
// owner can check what non-buyers will see.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (row.format !== 'html') {
      return NextResponse.json({ error: 'This book is not an HTML book.' }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const wantsSample = body?.variant === 'sample';
    const variant = access.level === 'full' && !wantsSample ? 'full' : 'preview';
    const path = variant === 'full' ? row.file_path : row.preview_file_path;
    if (!isBookObjectPath(row.id, path, variant === 'full' ? 'file' : 'preview', 'html')) {
      return NextResponse.json({ error: 'This book has no file yet.' }, { status: 404 });
    }

    const { ticket, expiresAt } = issueHtmlTicket({ bookId: id, userId: auth.user.id, variant });
    return NextResponse.json(
      {
        url: `/api/books/${encodeURIComponent(id)}/html?t=${encodeURIComponent(ticket)}`,
        variant,
        expiresAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    console.error('[books/html-ticket]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not open the book.' }, { status: 500 });
  }
}
