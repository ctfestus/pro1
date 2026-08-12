'use client';

// Live Sessions (Events) section, extracted verbatim from app/student/page.tsx.

import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/sanitize';
import { buildGoogleCalUrl, buildOutlookCalUrl, buildYahooCalUrl, downloadIcs, buildCalendarFields, isRecurring } from '@/lib/calendar-links';
import { getLastScheduledSessionDate, getNextScheduledSessionDate } from '@/lib/event-sessions';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { Sk, EmptyState } from '@/components/student/shared';
import { isIndividualCohort } from '@/lib/cohort-kind';
import {
  CalendarDays, Calendar, Sun, CheckCircle, ChevronRight, ChevronLeft, Video, MapPin, Repeat, Download,
} from 'lucide-react';

export function EventsSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [regs, setRegs] = useState<any[]>([]);
  const [cohortEvents, setCohortEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: student } = await supabase
          .from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
        // A synthetic individual-enrollment cohort (migration 165) has no events.
        const inIndividualCohort = isIndividualCohort((student as any)?.cohort?.cohort_kind);

        const [{ data: regsData }, { data: cohortData }] = await Promise.all([
          supabase
            .from('event_registrations')
            .select('event_id, registered_at, join_token')
            .eq('student_id', userId),
          student?.cohort_id && !inIndividualCohort
            ? supabase.from('events').select('id, title, description, slug, cover_image, event_date, event_time, timezone, location, meeting_link, event_type, status, recurrence, recurrence_end_date, recurrence_days')
                .contains('cohort_ids', [student.cohort_id]).eq('status', 'published')
            : Promise.resolve({ data: [] }),
        ]);

        setRegs(regsData ?? []);
        setCohortEvents(cohortData ?? []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  const buildDateFromEventDetails = (eventDetails: any) => {
    if (!eventDetails?.date) return null;
    const timeStr = eventDetails.time ? eventDetails.time.substring(0, 5) : '00:00';
    const merged = `${eventDetails.date}T${timeStr}:00`;
    const d = new Date(merged);
    return Number.isNaN(d.getTime()) ? null : d;
  };

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
    const start = buildDateFromEventDetails({ date: displayDate, time: f.event_time });
    const mode = (f.event_type || '').toLowerCase() === 'virtual' ? 'Virtual' : 'In-Person';
    const meetingUrl = sanitizeHttpUrl(f.meeting_link);
    const registered = registeredEventIds.has(f.id);
    return {
      id: `cohort-${f.id}`,
      formId: f.id,
      formSlug: f.slug,
      title: f.title || 'Untitled Event',
      description: f.description || '',
      startsAt: start,
      eventType: mode,
      locationText: f.location || '',
      meetingProvider: mode === 'Virtual' ? 'Google Meet' : 'Venue',
      meetingNote: mode === 'Virtual' ? 'Link shared after registration' : (f.location || 'In-person event'),
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

  if (loading) return (
    <div className="space-y-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-2xl p-4 flex gap-3" style={{ background: C.card, border: `1px solid ${C.green}50` }}>
          <Sk w={56} h={56} r={12}/><div className="flex-1 space-y-2"><Sk h={14}/><Sk h={11} w="55%"/><Sk h={11} w="35%"/></div>
        </div>
      ))}
    </div>
  );

  if (!cohortEvents.length) return (
    <EmptyState icon={CalendarDays} title="No live sessions yet"
      body="No live sessions have been scheduled for this cohort yet." />
  );

  // -- Realistic provider logos ---
  const LOGOS: Record<string, string> = {
    meet:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Meet.png',
    zoom:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Zoom.png',
    teams: 'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Teams.png',
  };
  const ProviderIcon = ({ provider }: { provider: string }) => {
    const p = (provider || '').toLowerCase();
    const src = p.includes('zoom') ? LOGOS.zoom : p.includes('teams') || p.includes('microsoft') ? LOGOS.teams : LOGOS.meet;
    return <img src={src} alt={provider} style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}/>;
  };

  const EventCard = ({ item, past: isPast, index, isLast }: { item: any; past?: boolean; index: number; isLast?: boolean }) => {
    const [joinErr, setJoinErr] = useState('');
    const [calOpen, setCalOpen] = useState(false);
    const [calToken, setCalToken] = useState<string | null>(null);
    const [calBusy, setCalBusy] = useState(false);
    const showImage = item.imageUrl && !imgErrors.has(item.id);
    const eventRepeats = isRecurring(item.recurrence);
    const displayDateLabel = item.startsAt
      ? item.startsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    const dateLabel = displayDateLabel && eventRepeats && !isPast && item.nextSessionDate
      ? `Next: ${displayDateLabel}`
      : displayDateLabel;
    const timeLabel = item.startsAt
      ? item.startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;
    const isVirtual = item.eventType === 'Virtual';
    const isRegistered = item.source === 'registration';

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
    const openCalendar = async (e: React.MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
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

    const DAY_LABELS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const recurrenceLabel = (() => {
      if (!item.recurrence || item.recurrence === 'once') return null;
      if (item.recurrence === 'daily') return 'Repeats Daily';
      if (item.recurrence === 'weekly') {
        const days = (item.recurrenceDays ?? []).sort((a: number, b: number) => a - b).map((d: number) => DAY_LABELS[d]).join(' · ');
        return days ? `Every ${days}` : 'Weekly';
      }
      return null;
    })();

    const card = (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: isPast ? 0.6 : 1, y: 0 }}
        transition={{ delay: index * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-2.5"
      >
          {/* Cover */}
          <div className="relative w-full aspect-video rounded-xl overflow-hidden flex-shrink-0"
            style={{ background: C.thumbBg }}>
            {showImage
              ? <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover"
                  onError={() => setImgErrors(prev => new Set(prev).add(item.id))}/>
              : <div className="w-full h-full flex items-center justify-center">
                  <CalendarDays className="w-10 h-10" style={{ color: C.faint }}/>
                </div>
            }
          </div>

            {/* Row 1: Date·Time pill + Mode pill */}
            <div className="flex items-center gap-2 flex-wrap">
              {(dateLabel || timeLabel) && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: C.pill, color: C.muted }}>
                  {dateLabel}{timeLabel && ` · ${timeLabel}`}
                </span>
              )}
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: isVirtual ? `${C.green}15` : C.pill,
                  color: isVirtual ? C.green : C.muted,
                }}>
                {item.eventType}
              </span>
              {recurrenceLabel && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: `${C.green}15`, color: C.green }}>
                  <Repeat className="w-3 h-3" /> {recurrenceLabel}
                </span>
              )}
              {isRegistered && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ background: '#16a34a', color: '#fff' }}>
                  <CheckCircle className="w-3 h-3" /> Registered
                </span>
              )}
            </div>

            {/* Row 2: Meeting provider (virtual) or venue (in-person) */}
            {isVirtual ? (
              <div className="flex items-center gap-1.5">
                <ProviderIcon provider={item.meetingProvider}/>
                <span className="text-xs font-medium" style={{ color: C.muted }}>
                  {item.meetingProvider}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                <span className="text-xs" style={{ color: C.muted }}>
                  {item.locationText
                    ? <span className="font-medium">{item.locationText}</span>
                    : <span style={{ color: C.faint }}>Venue TBC</span>
                  }
                </span>
              </div>
            )}

            {/* Title */}
            <p className="text-sm font-bold leading-snug line-clamp-2" style={{ color: C.text }}>
              {item.title}
            </p>

            {/* Description */}
            {item.description && (
              <div className="text-xs leading-relaxed line-clamp-2 rich-content" style={{ color: C.muted }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.description) }} />
            )}

            {/* Actions: Join + Add to Calendar */}
            {((item.joinToken || item.meetingUrl) || calGoogleUrl) && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {(item.joinToken || item.meetingUrl) && (
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg w-fit dashboard-cta"
                      style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: 'pointer' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setJoinErr('');
                        if (item.joinToken) {
                          window.open(`/api/join?token=${item.joinToken}`, '_blank', 'noopener,noreferrer');
                          return;
                        }
                        const win = window.open('', '_blank', 'noopener,noreferrer');
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
                      }}>
                      <Video className="w-3 h-3"/> Join
                    </button>
                  )}
                  {calGoogleUrl && (
                    <button
                      onClick={openCalendar} disabled={calBusy}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg w-fit"
                      style={{ background: C.pill, color: C.muted, border: `1px solid ${C.cardBorder}`, cursor: 'pointer', opacity: calBusy ? 0.6 : 1 }}>
                      <Calendar className="w-3 h-3"/> {calBusy ? 'Preparing...' : 'Add to Calendar'}
                    </button>
                  )}
                </div>
                {joinErr && <p className="text-xs mt-1" style={{ color: '#ef4444', margin: 0 }}>{joinErr}</p>}

                {calOpen && calGoogleUrl && (
                  <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); setCalOpen(false); }}
                    style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 18, width: 'min(320px, calc(100vw - 32px))', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ textAlign: 'center' }}>
                        <p className="text-sm font-bold" style={{ color: C.text, margin: 0 }}>Add to Calendar</p>
                        <p className="text-xs" style={{ color: C.faint, marginTop: 4 }}>
                          {calRecurring ? 'Saves every session in the series.' : 'Save this session to your calendar.'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <a href={calGoogleUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); setCalOpen(false); }}
                          className="text-xs font-semibold px-3 py-2.5 rounded-lg text-center" style={{ background: C.pill, color: C.text, textDecoration: 'none' }}>
                          Google Calendar
                        </a>
                        {calOutlookUrl && (
                          <a href={calOutlookUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); setCalOpen(false); }}
                            className="text-xs font-semibold px-3 py-2.5 rounded-lg text-center" style={{ background: C.pill, color: C.text, textDecoration: 'none' }}>
                            Outlook.com
                          </a>
                        )}
                        {calYahooUrl && (
                          <a href={calYahooUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); setCalOpen(false); }}
                            className="text-xs font-semibold px-3 py-2.5 rounded-lg text-center" style={{ background: C.pill, color: C.text, textDecoration: 'none' }}>
                            Yahoo Calendar
                          </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); downloadIcs(item.title, item.eventDate, item.eventTime ?? '', item.eventTimezone, calLocation, calDescription, item.recurrence, item.recurrenceEndDate, item.recurrenceDays); setCalOpen(false); }}
                          className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg" style={{ background: C.pill, color: C.text, border: 'none', cursor: 'pointer' }}>
                          <Download className="w-3.5 h-3.5"/> Apple / iCal (.ics)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
      </motion.div>
    );

    return (
      item.source === 'cohort' && item.formSlug
        ? <Link href={`/${item.formSlug}`} className="flex-shrink-0 w-[270px] snap-start hover:opacity-90 transition-opacity" style={{ textDecoration: 'none' }}>{card}</Link>
        : <div className="flex-shrink-0 w-[270px] snap-start">{card}</div>
    );
  };

  if (!upcoming.length && !past.length) return (
    <EmptyState icon={CalendarDays} title="No upcoming events" body="Your upcoming events will appear here." />
  );

  const EventCarousel = ({ title, items, past: isPastRow }: { title: string; items: any[]; past?: boolean }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 290, behavior: 'smooth' });
    return (
      <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>{title}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
              className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}><ChevronLeft className="w-4 h-4"/></button>
            <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
              className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}><ChevronRight className="w-4 h-4"/></button>
          </div>
        </div>
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x items-start"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {items.map((item, i) => <EventCard key={item.id} item={item} past={isPastRow} index={i} />)}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && <EventCarousel title="Upcoming" items={upcoming} />}
      {past.length > 0 && <EventCarousel title="Past" items={past.slice().reverse()} past />}
    </div>
  );
}
