import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { fetchAllRowsByIds } from '@/lib/fetch-all-rows';
import {
  bookColumnsFromInput,
  bookSlug,
  chaptersFromInput,
  commercialFromInput,
  isBookFormat,
  verifyUploadedObject,
} from '@/lib/books/admin';
import { normalizeBook, validateBookForPublish, type BookFormat, type BookPrice } from '@/lib/books/schema';
import { BOOK_BUCKET } from '@/lib/books/storage';
import { refreshBookStore } from '@/lib/books/store-cache';

// /api/books -- the admin editor's save path for books.
//
//   GET     list the caller's books (every book for an admin) with reader counts
//   POST    { title }                       create a draft; the editor then uploads into its folder
//   PUT     { id, ...fields, file?, preview?, chapters?, status? }   save
//   DELETE  ?id=                            delete a book nobody owns a copy of
//
// Writes use the service role, so every rule is enforced here: ownership (the owning instructor or
// any admin -- the same people may set sale terms, migration 234), uploaded files (real size and
// type read back from storage, never the browser's word), and publish readiness. The database
// writes of a save then happen in one transaction, in save_book (migration 233), which also
// refuses a save made from an outdated version of the book. Assigning a book to a cohort does not
// email students yet (lib/send-assignment-notification.ts has no book type); assigned books show
// up in the student's My Books (/student#books, components/student/books.tsx).
export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'instructor'];

type BookRow = Record<string, any> & { id: string; user_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canEdit(book: BookRow, userId: string, role: string) {
  return role === 'admin' || book.user_id === userId;
}

async function loadPrices(db: any, bookId: string): Promise<BookPrice[]> {
  const { data, error } = await db.from('book_prices').select('currency, amount').eq('book_id', bookId);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ currency: p.currency, amount: Number(p.amount) }));
}

/** Uploads younger than this may still be about to be saved, possibly from another tab. */
const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000;

/**
 * After a committed save: remove the files this save replaced, and uploads in the book's folder
 * that were never saved and are over a day old. A fresh unsaved upload is left alone -- another
 * tab may be about to save it. Best effort: a failure here never fails the save.
 */
async function cleanUpBookFiles(db: any, bookId: string, current: (string | null)[], replaced: string[], now = Date.now()) {
  try {
    const bucket = db.storage.from(BOOK_BUCKET);
    const keep = new Set(current.filter(Boolean));
    const remove = new Set<string>(replaced.filter(p => !keep.has(p)));
    const { data: objects, error } = await bucket.list(bookId, { limit: 1000 });
    if (error) throw error;
    for (const o of objects ?? []) {
      const path = `${bookId}/${o.name}`;
      const created = Date.parse(o.created_at ?? '');
      if (!keep.has(path) && Number.isFinite(created) && now - created > ABANDONED_UPLOAD_MS) remove.add(path);
    }
    if (remove.size) {
      const { error: rmError } = await bucket.remove([...remove]);
      if (rmError) throw rmError;
    }
  } catch (e: any) {
    console.error('[books] could not clean up book files', e?.message ?? e);
  }
}

