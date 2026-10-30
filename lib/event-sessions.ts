// Shared logic for deciding whether a given calendar date is a scheduled
// occurrence of a live-session event. Used both to gate attendance writes
// (so a stray click on an off-schedule day cannot invent a session) and to
// filter the attendance report (so existing off-schedule rows stop distorting
// the session count and missed totals).

export interface EventSchedule {
  event_date?: string | null;
  timezone?: string | null;
  recurrence?: string | null;
  recurrence_end_date?: string | null;
  recurrence_days?: number[] | null;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Timezones are stored as fixed GMT offsets like "GMT+0 (Accra)" or "GMT+5:30 (IST)"; "UTC+1"
// reads the same. Returns the offset in minutes, or null if it can't be parsed.
export function parseGmtOffsetMinutes(timezone?: string | null): number | null {
  if (!timezone) return null;
  const m = timezone.match(/(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

// Today's calendar date (YYYY-MM-DD) in the event's timezone. Attendance must be
// gated and stamped against the event-local day, not the server's UTC day, or a
// click at the correct local time near UTC midnight lands on the wrong date.
export function eventLocalDate(timezone?: string | null, now: Date = new Date()): string {
  const offsetMin = parseGmtOffsetMinutes(timezone);
  if (offsetMin === null) return now.toISOString().slice(0, 10); // fall back to UTC
  return new Date(now.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
}

function parseCalendarDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function calendarDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(dateStr: string, days: number): string | null {
  const date = parseCalendarDate(dateStr);
  if (!date) return null;
  return calendarDateKey(new Date(date.getTime() + days * DAY_MS));
}

function weeklyTargetDays(event: EventSchedule): number[] {
  if (Array.isArray(event.recurrence_days) && event.recurrence_days.length > 0) {
    return event.recurrence_days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  }

  const start = parseCalendarDate(event.event_date);
  return start ? [start.getUTCDay()] : [];
}

// dateStr must be a YYYY-MM-DD calendar date (UTC). Returns true when that date
// is an actual scheduled occurrence of the event.
export function isScheduledSessionDate(event: EventSchedule | null | undefined, dateStr: string): boolean {
  if (!event?.event_date || !dateStr) return false;

  // Nothing before the series starts counts.
  if (dateStr < event.event_date) return false;

  // One-time events only run on their single date.
  if (event.recurrence === 'once' || !event.recurrence) {
    return dateStr === event.event_date;
  }

  // Recurring events must fall on or before the end date, when one is set.
  if (event.recurrence_end_date && dateStr > event.recurrence_end_date) return false;

  if (event.recurrence === 'daily') return true;

  if (event.recurrence === 'weekly') {
    const date = parseCalendarDate(dateStr);
    if (!date) return false;
    return weeklyTargetDays(event).includes(date.getUTCDay());
  }

  return false;
}

// Returns the next scheduled session date on or after fromDateStr. For recurring
// event cards, this is the date students should see instead of the old series
// start date.
export function getNextScheduledSessionDate(
  event: EventSchedule | null | undefined,
  fromDateStr?: string,
): string | null {
  if (!event?.event_date) return null;

  const start = parseCalendarDate(event.event_date);
  const from = parseCalendarDate(fromDateStr ?? eventLocalDate(event.timezone));
  if (!start || !from) return null;

  if (event.recurrence === 'once' || !event.recurrence) {
    return event.event_date >= calendarDateKey(from) ? event.event_date : null;
  }

  const endStr = event.recurrence_end_date && parseCalendarDate(event.recurrence_end_date)
    ? event.recurrence_end_date
    : null;
  const cursorStart = event.event_date > calendarDateKey(from) ? event.event_date : calendarDateKey(from);
  if (endStr && cursorStart > endStr) return null;

  if (event.recurrence === 'daily') return cursorStart;

  if (event.recurrence === 'weekly') {
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = addCalendarDays(cursorStart, offset);
      if (!candidate || (endStr && candidate > endStr)) return null;
      if (isScheduledSessionDate(event, candidate)) return candidate;
    }
  }

  return null;
}

// Returns the last scheduled session before fromDateStr. This lets past recurring
// series display their most recent real occurrence instead of the original start.
export function getLastScheduledSessionDate(
  event: EventSchedule | null | undefined,
  fromDateStr?: string,
): string | null {
  if (!event?.event_date) return null;

  const start = parseCalendarDate(event.event_date);
  const from = parseCalendarDate(fromDateStr ?? eventLocalDate(event.timezone));
  if (!start || !from) return null;

  const fromKey = calendarDateKey(from);
  if (event.recurrence === 'once' || !event.recurrence) {
    return event.event_date < fromKey ? event.event_date : null;
  }

  const endStr = event.recurrence_end_date && parseCalendarDate(event.recurrence_end_date)
    ? event.recurrence_end_date
    : null;
  const dayBeforeFrom = addCalendarDays(fromKey, -1);
  if (!dayBeforeFrom) return null;

  const cursorStart = endStr && endStr < dayBeforeFrom ? endStr : dayBeforeFrom;
  if (cursorStart < event.event_date) return null;

  if (event.recurrence === 'daily') return cursorStart;

  if (event.recurrence === 'weekly') {
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = addCalendarDays(cursorStart, -offset);
      if (!candidate || candidate < event.event_date) return null;
      if (isScheduledSessionDate(event, candidate)) return candidate;
    }
  }

  return null;
}

// Absolute start of the session on dateStr at timeStr (HH:MM, seconds ignored), read in the
// event's stored GMT offset. Without a parseable offset the time is read as UTC, matching
// eventLocalDate's fallback.
export function sessionStartInstant(dateStr: string, timeStr: string, timezone?: string | null): Date | null {
  const date = parseCalendarDate(dateStr);
  const time = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!date || !time) return null;
  const hours = Number(time[1]);
  const mins = Number(time[2]);
  if (hours > 23 || mins > 59) return null;
  const offsetMin = parseGmtOffsetMinutes(timezone) ?? 0;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, mins) - offsetMin * 60_000,
  );
}

// The next session that has not started yet: its calendar date and absolute start. An event with
// no time is treated as starting at midnight in its timezone, and `timed` says so, because a
// reminder keyed to the hour means nothing for it.
export function getNextSessionStart(
  event: (EventSchedule & { event_time?: string | null }) | null | undefined,
  now: Date = new Date(),
): { date: string; start: Date; timed: boolean } | null {
  if (!event?.event_date) return null;
  const timed = !!event.event_time;
  const time = event.event_time || '00:00';
  // Start a day back: the event-local "today" can lag a session that has not started yet.
  let from = addCalendarDays(eventLocalDate(event.timezone, now), -1);
  for (let i = 0; i < 4 && from; i += 1) {
    const day = getNextScheduledSessionDate(event, from);
    if (!day) return null;
    const start = sessionStartInstant(day, time, event.timezone);
    if (!start) return null;
    if (start.getTime() > now.getTime()) return { date: day, start, timed };
    from = addCalendarDays(day, 1);
  }
  return null;
}
