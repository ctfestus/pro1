/**
 * Short-lived tickets for loading an HTML book into its sandboxed iframe.
 *
 * An iframe navigation cannot carry the Bearer token every other route authenticates with, so the
 * reader first asks /api/books/[id]/html-ticket (Bearer-authenticated, access-checked) for a
 * ticket, then points the iframe at /api/books/[id]/html?t=<ticket>. The ticket is an HMAC over
 * (book, user, variant, expiry): it opens exactly one book, for one person, for a few minutes,
 * and cannot be edited to open another book or the full file instead of the sample.
 *
 * The store's open sample uses a 'public-sample' ticket with no user: issued by the unauthenticated
 * /api/books/[id]/sample, honoured only while the sample is public (isPublicSampleAvailable), and
 * only ever for the sample object.
 *
 * A guest buyer (no account) opens an HTML product with a 'guest' ticket naming their purchase,
 * issued by /api/books/guest-access/open and honoured only while that purchase is paid and inside
 * its seven days (lib/books/guest-purchase.ts).
 *
 * Server-only (node:crypto).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const HTML_TICKET_TTL_SECONDS = 5 * 60;

export type HtmlTicketVariant = 'full' | 'preview' | 'public-sample' | 'guest';

export interface HtmlTicketClaims {
  bookId: string;
  /** Null exactly when the variant is 'public-sample' or 'guest'. */
  userId: string | null;
  /** Only on a 'guest' ticket: the paid guest purchase it opens (lib/books/guest-access.ts). */
  purchaseId?: string;
  variant: HtmlTicketVariant;
  /** Unix seconds. */
  exp: number;
}

function ticketSecret(): string {
  return process.env.BOOK_HTML_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`book-html:v1:${payload}`).digest('base64url');
}

export function issueHtmlTicket(
  claims: Omit<HtmlTicketClaims, 'exp'>,
  nowMs: number = Date.now(),
): { ticket: string; expiresAt: number } {
  const secret = ticketSecret();
  if (!secret) throw new Error('Book HTML ticket secret not configured');
  const exp = Math.floor(nowMs / 1000) + HTML_TICKET_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url');
  return { ticket: `${payload}.${sign(payload, secret)}`, expiresAt: exp };
}

/** Returns the claims when the ticket is authentic, unexpired, and for this book; else null. */
export function verifyHtmlTicket(
  ticket: unknown,
  bookId: string,
  nowMs: number = Date.now(),
): HtmlTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length > 2048) return null;
  const secret = ticketSecret();
  if (!secret) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot);
  const given = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: HtmlTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !claims
    || claims.bookId !== bookId
    || (claims.variant !== 'full' && claims.variant !== 'preview' && claims.variant !== 'public-sample' && claims.variant !== 'guest')
    // A public or guest ticket names nobody; every other ticket names its reader.
    || (claims.variant === 'public-sample' || claims.variant === 'guest' ? claims.userId !== null : typeof claims.userId !== 'string')
    // Only a guest ticket names a purchase, and it must.
    || (claims.variant === 'guest'
      ? typeof claims.purchaseId !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.purchaseId)
      : claims.purchaseId !== undefined)
    || typeof claims.exp !== 'number'
    || claims.exp * 1000 <= nowMs
  ) {
    return null;
  }
  return claims;
}
