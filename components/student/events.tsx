'use client';

// Live sessions, Upcoming tab: the cohort's sessions as a list by day, past ones after them.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { toPlainText } from '@/lib/plain-text';
import { buildGoogleCalUrl, buildOutlookCalUrl, buildYahooCalUrl, downloadIcs, buildCalendarFields, isRecurring } from '@/lib/calendar-links';
import { getLastScheduledSessionDate, getNextScheduledSessionDate, sessionStartInstant } from '@/lib/event-sessions';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { DISPLAY_FONT, Pill, btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { Sk, EmptyState } from '@/components/student/shared';
import { isIndividualCohort } from '@/lib/cohort-kind';
import {
  CalendarDays, Calendar, Video, MapPin, Repeat, Download, RefreshCw,
} from 'lucide-react';

// -- Realistic provider logos ---
const LOGOS: Record<string, string> = {
  meet:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Meet.png',
  zoom:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Zoom.png',
  teams: 'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Teams.png',
};
const ProviderIcon = ({ provider }: { provider: string }) => {
  const p = (provider || '').toLowerCase();
  const src = p.includes('zoom') ? LOGOS.zoom : p.includes('teams') || p.includes('microsoft') ? LOGOS.teams : p.includes('meet') ? LOGOS.meet : null;
  if (!src) return null;
  return <img src={src} alt={provider} style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}/>;
};

const DAY_LABELS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
function recurrenceLabel(item: any) {
  if (!item.recurrence || item.recurrence === 'once') return null;
  if (item.recurrence === 'daily') return 'Every day';
  if (item.recurrence === 'weekly') {
    const days = [...(item.recurrenceDays ?? [])].sort((a: number, b: number) => a - b).map((d: number) => DAY_LABELS[d]).join(', ');
    return days ? `Every ${days}` : 'Weekly';
  }
  return null;
}

