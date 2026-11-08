/**
 * Buying a single book through Paystack.
 *
 *   startBookCheckout   -- POST /api/books/checkout: a pending book_purchases row, then a Paystack link
 *   settleBookPurchase  -- the webhook and the buyer's return page: ask Paystack, then fulfil once
 *   sweepBookPurchases  -- hourly recovery for lost webhooks and failed receipts
 *
 * Refunds are handled outside the platform (in Paystack, by staff); nothing here reacts to them.
 *
 * Granting access happens only in the fulfil_book_purchase database function (migration 235), under
 * a row lock, so the webhook and the return page can race safely. References start with "book-" so
 * the shared webhook can route them here without a lookup.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  initializePaystackTransaction,
  makePaystackReference,
  PaystackApiError,
  paystackBookCallbackUrl,
  type PaystackVerification,
  verifyPaystackTransaction,
} from '@/lib/paystack';
import { PaymentError } from '@/lib/payment-errors';
import { sendBookPurchaseReceipt } from '@/lib/books/receipt-email';

export const BOOK_REFERENCE_PREFIX = 'book-';

/** A Paystack link older than this is not handed out again; the checkout is checked and replaced. */
const CHECKOUT_REUSE_MS = 30 * 60 * 1000;
/** A row with no link yet is a checkout still being created (or one whose Paystack call timed out). */
const INITIALIZING_GRACE_MS = 2 * 60 * 1000;
/** Paystack statuses after which an open checkout may be replaced. Anything else may still charge. */
const CLOSABLE_PROVIDER_STATUSES = ['failed', 'abandoned', 'reversed'];

export function isBookReference(reference: string | null | undefined): reference is string {
  return typeof reference === 'string' && reference.startsWith(BOOK_REFERENCE_PREFIX);
}

export type BookSettleResult =
  | { status: 'paid' | 'needs_review' | 'refunded'; purchaseId: string; bookId: string; alreadyProcessed: boolean; reason?: string }
  | { status: 'unknown' }
  | { status: 'unpaid'; providerStatus: string };

/**
 * Ask Paystack about a book purchase and fulfil it if the money is there. Safe to call any number of
 * times, from anywhere: the database function grants access at most once.
 */
export async function settleBookPurchase(
  db: SupabaseClient,
  reference: string,
  verified?: PaystackVerification,
): Promise<BookSettleResult> {
  const { data: purchase, error } = await db
    .from('book_purchases')
    .select('id, book_id, status')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (error) throw error;
  if (!purchase) return { status: 'unknown' };
  if (purchase.status === 'paid' || purchase.status === 'refunded' || purchase.status === 'needs_review') {
    return { status: purchase.status, purchaseId: purchase.id, bookId: purchase.book_id, alreadyProcessed: true };
  }

  const result = verified ?? await verifyPaystackTransaction(reference);
  if (result.status !== 'success') {
    // Only a definite failure closes the checkout. "abandoned" at Paystack still lets the buyer
    // finish on the same link, so the row stays pending until the link is replaced.
    if (result.status === 'failed' || result.status === 'reversed') {
      const { error: failError } = await db.from('book_purchases')
        .update({ status: 'failed' }).eq('id', purchase.id).eq('status', 'pending');
      if (failError) throw failError;
    }
    return { status: 'unpaid', providerStatus: result.status || 'unknown' };
  }

  const { data, error: rpcError } = await db.rpc('fulfil_book_purchase', {
    p_reference: reference,
    p_amount: result.amount,
    p_currency: result.currency,
    p_transaction_id: result.transactionId ?? null,
  });
  if (rpcError) throw rpcError;
  if (!data || data.status === 'unknown') return { status: 'unknown' };
  return {
    status: data.status,
    purchaseId: data.purchaseId,
    bookId: data.bookId,
    alreadyProcessed: data.alreadyProcessed === true,
    ...(data.reason ? { reason: data.reason } : {}),
  };
}

export interface BookCheckoutBook {
  id: string;
  title: string;
  royalty_pct: number | string | null;
}

export type BookCheckoutOutcome =
  | { kind: 'checkout'; reference: string; authorizationUrl: string }
  | { kind: 'settled'; reference: string; status: 'paid' | 'needs_review' | 'refunded' };

/**
 * Open (or reuse) the buyer's checkout for one book at one price. The caller has already checked
 * that the book is for sale, that the buyer does not have it, and which price applies.
 */
