import {
  eventLocalDate,
  getLastScheduledSessionDate,
  getNextScheduledSessionDate,
  type EventSchedule,
} from '@/lib/event-sessions';

/**
 * What the public events pages (/events, /events/[slug]) may show anyone, built field by field from
 * an events row. Pure, so it can be tested and shared by the server store and the register route.
 *
 * Never returned: the meeting link (it reaches a registrant only through the emailed, tracked
 * /api/join link), cohort ids, the owner id, theme settings. The location is shown for in-person
 * events only.
 */

type PublicEventFormat = 'virtual' | 'in-person';

interface PublicEventSpeaker {
  name: string;
  title: string | null;
  bio: string | null;
  avatar: string | null;
  linkedin: string | null;
}

/** A registration question beyond name and email, limited to the types the public form renders. */
export interface PublicEventField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'number' | 'select' | 'phone' | 'company';
  placeholder: string | null;
  options: string[];
  required: boolean;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  /** Rich text, unsanitized: render through sanitizeRichText. */
  description: string | null;
  /** Plain text, for cards and link previews. */
  summary: string;
  coverImage: string | null;
  format: PublicEventFormat;
  /** In-person address as typed; null for an online event. */
  location: string | null;
  /** The location split for display: "Accra Digital Centre, Ring Road, Accra" is the venue
   * "Accra Digital Centre" at "Ring Road, Accra". Null for an online event or no location. */
  venue: { name: string; address: string | null } | null;
  /** The series start (YYYY-MM-DD) as stored. */
  startDate: string | null;
  time: string | null;
  timezone: string | null;
  recurrence: 'once' | 'daily' | 'weekly';
  recurrenceEndDate: string | null;
  recurrenceDays: number[];
  /** The next session on or after today in the event's timezone; null once the event is over. */
  nextDate: string | null;
  /** The most recent past session, for an event that is over. */
  lastDate: string | null;
  /** True when no session remains (an undated event is never over). */
  isPast: boolean;
  /** Listed on /events. An unlisted (private) event is reachable by its link only. */
  listed: boolean;
  capacity: number | null;
  /** Seats taken by cohort and public registrations together. */
  taken: number;
  spotsLeft: number | null;
  speakers: PublicEventSpeaker[];
  fields: PublicEventField[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{2}):(\d{2})/;
const FIELD_TYPES = new Set<PublicEventField['type']>(['text', 'email', 'textarea', 'number', 'select', 'phone', 'company']);
/** Asked by the form itself, so an event's own copies of them are skipped. */
const BUILT_IN_FIELDS = new Set(['name', 'full_name', 'first_name', 'last_name', 'email']);

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

