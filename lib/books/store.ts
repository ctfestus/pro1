import 'server-only';
import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { fetchAllRowsByIds } from '@/lib/fetch-all-rows';
import { shownPrice, type PriceRow, type ShownPrice } from '@/lib/books/pricing';
import { isBookObjectPath, isLicenseExpired, type BookFormat } from '@/lib/books/schema';
import { BOOKS_STORE_TAG } from '@/lib/books/store-cache';
import { isProductType, productTypeLabel } from '@/lib/books/product-type';
import type { NavBook } from '@/lib/landing-nav';

/**
 * What the public book store (/books, /books/[slug]) may show anyone, signed in or not.
 *
 * Anonymous visitors cannot read the book tables (RLS is authenticated-only), so the store reads
 * them here with the service role, under the same two rules as lib/public-catalogue-item.ts:
 *
 * 1. The projection is pinned. The object paths are read only to decide hasFile / hasSample and
 *    are never returned: toStoreBook builds the output field by field.
 * 2. Only books the public may buy or download: published, with a file, a current licence, and
 *    either for sale with at least one price, or open to everyone (free). Drafts, archived and
 *    cohort-only books never appear.
 *
 * Cached for a minute under the 'books-store' tag; /api/books revalidates it on every save.
 */

const COLUMNS = [
  'id', 'slug', 'title', 'subtitle', 'description', 'cover_image', 'authors', 'category', 'topics', 'skills',
  'difficulty', 'estimated_minutes', 'format', 'file_size', 'purchasable', 'available_to_everyone',
  'license_expires_at', 'updated_at', 'product_type', 'product_type_label',
  // Read only to compute hasFile / hasSample. Never returned.
  'file_path', 'preview_file_path',
].join(', ');

/** A price as shown and charged now: the sale price while a sale is on (lib/books/pricing.ts). */
export type StorePrice = ShownPrice;

export interface StoreBook {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  coverImage: string | null;
  authors: string[];
  category: string | null;
  topics: string[];
  skills: string[];
  difficulty: string | null;
  estimatedMinutes: number | null;
  format: BookFormat;
  /** What kind of product (migration 242), e.g. 'template', and how it reads, e.g. "Template". */
  productType: string;
  productTypeLabel: string;
  fileSize: number | null;
  /** Open to everyone: a free download for any signed-in visitor. */
  free: boolean;
  /** For sale, sorted by currency. Empty for a free book. */
  prices: StorePrice[];
  /** A free sample anyone may open (for-sale books only). */
  hasSample: boolean;
}

export interface StoreChapter {
  title: string;
  inSample: boolean;
}

export interface StoreBookDetail extends StoreBook {
  chapters: StoreChapter[];
  /** The instructor who publishes the product, from their own profile (Settings). */
  instructor: StoreInstructor | null;
}

export type SocialKey = 'linkedin' | 'twitter' | 'instagram' | 'github' | 'youtube' | 'website';

export interface StoreInstructor {
  name: string;
  /** An https URL or an image reference; null when there is no photo. */
  avatar: string | null;
  bio: string | null;
  /** Only well-formed http(s) links, in a fixed order. */
  links: { key: SocialKey; url: string }[];
}

const SOCIAL_KEYS: SocialKey[] = ['linkedin', 'twitter', 'instagram', 'github', 'youtube', 'website'];

function webUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) return null;
  const raw = v.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The public part of a profile row, built field by field like toStoreBook: name, photo, bio and
 * the social links set in Settings. Null without a name. Exported for tests.
 */
export function toStoreInstructor(row: any): StoreInstructor | null {
  const name = typeof row?.full_name === 'string' ? row.full_name.trim().slice(0, 200) : '';
  if (!name) return null;
  const avatarRaw = typeof row.avatar_url === 'string' ? row.avatar_url.trim() : '';
  const avatar = avatarRaw.startsWith('https://') || /^[\w./-]{1,300}$/.test(avatarRaw) ? avatarRaw : null;
  const bio = typeof row.bio === 'string' ? row.bio.replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 800) || null : null;
  const social = row.social_links && typeof row.social_links === 'object' && !Array.isArray(row.social_links) ? row.social_links : {};
  const links = SOCIAL_KEYS.flatMap(key => {
    const url = webUrl(social[key]);
    return url ? [{ key, url }] : [];
  });
  return { name, avatar, bio, links };
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

/**
 * A row to what the store shows, or null when the public may not see it. Exported for tests: it is
 * the one place the output shape is built, so a path can never leak through a spread.
 */
export function toStoreBook(row: any, prices: StorePrice[], now: Date = new Date()): StoreBook | null {
  if (!row || row.status !== 'published') return null;
  const format = row.format as BookFormat;
  if (!isBookObjectPath(row.id, row.file_path, 'file', format)) return null;
  if (isLicenseExpired(row.license_expires_at, now)) return null;
  const free = row.available_to_everyone === true;
  const forSale = row.purchasable === true && prices.length > 0;
  if (!free && !forSale) return null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title ?? 'Untitled'),
    subtitle: row.subtitle ?? null,
    description: row.description ?? null,
    coverImage: row.cover_image ?? null,
    authors: list(row.authors),
    category: row.category ?? null,
    topics: list(row.topics),
    skills: list(row.skills),
    difficulty: row.difficulty ?? null,
    estimatedMinutes: typeof row.estimated_minutes === 'number' ? row.estimated_minutes : null,
    productType: isProductType(row.product_type) ? row.product_type : 'book',
    productTypeLabel: productTypeLabel(row.product_type, row.product_type_label),
    format,
    fileSize: typeof row.file_size === 'number' ? row.file_size : null,
    free,
    prices: free ? [] : prices,
    hasSample: !free && forSale && isBookObjectPath(row.id, row.preview_file_path, 'preview', format),
  };
}

