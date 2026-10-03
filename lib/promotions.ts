// Promotions (migration 219): closable promo cards shown on the landing pages, the student
// dashboard, and inside courses. Authored at /create/promotion, rendered by components/PromoCard.

export type PromoPlacement = 'landing' | 'student' | 'course';

export const PROMO_PLACEMENTS: { id: PromoPlacement; label: string; hint: string }[] = [
  { id: 'landing', label: 'Public pages',      hint: 'Home page and pricing page, including signed-out visitors' },
  { id: 'student', label: 'Student dashboard', hint: 'Every section of the student dashboard' },
  { id: 'course',  label: 'Inside courses',    hint: 'Course overview and the course player' },
];

/** A live promotion as returned by get_active_promotions(). */
export interface ActivePromotion {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  updated_at: string;
}

/**
 * The link or image URL to render, or null when it is not one we will put in an href/src.
 * Accepts a same-site path ("/pricing") or an absolute http(s) URL; anything else
 * (javascript:, data:, protocol-relative "//host") is dropped rather than rendered.
 */
export function safePromoUrl(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
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
