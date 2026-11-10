import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { buildAnnouncementEmail, personalise } from '@/lib/books/announce';
import { announcementBook, loadAnnounceable, parseAnnouncementInput } from '@/lib/books/announce-request';

// POST /api/books/announce/preview { bookId, subject, message } -> { subject, html }
//
// The exact launch email students would get (built the same way as a real send), addressed to the
// person previewing. Nothing is sent or recorded.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const input = parseAnnouncementInput(body);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const db = auth.serviceDb;
  try {
    const target = await loadAnnounceable(db, input.bookId, auth.user.id, auth.role);
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: target.status });
    const [email, me] = await Promise.all([
      buildAnnouncementEmail({ subject: input.subject, message: input.message, book: announcementBook(target.live) }),
      db.from('students').select('full_name').eq('id', auth.user.id).maybeSingle(),
    ]);
    const name = (me.data as any)?.full_name?.trim() || 'there';
    return NextResponse.json(personalise(email, name), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/announce] preview failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not build the preview.' }, { status: 500 });
  }
}
