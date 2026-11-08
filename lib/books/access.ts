/**
 * Who may read a book's file. The single decision behind every route that hands out book bytes.
 *
 * The books table's RLS decides who may SEE a book row (a purchasable book is visible to every
 * signed-in account so it can be sold). Reading is narrower, and is decided here on the service
 * role, because the file lives in a private bucket that only these routes can reach.
 *
 * Grants, in order:
 *   1. the owner, or an admin -- always, even for a draft or an expired licence, so they can fix it
 *   2. the shared cohort rule (lib/student-content-access.ts), which also covers subscription plans
 *   3. an active book_entitlements row (single-book purchase or manual grant) -- this one also
 *      survives archiving: a buyer keeps re-downloading what they paid for after the book is withdrawn
 * A reader with none of these gets the free sample -- but only for a book that is for sale. A book
 * the reader cannot even see in the catalogue (cohort-only, not for sale) is a 404, so these
 * service-role routes never reveal more than the books RLS does.
 */
import { hasPublishedStudentContentAccess } from '@/lib/student-content-access';
import { isBookObjectPath, isLicenseExpired, type BookFormat } from '@/lib/books/schema';

export type BookAccess =
  | { level: 'full'; reason: 'owner' | 'admin' | 'cohort' | 'entitlement' }
  | { level: 'preview' }
  | { level: 'none'; status: 403 | 404; error: string };

/** The columns canReadBook needs. Select at least these. */
export const BOOK_ACCESS_COLUMNS =
  'id, user_id, status, cohort_ids, available_to_everyone, purchasable, license_expires_at, preview_file_path';

export interface BookAccessRow {
  id: string;
  user_id: string | null;
  status: string | null;
  cohort_ids: string[] | null;
  available_to_everyone: boolean | null;
  purchasable: boolean | null;
  license_expires_at: string | null;
  preview_file_path: string | null;
}

const NOT_FOUND: BookAccess = { level: 'none', status: 404, error: 'Book not found.' };

export async function canReadBook(
  db: any,
  userId: string,
  book: BookAccessRow,
  now: Date = new Date(),
): Promise<BookAccess> {
  const { data: me, error: meError } = await db
    .from('students')
    .select('role, cohort_id')
    .eq('id', userId)
    .maybeSingle();
  if (meError) throw meError;

  if (book.user_id === userId) return { level: 'full', reason: 'owner' };
  if (me?.role === 'admin') return { level: 'full', reason: 'admin' };

  // Drafts do not exist to anyone else. An archived book is withdrawn from sale and from cohorts,
  // but people who own it keep it: they paid for a download, not for a listing.
  if (book.status !== 'published' && book.status !== 'archived') return NOT_FOUND;
  const archived = book.status === 'archived';

  const viaCohort = !archived && await hasPublishedStudentContentAccess(db, {
    contentId: book.id,
    status: book.status,
    cohortId: me?.cohort_id ?? null,
    cohortIds: book.cohort_ids,
    availableToEveryone: book.available_to_everyone,
  });

  let entitled = false;
  if (!viaCohort) {
    const { data: ent, error: entError } = await db
      .from('book_entitlements')
      .select('id')
      .eq('student_id', userId)
      .eq('book_id', book.id)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    if (entError) throw entError;
    entitled = !!ent;
  }
  if (archived && !entitled) return NOT_FOUND;

  // These routes run on the service role, so the catalogue RLS does not hide anything here. A
  // reader with no grant may only learn a book exists when it is for sale -- exactly the rows the
  // books RLS shows them. Anything else (a cohort-only title, say) is a 404, sample or not.
  const visible = viaCohort || entitled || book.purchasable === true;
  if (!visible) return NOT_FOUND;

  if (isLicenseExpired(book.license_expires_at, now)) {
    return { level: 'none', status: 403, error: 'This book is no longer available.' };
  }
  if (viaCohort) return { level: 'full', reason: 'cohort' };
  if (entitled) return { level: 'full', reason: 'entitlement' };

  // For sale, not owned: the sample if there is one.
  if (book.preview_file_path) return { level: 'preview' };
  return { level: 'none', status: 403, error: 'Buy this book to read it.' };
}

/**
 * Whether anyone, signed in or not, may read this book's free sample: the store shows it to every
 * visitor (/api/books/[id]/sample, and the sandboxed HTML route for a public-sample ticket). Only a
 * published book that is for sale, whose licence is current, and whose sample is an object this
 * book's own upload issued. Never the full file: callers serve preview_file_path and nothing else.
 */
export function isPublicSampleAvailable(
  row: Pick<BookAccessRow, 'id' | 'status' | 'purchasable' | 'license_expires_at' | 'preview_file_path'> & { format: string | null },
  now: Date = new Date(),
): boolean {
  return row.status === 'published'
    && row.purchasable === true
    && !isLicenseExpired(row.license_expires_at, now)
    && isBookObjectPath(row.id, row.preview_file_path, 'preview', row.format as BookFormat);
}
