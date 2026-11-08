/**
 * Server-side rules for saving a book from the admin editor (/api/books). Kept out of the route so
 * each rule is testable on its own.
 *
 * Every value the editor sends is untrusted: these functions turn request JSON into exactly the
 * columns the route writes, and nothing else. Commercial terms (whether a book is sold, its royalty,
 * its prices) are parsed separately because prices live in their own table.
 */
import {
  BOOK_DIFFICULTIES,
  BOOK_FILE_MAX_BYTES,
  BOOK_FORMATS,
  BOOK_HTML_MAX_BYTES,
  BOOK_LICENSE_TYPES,
  BOOK_MIME_BY_FORMAT,
  isBookObjectPath,
  type BookFormat,
  type BookPrice,
} from '@/lib/books/schema';
import { BOOK_BUCKET } from '@/lib/books/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function textList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const t = text(item, maxLen);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function positiveInt(v: unknown, max: number): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), max);
}

function httpUrl(v: unknown): string | null {
  const t = text(v, 2000);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function isoDate(v: unknown): string | null {
  const t = text(v, 40);
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The editable, non-commercial columns, from request JSON. Keys absent from the request are absent
 * from the result, so a partial save leaves other columns alone.
 */
export function bookColumnsFromInput(input: any): Record<string, unknown> {
  const has = (k: string) => input && Object.prototype.hasOwnProperty.call(input, k);
  const out: Record<string, unknown> = {};
  if (has('title')) out.title = text(input.title, 300) ?? 'Untitled';
  if (has('subtitle')) out.subtitle = text(input.subtitle, 300);
  if (has('description')) out.description = text(input.description, 20000);
  if (has('coverImage')) out.cover_image = text(input.coverImage, 2000);
  if (has('authors')) out.authors = textList(input.authors, 20, 200);
  if (has('category')) out.category = text(input.category, 120);
  if (has('topics')) out.topics = textList(input.topics, 30, 80);
  if (has('skills')) out.skills = textList(input.skills, 30, 80);
  if (has('difficulty')) {
    out.difficulty = (BOOK_DIFFICULTIES as readonly string[]).includes(input.difficulty) ? input.difficulty : null;
  }
  if (has('estimatedMinutes')) out.estimated_minutes = positiveInt(input.estimatedMinutes, 100000);
  if (has('rightsHolder')) out.rights_holder = text(input.rightsHolder, 300);
  if (has('licenseType')) {
    out.license_type = (BOOK_LICENSE_TYPES as readonly string[]).includes(input.licenseType) ? input.licenseType : null;
  }
  if (has('licenseUrl')) out.license_url = httpUrl(input.licenseUrl);
  if (has('licenseExpiresAt')) out.license_expires_at = isoDate(input.licenseExpiresAt);
  if (has('aiAllowed')) out.ai_allowed = input.aiAllowed !== false;
  if (has('endorsementPermitted')) out.endorsement_permitted = input.endorsementPermitted === true;
  if (has('availableToEveryone') || has('cohortIds')) {
    const everyone = input.availableToEveryone === true;
    const cohorts = Array.isArray(input.cohortIds)
      ? [...new Set(input.cohortIds.filter((c: unknown): c is string => typeof c === 'string' && UUID.test(c)).map((c: string) => c.toLowerCase()))]
      : [];
    // Same rule as the books CHECK: an open book names no cohorts.
    out.available_to_everyone = everyone;
    out.cohort_ids = everyone ? [] : cohorts;
  }
  return out;
}

export interface CommercialInput {
  purchasable?: boolean;
  royaltyPct?: number;
  prices?: BookPrice[];
}

/** Commercial terms present in the request, normalized. Undefined fields were not sent. */
export function commercialFromInput(input: any): CommercialInput {
  const out: CommercialInput = {};
  if (input && 'purchasable' in input) out.purchasable = input.purchasable === true;
  if (input && 'royaltyPct' in input) {
    const n = Number(input.royaltyPct);
    out.royaltyPct = Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 100) / 100 : 0;
  }
  if (input && Array.isArray(input.prices)) {
    const byCurrency = new Map<string, number>();
    for (const p of input.prices) {
      const currency = typeof p?.currency === 'string' ? p.currency.trim().toUpperCase() : '';
      const amount = Number(p?.amount);
      if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || amount <= 0 || amount >= 1e8) continue;
      byCurrency.set(currency, Math.round(amount * 100) / 100);
    }
    out.prices = [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
  }
  return out;
}

export interface ChapterInput {
  id?: string;
  title: string;
  locator: Record<string, unknown>;
  estimated_minutes: number | null;
  required: boolean;
  is_preview: boolean;
}

/**
 * Chapters for save_book_chapters (migration 233). Returns an error sentence instead when a chapter
 * is unusable, so the editor can show it. Locators are checked against the book's format: they are
 * later handed to the reader, so only the shape that format uses is kept.
 */
export function chaptersFromInput(input: unknown, format: BookFormat | null): ChapterInput[] | { error: string } {
  if (!Array.isArray(input)) return { error: 'Chapters must be a list.' };
  if (input.length > 1000) return { error: 'A book can have at most 1000 chapters.' };
  const out: ChapterInput[] = [];
  const seenIds = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const title = text(raw?.title, 300);
    if (!title) return { error: `Chapter ${i + 1} needs a title.` };
    const id = typeof raw?.id === 'string' && UUID.test(raw.id) ? raw.id.toLowerCase() : null;
    if (id && seenIds.has(id)) return { error: `Chapter ${i + 1} is listed twice.` };
    if (id) seenIds.add(id);
    const loc = raw?.locator ?? {};
    let locator: Record<string, unknown> = {};
    if (format === 'epub') {
      const href = text(loc.href, 1000);
      if (href) locator = { href };
    } else if (format === 'pdf') {
      const start = positiveInt(loc.pageStart, 100000);
      const end = positiveInt(loc.pageEnd, 100000);
      if (start) locator = end && end >= start ? { pageStart: start, pageEnd: end } : { pageStart: start };
    } else if (format === 'html') {
      const anchor = text(loc.anchor, 200);
      if (anchor && /^[A-Za-z][\w:.-]*$/.test(anchor)) locator = { anchor };
    }
    out.push({
      ...(id ? { id } : {}),
      title,
      locator,
      estimated_minutes: positiveInt(raw?.estimatedMinutes, 10000),
      required: raw?.required !== false,
      is_preview: raw?.isPreview === true,
    });
  }
  return out;
}

