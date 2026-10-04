/**
 * Opens a student straight at their instructor's review of a virtual experience.
 *
 * The review email links to /student?review=<veId>#virtual_experiences. The Virtual Experiences
 * section reads the id, opens that VE's details and scrolls to the review. A student who is signed
 * out is sent to sign in first, and every hand-off on the way redirects to a fixed destination, so
 * the id is remembered here across that (the same approach as lib/pending-purchase.ts).
 *
 * Only the id is stored, never a URL, and it must look like a uuid, so nothing a link supplies is
 * navigated to. Storage can throw (private windows, blocked site data), so every access is guarded;
 * a failure just means the student lands on the dashboard as before.
 */

const KEY = 'pending-ve-review';
const PARAM = 'review';
// Long enough to survive signing in, short enough that an old link does not resurface later.
const TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link to put in an email: the review of this VE on the student dashboard. */
export function veReviewHref(appUrl: string, veId: string): string {
  return `${appUrl}/student?${PARAM}=${encodeURIComponent(veId)}#virtual_experiences`;
}

/** The VE id named in a query string, or null when absent or malformed. */
export function readVeReviewTarget(search: string): string | null {
  const id = new URLSearchParams(search).get(PARAM);
  return id && UUID.test(id) ? id : null;
}

/** Called before redirecting a signed-out student away, so the review can still open after. */
export function rememberVeReviewTarget(search: string): void {
  const id = readVeReviewTarget(search);
  if (!id) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }));
  } catch { /* storage unavailable: the student lands on the dashboard */ }
}

function readStored(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof stored?.at !== 'number' || Date.now() - stored.at > TTL_MS) return null;
    return typeof stored.id === 'string' && UUID.test(stored.id) ? stored.id : null;
  } catch {
    return null;
  }
}

/** True when a review is waiting to be opened, from the URL or remembered across signing in. */
export function hasPendingVeReview(search: string): boolean {
  return !!readVeReviewTarget(search) || !!readStored();
}

/**
 * The VE whose review should open now, or null. Single use: clears the remembered id and removes
 * the parameter from the address, so a refresh or a later visit does not reopen it.
 */
export function takeVeReviewTarget(): string | null {
  const fromUrl = readVeReviewTarget(window.location.search);
  const id = fromUrl ?? readStored();
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  if (fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAM);
    history.replaceState(history.state, '', url);
  }
  return id;
}
