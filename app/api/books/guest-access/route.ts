import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { verifyGuestAccessToken } from '@/lib/books/guest-access';
import { downloadsLeft, guestAccessState, guestBookAvailable, guestRateLimited, loadGuestPurchase } from '@/lib/books/guest-purchase';

// POST /api/books/guest-access  { access }
//   -> { title, slug, coverImage, format, state, downloadsLeft, expiresAt }
//
// What the guest download page shows. Looking never uses anything: only an explicit Download
// (/api/books/guest-access/download) takes one of the five, so an email scanner that follows the
// link, or a refresh, costs the buyer nothing. POST, so a link preview cannot call it either.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const purchaseId = verifyGuestAccessToken(body?.access);
  if (!purchaseId) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: NO_STORE });
  if (await guestRateLimited(req, [['access-ip', 'ip', 300, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const purchase = await loadGuestPurchase(db, purchaseId);
    if (!purchase) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: NO_STORE });
    const { data: book, error } = await db
      .from('books').select('title, slug, cover_image, format, status, license_expires_at').eq('id', purchase.book_id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      title: book?.title ?? 'Your product',
      slug: book?.slug ?? null,
      coverImage: book?.cover_image ?? null,
      format: book?.format ?? null,
      state: guestBookAvailable(book) ? guestAccessState(purchase) : 'unavailable',
      free: purchase.kind === 'free_claim',
      downloadsLeft: downloadsLeft(purchase),
      expiresAt: purchase.guest_access_expires_at,
    }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/guest-access]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load this purchase.' }, { status: 500 });
  }
}
