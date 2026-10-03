// Promotions (migration 219): closable promo cards shown on the landing pages, the student
// dashboard, and inside courses. Authored at /create/promotion, rendered by components/PromoCard.

export type PromoPlacement = 'landing' | 'student' | 'course';

export const PROMO_PLACEMENTS: { id: PromoPlacement; label: string; hint: string }[] = [
  { id: 'landing', label: 'Public pages',      hint: 'Home page and pricing page, including signed-out visitors' },
  { id: 'student', label: 'Student dashboard', hint: 'Every section of the student dashboard' },
  { id: 'course',  label: 'Inside courses',    hint: 'Course overview and the course player' },
];

/** A live promotion as returned by /api/promotions (get_active_promotion()). */
export interface ActivePromotion {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  updated_at: string;
}

// Stand-in origin for resolving a relative path the way a browser would.
const SAME_SITE_PROBE = 'https://same-site.invalid';

/**
 * The link or image URL to render, or null when it is not one we will put in an href/src.
 * Accepts an absolute https URL, or a path on this site ("/pricing"). A path counts as same-site
 * only if a browser would resolve it to this origin, so "//host" and "/\host" (both of which a
 * browser sends cross-origin) are rejected, as are http:, javascript: and data: URLs.
 */
export function safePromoUrl(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  if (!url) return null;
  try {
    if (url.startsWith('/')) {
      const resolved = new URL(url, SAME_SITE_PROBE);
      return resolved.origin === SAME_SITE_PROBE ? `${resolved.pathname}${resolved.search}${resolved.hash}` : null;
    }
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PROMO_EXCLUDES = 50;

/** The closed-promo ids a client sent, keeping only well-formed UUIDs, capped. */
export function parsePromoExcludes(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(s => s.trim()).filter(s => UUID_RE.test(s)))].slice(0, MAX_PROMO_EXCLUDES);
}

export function isPromoPlacement(value: string | null): value is PromoPlacement {
  return value === 'landing' || value === 'student' || value === 'course';
}

/** Dashboard list label for a promotions row. */
export function promoStatus(row: { is_active: boolean; starts_at: string; ends_at: string | null }): 'Paused' | 'Scheduled' | 'Ended' | 'Live' {
  const now = Date.now();
  if (!row.is_active) return 'Paused';
  if (new Date(row.starts_at).getTime() > now) return 'Scheduled';
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return 'Ended';
  return 'Live';
}

export function isExternalUrl(url: string): boolean {
  return !url.startsWith('/');
}
