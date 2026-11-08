import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { isPublicSampleAvailable } from '@/lib/books/access';
import { issueHtmlTicket } from '@/lib/books/html-ticket';
import { BOOK_BUCKET, BOOK_SIGNED_URL_TTL_SECONDS } from '@/lib/books/storage';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

// GET /api/books/[id]/sample -> { url, format, download }
//
// The store's free sample, for anyone -- no account needed. Only for a book that is published and
// for sale, with a current licence (isPublicSampleAvailable). This route only ever signs the
// book's preview_file_path: it never reads file_path and takes no variant, so there is no way to
// ask it for the full book.
//   PDF  -> a short-lived inline link (opens in the browser's viewer)
//   EPUB -> a short-lived download link (browsers cannot show EPUB)
//   HTML -> a public-sample ticket for the sandboxed /api/books/[id]/html page
// Rate limited per IP when Redis is configured.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

function ipKey(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const redis = getRedis();
  if (redis) {
    try {
      if (await bumpRateLimit(redis, `rate:book-sample:${ipKey(req)}`, 60, 60 * 60)) {
        return NextResponse.json({ error: 'Too many samples opened. Try again later.' }, { status: 429 });
      }
    } catch {
      // A rate-limit outage must not take the store's samples down with it.
    }
  }

  const db = adminClient();
  try {
    const { data: book, error } = await db
      .from('books')
      .select('id, slug, status, purchasable, license_expires_at, format, preview_file_path')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = book as { id: string; slug: string | null; status: string | null; purchasable: boolean | null; license_expires_at: string | null; format: string | null; preview_file_path: string | null } | null;
    if (!row || !isPublicSampleAvailable(row)) {
      return NextResponse.json({ error: 'This book has no free sample.' }, { status: 404, headers: NO_STORE });
    }

    if (row.format === 'html') {
      const { ticket } = issueHtmlTicket({ bookId: row.id, userId: null, variant: 'public-sample' });
      return NextResponse.json(
        { url: `/api/books/${encodeURIComponent(row.id)}/html?t=${encodeURIComponent(ticket)}`, format: 'html', download: false },
        { headers: NO_STORE },
      );
    }

    const inline = row.format === 'pdf';
    const filename = `${row.slug || 'book'}-sample.${row.format}`;
    const { data: signed, error: signError } = await db.storage
      .from(BOOK_BUCKET)
      .createSignedUrl(row.preview_file_path as string, BOOK_SIGNED_URL_TTL_SECONDS, inline ? undefined : { download: filename });
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL returned.');
    return NextResponse.json({ url: signed.signedUrl, format: row.format, download: !inline }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/sample]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not open the sample.' }, { status: 500 });
  }
}
