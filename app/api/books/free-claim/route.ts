import { NextRequest, NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { claimFreeProduct } from '@/lib/books/free-claim';
import { normalizeGuestEmail, normalizeGuestName } from '@/lib/books/guest-access';
import { emailHash, guestRateLimited } from '@/lib/books/guest-purchase';
import { resendGuestAccessEmail, sendBookPurchaseReceipt } from '@/lib/books/receipt-email';
import { hasDeliverable, isLicenseExpired } from '@/lib/books/schema';

// POST /api/books/free-claim  { bookId, name, email }  -> { message }
//
// "Get it free" for a visitor without an account (migration 239). The download link is emailed,
// never returned here, so the file only reaches the owner of the address. The answer is the same
// whether a new claim was made or an open one was emailed again.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE = { message: 'Check your email. We have sent your download link.' };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const bookId = typeof body?.bookId === 'string' && UUID.test(body.bookId) ? body.bookId : null;
  if (!bookId) return NextResponse.json({ error: 'A valid product id is required.' }, { status: 400 });
  const name = normalizeGuestName(body?.name);
  if (!name) return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 });
  const email = normalizeGuestEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (await guestRateLimited(req, [['free-ip', 'ip', 20, 60 * 60], ['free-email', emailHash(email), 3, 60 * 60], ['free-all', 'all', 300, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const { data: book, error } = await db
      .from('books')
      .select('id, title, status, available_to_everyone, license_expires_at, format, file_path')
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    // Only published products open to everyone; never one for sale or for a cohort only.
    if (!book || book.status !== 'published' || book.available_to_everyone !== true) {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    if (isLicenseExpired(book.license_expires_at)) {
      return NextResponse.json({ error: 'This product is no longer available.' }, { status: 403 });
    }
    // Its file, or for a link product its address (migration 243).
    if (!hasDeliverable(book)) {
      return NextResponse.json({ error: 'This product is not ready yet.' }, { status: 409 });
    }

    const claim = await claimFreeProduct(db, { book: { id: book.id, title: book.title }, name, email });
    if (claim.limited) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
    after(async () => {
      try {
        if (claim.existing) await resendGuestAccessEmail(db, claim.id);
        else await sendBookPurchaseReceipt(db, claim.id);
      } catch (e: any) {
        console.error('[books/free-claim] email failed', claim.id, e?.message ?? e);
      }
    });
    return NextResponse.json(DONE, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/free-claim] failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not send the download link. Try again.' }, { status: 500 });
  }
}