export async function startBookCheckout(
  db: SupabaseClient,
  input: { studentId: string; email: string; book: BookCheckoutBook; amount: number; currency: string },
  attempt = 0,
): Promise<BookCheckoutOutcome> {
  const { data: open, error: openError } = await db
    .from('book_purchases')
    .select('id, paystack_reference, authorization_url, amount, currency, created_at')
    .eq('student_id', input.studentId)
    .eq('book_id', input.book.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (openError) throw openError;

  if (open) {
    const age = Date.now() - new Date(open.created_at).getTime();
    const samePrice = open.currency === input.currency && Math.round(Number(open.amount) * 100) === Math.round(input.amount * 100);
    if (open.authorization_url && samePrice && age < CHECKOUT_REUSE_MS) {
      return { kind: 'checkout', reference: open.paystack_reference, authorizationUrl: open.authorization_url };
    }
    if (!open.authorization_url && age < INITIALIZING_GRACE_MS) {
      throw new PaymentError('conflict', 'Your checkout is being prepared. Give it a moment and try again.', 409);
    }
    if (attempt >= 1) {
      throw new PaymentError('conflict', 'Your earlier checkout is still being confirmed. Please try again shortly.', 409);
    }
    // The old link may have been paid after all. Paystack is the only one who knows.
    let settled: BookSettleResult | null = null;
    try {
      settled = await settleBookPurchase(db, open.paystack_reference);
    } catch (e) {
      // Paystack answers a reference it never created with a 4xx (404, or 400 "reference not
      // found"). For a row with no link that means our initialize call never landed, so nothing can
      // arrive on it. A row with a link was created there, so only a 404 is taken at its word.
      const notCreated = e instanceof PaystackApiError
        && (e.status === 404 || (!open.authorization_url && e.status >= 400 && e.status < 500));
      if (!notCreated) throw e;
    }
    if (settled && settled.status !== 'unpaid' && settled.status !== 'unknown') {
      return { kind: 'settled', reference: open.paystack_reference, status: settled.status };
    }
    // Still moving at Paystack (a mobile money approval, say): replacing it now could charge twice.
    if (settled?.status === 'unpaid' && !CLOSABLE_PROVIDER_STATUSES.includes(settled.providerStatus)) {
      throw new PaymentError(
        'conflict',
        'Your earlier payment for this book is still being processed. Wait for it to finish, then try again.',
        409,
      );
    }
    // Close it so a new one can open. If money does turn up on it later, fulfil_book_purchase still
    // honours a failed row -- the buyer paid -- and a second copy goes to review, not to nowhere.
    const { error: closeError } = await db.from('book_purchases')
      .update({ status: 'failed' }).eq('id', open.id).eq('status', 'pending');
    if (closeError) throw closeError;
    return startBookCheckout(db, input, attempt + 1);
  }

  const reference = makePaystackReference('book');
  const { data: created, error: insertError } = await db.from('book_purchases').insert({
    student_id: input.studentId,
    book_id: input.book.id,
    book_title: input.book.title,
    amount: input.amount,
    currency: input.currency,
    paystack_reference: reference,
    royalty_pct: Number(input.book.royalty_pct ?? 0) || 0,
  }).select('id').single();
  if (insertError) {
    // Another tab opened one between our read and insert. Let the buyer retry onto it.
    if (insertError.code === '23505') {
      throw new PaymentError('conflict', 'Your checkout is being prepared. Give it a moment and try again.', 409);
    }
    throw insertError;
  }

  let authorizationUrl: string;
  try {
    const initialized = await initializePaystackTransaction({
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference,
      callbackUrl: paystackBookCallbackUrl(reference),
      metadata: { kind: 'book_purchase', purchase_id: created.id, book_id: input.book.id },
    });
    authorizationUrl = initialized.authorizationUrl;
  } catch (e) {
    // Paystack said no: nothing was created there, so close the row and free the slot. On a
    // timeout or network error we cannot know, so the row is left; the next attempt asks Paystack.
    if (e instanceof PaystackApiError && e.status >= 400 && e.status < 500) {
      await db.from('book_purchases').update({ status: 'failed' }).eq('id', created.id).eq('status', 'pending');
    }
    throw e;
  }

  const { error: urlError } = await db.from('book_purchases')
    .update({ authorization_url: authorizationUrl }).eq('id', created.id);
  if (urlError) throw urlError;
  return { kind: 'checkout', reference, authorizationUrl };
}

/**
 * Hourly recovery, run by the subscription sweep cron:
 *   1. open checkouts with a link, 10 minutes to 3 days old, are checked with Paystack, least
 *      recently checked first -- this grants a book whose webhook was lost or dead-lettered and
 *      whose buyer never came back to the page
 *   2. paid purchases from the last week with no receipt yet get it (a mail outage at payment time)
 */
export async function sweepBookPurchases(
  db: SupabaseClient,
  outOfTime: () => boolean = () => false,
): Promise<{ settled: number; receipts: number; failed: number }> {
  let settled = 0;
  let receipts = 0;
  let failed = 0;
  const now = Date.now();

  const { data: open, error: openError } = await db
    .from('book_purchases')
    .select('id, paystack_reference')
    .eq('status', 'pending')
    .not('authorization_url', 'is', null)
    .lt('created_at', new Date(now - 10 * 60 * 1000).toISOString())
    .gt('created_at', new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString())
    // Least recently checked first: abandoned checkouts stay pending, and ordering by age alone
    // would let the same oldest 25 hold every run while a newer paid one waits.
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(25);
  if (openError) throw openError;
  for (const row of open ?? []) {
    if (outOfTime()) break;
    const { error: stampError } = await db.from('book_purchases')
      .update({ last_checked_at: new Date().toISOString() }).eq('id', row.id);
    if (stampError) throw stampError;
    try {
      const result = await settleBookPurchase(db, row.paystack_reference);
      if (result.status === 'paid') settled++;
    } catch {
      failed++;
    }
  }

  const { data: unsent, error: unsentError } = await db
    .from('book_purchases')
    .select('id')
    .eq('status', 'paid')
    .is('receipt_email_sent_at', null)
    .gt('paid_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('paid_at', { ascending: true })
    .limit(50);
  if (unsentError) throw unsentError;
  for (const row of unsent ?? []) {
    if (outOfTime()) break;
    try {
      if ((await sendBookPurchaseReceipt(db, row.id)).sent) receipts++;
    } catch {
      failed++;
    }
  }
  return { settled, receipts, failed };
}
