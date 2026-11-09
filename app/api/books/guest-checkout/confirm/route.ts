import { NextRequest, NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { isBookReference, settleBookPurchase } from '@/lib/books/purchases';
import { sendBookPurchaseReceipt } from '@/lib/books/receipt-email';
import { guestAccessToken, returnCodeMatches } from '@/lib/books/guest-access';
import { guestRateLimited } from '@/lib/books/guest-purchase';
import { PaystackApiError } from '@/lib/paystack';

// POST /api/books/guest-checkout/confirm  { reference, code }
//   -> { status: 'paid', access } | { status: 'pending' | 'abandoned' | 'failed' | 'needs_review' | 'refunded' }
//
// Called by the product page Paystack returns a guest to. Only the browser that started the
// checkout holds `code`; without it the answer is a plain 404, so a reference seen in browser history
// or a receipt cannot collect the download. Confirming again returns the same access link and never
// changes the purchase's allowance.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const notFound = () => NextResponse.json({ error: 'Purchase not found.' }, { status: 404, headers: NO_STORE });

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const reference = body?.reference;
  if (!isBookReference(reference) || reference.length > 100 || typeof body?.code !== 'string') return notFound();
  if (await guestRateLimited(req, [['confirm-ip', 'ip', 120, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const { data: purchase, error } = await db
      .from('book_purchases')
      .select('id, is_guest, guest_return_hash')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (error) throw error;
    if (!purchase || !purchase.is_guest || !returnCodeMatches(body.code, purchase.guest_return_hash)) return notFound();

    let result;
    try {
      result = await settleBookPurchase(db, reference);
    } catch (e) {
      // Paystack unreachable: the webhook will settle it. Tell the page to check again shortly.
      if (e instanceof PaystackApiError) return NextResponse.json({ status: 'pending' }, { headers: NO_STORE });
      throw e;
    }

    if (result.status === 'paid') {
      after(async () => {
        try { await sendBookPurchaseReceipt(db, purchase.id); } catch (e: any) {
          console.error('[books/guest-checkout] receipt email failed', purchase.id, e?.message ?? e);
        }
      });
      return NextResponse.json({ status: 'paid', access: guestAccessToken(purchase.id) }, { headers: NO_STORE });
    }
    // 'abandoned': the buyer left Paystack without paying, so the page lets them try again.
    const status = result.status === 'unpaid'
      ? (result.providerStatus === 'failed' || result.providerStatus === 'reversed' ? 'failed'
        : result.providerStatus === 'abandoned' ? 'abandoned' : 'pending')
      : result.status === 'unknown' ? 'pending' : result.status;
    return NextResponse.json({ status }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/guest-checkout] confirm failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not confirm the purchase.' }, { status: 500 });
  }
}
