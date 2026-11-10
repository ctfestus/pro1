import type { SupabaseClient } from '@supabase/supabase-js';
import { newReturnCode } from '@/lib/books/guest-access';

/**
 * A free product claimed without an account (migration 239): a guest purchase row with kind
 * 'free_claim', amount 0, paid at once, with the usual guest allowance (7 days, 5 downloads). The
 * link only ever goes to the email given, so getting the file proves the address is theirs.
 *
 * The database function claim_free_book does the whole thing atomically, under a lock per email
 * (and a platform-wide one just before creating a claim): an open claim (inside its seven days,
 * downloads left) is returned for the caller to resend, the hourly limits are checked (3 new claims
 * per email across all products, 300 across the platform), and only then is a claim created.
 * Simultaneous requests therefore never make two claims or slip past a limit.
 */
export const FREE_CLAIM_PREFIX = 'free-';

export async function claimFreeProduct(
  db: SupabaseClient,
  input: { book: { id: string; title: string }; name: string; email: string },
): Promise<{ id: string; existing: boolean; limited?: boolean }> {
  const { data, error } = await db.rpc('claim_free_book', {
    p_book_id: input.book.id,
    p_book_title: input.book.title,
    p_email: input.email,
    p_name: input.name,
    // Nobody is ever given a return code for a free claim (the link only goes by email); the column
    // must still hold a well-formed hash.
    p_return_hash: newReturnCode().hash,
  });
  if (error) throw error;
  if (data?.limited) return { id: '', existing: false, limited: true };
  if (!data?.id) throw new Error('The claim was not recorded.');
  return { id: String(data.id), existing: data.existing === true };
}
