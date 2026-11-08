import { revalidateTag } from 'next/cache';

/** Cache tag for the public book store (lib/books/store.ts). */
export const BOOKS_STORE_TAG = 'books-store';

/**
 * Drop the cached store after a book is saved or deleted, so a publish, price change or unpublish
 * shows on /books straight away instead of within the minute. Best effort: outside a Next request
 * (tests, scripts) there is no cache to drop, and a failure here must never fail the save.
 */
export function refreshBookStore(): void {
  try {
    revalidateTag(BOOKS_STORE_TAG);
  } catch {
    /* no request cache to drop */
  }
}
