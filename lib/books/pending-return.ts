/**
 * Keeps a book buyer's way back to My Books across signing in and onboarding.
 *
 * Two links bring a buyer to My Books:
 *   * Paystack's return, /student?book_reference=...#products, where the payment is confirmed;
 *   * the receipt email's "Download your book", /student#products.
 * If their session expired, or they are new and still have to finish onboarding, the student page
 * redirects them away first, and those redirects go to fixed places (sign-in, then the dashboard;
 * onboarding, then Learning Paths). The payment confirmation or the download was lost. So the
 * destination is stored before the redirect and rebuilt afterwards.
 *
 * Same rules as lib/pending-purchase.ts: no URL is stored, only a reference matching the exact
 * shape checkout issues (`book-` + a UUID, lib/paystack.ts makePaystackReference) or a flag that
 * My Books was the destination; the path is rebuilt here; storage failures are swallowed (the
 * buyer can still open My Books, and the webhook still grants the book).
 */

const KEY = 'pending-book-return';
const TTL_MS = 24 * 60 * 60 * 1000;
const REFERENCE = /^book-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS_HASH = '#products';

/** The book payment reference in a query string, or null. */
export function readBookReturn(search: string): string | null {
  try {
    const reference = new URLSearchParams(search).get('book_reference');
    return reference && REFERENCE.test(reference) ? reference : null;
  } catch {
    return null;
  }
}

/**
 * Call before redirecting a visitor to sign in or onboarding. Stores the payment reference when
 * there is one, else just that My Books was where they were going (the receipt link).
 */
export function rememberBookReturn(search: string, hash: string): void {
  const reference = readBookReturn(search);
  if (!reference && hash !== PRODUCTS_HASH) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(reference ? { reference, at: Date.now() } : { books: true, at: Date.now() }));
  } catch { /* storage unavailable: My Books and the webhook still work without it */ }
}

/** The return page, built from a validated reference only. */
export function bookReturnHref(reference: string): string | null {
  return REFERENCE.test(reference) ? `/student?book_reference=${encodeURIComponent(reference)}#products` : null;
}

/**
 * Reads and clears the stored destination, as a path to go to: the payment return page, or
 * My Books. Single use; null when nothing (valid and recent) was stored.
 */
export function takeBookReturnHref(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    window.localStorage.removeItem(KEY);
    const stored = JSON.parse(raw) as { reference?: unknown; books?: unknown; at?: unknown };
    if (typeof stored?.at !== 'number' || Date.now() - stored.at > TTL_MS) return null;
    if (typeof stored.reference === 'string') return bookReturnHref(stored.reference);
    return stored.books === true ? `/student${PRODUCTS_HASH}` : null;
  } catch {
    return null;
  }
}

// --- The book a visitor was about to buy -----------------------------------------------------
//
// The store's Buy button sends a signed-out visitor to sign in (which returns them through
// ?next=) or to create an account, which goes through email confirmation and onboarding and ends
// on the student dashboard. So the book page also remembers its slug before sending them, and the
// student page sends them back to the book. Only a slug is stored, matched against the slug shape
// (lib/books/admin.ts bookSlug); the path is rebuilt here.

const PAGE_KEY = 'pending-book-page';
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

/** Call from the book page before sending a visitor to sign in or sign up. */
export function rememberBookPage(slug: string): void {
  if (!SLUG.test(slug)) return;
  try {
    window.localStorage.setItem(PAGE_KEY, JSON.stringify({ slug, at: Date.now() }));
  } catch { /* storage unavailable: they find the book again from the store */ }
}

/** They are back on the book page: nothing left to restore. */
export function clearBookPage(): void {
  try { window.localStorage.removeItem(PAGE_KEY); } catch { /* nothing stored */ }
}

/** Reads and clears the remembered book, as its store path. Single use; null when none. */
export function takeBookPageHref(): string | null {
  try {
    const raw = window.localStorage.getItem(PAGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(PAGE_KEY);
    const stored = JSON.parse(raw) as { slug?: unknown; at?: unknown };
    if (typeof stored?.at !== 'number' || Date.now() - stored.at > TTL_MS) return null;
    return typeof stored.slug === 'string' && SLUG.test(stored.slug) ? `/products/${stored.slug}` : null;
  } catch {
    return null;
  }
}
