import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { BOOK_ACCESS_COLUMNS, canReadBook, type BookAccessRow } from '@/lib/books/access';

// GET /api/books/[id]/access -> { owned }
//
// For the store's book page: whether the signed-in visitor can already download this book (they
// bought it, were given it, have it through their cohort, or own/administer it), so the page
// offers Download instead of Buy. The same decision the download route makes (canReadBook).
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const db = auth.serviceDb;
  try {
    const { data: book, error } = await db.from('books').select(BOOK_ACCESS_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!book) return NextResponse.json({ owned: false }, { headers: { 'Cache-Control': 'no-store' } });
    const access = await canReadBook(db, auth.user.id, book as unknown as BookAccessRow);
    return NextResponse.json({ owned: access.level === 'full' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/access]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not check this book.' }, { status: 500 });
  }
}
