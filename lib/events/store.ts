import 'server-only';
import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { loadInstructor, type StoreInstructor } from '@/lib/books/store';
import { EVENTS_STORE_TAG } from '@/lib/events/store-cache';
import { toPublicEvent, type PublicEvent } from '@/lib/events/public-event';
import type { NavBook } from '@/lib/landing-nav';

/**
 * Events the public may see, for /events and /events/[slug].
 *
 * Anonymous visitors cannot read the events table (its policy admits the owner, admins and cohort
 * members), so these read it with the service role. The selected columns are pinned and the output
 * is built field by field in toPublicEvent, so the meeting link and cohort ids never leave here.
 * Only published events with public registration turned on are returned.
 *
 * Cached for a minute under the 'events-store' tag; event saves and registrations revalidate it.
 */

const COLUMNS = [
  'id', 'slug', 'title', 'description', 'cover_image', 'status', 'public_registration', 'is_private',
  'event_date', 'event_time', 'timezone', 'location', 'event_type', 'capacity', 'speakers', 'fields',
  'recurrence', 'recurrence_end_date', 'recurrence_days', 'user_id', 'custom_accent', 'theme', 'mode', 'font',
].join(', ');

const MAX_EVENTS = 200;
const PAST_SHOWN = 12;

export interface PublicEventDetail extends PublicEvent {
  host: StoreInstructor | null;
}

interface PublicEventList {
  upcoming: PublicEvent[];
  past: PublicEvent[];
}

async function seatsTaken(db: any, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data, error } = await db.rpc('event_seats_taken', { p_event_ids: ids });
  if (error) throw error;
  for (const r of (data as any[]) ?? []) out.set(r.event_id, Number(r.taken) || 0);
  return out;
}

async function loadPublicEvents(): Promise<PublicEventList> {
  const db = adminClient();
  const { data, error } = await db
    .from('events')
    .select(COLUMNS)
    .eq('status', 'published')
    .eq('public_registration', true)
    .eq('is_private', false)
    .order('event_date', { ascending: false, nullsFirst: false })
    .limit(MAX_EVENTS);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  const taken = await seatsTaken(db, rows.map(r => r.id));
  const events = rows
    .map(r => toPublicEvent(r, taken.get(r.id) ?? 0))
    .filter((e): e is PublicEvent => !!e);
  const key = (e: PublicEvent) => e.nextDate ?? e.startDate ?? '9999-12-31';
  const upcoming = events.filter(e => !e.isPast)
    .sort((a, b) => key(a).localeCompare(key(b)) || (a.time ?? '').localeCompare(b.time ?? ''));
  const past = events.filter(e => e.isPast)
    .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
    .slice(0, PAST_SHOWN);
  return { upcoming, past };
}

async function loadPublicEvent(slug: string): Promise<PublicEventDetail | null> {
  if (!slug || slug.length > 200) return null;
  const db = adminClient();
  const { data, error } = await db
    .from('events')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const taken = await seatsTaken(db, [(data as any).id]);
  const event = toPublicEvent(data, taken.get((data as any).id) ?? 0);
  if (!event) return null;
  return { ...event, host: await loadInstructor(db, (data as any).user_id) };
}

const listPublicEvents = unstable_cache(() => loadPublicEvents(), ['events-store-list'], { tags: [EVENTS_STORE_TAG], revalidate: 60 });
export const getPublicEvent = unstable_cache((slug: string) => loadPublicEvent(slug), ['events-store-event'], { tags: [EVENTS_STORE_TAG], revalidate: 60 });

/** For the public pages: an outage shows no events rather than an error page. */
export async function listPublicEventsOrEmpty(): Promise<PublicEventList> {
  try {
    return await listPublicEvents();
  } catch (e: any) {
    console.error('[events/store] list failed', e?.message ?? e);
    return { upcoming: [], past: [] };
  }
}

/** Events as the shared nav's Learn menu lists them (lib/landing-nav.ts). */
export function toNavEvents(events: PublicEvent[]): NavBook[] {
  return events.map(e => ({ id: e.id, slug: e.slug, title: e.title, coverImage: e.coverImage }));
}

/** Upcoming events for the nav. Empty on any failure. */
export async function listNavEvents(): Promise<NavBook[]> {
  return toNavEvents((await listPublicEventsOrEmpty()).upcoming);
}

/**
 * The slug of a public event, for sending /<slug> visitors to its public page. Null otherwise.
 * Cached like the rest: it runs on every /<slug> view, courses and paths included.
 */
export async function publicEventRedirect(ref: string): Promise<{ slug: string } | null> {
  if (!ref || ref.length > 200) return null;
  try {
    return await cachedPublicEventSlug(ref);
  } catch {
    return null;
  }
}

const cachedPublicEventSlug = unstable_cache(async (ref: string): Promise<{ slug: string } | null> => {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const { data, error } = await adminClient()
    .from('events')
    .select('slug, status, public_registration')
    .eq(isUuid ? 'id' : 'slug', ref)
    .maybeSingle();
  // Thrown, so not cached: a failed read must not pin "no public event" for a minute.
  if (error) throw error;
  if (!data || data.status !== 'published' || data.public_registration !== true || !data.slug) return null;
  return { slug: data.slug };
}, ['events-store-redirect'], { tags: [EVENTS_STORE_TAG], revalidate: 60 });
