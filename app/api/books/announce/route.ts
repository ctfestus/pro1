import { NextRequest, NextResponse, after } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { announcementAudience, buildAnnouncementEmail, createAnnouncement, runAnnouncement } from '@/lib/books/announce';
import { loadStoreBook } from '@/lib/books/store';
import { announcementBook, loadAnnounceable, parseAnnouncementInput } from '@/lib/books/announce-request';

// GET  /api/books/announce?bookId=...  -> { available, reason?, recipients, history }
// POST /api/books/announce { bookId, subject, message } -> { recipients }
//
// Launch emails for a digital product (migration 241): every admitted, active student gets one
// (lib/books/announce.ts). An instructor may announce only their
// own products; an admin any. The product must be live in the store, so its link works for
// everyone. Only one send per product can be in progress (a unique index), and another is refused
// within ten minutes of the last, so a double click or a retry never emails everyone twice. The
// audience is saved with the announcement and sent after the answer, in batches; anything not done
// when time runs out is resumed by the hourly sweep (lib/books/announce.ts).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ROLES = ['admin', 'instructor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUARD_MS = 10 * 60 * 1000;
const NO_STORE = { 'Cache-Control': 'no-store' };

async function loadOwned(db: any, bookId: string, userId: string, role: string) {
  const { data: book, error } = await db.from('books').select('id, user_id, slug, title, cover_image').eq('id', bookId).maybeSingle();
  if (error) throw error;
  // Another instructor's product does not exist for this caller.
  if (!book || (role !== 'admin' && book.user_id !== userId)) return null;
  return book as { id: string; user_id: string; slug: string; title: string; cover_image: string | null };
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const bookId = req.nextUrl.searchParams.get('bookId') ?? '';
  if (!UUID.test(bookId)) return NextResponse.json({ error: 'A valid product id is required.' }, { status: 400 });
  const db = auth.serviceDb;
  try {
    const book = await loadOwned(db, bookId, auth.user.id, auth.role);
    if (!book) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    const [live, audience, history] = await Promise.all([
      loadStoreBook(book.slug, db),
      announcementAudience(db),
      db.from('book_announcements').select('created_at, subject, recipients, sent, failed, status, error')
        .eq('book_id', book.id).order('created_at', { ascending: false }).limit(5),
    ]);
    if (history.error) throw history.error;
    return NextResponse.json({
      available: !!live,
      ...(live ? {} : { reason: 'Publish this product, and make it free or for sale, before announcing it.' }),
      recipients: audience.recipients.length,
      history: history.data ?? [],
    }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/announce] load failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load the announcement details.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const input = parseAnnouncementInput(body);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const { bookId, subject, message } = input;

  const db = auth.serviceDb;
  try {
    const target = await loadAnnounceable(db, bookId, auth.user.id, auth.role);
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: target.status });
    const { book } = target;

    // Never twice by accident: nothing sent for this product in the last ten minutes, none still
    // preparing or sending (a unique index), and the earliest of any started together wins.
    const { data: recent, error: recentError } = await db.from('book_announcements').select('id')
      .eq('book_id', book.id).gt('created_at', new Date(Date.now() - GUARD_MS).toISOString()).limit(1);
    if (recentError) throw recentError;
    if (recent?.length) return NextResponse.json({ error: 'This product was announced in the last ten minutes.' }, { status: 409 });

    const { recipients } = await announcementAudience(db);
    if (!recipients.length) return NextResponse.json({ error: 'There are no students to email yet.' }, { status: 409 });

    // The email, rendered once now and saved with the announcement (lib/books/announce.ts).
    const email = await buildAnnouncementEmail({ subject, message, book: announcementBook(target.live) });
    const created = await createAnnouncement(db, { bookId: book.id, sentBy: auth.user.id, subject, message, recipients, email });
    if (created === 'busy') return NextResponse.json({ error: 'An announcement for this product is already being sent.' }, { status: 409 });

    const started = Date.now();
    after(async () => {
      try {
        // Leave a margin before the function's time limit; the hourly sweep finishes anything left.
        await runAnnouncement(db, created.id, () => Date.now() - started > (maxDuration - 40) * 1000);
      } catch (e: any) {
        console.error('[books/announce] send failed', created.id, e?.message ?? e);
      }
    });
    return NextResponse.json({ recipients: recipients.length }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/announce] failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not send the announcement.' }, { status: 500 });
  }
}
