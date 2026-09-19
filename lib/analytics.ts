/**
 * Google Analytics helpers: which measurement IDs are acceptable, and what must never be sent to
 * Google along with a page view.
 */

// GA4 only. Universal Analytics (UA-) stopped collecting data in 2023, and a GTM container
// (GTM-) needs a different snippet, so accepting either would store an ID that silently
// collects nothing.
const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

export function normalizeGaMeasurementId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Uppercased rather than rejected: GA shows the ID uppercase, and an admin who typed it by
  // hand in lower case meant the same property.
  const id = value.trim().toUpperCase();
  return GA4_MEASUREMENT_ID.test(id) ? id : null;
}

/**
 * Query and fragment keys that carry a working credential.
 *
 * The confirmation link is the reason this list exists. app/auth/confirm deliberately does NOT
 * verify on GET -- email scanners were burning the one-time token before the student clicked --
 * so while that page is on screen the token_hash in the address bar is live, and a default GA
 * page view reports the whole URL. For a recovery link that is a password reset. The same goes
 * for the PKCE `code` on /auth/callback and the root fallback in middleware.
 */
export const SENSITIVE_URL_PARAMS = ['token_hash', 'code', 'access_token', 'refresh_token', 'token'] as const;

const REDACTED = 'redacted';

/**
 * A URL safe to report to analytics: same page, same query shape, credentials replaced.
 *
 * Applied to the referrer as well as the location. A browser that leaves the confirmation page
 * carries that URL, token and all, in document.referrer, so redacting only the current page would
 * hand Google the token on the NEXT page view instead of this one.
 */
export function redactSensitiveUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    for (const key of SENSITIVE_URL_PARAMS) {
      if (url.searchParams.has(key)) url.searchParams.set(key, REDACTED);
    }
    // The fragment is dropped whole rather than rewritten: it is not required to be key=value,
    // and an implicit-flow response puts the access and refresh tokens there.
    if (SENSITIVE_URL_PARAMS.some(key => url.hash.includes(key))) url.hash = '';
    return url.toString();
  } catch {
    // Not parseable as a URL, so nothing can be edited out of it precisely. Reporting no URL is
    // better than reporting one that may still hold a token.
    return SENSITIVE_URL_PARAMS.some(key => raw.includes(key)) ? '' : raw;
  }
}
