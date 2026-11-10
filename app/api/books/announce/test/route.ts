import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { buildAnnouncementEmail, personalise } from '@/lib/books/announce';
import { announcementBook, loadAnnounceable, parseAnnouncementInput } from '@/lib/books/announce-request';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

// POST /api/books/announce/test { bookId, subject, message } -> { sentTo }
//
// Sends the exact launch email to the person asking, and only to them (their own account email,
// never an address from the request), to check it in a real inbox before announcing. Marked
// "[Test]" in the subject, not recorded as an announcement, and limited to 10 an hour each.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const input = parseAnnouncementInput(body);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const to = auth.user.email?.trim();
  if (!to) return NextResponse.json({ error: 'Your account has no email address to send a test to.' }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 503 });

  const redis = getRedis();
  if (redis) {
    try {
      if (await bumpRateLimit(redis, `rate:book-announce-test:${auth.user.id}`, 10, 60 * 60)) {
        return NextResponse.json({ error: 'You have sent several tests already. Try again in a while.' }, { status: 429 });
      }
    } catch { /* a rate-limit outage does not block a test to yourself */ }
  }

  const db = auth.serviceDb;
  try {
    const target = await loadAnnounceable(db, input.bookId, auth.user.id, auth.role);
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: target.status });
    const [email, me] = await Promise.all([
      buildAnnouncementEmail({ subject: input.subject, message: input.message, book: announcementBook(target.live) }),
      db.from('students').select('full_name').eq('id', auth.user.id).maybeSingle(),
    ]);
    const copy = personalise(email, (me.data as any)?.full_name?.trim() || 'there');
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: email.from, to, subject: `[Test] ${copy.subject}`, html: copy.html,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ sentTo: to }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/announce] test failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not send the test email.' }, { status: 500 });
  }
}
