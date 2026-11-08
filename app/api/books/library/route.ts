import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { isLicenseExpired } from '@/lib/books/schema';

// GET /api/books/library -> { books: LibraryBook[], purchases: LibraryPurchase[] }
//
// The buyer's "My Books": every book they can download, and their book payments.
//   * books they bought or were granted (an active book_entitlements row) -- kept after a book is
//     archived, as lib/books/access.ts canReadBook does; drafts stay hidden
//   * published books assigned to their cohort, directly or through a published learning path
//     assigned to it (books open to everyone are on the store, not listed here)
// A book whose licence has ended is still listed, marked unavailable, so it does not silently
// disappear. Display columns only: no file paths -- downloads go through /api/books/[id]/file,
// which re-checks access. Student Mode lists the viewed student's books (requireStudentUser).
export const dynamic = 'force-dynamic';

const BOOK_COLUMNS = 'id, slug, title, subtitle, cover_image, authors, format, file_size, status, license_expires_at';

export type LibrarySource = 'purchase' | 'grant' | 'cohort';

export interface LibraryBook {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  authors: string[];
  format: string | null;
  fileSize: number | null;
  source: LibrarySource;
  /** When it became theirs (entitlements); null for cohort books. */
  since: string | null;
  /** False once the licence has ended: listed, but not downloadable. */
  available: boolean;
}

export interface LibraryPurchase {
  id: string;
  bookId: string | null;
  bookTitle: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

function toBook(row: any, source: LibrarySource, since: string | null, now: Date): LibraryBook {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? null,
    coverImage: row.cover_image ?? null,
    authors: Array.isArray(row.authors) ? row.authors : [],
    format: row.format ?? null,
    fileSize: row.file_size ?? null,
    source,
    since,
    available: !isLicenseExpired(row.license_expires_at, now),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;
  const db = auth.serviceDb;
  const userId = auth.user.id;
  const now = new Date();

  try {
    const [studentRes, entitlementRes, purchaseRes] = await Promise.all([
      db.from('students').select('cohort_id').eq('id', userId).maybeSingle(),
      db.from('book_entitlements').select('book_id, source, granted_at').eq('student_id', userId).is('revoked_at', null),
      db.from('book_purchases')
        .select('id, book_id, book_title, amount, currency, status, paid_at, created_at')
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    for (const r of [studentRes, entitlementRes, purchaseRes]) if (r.error) throw r.error;
    const cohortId: string | null = (studentRes.data as any)?.cohort_id ?? null;
    const entitlements: any[] = (entitlementRes.data as any[]) ?? [];

    const books = new Map<string, LibraryBook>();

    // Bought or granted. Archived books stay; drafts do not.
    if (entitlements.length) {
      const { data, error } = await db.from('books').select(BOOK_COLUMNS)
        .in('id', entitlements.map(e => e.book_id))
        .in('status', ['published', 'archived']);
      if (error) throw error;
      const byId = new Map(((data as any[]) ?? []).map(b => [b.id, b]));
      for (const e of entitlements) {
        const row = byId.get(e.book_id);
        if (row) books.set(row.id, toBook(row, e.source === 'grant' ? 'grant' : 'purchase', e.granted_at ?? null, now));
      }
    }

    // Assigned to the cohort: directly, or through a published path assigned to the cohort.
    if (cohortId) {
      const [direct, paths] = await Promise.all([
        db.from('books').select(BOOK_COLUMNS).eq('status', 'published').contains('cohort_ids', [cohortId]),
        db.from('learning_paths').select('item_ids').eq('status', 'published').contains('cohort_ids', [cohortId]),
      ]);
      if (direct.error) throw direct.error;
      if (paths.error) throw paths.error;
      const rows: any[] = [...((direct.data as any[]) ?? [])];
      const pathItems = [...new Set(((paths.data as any[]) ?? []).flatMap(p => (Array.isArray(p.item_ids) ? p.item_ids : [])))]
        .filter(id => !books.has(id) && !rows.some(r => r.id === id));
      if (pathItems.length) {
        // learning_paths.item_ids mixes content types; only the ids that are books match here.
        const { data, error } = await db.from('books').select(BOOK_COLUMNS).eq('status', 'published').in('id', pathItems);
        if (error) throw error;
        rows.push(...((data as any[]) ?? []));
      }
      for (const row of rows) if (!books.has(row.id)) books.set(row.id, toBook(row, 'cohort', null, now));
    }

    const list = [...books.values()].sort((a, b) =>
      (b.since ?? '').localeCompare(a.since ?? '') || a.title.localeCompare(b.title));

    const purchases: LibraryPurchase[] = ((purchaseRes.data as any[]) ?? []).map(p => ({
      id: p.id,
      bookId: p.book_id ?? null,
      bookTitle: p.book_title,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      paidAt: p.paid_at ?? null,
      createdAt: p.created_at,
    }));

    return NextResponse.json({ books: list, purchases }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[books/library]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load your books.' }, { status: 500 });
  }
}
