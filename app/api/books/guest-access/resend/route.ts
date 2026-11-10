import { NextRequest, NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { normalizeGuestEmail } from '@/lib/books/guest-access';
import { emailHash, guestRateLimited } from '@/lib/books/guest-purchase';
import { resendGuestAccessEmail } from '@/lib/books/receipt-email';

// POST /api/books/guest-access/resend  { email }
//
// "Lost your link?" Emails the download link again for this address's guest purchases that are paid
// and still inside their seven days. The answer is the same whatever the address, so it never
// reveals who bought what. The link is the same one as before; nothing about the allowance changes.
export const dynamic = 'force-dynamic';

const DONE = { message: 'If that email has a recent purchase, we have sent the download link to it.' };

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const email = normalizeGuestEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (await guestRateLimited(req, [['resend-ip', 'ip', 10, 60 * 60], ['resend-email', emailHash(email), 3, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  // Looked up and sent after answering, so the response time is the same whatever the address.
  after(async () => {
    const db = adminClient();
    try {
      // Paid purchases first, so free claims made to this address can never crowd them out.
      const lookup = (kind: 'sale' | 'free_claim') => db
        .from('book_purchases')
        .select('id')
        .eq('is_guest', true)
        .eq('kind', kind)
        .eq('guest_email', email)
        .eq('status', 'paid')
        .gt('guest_access_expires_at', new Date().toISOString())
        .order('paid_at', { ascending: false })
        .limit(5);
      const [sales, free] = await Promise.all([lookup('sale'), lookup('free_claim')]);
      if (sales.error) throw sales.error;
      if (free.error) throw free.error;
      const data = [...(sales.data ?? []), ...(free.data ?? [])].slice(0, 5);
      for (const row of data) {
        try { await resendGuestAccessEmail(db, row.id); } catch (e: any) {
          console.error('[books/guest-access] resend failed', row.id, e?.message ?? e);
        }
      }
    } catch (e: any) {
      console.error('[books/guest-access] resend lookup failed', e?.message ?? e);
    }
  });
  return NextResponse.json(DONE, { headers: { 'Cache-Control': 'no-store' } });
}