/**
 * Check an object the browser says it uploaded, before its path is saved on the book. The upload
 * route only declared a size; the signed upload URL does not enforce it, so the real stored size
 * and type are read back here. A rejected object is deleted so it does not sit in the bucket.
 * Returns the real size when acceptable, or an error sentence.
 */
export async function verifyUploadedObject(
  db: any,
  bookId: string,
  path: unknown,
  kind: 'file' | 'preview',
  format: BookFormat,
): Promise<{ size: number } | { error: string }> {
  if (!isBookObjectPath(bookId, path, kind, format)) return { error: 'That upload does not belong to this book.' };
  const bucket = db.storage.from(BOOK_BUCKET);
  const { data, error } = await bucket.info(path);
  if (error || !data) return { error: 'The uploaded file was not found. Upload it again.' };

  const size = Number((data as any).size ?? (data as any).metadata?.size);
  const type = String((data as any).contentType ?? (data as any).metadata?.mimetype ?? '').split(';')[0].trim();
  const max = format === 'html' ? BOOK_HTML_MAX_BYTES : BOOK_FILE_MAX_BYTES;
  let problem: string | null = null;
  if (!Number.isFinite(size) || size <= 0) problem = 'The uploaded file is empty.';
  else if (size > max) problem = `The file is larger than ${Math.round(max / (1024 * 1024))} MB.`;
  else if (type && type !== BOOK_MIME_BY_FORMAT[format]) problem = 'The uploaded file is not the expected type.';
  if (problem) {
    await bucket.remove([path]).catch(() => {});
    return { error: problem };
  }
  return { size };
}

/** A URL-safe slug from a title, plus a short random tail so titles may repeat. */
export function bookSlug(title: string, tail: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${tail}` : tail;
}

export function isBookFormat(v: unknown): v is BookFormat {
  return typeof v === 'string' && (BOOK_FORMATS as readonly string[]).includes(v);
}
