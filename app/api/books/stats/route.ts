import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { productPeople } from '@/lib/books/stats';

// GET /api/books/stats?bookId=...   -> { people: ProductPerson[] }
//
// Who has one product, for the dashboard's People panel. (Per-product totals come with the product
// list, GET /api/books, so the dashboard counts them once.) Instructors see their own products; admins see all
// (instructors are trusted with their buyers' names and emails, as with the review list).
export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'instructor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;
  const bookId = req.nextUrl.searchParams.get('bookId') ?? '';
  if (!UUID.test(bookId)) return NextResponse.json({ error: 'A valid product id is required.' }, { status: 400 });

  try {
    const { data: book, error } = await db.from('books').select('id, user_id, available_to_everyone').eq('id', bookId).maybeSingle();
    if (error) throw error;
    // Another instructor's product is not found, not forbidden: it does not exist for them.
    if (!book || (auth.role !== 'admin' && book.user_id !== auth.user.id)) {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    return NextResponse.json({ people: await productPeople(db, book) }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/stats] failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load sales and downloads.' }, { status: 500 });
  }
}
