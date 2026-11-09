import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { startGuestBookCheckout } from '@/lib/books/purchases';
import { isBookObjectPath, isLicenseExpired } from '@/lib/books/schema';
import { normalizeGuestEmail } from '@/lib/books/guest-access';
import { emailHash, guestRateLimited } from '@/lib/books/guest-purchase';
import { PaystackApiError, paystackIsConfigured } from '@/lib/paystack';
import { paymentErrorResponse } from '@/lib/payment-errors';
import { shownPrice, type PriceRow } from '@/lib/books/pricing';

// POST /api/books/guest-checkout
//   { bookId, email, currency?, expectedAmount?, resume?: { reference, code } }
//   -> { authorizationUrl, reference, returnCode } | { status, reference, returnCode }
//
// Buying a product with only an email: no sign-in, no account (migration 238). The product rules are
// the store's: published, for sale, a current licence, its own file and a price. expectedAmount is
// the price the buyer was shown; a mismatch charges nothing (409 { priceChanged, price }).
//
// returnCode is a secret only this browser keeps; the Paystack return page presents it to collect
// the download (/api/books/guest-checkout/confirm). `resume` lets the same browser get its own open
// checkout back; nobody else can (lib/books/purchases.ts startGuestBookCheckout).
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  if (!paystackIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is temporarily unavailable.' }, { status: 503 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const bookId = typeof body?.bookId === 'string' && UUID.test(body.bookId) ? body.bookId : null;
  if (!bookId) return NextResponse.json({ error: 'A valid product id is required.' }, { status: 400 });
  const email = normalizeGuestEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  const wanted = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : null;
  const expected = typeof body?.expectedAmount === 'number' && Number.isFinite(body.expectedAmount) ? body.expectedAmount : null;
  const resume = body?.resume && typeof body.resume.reference === 'string' && typeof body.resume.code === 'string'
    ? { reference: body.resume.reference, code: body.resume.code } : null;

  if (await guestRateLimited(req, [['checkout-ip', 'ip', 20, 60 * 60], ['checkout-email', emailHash(email), 10, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many checkouts started. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const { data: book, error } = await db
      .from('books')
      .select('id, slug, title, status, purchasable, available_to_everyone, license_expires_at, format, file_path, royalty_pct')
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    // Drafts, archived and cohort-only products are not for sale to anyone outside.
    if (!book || book.status !== 'published' || book.purchasable !== true) {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    // A free product stays sign-in only: a download without an account would make the file public.
    if (book.available_to_everyone === true) {
      return NextResponse.json({ error: 'This product is free. Sign in to download it.' }, { status: 400 });
    }
    if (isLicenseExpired(book.license_expires_at)) {
      return NextResponse.json({ error: 'This product is no longer available.' }, { status: 403 });
    }
    if (!isBookObjectPath(book.id, book.file_path, 'file', book.format)) {
      return NextResponse.json({ error: 'This product is not ready for sale yet.' }, { status: 409 });
    }

    const { data: prices, error: priceError } = await db
      .from('book_prices').select('currency, amount, sale_amount, sale_ends_at').eq('book_id', book.id).order('currency');
    if (priceError) throw priceError;
    const list = (prices ?? []) as PriceRow[];
    if (!list.length) return NextResponse.json({ error: 'This product has no price yet.' }, { status: 409 });
    const price = wanted ? list.find(p => p.currency === wanted) : list.length === 1 ? list[0] : null;
    if (!price) {
      return NextResponse.json({ error: 'Choose a currency.', currencies: list.map(p => p.currency) }, { status: 400 });
    }
    const charge = shownPrice(price);
    if (expected !== null && Math.round(expected * 100) !== Math.round(charge.amount * 100)) {
      return NextResponse.json(
        { error: 'The price has changed. Check the new price and press Buy again.', priceChanged: true, price: charge },
        { status: 409, headers: NO_STORE },
      );
    }

    const outcome = await startGuestBookCheckout(db, {
      email,
      book: { id: book.id, slug: book.slug, title: book.title, royalty_pct: book.royalty_pct },
      amount: charge.amount,
      currency: price.currency,
      resume,
    });
    if (outcome.kind === 'settled') {
      return NextResponse.json({ status: outcome.status, reference: outcome.reference, returnCode: outcome.returnCode }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { authorizationUrl: outcome.authorizationUrl, reference: outcome.reference, returnCode: outcome.returnCode },
      { headers: NO_STORE },
    );
  } catch (e) {
    if (e instanceof PaystackApiError) {
      console.error('[books/guest-checkout] paystack', e.status, e.message);
      return NextResponse.json({ error: 'Could not reach the payment provider. Please try again.' }, { status: 502 });
    }
    const { message, status } = paymentErrorResponse(e, 'Could not start the checkout.');
    return NextResponse.json({ error: message }, { status });
  }
}
