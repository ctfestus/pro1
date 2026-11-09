import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

// GET   /api/books/purchases          -> { attention: [...] }
// PATCH /api/books/purchases { id }   -> mark one resolved
//
// Book payments a person has to look at: money that arrived but could not be turned into access
// (wrong amount, already owned, deleted account). Each stays listed until someone marks it
// resolved, after sorting it out in Paystack (refunds happen there, outside the platform).
// Instructors see their own books' payments; admins see all.
export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'instructor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;
  try {
    let query = db
      .from('book_purchases')
      .select('id, book_id, book_title, amount, currency, status, review_reason, paystack_reference, paid_at, created_at, students ( email, full_name ), books!inner ( user_id )')
      .not('review_reason', 'is', null)
      .is('review_resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (auth.role !== 'admin') query = query.eq('books.user_id', auth.user.id);
    const { data, error } = await query;
    if (error) throw error;
    const attention = (data ?? []).map((r: any) => {
      const student = Array.isArray(r.students) ? r.students[0] : r.students;
      return {
        id: r.id,
        bookId: r.book_id,
        bookTitle: r.book_title,
        amount: Number(r.amount),
        currency: r.currency,
        status: r.status,
        reason: r.review_reason,
        reference: r.paystack_reference,
        paidAt: r.paid_at,
        buyerEmail: student?.email ?? null,
        buyerName: student?.full_name ?? null,
      };
    });
    return NextResponse.json({ attention }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/purchases] list failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load product payments.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: 'A valid purchase id is required.' }, { status: 400 });

  try {
    const { data: found, error } = await db
      .from('book_purchases')
      .select('id, books ( user_id )')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!found) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });
    const book = Array.isArray((found as any).books) ? (found as any).books[0] : (found as any).books;
    if (auth.role !== 'admin' && book?.user_id !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { error: updateError } = await db.from('book_purchases')
      .update({ review_resolved_at: new Date().toISOString() })
      .eq('id', found.id);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[books/purchases] resolve failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not update the payment.' }, { status: 500 });
  }
}
