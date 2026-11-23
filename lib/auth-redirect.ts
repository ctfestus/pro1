/**
 * Where to send someone after they sign in.
 *
 * A visitor who clicks a course, experience or certification and is asked to sign in used to land
 * on their dashboard afterwards, with no trace of what they had clicked -- so the only way back
 * was to go and find it again. The content page now says where it sent them from, and /auth
 * returns them there.
 *
 * `next` arrives from the query string, which anyone can write, so it is validated rather than
 * trusted: only a path on this site is ever followed. Without that check, a link like
 * /auth?next=https://example.com would turn our own sign-in page into a redirect to someone
 * else's -- the classic open redirect, and a convincing one, because the domain in the address
 * bar is genuinely ours right up until the moment it is not.
 */

/**
 * The sign-in page itself, and its sub-flows: returning here would loop.
 *
 * The delimiter set matters. Matching only `/` and end-of-string let `/auth?mode=signup` and
 * `/auth#top` through, which are the same page and the same loop. `/authors` must still pass,
 * which is why this is a delimiter check rather than a prefix check.
 */
const NEVER_RETURN_TO = /^\/auth([/?#]|$)/;

/**
 * A same-site path, or null. Rejects absolute URLs, protocol-relative `//host` (a browser reads
 * that as another origin), backslash variants that some parsers normalise to a slash, and
 * anything with control characters in it.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value.startsWith('/')) return null;      // absolute URL, or a bare word
  if (/^\/[/\\]/.test(value)) return null;      // //evil.example or /\evil.example
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (NEVER_RETURN_TO.test(value)) return null;
  return value;
}

/** The sign-in link for a page that wants the visitor back afterwards. */
export function signInHref(next?: string | null): string {
  const target = safeNextPath(next);
  return target ? `/auth?next=${encodeURIComponent(target)}` : '/auth';
}

/**
 * The page a visitor was sent to /auth from, kept across sign-up: the confirmation email and
 * onboarding come in between, and neither carries the query string. Stored in this browser for a
 * day; onboarding takes it when it finishes. Validated again on the way out.
 */
const REMEMBERED_NEXT = 'auth-next';
const REMEMBER_FOR_MS = 24 * 60 * 60 * 1000;

export function rememberNext(next: string | null): void {
  if (!next) return;
  try { window.localStorage.setItem(REMEMBERED_NEXT, JSON.stringify({ next, at: Date.now() })); } catch { /* storage off */ }
}

export function takeRememberedNext(): string | null {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_NEXT);
    window.localStorage.removeItem(REMEMBERED_NEXT);
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at > REMEMBER_FOR_MS) return null;
    return safeNextPath(saved.next);
  } catch {
    return null;
  }
}