/** save_book raises these codes; anything else is a server error. */
const SAVE_ERRORS: Record<string, { status: number; error: string }> = {
  BK404: { status: 404, error: 'Book not found.' },
  BK409: { status: 409, error: 'This book was changed since you opened it. Reload to see the latest version.' },
  BK400: { status: 400, error: 'Saving would remove every chapter. Remove them on purpose to do that.' },
  '42501': { status: 400, error: 'A chapter in this save belongs to another book. Reload and try again.' },
  '23514': { status: 400, error: 'The book could not be saved as given. Check its file, licence and paths.' },
};

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;

  try {
    let query = db
      .from('books')
      .select('id, user_id, slug, title, subtitle, cover_image, authors, category, status, format, purchasable, available_to_everyone, cohort_ids, updated_at')
      .order('updated_at', { ascending: false });
    if (auth.role !== 'admin') query = query.eq('user_id', auth.user.id);
    const { data: books, error } = await query;
    if (error) throw error;

    const ids = (books ?? []).map((b: any) => b.id);
    // Sales per book, for the list. Refunded and review cases are not counted as sold.
    const sales = await fetchAllRowsByIds<{ book_id: string }>(
      ids,
      (chunk, from, to) => db.from('book_purchases')
        .select('book_id', { count: 'exact' })
        .in('book_id', chunk).eq('status', 'paid').order('id').range(from, to),
    );
    const sold = new Map<string, number>();
    for (const r of sales) sold.set(r.book_id, (sold.get(r.book_id) ?? 0) + 1);

    return NextResponse.json({
      role: auth.role,
      books: (books ?? []).map((b: any) => ({ ...b, sold: sold.get(b.id) ?? 0 })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books] list failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load books.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 300) : '';
  if (!title) return NextResponse.json({ error: 'Add a title.' }, { status: 400 });

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = bookSlug(title, randomBytes(4).toString('hex'));
    const { data, error } = await db
      .from('books')
      .insert({ user_id: auth.user.id, title, slug, status: 'draft' })
      .select('id, slug')
      .single();
    if (!error) return NextResponse.json({ id: data.id, slug: data.slug });
    if (error.code !== '23505') {
      console.error('[books] create failed', error.message);
      return NextResponse.json({ error: 'Could not create the book.' }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'Could not create the book. Try again.' }, { status: 409 });
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'A valid book id is required.' }, { status: 400 });

  try {
    const { data: existing, error: loadError } = await db.from('books').select('*').eq('id', id).maybeSingle();
    if (loadError) throw loadError;
    if (!existing) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
    const book = existing as BookRow;
    if (!canEdit(book, auth.user.id, auth.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Refuse a save built on an older copy of the book (another tab, another editor), so it cannot
    // silently undo what was saved since it was loaded.
    if (body.expectedUpdatedAt !== undefined
      && Date.parse(String(body.expectedUpdatedAt)) !== Date.parse(String(book.updated_at))) {
      return NextResponse.json({ error: 'This book was changed since you opened it. Reload to see the latest version.' }, { status: 409 });
    }

    const commercial = commercialFromInput(body);
    const storedPrices = await loadPrices(db, book.id);

    const patch: Record<string, unknown> = bookColumnsFromInput(body);
    if (commercial.purchasable !== undefined) patch.purchasable = commercial.purchasable;
    if (commercial.royaltyPct !== undefined) patch.royalty_pct = commercial.royaltyPct;

    // Files. A new main file may change the format; the sample must always match it.
    const replaced: string[] = [];
    let format: BookFormat | null = isBookFormat(book.format) ? book.format : null;
    if (body.file !== undefined) {
      const path = body.file?.path;
      const nextFormat = body.file?.format;
      if (path !== book.file_path) {
        if (!isBookFormat(nextFormat)) return NextResponse.json({ error: 'Unknown book format.' }, { status: 400 });
        const checked = await verifyUploadedObject(db, book.id, path, 'file', nextFormat);
        if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
        if (book.file_path) replaced.push(book.file_path);
        patch.file_path = path;
        patch.file_size = checked.size;
        patch.format = nextFormat;
        if (nextFormat !== format && book.preview_file_path && body.preview === undefined) {
          // The old sample is in the old format and can no longer be served.
          replaced.push(book.preview_file_path);
          patch.preview_file_path = null;
        }
        format = nextFormat;
      }
    }
    if (body.preview !== undefined) {
      const path = body.preview?.path ?? null;
      if (path === null) {
        if (book.preview_file_path) replaced.push(book.preview_file_path);
        patch.preview_file_path = null;
      } else if (path !== book.preview_file_path) {
        if (!format) return NextResponse.json({ error: 'Upload the book file before its sample.' }, { status: 400 });
        const checked = await verifyUploadedObject(db, book.id, path, 'preview', format);
        if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
        if (book.preview_file_path) replaced.push(book.preview_file_path);
        patch.preview_file_path = path;
      }
    }

    let chapters: ReturnType<typeof chaptersFromInput> | null = null;
    if (body.chapters !== undefined) {
      chapters = chaptersFromInput(body.chapters, format);
      if ('error' in chapters) return NextResponse.json({ error: chapters.error }, { status: 400 });
    }

    const status = ['draft', 'published', 'archived'].includes(body.status) ? body.status : book.status;
    patch.status = status;
    const nextPrices = commercial.prices ?? storedPrices;
    if (status === 'published') {
      const problems = validateBookForPublish(normalizeBook({ ...book, ...patch }), nextPrices);
      if (problems.length) return NextResponse.json({ error: problems.join(' '), problems }, { status: 400 });
    }
    // One transaction from here. The version is the one the editor loaded, else the one read above,
    // so the publish checks just made are about the row that is actually updated.
    const { data: saved, error: saveError } = await db.rpc('save_book', {
      p_book_id: book.id,
      p_expected_updated_at: body.expectedUpdatedAt ?? book.updated_at ?? null,
      p_patch: patch,
      p_chapters: chapters,
      p_clear_chapters: body.clearChapters === true,
      p_prices: commercial.prices ?? null,
    });
    if (saveError) {
      const known = SAVE_ERRORS[String(saveError.code)];
      if (known) return NextResponse.json({ error: known.error }, { status: known.status });
      throw saveError;
    }

    await cleanUpBookFiles(db, book.id, [(saved as any)?.file_path ?? null, (saved as any)?.preview_file_path ?? null], replaced);

    refreshBookStore();
    return NextResponse.json({ ok: true, book: saved });
  } catch (e: any) {
    console.error('[books] save failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not save the book.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;

  const requested = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID.test(requested)) return NextResponse.json({ error: 'A valid book id is required.' }, { status: 400 });

  try {
    const { data: found, error } = await db.from('books').select('id, user_id').eq('id', requested).maybeSingle();
    if (error) throw error;
    if (!found) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
    const book = found as BookRow;
    if (!canEdit(book, auth.user.id, auth.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // The stored id from here on: storage folders are named by it, in lowercase.
    const id = book.id;

    // A book anyone tried to buy, bought, or was given is archived, never deleted: the money
    // records and buyers' downloads hang off it.
    const [{ count: purchases }, { count: owners }] = await Promise.all([
      db.from('book_purchases').select('id', { count: 'exact', head: true }).eq('book_id', id),
      db.from('book_entitlements').select('id', { count: 'exact', head: true }).eq('book_id', id),
    ]);
    if ((purchases ?? 0) > 0 || (owners ?? 0) > 0) {
      return NextResponse.json({ error: 'This book has orders or owners. Archive it instead of deleting it.' }, { status: 409 });
    }

    const { error: delError } = await db.from('books').delete().eq('id', id);
    if (delError) throw delError;
    await db.from('cohort_assignments').delete().eq('content_id', id);

    const bucket = db.storage.from(BOOK_BUCKET);
    const { data: objects } = await bucket.list(id, { limit: 1000 });
    const paths = (objects ?? []).map((o: any) => `${id}/${o.name}`);
    if (paths.length) {
      const { error: rmError } = await bucket.remove(paths);
      if (rmError) console.error('[books] could not remove files of deleted book', rmError.message);
    }
    refreshBookStore();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[books] delete failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not delete the book.' }, { status: 500 });
  }
}
