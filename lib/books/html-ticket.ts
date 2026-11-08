/**
 * Short-lived tickets for loading an HTML book into its sandboxed iframe.
 *
 * An iframe navigation cannot carry the Bearer token every other route authenticates with, so the
 * reader first asks /api/books/[id]/html-ticket (Bearer-authenticated, access-checked) for a
 * ticket, then points the iframe at /api/books/[id]/html?t=<ticket>. The ticket is an HMAC over
 * (book, user, variant, expiry): it opens exactly one book, for one person, for a few minutes,
 * and cannot be edited to open another book or the full file instead of the sample.
 *
 * Server-only (node:crypto).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const HTML_TICKET_TTL_SECONDS = 5 * 60;

export type HtmlTicketVariant = 'full' | 'preview';

export interface HtmlTicketClaims {
  bookId: string;
  userId: string;
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
    || typeof claims.userId !== 'string'
    || (claims.variant !== 'full' && claims.variant !== 'preview')
    || typeof claims.exp !== 'number'
    || claims.exp * 1000 <= nowMs
  ) {
    return null;
  }
  return claims;
}
