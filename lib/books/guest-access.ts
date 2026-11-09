/**
 * Guest purchases: a digital product bought with only an email, no account (migration 238).
 *
 * Two secrets, with different jobs:
 *
 *   return code   A random value made when the guest starts a checkout and kept only by that
 *                 browser; the database holds its SHA-256 (guest_return_hash). The Paystack return
 *                 page must present it to collect the download, so a reference seen in browser
 *                 history or a receipt is not enough, and another browser that types the same email
 *                 never gets this checkout or its link.
 *
 *   access link   An HMAC over the purchase id. Nothing about it is stored, so it is the same every
 *                 time it is made: a retried receipt, a resend and the return page all hand out the
 *                 identical link, and none of them adds a download. What the link may do is decided
 *                 by the purchase itself at every use: paid (a refund ends it), inside its 7 days,
 *                 and with downloads left (take_guest_book_download).
 *
 * Server-only (node:crypto).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Downloads one guest purchase allows, and for how long (both start at verified payment). */
export const GUEST_DOWNLOAD_LIMIT = 5;
export const GUEST_ACCESS_DAYS = 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accessSecret(): string {
  return process.env.BOOK_GUEST_ACCESS_SECRET || process.env.BOOK_HTML_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function mac(purchaseId: string, secret: string): string {
  // Domain-separated from the HTML tickets, which may share the fallback secret.
  return createHmac('sha256', secret).update(`book-guest-access:v1:${purchaseId.toLowerCase()}`).digest('base64url');
}

/** The guest's access link token for a purchase. Deterministic: the same purchase, the same token. */
export function guestAccessToken(purchaseId: string): string {
  const secret = accessSecret();
  if (!secret) throw new Error('Guest access secret not configured');
  if (!UUID.test(purchaseId)) throw new Error('Invalid purchase id');
  return `${purchaseId.toLowerCase()}.${mac(purchaseId, secret)}`;
}

/** The purchase id an access token is for, when the token is authentic; else null. */
export function verifyGuestAccessToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const secret = accessSecret();
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const purchaseId = token.slice(0, dot);
  if (!UUID.test(purchaseId) || purchaseId !== purchaseId.toLowerCase()) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(purchaseId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return purchaseId;
}

/** A fresh return code for a new guest checkout, and the hash the database keeps. */
export function newReturnCode(): { code: string; hash: string } {
  const code = randomBytes(32).toString('base64url');
  return { code, hash: hashReturnCode(code) };
}

export function hashReturnCode(code: string): string {
  return createHash('sha256').update(`book-guest-return:v1:${code}`).digest('hex');
}

/** Whether a presented return code matches the stored hash (constant time). */
export function returnCodeMatches(code: unknown, storedHash: unknown): boolean {
  if (typeof code !== 'string' || code.length < 20 || code.length > 200) return false;
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const given = Buffer.from(hashReturnCode(code));
  const expected = Buffer.from(storedHash);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A plausible email address, lowercased and trimmed; null when it is not one. */
export function normalizeGuestEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

/** The path of the page a guest's links open (never the file itself, so email scanners use nothing). */
export function guestAccessPath(purchaseId: string): string {
  return `/products/download?access=${encodeURIComponent(guestAccessToken(purchaseId))}`;
}
