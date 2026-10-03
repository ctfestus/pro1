// Promotions (migrations 219, 220): closable promo cards shown on the landing pages, the student
// dashboard, and inside courses. Authored at /create/promotion, rendered by components/PromoCard.

export type PromoPlacement = 'landing' | 'student' | 'course';

export const PROMO_PLACEMENTS: { id: PromoPlacement; label: string; hint: string }[] = [
  { id: 'landing', label: 'Public pages',      hint: 'Home page and pricing page, including signed-out visitors' },
  { id: 'student', label: 'Student dashboard', hint: 'Every section of the student dashboard' },
  { id: 'course',  label: 'Inside courses',    hint: 'Course overview and the course player' },
];

/** 'standard' = image + text card; 'events' = heading with dated event rows, no image (migration 220). */
export type PromoKind = 'standard' | 'events';

export type EventFormat = 'virtual' | 'in_person' | 'hybrid';

export const EVENT_FORMATS: { id: EventFormat; label: string }[] = [
  { id: 'virtual',   label: 'Virtual' },
  { id: 'in_person', label: 'In person' },
  { id: 'hybrid',    label: 'Hybrid' },
];

/** One row of an events promo, typed in by the instructor. date is "YYYY-MM-DD". */
export interface PromoEventItem {
  date: string;
  format: EventFormat;
  title: string;
  note: string;
  url: string;
}

export const MAX_EVENT_ITEMS = 6;
/** Rows shown on the card at once; later ones appear as earlier ones pass. */
export const MAX_EVENT_ROWS_SHOWN = 4;

/** A live promotion as returned by /api/promotions (get_active_promotion()). */
export interface ActivePromotion {
  id: string;
  kind?: PromoKind;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  event_items?: unknown;
  updated_at: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The rows to show, from the stored JSON: well-formed ones only, dated today or later in the
 * viewer's time zone, soonest first, capped for the card. Never throws on bad data.
 */
export function upcomingEventItems(raw: unknown, limit = MAX_EVENT_ROWS_SHOWN): PromoEventItem[] {
  if (!Array.isArray(raw)) return [];
  const today = localIsoDate(new Date());
  return raw
    .flatMap((x): PromoEventItem[] => {
      if (!x || typeof x !== 'object') return [];
      const item = x as Record<string, unknown>;
      const date = typeof item.date === 'string' ? item.date : '';
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!ISO_DATE_RE.test(date) || !title || date < today) return [];
      const format = EVENT_FORMATS.some(f => f.id === item.format) ? item.format as EventFormat : 'virtual';
      return [{
        date, format, title,
        note: typeof item.note === 'string' ? item.note.trim() : '',
        url: typeof item.url === 'string' ? item.url.trim() : '',
      }];
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

/** "2026-10-06" -> { month: "OCT", day: "06" }; read from the text so no time zone can shift it. */
export function eventDateParts(date: string): { month: string; day: string } {
  const [, m, d] = date.split('-');
  return { month: MONTHS[Number(m) - 1] ?? '', day: d ?? '' };
}

export function eventFormatLabel(format: EventFormat): string {
  return EVENT_FORMATS.find(f => f.id === format)?.label ?? 'Virtual';
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

/** "Show again after closing" choices in the editor; null = never. */
export const PROMO_RESHOW_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'Never' },
  { days: 1,    label: 'After 1 day' },
  { days: 3,    label: 'After 3 days' },
  { days: 7,    label: 'After 7 days' },
  { days: 14,   label: 'After 14 days' },
  { days: 30,   label: 'After 30 days' },
];

/**
 * The closed promos a client sent as "id:closedAtEpochSeconds,..." -- parallel arrays for
 * get_active_promotion(). A bare id (no time) is a closure with no known time: still closed for a
 * Never promo, already expired for one that reshows. Malformed entries are dropped; the list is
 * capped, first wins.
 */
export function parseClosedPromos(raw: string | null): { ids: string[]; closedAt: (string | null)[] } {
  const ids: string[] = [];
  const closedAt: (string | null)[] = [];
  for (const entry of (raw ?? '').split(',')) {
    if (ids.length >= MAX_PROMO_EXCLUDES) break;
    const [id, secs] = entry.trim().split(':');
    if (!id || !UUID_RE.test(id) || ids.includes(id)) continue;
    const n = secs === undefined ? NaN : Number(secs);
    ids.push(id);
    // 8.64e12 s is the largest time a Date can hold; beyond it toISOString throws.
    closedAt.push(Number.isSafeInteger(n) && n > 0 && n <= 8.64e12 ? new Date(n * 1000).toISOString() : null);
  }
  return { ids, closedAt };
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
