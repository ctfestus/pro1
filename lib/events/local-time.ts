import { parseGmtOffsetMinutes, sessionStartInstant } from '@/lib/event-sessions';

/**
 * An event's start in the visitor's own time, for the public event page.
 *
 * Built on sessionStartInstant, the calculation the countdown and the reminder emails use, so the
 * three can never disagree. Pure: the visitor's offset comes in as a function (in the browser,
 * from Date#getTimezoneOffset at that instant, so summer time on the event's date is right).
 *
 * Returns null whenever it cannot be certain or has nothing to add:
 *   - the event's timezone is not written the way the editors write it, "GMT+1 (Lagos)" or
 *     "UTC+5:30". Old rows hold names like "WAT" (read as UTC elsewhere: the wrong-by-hours bug),
 *     and look-alikes such as "Etc/GMT+5" or "GMT+0530" would be misread by the looser parser
 *   - no date or no time
 *   - the visitor is already on the event's offset
 */

/** The editors' shape only, from the start of the string, with real minutes. */
const EDITOR_TIMEZONE = /^(?:GMT|UTC)\s*[+-]\s*\d{1,2}(?::[0-5]\d)?(?:\s|\(|$)/i;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ViewerLocalTime {
  /** "8:00 PM" */
  time: string;
  /** "Fri, Nov 21" when the visitor's date differs from the event's, else null. */
  date: string | null;
  /** "GMT+3", "GMT-4", "GMT+5:30" */
  zone: string;
}

/** "GMT+3" from +180 minutes. */
export function gmtLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export function viewerLocalTime(
  date: string | null | undefined,
  time: string | null | undefined,
  timezone: string | null | undefined,
  viewerOffsetAt: (instant: Date) => number,
): ViewerLocalTime | null {
  if (!date || !time) return null;
  if (!timezone || !EDITOR_TIMEZONE.test(timezone.trim())) return null;
  const eventOffset = parseGmtOffsetMinutes(timezone);
  if (eventOffset === null || Math.abs(eventOffset) > 14 * 60) return null;
  const instant = sessionStartInstant(date, time, timezone);
  if (!instant) return null;
  const viewerOffset = viewerOffsetAt(instant);
  if (!Number.isFinite(viewerOffset) || viewerOffset === eventOffset) return null;

  // The instant as a wall clock in the visitor's offset, read with UTC getters (no locale).
  const local = new Date(instant.getTime() + viewerOffset * 60_000);
  const h24 = local.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const clock = `${h12}:${String(local.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
  const localDate = local.toISOString().slice(0, 10);
  return {
    time: clock,
    date: localDate === date ? null : `${DAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`,
    zone: gmtLabel(viewerOffset),
  };
}

/** The browser's offset at an instant, in minutes east of GMT (getTimezoneOffset is west). */
export const browserOffsetAt = (instant: Date): number => -instant.getTimezoneOffset();
