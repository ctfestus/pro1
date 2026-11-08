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
 *   3. an active book_entitlements row (single-book purchase or manual grant)
 * A reader with none of these gets the free sample -- but only for a book that is for sale. A book
 * the reader cannot even see in the catalogue (cohort-only, not for sale) is a 404, so these
 * service-role routes never reveal more than the books RLS does.
 */
import { hasPublishedStudentContentAccess } from '@/lib/student-content-access';
import { isLicenseExpired } from '@/lib/books/schema';

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

  // Unpublished books do not exist to anyone else, whatever they once bought. Archiving a book
  // is how an admin withdraws it; an entitlement does not override that.
  if (book.status !== 'published') return NOT_FOUND;

  const viaCohort = await hasPublishedStudentContentAccess(db, {
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
