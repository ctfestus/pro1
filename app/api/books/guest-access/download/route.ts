import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { verifyGuestAccessToken } from '@/lib/books/guest-access';
import { guestBookAvailable, guestRateLimited, loadGuestPurchase } from '@/lib/books/guest-purchase';
import { isBookObjectPath } from '@/lib/books/schema';
import { BOOK_BUCKET, BOOK_SIGNED_URL_TTL_SECONDS } from '@/lib/books/storage';

// POST /api/books/guest-access/download  { access }  -> { url, remaining }
//
// The guest's explicit Download. Takes one of the purchase's five downloads (take_guest_book_download,
// under a row lock, only while the purchase is paid and inside its seven days) and hands out a
// short-lived signed download URL. "Five downloads" therefore means five download links handed out:
// a link can be reused until it expires a few minutes later. If handing it out fails, the download
// is given back (release_guest_book_download), so a failed attempt costs nothing.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const REFUSED: Record<string, string> = {
  not_paid: 'This purchase is no longer active.',
  expired: 'This download link has expired.',
  used_up: 'All downloads for this purchase have been used.',
  not_found: 'This link is not valid.',
};

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const purchaseId = verifyGuestAccessToken(body?.access);
  if (!purchaseId) return NextResponse.json({ error: REFUSED.not_found }, { status: 404, headers: NO_STORE });
  if (await guestRateLimited(req, [['download-ip', 'ip', 60, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  let taken = false;
  try {
    const purchase = await loadGuestPurchase(db, purchaseId);
    if (!purchase) return NextResponse.json({ error: REFUSED.not_found }, { status: 404, headers: NO_STORE });
    const { data: book, error } = await db
      .from('books').select('id, slug, format, file_path, status, license_expires_at').eq('id', purchase.book_id).maybeSingle();
    if (error) throw error;
    // A product withdrawn (back to draft) or whose licence ended is refused, as for account holders.
    if (!book || !guestBookAvailable(book)) {
      return NextResponse.json({ error: 'This product is no longer available.' }, { status: 403, headers: NO_STORE });
    }
    // Checked before taking a download, so a product without a file costs nothing.
    if (!isBookObjectPath(book.id, book.file_path, 'file', book.format)) {
      return NextResponse.json({ error: 'This product file is not available right now.' }, { status: 409, headers: NO_STORE });
    }

    const { data: took, error: takeError } = await db.rpc('take_guest_book_download', { p_purchase_id: purchaseId });
    if (takeError) throw takeError;
    if (!took?.ok) {
      const reason = typeof took?.reason === 'string' ? took.reason : 'not_found';
      return NextResponse.json({ error: REFUSED[reason] ?? REFUSED.not_found, reason }, { status: 403, headers: NO_STORE });
    }
    taken = true;

    const { data: signed, error: signError } = await db.storage
      .from(BOOK_BUCKET)
      .createSignedUrl(book.file_path as string, BOOK_SIGNED_URL_TTL_SECONDS, { download: `${book.slug || 'product'}.${book.format}` });
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL returned.');
    return NextResponse.json({ url: signed.signedUrl, remaining: took.remaining }, { headers: NO_STORE });
  } catch (e: any) {
    if (taken) {
      // Nothing was handed out: give the download back.
      const { error: releaseError } = await db.rpc('release_guest_book_download', { p_purchase_id: purchaseId });
      if (releaseError) console.error('[books/guest-access] release failed', purchaseId, releaseError.message);
    }
    console.error('[books/guest-access] download failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not get the file. Try again.' }, { status: 500 });
  }
}
