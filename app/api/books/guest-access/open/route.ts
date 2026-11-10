import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { verifyGuestAccessToken } from '@/lib/books/guest-access';
import { guestAccessState, guestBookAvailable, guestRateLimited, loadGuestPurchase } from '@/lib/books/guest-purchase';
import { issueHtmlTicket } from '@/lib/books/html-ticket';
import { isBookObjectPath } from '@/lib/books/schema';
import { logBookDownload } from '@/lib/books/downloads';

// POST /api/books/guest-access/open  { access }  -> { url }
//
// Opens a product in the browser for a guest buyer:
//   interactive HTML -> a few-minute 'guest' ticket for the sandboxed viewer (/api/books/[id]/html),
//                       which re-checks the purchase
//   link product     -> its address (migration 243), read from book_links only here
// Unlimited while the purchase is paid and inside its seven days; it does not use one of the five
// downloads.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const purchaseId = verifyGuestAccessToken(body?.access);
  if (!purchaseId) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: NO_STORE });
  if (await guestRateLimited(req, [['open-ip', 'ip', 120, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const purchase = await loadGuestPurchase(db, purchaseId);
    if (!purchase) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: NO_STORE });
    if (guestAccessState(purchase) !== 'ready') {
      return NextResponse.json({ error: 'This link is no longer active.' }, { status: 403, headers: NO_STORE });
    }
    const { data: book, error } = await db.from('books').select('id, format, file_path, status, license_expires_at').eq('id', purchase.book_id).maybeSingle();
    if (error) throw error;
    if (!book || !guestBookAvailable(book)) {
      return NextResponse.json({ error: 'This product is no longer available.' }, { status: 403, headers: NO_STORE });
    }
    if (book.format === 'link') {
      const { data: link, error: linkError } = await db.from('book_links').select('url').eq('book_id', book.id).maybeSingle();
      if (linkError) throw linkError;
      const url = typeof (link as any)?.url === 'string' ? (link as any).url : '';
      if (!url.startsWith('https://')) {
        return NextResponse.json({ error: 'This product is not available right now.' }, { status: 409, headers: NO_STORE });
      }
      await logBookDownload(db, { bookId: book.id, purchaseId, repeatable: true });
      return NextResponse.json({ url, link: true }, { headers: { ...NO_STORE, 'Referrer-Policy': 'no-referrer' } });
    }
    if (book.format !== 'html') {
      return NextResponse.json({ error: 'Only interactive HTML products open in the browser. Use Download instead.' }, { status: 400, headers: NO_STORE });
    }
    if (!isBookObjectPath(book.id, book.file_path, 'file', 'html')) {
      return NextResponse.json({ error: 'This product file is not available right now.' }, { status: 409, headers: NO_STORE });
    }
    const { ticket } = issueHtmlTicket({ bookId: book.id, userId: null, variant: 'guest', purchaseId });
    return NextResponse.json({ url: `/api/books/${book.id}/html?t=${encodeURIComponent(ticket)}` }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/guest-access] open failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not open the product.' }, { status: 500 });
  }
}
