import { NextRequest, NextResponse, after } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { BOOK_ACCESS_COLUMNS, canReadBook, type BookAccessRow } from '@/lib/books/access';
import { isBookReference, settleBookPurchase, startBookCheckout } from '@/lib/books/purchases';
import { sendBookPurchaseReceipt } from '@/lib/books/receipt-email';
import { isBookObjectPath, isLicenseExpired } from '@/lib/books/schema';
import { PaystackApiError, paystackIsConfigured } from '@/lib/paystack';
import { paymentErrorResponse } from '@/lib/payment-errors';

// POST /api/books/checkout  { bookId, currency? }  -> { authorizationUrl, reference } | { status }
// GET  /api/books/checkout?reference=book-...      -> { status, bookId }
//
// Buying one book. POST opens (or reuses) a Paystack checkout; GET is called from the page Paystack
// returns the buyer to and confirms the payment without waiting for the webhook. Both paths end in
// the same locked database function, so access is granted once however they race.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

function sendReceiptLater(db: any, purchaseId: string) {
  after(async () => {
    try { await sendBookPurchaseReceipt(db, purchaseId); } catch (e: any) {
      console.error('[books/checkout] receipt email failed', purchaseId, e?.message ?? e);
    }
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const email = auth.user.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Your account needs an email address to buy a book.' }, { status: 400 });
  if (!paystackIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is temporarily unavailable.' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const bookId = typeof body?.bookId === 'string' && UUID.test(body.bookId) ? body.bookId : null;
  if (!bookId) return NextResponse.json({ error: 'A valid book id is required.' }, { status: 400 });
  const wanted = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : null;

  const db = auth.serviceDb;
  try {
    const { data: found, error } = await db
      .from('books')
      .select(`${BOOK_ACCESS_COLUMNS}, title, royalty_pct, format, file_path`)
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    if (!found) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
    const book = found as unknown as BookAccessRow & {
      title: string; royalty_pct: number | null; format: string | null; file_path: string | null;
    };

    const access = await canReadBook(db, auth.user.id, book);
    if (access.level === 'full') {
      return NextResponse.json({ error: 'You already have this book.' }, { status: 409 });
    }
    if (access.level === 'none' && access.status === 404) {
      return NextResponse.json({ error: access.error }, { status: 404 });
    }
    if (book.purchasable !== true) return NextResponse.json({ error: 'This book is not for sale.' }, { status: 400 });
    if (isLicenseExpired(book.license_expires_at)) {
      return NextResponse.json({ error: 'This book is no longer available.' }, { status: 403 });
    }
    if (!isBookObjectPath(book.id, book.file_path, 'file', book.format)) {
      return NextResponse.json({ error: 'This book is not ready for sale yet.' }, { status: 409 });
    }

    const { data: prices, error: priceError } = await db
      .from('book_prices').select('currency, amount').eq('book_id', book.id).order('currency');
    if (priceError) throw priceError;
    const list = (prices ?? []) as { currency: string; amount: number | string }[];
    if (!list.length) return NextResponse.json({ error: 'This book has no price yet.' }, { status: 409 });
    const price = wanted ? list.find(p => p.currency === wanted) : list.length === 1 ? list[0] : null;
    if (!price) {
      return NextResponse.json(
        { error: 'Choose a currency.', currencies: list.map(p => p.currency) },
        { status: 400 },
      );
    }

    const outcome = await startBookCheckout(db, {
      studentId: auth.user.id,
      email,
      book: { id: book.id, title: book.title, royalty_pct: book.royalty_pct },
      amount: Number(price.amount),
      currency: price.currency,
    });
    if (outcome.kind === 'settled') {
      return NextResponse.json({ status: outcome.status, reference: outcome.reference }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { authorizationUrl: outcome.authorizationUrl, reference: outcome.reference },
      { headers: NO_STORE },
    );
  } catch (e) {
    if (e instanceof PaystackApiError) {
      console.error('[books/checkout] paystack', e.status, e.message);
      return NextResponse.json({ error: 'Could not reach the payment provider. Please try again.' }, { status: 502 });
    }
    const { message, status } = paymentErrorResponse(e, 'Could not start the checkout.');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const reference = req.nextUrl.searchParams.get('reference') ?? '';
  if (!isBookReference(reference) || reference.length > 100) {
    return NextResponse.json({ error: 'A valid purchase reference is required.' }, { status: 400 });
  }

  const db = auth.serviceDb;
  try {
    // Only the buyer may confirm their own purchase.
    const { data: purchase, error } = await db
      .from('book_purchases')
      .select('id, book_id')
      .eq('paystack_reference', reference)
      .eq('student_id', auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!purchase) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });

    let result;
    try {
      result = await settleBookPurchase(db, reference);
    } catch (e) {
      // Paystack unreachable: the webhook will settle it. Tell the page to check again shortly.
      if (e instanceof PaystackApiError) {
        return NextResponse.json({ status: 'pending', bookId: purchase.book_id }, { headers: NO_STORE });
      }
      throw e;
    }

    if (result.status === 'paid') sendReceiptLater(db, result.purchaseId);
    const status = result.status === 'unpaid'
      ? (result.providerStatus === 'failed' || result.providerStatus === 'reversed' ? 'failed' : 'pending')
      : result.status === 'unknown' ? 'pending' : result.status;
    return NextResponse.json({ status, bookId: purchase.book_id }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/checkout] confirm failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not confirm the purchase.' }, { status: 500 });
  }
}
