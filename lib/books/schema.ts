/**
 * The Books content contract: row shapes, locators, and the boundary normalizer.
 *
 * Books are not course content, so these types live here rather than in lib/course-schema.ts.
 *
 * This module has no runtime imports, so client components may import it freely.
 */

export type BookFormat = 'epub' | 'pdf' | 'html';
export type BookStatus = 'draft' | 'published' | 'archived';
export type BookDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type BookLicenseType =
  | 'own' | 'cc_by' | 'cc_by_sa' | 'cc_by_nc' | 'public_domain' | 'licensed' | 'other';

export const BOOK_FORMATS: readonly BookFormat[] = ['epub', 'pdf', 'html'];
export const BOOK_DIFFICULTIES: readonly BookDifficulty[] = ['beginner', 'intermediate', 'advanced'];
export const BOOK_LICENSE_TYPES: readonly BookLicenseType[] = [
  'own', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'public_domain', 'licensed', 'other',
];

/** Storage object key limits. Mirrors the book-files bucket configuration (migration 232). */
export const BOOK_FILE_MAX_BYTES = 100 * 1024 * 1024;
/** Self-contained HTML books are served through a function, so they keep the embed proxy's cap. */
export const BOOK_HTML_MAX_BYTES = 10 * 1024 * 1024;

export const BOOK_MIME_BY_FORMAT: Record<BookFormat, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  html: 'text/html',
};

/** Where a chapter starts. Exactly one shape per format. */
export type BookChapterLocator =
  | { href: string }                          // EPUB spine item / nav target
  | { pageStart: number; pageEnd?: number }   // PDF, 1-based
  | { anchor: string };                       // HTML element id

export interface Book {
  id: string;
  /** Null once the author's account is deleted; admins manage the book from then on. */
  userId: string | null;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  coverImage: string | null;
  authors: string[];
  category: string | null;
  topics: string[];
  skills: string[];
  difficulty: BookDifficulty | null;
  estimatedMinutes: number | null;
  status: BookStatus;
  cohortIds: string[];
  availableToEveryone: boolean;
  purchasable: boolean;
  royaltyPct: number;
  format: BookFormat | null;
  filePath: string | null;
  fileSize: number | null;
  previewFilePath: string | null;
  rightsHolder: string | null;
  licenseType: BookLicenseType | null;
  licenseUrl: string | null;
  licenseExpiresAt: string | null;
  aiAllowed: boolean;
  endorsementPermitted: boolean;
}

export interface BookChapter {
  id: string;
  bookId: string;
  position: number;
  title: string;
  locator: BookChapterLocator | Record<string, never>;
  estimatedMinutes: number | null;
  required: boolean;
  isPreview: boolean;
}

export interface BookPrice {
  currency: string;
  amount: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()) : [];
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);

/** A database row (snake_case) to the Book contract. Tolerates missing optional columns. */
export function normalizeBook(row: any): Book {
  return {
    id: String(row?.id ?? ''),
    userId: str(row?.user_id),
    slug: String(row?.slug ?? ''),
    title: str(row?.title) ?? 'Untitled',
    subtitle: str(row?.subtitle),
    description: str(row?.description),
    coverImage: str(row?.cover_image),
    authors: strList(row?.authors),
    category: str(row?.category),
    topics: strList(row?.topics),
    skills: strList(row?.skills),
    difficulty: oneOf(row?.difficulty, BOOK_DIFFICULTIES),
    estimatedMinutes: num(row?.estimated_minutes),
    status: oneOf(row?.status, ['draft', 'published', 'archived'] as const) ?? 'draft',
    cohortIds: strList(row?.cohort_ids),
    availableToEveryone: row?.available_to_everyone === true,
    purchasable: row?.purchasable === true,
    royaltyPct: num(row?.royalty_pct) ?? 0,
    format: oneOf(row?.format, BOOK_FORMATS),
    filePath: str(row?.file_path),
    fileSize: num(row?.file_size),
    previewFilePath: str(row?.preview_file_path),
    rightsHolder: str(row?.rights_holder),
    licenseType: oneOf(row?.license_type, BOOK_LICENSE_TYPES),
    licenseUrl: str(row?.license_url),
    licenseExpiresAt: str(row?.license_expires_at),
    aiAllowed: row?.ai_allowed !== false,
    endorsementPermitted: row?.endorsement_permitted === true,
  };
}

export function normalizeChapter(row: any): BookChapter {
  const loc = row?.locator && typeof row.locator === 'object' ? row.locator : {};
  return {
    id: String(row?.id ?? ''),
    bookId: String(row?.book_id ?? ''),
    position: num(row?.position) ?? 0,
    title: str(row?.title) ?? 'Untitled chapter',
    locator: loc,
    estimatedMinutes: num(row?.estimated_minutes),
    required: row?.required !== false,
    isPreview: row?.is_preview === true,
  };
}

/** True once a licence end date has passed. A missing or unparseable date never expires. */
export function isLicenseExpired(licenseExpiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!licenseExpiresAt) return false;
  const t = Date.parse(licenseExpiresAt);
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * Problems that block publishing, as user-visible sentences. Mirrors the books_published_ready
 * CHECK (migration 232) so the editor can say why before the database refuses.
 */
export function validateBookForPublish(book: Book, prices: BookPrice[] = []): string[] {
  const problems: string[] = [];
  if (!book.title || book.title === 'Untitled') problems.push('Add a title.');
  if (!book.format || !book.filePath) problems.push('Upload the book file.');
  if (!book.licenseType) problems.push('Choose a licence type.');
  if (!book.availableToEveryone && !book.purchasable && book.cohortIds.length === 0) {
    problems.push('Choose who can read it: everyone, a cohort, or sell it.');
  }
  if (book.purchasable && prices.length === 0) problems.push('Set at least one price to sell this book.');
  if (isLicenseExpired(book.licenseExpiresAt)) problems.push('The licence end date has already passed.');
  return problems;
}

/**
 * Storage object path for a book's file. One folder per book keeps cleanup to a prefix delete; the
 * nonce gives every upload a fresh object, so replacing a file never breaks a reader mid-session
 * on the old one (the old object is removed once the new path is saved).
 */
export function bookObjectPath(bookId: string, kind: 'file' | 'preview', format: BookFormat, nonce: string): string {
  return `${bookId}/${kind}-${nonce}.${format}`;
}

/**
 * True when `path` is an object the upload route could have issued for THIS book, of this kind and
 * format. Every route that signs or downloads a book object checks this first: file_path is
 * author-writable, so without it an author could point their own draft at another book's object
 * and read it through the service role. The books_*_path_scoped CHECKs (migration 232) enforce the
 * same rule in the database.
 */
export function isBookObjectPath(
  bookId: string,
  path: unknown,
  kind: 'file' | 'preview',
  format: BookFormat | string | null | undefined,
): path is string {
  if (typeof path !== 'string' || !bookId) return false;
  if (!(BOOK_FORMATS as readonly string[]).includes(String(format))) return false;
  const prefix = `${bookId}/${kind}-`;
  if (!path.startsWith(prefix)) return false;
  return new RegExp(`^[0-9a-f-]{36}\\.${format}$`).test(path.slice(prefix.length));
}
