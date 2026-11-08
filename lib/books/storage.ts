/** The private bucket every book file lives in (migration 232). Service role only. */
export const BOOK_BUCKET = 'book-files';

/** Signed EPUB/PDF read URLs. Long enough to open the file, short enough not to be worth sharing. */
export const BOOK_SIGNED_URL_TTL_SECONDS = 300;