async function pricesFor(db: any, ids: string[]): Promise<Map<string, StorePrice[]>> {
  const out = new Map<string, StorePrice[]>();
  if (!ids.length) return out;
  // Chunked and paged: a truncated or oversized price query would silently hide books from the
  // store. (book_id, currency) is unique, so ordering by both keeps page boundaries stable.
  const rows = await fetchAllRowsByIds<PriceRow & { book_id: string }>(ids, (chunk, from, to) =>
    db.from('book_prices').select('book_id, currency, amount, sale_amount, sale_ends_at', { count: 'exact' })
      .in('book_id', chunk).order('book_id').order('currency').range(from, to));
  for (const p of rows) {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const entry = out.get(p.book_id) ?? [];
    entry.push(shownPrice(p));
    out.set(p.book_id, entry);
  }
  return out;
}

/** Every book in the store, newest first. Throws on a database error. */
export async function loadStoreBooks(db: any = adminClient(), now: Date = new Date()): Promise<StoreBook[]> {
  const { data, error } = await db
    .from('books')
    .select(`${COLUMNS}, status`)
    .eq('status', 'published')
    .or('purchasable.eq.true,available_to_everyone.eq.true')
    .not('file_path', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  const prices = await pricesFor(db, rows.filter(r => r.purchasable === true).map(r => r.id));
  return rows.map(r => toStoreBook(r, prices.get(r.id) ?? [], now)).filter((b): b is StoreBook => !!b);
}

/** One book by slug with its table of contents, or null when the public may not see it. */
export async function loadStoreBook(slug: string, db: any = adminClient(), now: Date = new Date()): Promise<StoreBookDetail | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug)) return null;
  const { data, error } = await db.from('books').select(`${COLUMNS}, status, user_id`).eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const prices = (data as any).purchasable === true ? (await pricesFor(db, [(data as any).id])).get((data as any).id) ?? [] : [];
  const book = toStoreBook(data, prices, now);
  if (!book) return null;
  const instructor = await loadInstructor(db, (data as any).user_id);
  const { data: chapters, error: chapterError } = await db
    .from('book_chapters')
    .select('title, is_preview, position')
    .eq('book_id', book.id)
    .order('position');
  if (chapterError) throw chapterError;
  return {
    ...book,
    instructor,
    chapters: ((chapters as any[]) ?? [])
      .filter(c => typeof c.title === 'string' && c.title.trim())
      .map(c => ({ title: c.title, inSample: book.hasSample && c.is_preview === true })),
  };
}

/** The publishing instructor's public profile. A failure only hides the section. */
async function loadInstructor(db: any, userId: unknown): Promise<StoreInstructor | null> {
  if (typeof userId !== 'string' || !userId) return null; // the author's account was deleted
  try {
    const { data: profile } = await db
      .from('students')
      .select('full_name, avatar_url, bio, social_links')
      .eq('id', userId)
      .in('role', ['instructor', 'admin'])
      .maybeSingle();
    return toStoreInstructor(profile);
  } catch (e: any) {
    console.error('[books/store] instructor lookup failed', e?.message ?? e);
    return null;
  }
}

/**
 * Products recommended with a course (migration 240), as the public store shows them: only ones the
 * public may buy or download (toStoreBook), newest first, at most three.
 */
export async function loadProductsForCourse(courseId: string, db: any = adminClient(), now: Date = new Date()): Promise<StoreBook[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId)) return [];
  const { data, error } = await db
    .from('books')
    .select(`${COLUMNS}, status`)
    .eq('status', 'published')
    .contains('recommended_course_ids', [courseId.toLowerCase()])
    .or('purchasable.eq.true,available_to_everyone.eq.true')
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  const prices = await pricesFor(db, rows.filter(r => r.purchasable === true).map(r => r.id));
  return rows.map(r => toStoreBook(r, prices.get(r.id) ?? [], now)).filter((b): b is StoreBook => !!b).slice(0, 3);
}

export const getProductsForCourse = unstable_cache((courseId: string) => loadProductsForCourse(courseId), ['books-store-for-course'], { tags: [BOOKS_STORE_TAG], revalidate: 60 });

export const listStoreBooks = unstable_cache(() => loadStoreBooks(), ['books-store-list'], { tags: [BOOKS_STORE_TAG], revalidate: 60 });
export const getStoreBook = unstable_cache((slug: string) => loadStoreBook(slug), ['books-store-book'], { tags: [BOOKS_STORE_TAG], revalidate: 60 });

/** For the public pages: an outage shows an empty store rather than an error page. */
export async function listStoreBooksOrEmpty(): Promise<StoreBook[]> {
  try {
    return await listStoreBooks();
  } catch (e: any) {
    console.error('[books/store] list failed', e?.message ?? e);
    return [];
  }
}

/** The store's books for the shared nav's Learn menu (lib/landing-nav.ts). Empty on any failure. */
export async function listNavBooks(): Promise<NavBook[]> {
  return (await listStoreBooksOrEmpty()).map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
}
