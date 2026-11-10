import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStoreBook, type StoreBook } from '@/lib/books/store';
import { descriptionText } from '@/lib/books/description';
import { productPriceLabel } from '@/lib/books/share';
import { socialImageUrl } from '@/lib/cloudinary-url';

/**
 * The checks every announcement request shares (send, preview, test): a valid product id, a
 * subject, and a message with some words in it (an empty rich text editor still holds markup), and
 * a product the caller may announce that is live in the store. Messages are rich text from the
 * dashboard editor, sanitized when the email is built (lib/books/announce.ts).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AnnouncementInput = { bookId: string; subject: string; message: string };

export function parseAnnouncementInput(body: any): AnnouncementInput | { error: string } {
  const bookId = typeof body?.bookId === 'string' && UUID.test(body.bookId) ? body.bookId : null;
  const subject = typeof body?.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!bookId) return { error: 'A valid product id is required.' };
  if (!subject || subject.length > 200) return { error: 'Add a subject of up to 200 characters.' };
  if (!descriptionText(message)) return { error: 'Add a message.' };
  if (message.length > 5000) return { error: 'The message is too long. Keep it under 5,000 characters, formatting included.' };
  return { bookId, subject, message };
}

export async function loadAnnounceable(
  db: SupabaseClient, bookId: string, userId: string, role: string,
): Promise<{ book: { id: string; slug: string; title: string }; live: StoreBook } | { status: number; error: string }> {
  const { data: book, error } = await db.from('books').select('id, user_id, slug, title').eq('id', bookId).maybeSingle();
  if (error) throw error;
  // Another instructor's product does not exist for this caller.
  if (!book || (role !== 'admin' && book.user_id !== userId)) return { status: 404, error: 'Product not found.' };
  const live = await loadStoreBook(book.slug, db);
  if (!live) return { status: 409, error: 'Publish this product, and make it free or for sale, before announcing it.' };
  return { book, live };
}

/** The product details an announcement email shows. */
export function announcementBook(live: StoreBook) {
  return {
    title: live.title, slug: live.slug, priceLabel: productPriceLabel(live),
    coverUrl: live.coverImage ? socialImageUrl(live.coverImage) || null : null,
  };
}