/** One session: the time in the learner's zone, what and where, its labels, then Join and Add to calendar. */
const SessionRow = ({ item, past: isPast, C, imgErrors, onImageError }: { item: any; past?: boolean; C: typeof LIGHT_C; imgErrors: Set<string>; onImageError: (id: string) => void }) => {
  const [joinErr, setJoinErr] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [calToken, setCalToken] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState(false);
  const showImage = item.imageUrl && !imgErrors.has(item.id);
  const eventRepeats = isRecurring(item.recurrence);
  // "6:00" large, with "PM GMT" under it: the learner's own clock and zone.
  const parts = item.startsAt ? new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).formatToParts(item.startsAt) : [];
  const time = parts.filter(p => p.type === 'hour' || p.type === 'minute' || (p.type === 'literal' && p.value.trim() === ':')).map(p => p.value).join('') || null;
  const zone = parts.filter(p => p.type === 'dayPeriod' || p.type === 'timeZoneName').map(p => p.value).join(' ');
  const isVirtual = item.eventType === 'Virtual';
  const isRegistered = item.source === 'registration';
  const repeats = recurrenceLabel(item);

  // Add-to-calendar links. Absolute join link so a tap from the calendar
  // reminder reaches /api/join and records attendance. Recurring events embed
  // the full series via Google + .ics (Outlook.com / Yahoo can't encode it).
  const calRecurring = eventRepeats;
  const calOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const calEffToken = item.joinToken ?? calToken; // lazily-fetched token if none was registered yet
  const calJoinUrl = calEffToken ? `${calOrigin}/api/join?token=${calEffToken}` : '';
  const { calLocation, calDescription } = buildCalendarFields({ isVirtual, joinUrl: calJoinUrl, location: item.locationText, description: item.description });
  const calGoogleUrl  = item.eventDate ? buildGoogleCalUrl(item.title, item.eventDate, item.eventTime ?? '', item.eventTimezone, calLocation, calDescription, item.recurrence, item.recurrenceEndDate, item.recurrenceDays) : null;
  const calOutlookUrl = (item.eventDate && !calRecurring) ? buildOutlookCalUrl(item.title, item.eventDate, item.eventTime ?? '', item.eventTimezone, calLocation, calDescription) : null;
  const calYahooUrl   = (item.eventDate && !calRecurring) ? buildYahooCalUrl(item.title, item.eventDate, item.eventTime ?? '', item.eventTimezone, calLocation, calDescription) : null;

  // Virtual events need a join token in the calendar entry for attendance to be
  // recorded. If the student has none yet (cohort-assigned but not registered),
  // register on demand -- same flow as the Join button -- before opening.
  const openCalendar = async () => {
    let token = calEffToken;
    if (isVirtual && !token && item.formId) {
      setCalBusy(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const res = await fetch('/api/event-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ formId: item.formId }),
          });
          const json = await res.json();
          if (json.join_token) { token = json.join_token; setCalToken(json.join_token); }
        }
      } catch {}
      setCalBusy(false);
    }
    if (isVirtual && !token) { setJoinErr('Could not prepare your calendar link. Please refresh and try again.'); return; }
    setCalOpen(true);
  };

  const join = async () => {
    setJoinErr('');
    if (item.joinToken) {
      window.open(`/api/join?token=${item.joinToken}`, '_blank', 'noopener,noreferrer');
      return;
    }
    // Without 'noopener', or the browser returns null and the tab can never be sent
    // on; cutting opener by hand keeps the same protection.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch('/api/event-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ formId: item.formId }),
        });
        const json = await res.json();
        if (json.join_token && win) { win.location.href = `/api/join?token=${json.join_token}`; return; }
      }
    } catch {}
    win?.close();
    setJoinErr('Could not get your join link. Please refresh and try again.');
  };

  const calOption = 'block rounded-xl px-3 py-2.5 text-center text-[13px] font-semibold';
  const title = <span className="text-[15px] font-semibold leading-5" style={{ color: C.text }}>{item.title}</span>;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3.5" style={{ background: C.card, opacity: isPast ? 0.7 : 1 }}>
      {showImage && (
        <img src={item.imageUrl} alt="" onError={() => onImageError(item.id)} className="h-16 w-24 flex-shrink-0 rounded-xl object-cover"/>
      )}
      <div className="w-[72px] flex-shrink-0 rounded-xl py-2 text-center leading-tight" style={{ background: C.pill }}>
        <b className="block text-[17px] tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{time ?? 'TBC'}</b>
        {zone && <span className="text-[11px]" style={{ color: C.muted }}>{zone}</span>}
      </div>

      <div className="min-w-0 flex-[1_1_180px]">
        {item.source === 'cohort' && item.formSlug
          ? <Link href={`/${item.formSlug}`} className="hover:underline">{title}</Link>
          : title}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px]" style={{ color: C.muted }}>
          {isVirtual
            ? <><ProviderIcon provider={item.meetingProvider}/>{item.meetingProvider}</>
            : <><MapPin className="h-3.5 w-3.5 flex-shrink-0" style={{ color: C.faint }}/>{item.locationText || 'Venue to be confirmed'}</>}
        </div>
        {item.description && (
          <p className="mt-0.5 line-clamp-1 text-[13px]" style={{ color: C.muted }}>{toPlainText(item.description)}</p>
        )}
        {(isRegistered || !isVirtual || repeats) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {isRegistered && <Pill tone="good" dot C={C}>Registered</Pill>}
            {!isVirtual && <Pill tone="mute" C={C}>In person</Pill>}
            {repeats && <Pill tone="mute" C={C}><Repeat className="h-3 w-3"/>{repeats}</Pill>}
          </div>
        )}
      </div>

      {!isPast && ((isVirtual && item.meetingUrl) || calGoogleUrl) && (
        <div className="ml-auto flex flex-wrap gap-2">
          {isVirtual && item.meetingUrl && (
            <button type="button" onClick={join} className={btnClass} style={{ background: DARK_C.cta, color: '#ffffff' }}>
              <Video className="h-4 w-4"/> Join
            </button>
          )}
          {calGoogleUrl && (
            <button type="button" onClick={openCalendar} disabled={calBusy} className={btnClass} style={btnStyle('sec', C)}>
              <Calendar className="h-4 w-4"/> {calBusy ? 'Preparing' : 'Add to calendar'}
            </button>
          )}
        </div>
      )}
      {joinErr && <p className="w-full text-xs" style={{ color: palette(C).bad }}>{joinErr}</p>}

      {calOpen && calGoogleUrl && (
        <div onClick={() => setCalOpen(false)} className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add to calendar"
            className="flex flex-col gap-3.5 rounded-2xl p-5" style={{ background: C.card, width: 'min(320px, calc(100vw - 32px))' }}>
            <div className="text-center">
              <p className="text-[15px] font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Add to calendar</p>
              <p className="mt-1 text-xs" style={{ color: C.muted }}>
                {calRecurring ? 'Saves every session in the series.' : 'Save this session to your calendar.'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <a href={calGoogleUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalOpen(false)} className={calOption} style={btnStyle('sec', C)}>Google Calendar</a>
              {calOutlookUrl && <a href={calOutlookUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalOpen(false)} className={calOption} style={btnStyle('sec', C)}>Outlook.com</a>}
              {calYahooUrl && <a href={calYahooUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalOpen(false)} className={calOption} style={btnStyle('sec', C)}>Yahoo Calendar</a>}
              <button type="button" onClick={() => { downloadIcs(item.title, item.eventDate, item.eventTime ?? '', item.eventTimezone, calLocation, calDescription, item.recurrence, item.recurrenceEndDate, item.recurrenceDays); setCalOpen(false); }}
                className={`${calOption} inline-flex items-center justify-center gap-1.5`} style={btnStyle('sec', C)}>
                <Download className="h-3.5 w-3.5"/> Apple / iCal (.ics)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** "Wed, Nov 25" with how far off it is, for the heading over a day's sessions. */
function dayHeading(d: Date | null) {
  if (!d) return { day: 'Date to be confirmed', note: '' };
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = Math.round((midnight(d) - midnight(new Date())) / 86400000);
  const note = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? `In ${n} days` : n === -1 ? 'Yesterday' : `${-n} days ago`;
  return { day, note };
}

/** Sessions grouped under a heading per day, in the order given. */
const SessionDays = ({ items, past, C, imgErrors, onImageError }: { items: any[]; past?: boolean; C: typeof LIGHT_C; imgErrors: Set<string>; onImageError: (id: string) => void }) => {
  const days: { key: string; date: Date | null; items: any[] }[] = [];
  for (const item of items) {
    const key = item.startsAt ? item.startsAt.toDateString() : 'tbc';
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(item);
    else days.push({ key, date: item.startsAt, items: [item] });
  }
  return (
    <>
      {days.map(d => {
        const { day, note } = dayHeading(d.date);
        return (
          <section key={d.key} className="mt-5 first:mt-0">
            <h3 className="mb-2 flex items-baseline gap-2.5">
              <span className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{day}</span>
              {note && <span className="text-xs" style={{ color: C.muted }}>{note}</span>}
            </h3>
            <div className="space-y-2">
              {d.items.map(item => <SessionRow key={item.id} item={item} past={past} C={C} imgErrors={imgErrors} onImageError={onImageError}/>)}
            </div>
          </section>
        );
      })}
    </>
  );
};

export function EventsSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [regs, setRegs] = useState<any[]>([]);
  const [cohortEvents, setCohortEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data: student, error: studentError } = await supabase
          .from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
        if (studentError) throw studentError;
        // A synthetic individual-enrollment cohort (migration 165) has no events.
        const inIndividualCohort = isIndividualCohort((student as any)?.cohort?.cohort_kind);

        const [registrationsResult, eventsResult] = await Promise.all([
          supabase
            .from('event_registrations')
            .select('event_id, registered_at, join_token')
            .eq('student_id', userId),
          student?.cohort_id && !inIndividualCohort
            ? supabase.from('events').select('id, title, description, slug, cover_image, event_date, event_time, timezone, location, meeting_link, event_type, status, recurrence, recurrence_end_date, recurrence_days')
                .contains('cohort_ids', [student.cohort_id]).eq('status', 'published')
            : Promise.resolve({ data: [] }),
        ]);
        if (registrationsResult.error) throw registrationsResult.error;
        if ('error' in eventsResult && eventsResult.error) throw eventsResult.error;

        setRegs(registrationsResult.data ?? []);
        setCohortEvents(eventsResult.data ?? []);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [reloadKey, userId]);

  // In the event's own time zone, as the next-session banner reads it; the stored time is the
  // host's clock, not the learner's.
  const buildDateFromEventDetails = (eventDetails: { date: string | null; time?: string | null; timezone?: string | null }) =>
    eventDetails.date ? sessionStartInstant(eventDetails.date, eventDetails.time ? eventDetails.time.substring(0, 5) : '00:00', eventDetails.timezone) : null;

  const sanitizeHttpUrl = (value?: string | null) => {
    if (!value) return null;
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const u = new URL(normalized);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
    } catch {
      return null;
    }
  };

  const registeredEventIds = new Set(regs.map((r: any) => r.event_id).filter(Boolean));
  const regTokenMap = new Map(regs.filter((r: any) => r.event_id && r.join_token).map((r: any) => [r.event_id, r.join_token as string]));

  const allCohortEvents = cohortEvents.map((f: any) => {
    const schedule = {
      event_date: f.event_date ?? null,
      timezone: f.timezone ?? null,
      recurrence: f.recurrence ?? 'once',
      recurrence_end_date: f.recurrence_end_date ?? null,
      recurrence_days: Array.isArray(f.recurrence_days) ? f.recurrence_days : [],
    };
    const nextSessionDate = getNextScheduledSessionDate(schedule);
    const lastSessionDate = nextSessionDate ? null : getLastScheduledSessionDate(schedule);
    const displayDate = nextSessionDate ?? lastSessionDate ?? f.event_date ?? null;
    const start = buildDateFromEventDetails({ date: displayDate, time: f.event_time, timezone: f.timezone });
    const mode = (f.event_type || '').toLowerCase() === 'virtual' ? 'Virtual' : 'In person';
    const meetingUrl = sanitizeHttpUrl(f.meeting_link);
    const registered = registeredEventIds.has(f.id);
    return {
      id: `cohort-${f.id}`,
      formId: f.id,
      formSlug: f.slug,
      title: f.title || 'Untitled session',
      description: f.description || '',
      startsAt: start,
      eventType: mode,
      locationText: f.location || '',
      // Named from the link, so a Zoom or Teams session no longer shows the Google Meet logo.
      meetingProvider: mode !== 'Virtual' ? 'Venue'
        : /zoom\.us/i.test(f.meeting_link || '') ? 'Zoom'
        : /teams\.(microsoft|live)\.com/i.test(f.meeting_link || '') ? 'Microsoft Teams'
        : /meet\.google\.com/i.test(f.meeting_link || '') ? 'Google Meet' : 'Online',
      meetingUrl,
      joinToken: regTokenMap.get(f.id) ?? null,
      imageUrl: resolveCoverUrl(f.cover_image) || '',
      source: registered ? 'registration' : 'cohort',
      nextSessionDate,
      displayDate,
      eventDate: f.event_date ?? null,
      eventTime: f.event_time ?? null,
      eventTimezone: f.timezone ?? null,
      recurrence: f.recurrence ?? 'once',
      recurrenceEndDate: f.recurrence_end_date ?? null,
      recurrenceDays: f.recurrence_days ?? [],
    };
  });

  const allEvents = allCohortEvents.sort((a, b) => {
    const at = a.startsAt ? a.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.startsAt ? b.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  const _todayMidnight = new Date(); _todayMidnight.setHours(0, 0, 0, 0);
  const isEventPast = (e: any) => {
    if (e.nextSessionDate) return false;
    return !!e.startsAt && e.startsAt < _todayMidnight;
  };
  const upcoming = allEvents.filter(e => !isEventPast(e));
  const past = allEvents.filter(e => isEventPast(e));

  const onImageError = (id: string) => setImgErrors(prev => new Set(prev).add(id));

  if (loading) return (
    <div aria-busy="true">
      <Sk w={140} h={18}/>
      <div className="mt-2 space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-4 rounded-2xl px-4 py-3.5" style={{ background: C.card }}>
            <Sk w={64} h={52} r={12}/>
            <div className="flex-1 space-y-2"><Sk h={14} w="45%"/><Sk h={11} w="30%"/><Sk h={11} w="55%"/></div>
            <Sk w={180} h={40} r={12}/>
          </div>
        ))}
      </div>
    </div>
  );

  if (loadError) return (
    <EmptyState
      icon={RefreshCw}
      title="Could not load live sessions"
      body="Check your connection and try again."
      action={(
        <button type="button" onClick={() => setReloadKey(key => key + 1)}
          className="text-sm font-semibold px-4 py-2.5 rounded-xl"
          style={{ background: C.cta, color: C.ctaText }}>
          Try again
        </button>
      )}
    />
  );

  if (!cohortEvents.length) return (
    <EmptyState icon={CalendarDays} title="No live sessions yet"
      body="No live sessions have been scheduled for this cohort yet." />
  );

  if (!upcoming.length && !past.length) return (
    <EmptyState icon={CalendarDays} title="No upcoming sessions" body="Your upcoming sessions will appear here." />
  );

  return (
    <div>
      {upcoming.length > 0 && <SessionDays items={upcoming} C={C} imgErrors={imgErrors} onImageError={onImageError}/>}
      {past.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-lg font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Past sessions</h2>
          <SessionDays items={past.slice().reverse()} past C={C} imgErrors={imgErrors} onImageError={onImageError}/>
        </>
      )}
    </div>
  );
}