function httpsUrl(v: unknown): string | null {
  const raw = str(v, 500);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Plain text from the rich description, for cards and previews. */
function plainSummary(html: unknown, max = 220): string {
  if (typeof html !== 'string') return '';
  const text = html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}...`;
}

export function publicEventFields(raw: unknown): PublicEventField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PublicEventField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const name = str((f as any).name, 64);
    const type = (f as any).type;
    if (!name || !/^[A-Za-z0-9_-]+$/.test(name) || BUILT_IN_FIELDS.has(name) || seen.has(name)) continue;
    if (!FIELD_TYPES.has(type)) continue;
    const options = type === 'select' && Array.isArray((f as any).options)
      ? (f as any).options.map((o: unknown) => str(o, 200)).filter((o: string | null): o is string => !!o).slice(0, 50)
      : [];
    if (type === 'select' && !options.length) continue;
    seen.add(name);
    out.push({
      name,
      label: str((f as any).label, 200) ?? name,
      type,
      placeholder: str((f as any).placeholder, 200),
      options,
      required: (f as any).required !== false,
    });
    if (out.length >= 20) break;
  }
  return out;
}

function publicSpeakers(raw: unknown): PublicEventSpeaker[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(s => {
    const name = str(s?.name, 120);
    if (!name) return [];
    return [{
      name,
      title: str(s.title, 160),
      bio: str(s.bio, 800),
      avatar: httpsUrl(s.avatar_url),
      linkedin: httpsUrl(s.linkedin_url),
    }];
  }).slice(0, 24);
}

/** "Venue, street, city" to its venue name and the address after it (the first comma splits them). */
export function splitVenue(location: string | null): { name: string; address: string | null } | null {
  if (!location) return null;
  const i = location.indexOf(',');
  if (i < 0) return { name: location, address: null };
  const name = location.slice(0, i).trim();
  const address = location.slice(i + 1).trim();
  return name ? { name, address: address || null } : { name: address, address: null };
}

/** The editors' venue name and subtitle as the one stored location (the reverse of splitVenue). */
export function joinVenue(name: string, subtitle: string): string {
  const n = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const sub = subtitle.trim();
  return n && sub ? `${n}, ${sub}` : n || sub;
}

/** The schedule fields event-sessions reads, from a row. */
function scheduleOf(row: any): EventSchedule & { event_time?: string | null } {
  return {
    event_date: typeof row?.event_date === 'string' && DATE_RE.test(row.event_date) ? row.event_date : null,
    event_time: typeof row?.event_time === 'string' ? row.event_time : null,
    timezone: typeof row?.timezone === 'string' ? row.timezone : null,
    recurrence: row?.recurrence ?? 'once',
    recurrence_end_date: typeof row?.recurrence_end_date === 'string' ? row.recurrence_end_date : null,
    recurrence_days: Array.isArray(row?.recurrence_days) ? row.recurrence_days : null,
  };
}

/** Whether any session of this event is still to come, judged in the event's own timezone. */
export function eventIsOpenForRegistration(row: any, now: Date = new Date()): boolean {
  const sched = scheduleOf(row);
  if (!sched.event_date) return true;
  return getNextScheduledSessionDate(sched, eventLocalDate(sched.timezone, now)) !== null;
}

/**
 * The row as the public sees it, or null when the public may not see it at all: only published
 * events that take public registrations.
 */
export function toPublicEvent(row: any, taken: number, now: Date = new Date()): PublicEvent | null {
  if (!row || row.status !== 'published' || row.public_registration !== true) return null;
  const id = str(row.id, 64);
  const slug = str(row.slug, 200);
  if (!id || !slug) return null;
  const sched = scheduleOf(row);
  const today = eventLocalDate(sched.timezone, now);
  const nextDate = sched.event_date ? getNextScheduledSessionDate(sched, today) : null;
  const lastDate = sched.event_date && !nextDate
    ? (getLastScheduledSessionDate(sched, today) ?? sched.event_date)
    : null;
  const format: PublicEventFormat = row.event_type === 'virtual' ? 'virtual' : 'in-person';
  const capacity = typeof row.capacity === 'number' && row.capacity > 0 ? row.capacity : null;
  const timeMatch = typeof row.event_time === 'string' ? row.event_time.match(TIME_RE) : null;
  const recurrence = row.recurrence === 'daily' || row.recurrence === 'weekly' ? row.recurrence : 'once';
  return {
    id,
    slug,
    title: str(row.title, 300) ?? 'Untitled event',
    description: typeof row.description === 'string' && row.description.trim() ? row.description : null,
    summary: plainSummary(row.description),
    coverImage: str(row.cover_image, 1000),
    format,
    location: format === 'in-person' ? str(row.location, 300) : null,
    venue: format === 'in-person' ? splitVenue(str(row.location, 300)) : null,
    startDate: sched.event_date ?? null,
    time: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null,
    timezone: str(row.timezone, 80),
    recurrence,
    recurrenceEndDate: recurrence !== 'once' && sched.recurrence_end_date && DATE_RE.test(sched.recurrence_end_date) ? sched.recurrence_end_date : null,
    recurrenceDays: recurrence === 'weekly' && Array.isArray(row.recurrence_days)
      ? row.recurrence_days.filter((d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      : [],
    nextDate,
    lastDate,
    isPast: !eventIsOpenForRegistration(row, now),
    listed: row.is_private !== true,
    capacity,
    taken: Math.max(0, Math.floor(taken) || 0),
    spotsLeft: capacity === null ? null : Math.max(0, capacity - (Math.floor(taken) || 0)),
    speakers: publicSpeakers(row.speakers),
    fields: publicEventFields(row.fields),
  };
}

/** The date a card or header shows: the next session, else the last one. */
export function displayDate(ev: Pick<PublicEvent, 'nextDate' | 'lastDate' | 'startDate'>): string | null {
  return ev.nextDate ?? ev.lastDate ?? ev.startDate;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A calendar date's parts, read without the viewer's timezone (so the day never shifts). */
export function dateParts(date: string | null | undefined): { month: string; day: string; long: string } | null {
  if (!date || !DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return {
    month: MONTHS[dt.getUTCMonth()].toUpperCase(),
    day: String(dt.getUTCDate()),
    long: `${DAYS[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`,
  };
}

/** "6:30 PM" from "18:30". */
export function displayTime(time: string | null | undefined): string | null {
  const m = typeof time === 'string' ? time.match(TIME_RE) : null;
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}


/** "Weekly on Tue, Thu" or "Daily", or null for a one-time event. */
export function recurrenceLabel(ev: Pick<PublicEvent, 'recurrence' | 'recurrenceDays' | 'recurrenceEndDate'>): string | null {
  if (ev.recurrence === 'once') return null;
  const until = ev.recurrenceEndDate ? dateParts(ev.recurrenceEndDate) : null;
  const tail = until ? ` until ${until.month.charAt(0)}${until.month.slice(1).toLowerCase()} ${until.day}` : '';
  if (ev.recurrence === 'daily') return `Daily${tail}`;
  const days = ev.recurrenceDays.length ? ` on ${ev.recurrenceDays.map(d => DAYS[d]).join(', ')}` : '';
  return `Weekly${days}${tail}`;
}
