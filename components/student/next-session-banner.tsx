'use client';

// Countdown banner for the cohort's next live session. Shown at the top of the
// student dashboard once a session is within 24 hours, and while it is live.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { isIndividualCohort } from '@/lib/cohort-kind';
import { getNextScheduledSessionDate, parseGmtOffsetMinutes, eventLocalDate } from '@/lib/event-sessions';
import { Clock, Video, Repeat, X } from 'lucide-react';

const AHEAD_MS = 24 * 60 * 60_000;
// A session stays on the banner as "Live now" for this long after it starts.
const LIVE_MS = 60 * 60_000;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type EventRow = {
  id: string; title: string | null; event_date: string | null; event_time: string | null; timezone: string | null;
  event_type: string | null; meeting_link: string | null;
  recurrence: string | null; recurrence_end_date: string | null; recurrence_days: number[] | null;
};

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

// Session start as an absolute instant, honouring the event's stored GMT offset.
// Without a parseable offset, fall back to the viewer's local clock (same as the event cards).
function sessionStart(dateStr: string, timeStr: string, timezone: string | null): Date | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.slice(0, 5).split(':').map(Number);
  if ([y, m, d, hh, mm].some(n => Number.isNaN(n))) return null;
  const offset = parseGmtOffsetMinutes(timezone);
  const date = offset === null
    ? new Date(y, m - 1, d, hh, mm)
    : new Date(Date.UTC(y, m - 1, d, hh, mm) - offset * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

// First occurrence that has not yet finished its live window.
function upcomingStart(ev: EventRow, now: number): Date | null {
  if (!ev.event_date || !ev.event_time) return null;
  const schedule = {
    event_date: ev.event_date, timezone: ev.timezone, recurrence: ev.recurrence ?? 'once',
    recurrence_end_date: ev.recurrence_end_date, recurrence_days: ev.recurrence_days ?? [],
  };
  // Start a day early so a session still live across the date line is not skipped.
  let from = shiftDate(eventLocalDate(ev.timezone, new Date(now)), -1);
  for (let i = 0; i < 4; i += 1) {
    const day = getNextScheduledSessionDate(schedule, from);
    if (!day) return null;
    const start = sessionStart(day, ev.event_time, ev.timezone);
    if (!start) return null;
    if (start.getTime() + LIVE_MS > now) return start;
    from = shiftDate(day, 1);
  }
  return null;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function recurrenceLabel(ev: EventRow): string | null {
  if (ev.recurrence === 'daily') return 'Every day';
  if (ev.recurrence === 'weekly') {
    const days = (ev.recurrence_days ?? []).slice().sort((a, b) => a - b).map(d => DAY_LABELS[d]).filter(Boolean);
    return days.length ? `Every ${days.join(', ')}` : 'Every week';
  }
  return null;
}

const dismissKey = (id: string, start: Date) => `next-session-dismissed:${id}:${start.toISOString()}`;

export function NextSessionBanner({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tokens, setTokens] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: student } = await supabase
        .from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
      if (!student?.cohort_id || isIndividualCohort((student as any)?.cohort?.cohort_kind)) return;
      const [eventsRes, regsRes] = await Promise.all([
        supabase.from('events')
          .select('id, title, event_date, event_time, timezone, event_type, meeting_link, recurrence, recurrence_end_date, recurrence_days')
          .contains('cohort_ids', [student.cohort_id]).eq('status', 'published'),
        supabase.from('event_registrations').select('event_id, join_token').eq('student_id', userId),
      ]);
      if (cancelled) return;
      setEvents((eventsRes.data as EventRow[] | null) ?? []);
      setTokens(new Map((regsRes.data ?? []).filter((r: any) => r.event_id && r.join_token).map((r: any) => [r.event_id, r.join_token])));
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const soonest = events
    .map(ev => ({ ev, start: upcomingStart(ev, now) }))
    .filter((x): x is { ev: EventRow; start: Date } => !!x.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const next = soonest && soonest.start.getTime() - now <= AHEAD_MS ? soonest : null;
  const key = next ? dismissKey(next.ev.id, next.start) : null;
  let isDismissed = !!key && dismissed === key;
  if (key && !isDismissed) {
    try { isDismissed = sessionStorage.getItem(key) === '1'; } catch {}
  }

  // Tick every second only while the countdown is on screen. Otherwise sleep until
  // the next change: the soonest session entering the 24h window, or a dismissed
  // session ending. Capped at an hour so a sleeping laptop catches up on wake.
  let wakeIn: number | null = null;
  if (soonest) {
    const startMs = soonest.start.getTime();
    wakeIn = !next ? startMs - AHEAD_MS - now
      : isDismissed ? startMs + LIVE_MS - now
      : 1000;
    wakeIn = Math.min(Math.max(wakeIn, 1000), 60 * 60_000);
  }
  useEffect(() => {
    if (wakeIn === null) return;
    const t = setTimeout(() => setNow(Date.now()), wakeIn);
    return () => clearTimeout(t);
  }, [now, wakeIn]);

  if (!next || !key || isDismissed) return null;
  const { ev, start } = next;

  const msLeft = start.getTime() - now;
  const live = msLeft <= 0;
  const isVirtual = (ev.event_type || '').toLowerCase() === 'virtual';
  // Only offer the button when the event has a meeting link: /api/join 404s without
  // one. The button itself always goes through the student's join token (never the
  // raw link) so attendance is recorded.
  const canJoin = isVirtual && !!ev.meeting_link;
  const repeat = recurrenceLabel(ev);
  const whenLabel = start.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Same flow as the Join button on the event cards: /api/join records attendance,
  // registering on demand when the student has no join token yet.
  const join = async () => {
    setJoinErr('');
    const existing = tokens.get(ev.id);
    if (existing) { window.open(`/api/join?token=${existing}`, '_blank', 'noopener,noreferrer'); return; }
    const win = window.open('', '_blank', 'noopener,noreferrer');
    setJoining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch('/api/event-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ formId: ev.id }),
        });
        const json = await res.json();
        if (json.join_token) {
          setTokens(prev => new Map(prev).set(ev.id, json.join_token));
          if (win) { win.location.href = `/api/join?token=${json.join_token}`; return; }
        }
      }
    } catch {} finally { setJoining(false); }
    win?.close();
    setJoinErr('Could not get your join link. Please try again.');
  };

  const dismiss = () => {
    try { sessionStorage.setItem(key, '1'); } catch {}
    setDismissed(key);
  };

  return (
    <div className="rounded-2xl px-4 py-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ background: C.card }}>
      <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: `${C.green}15` }}>
        {live ? <Video className="w-4 h-4" style={{ color: C.green }}/> : <Clock className="w-4 h-4" style={{ color: C.green }}/>}
      </div>
      <div className="flex-1 min-w-[180px]">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.green, margin: 0 }}>
          {live ? 'Live now' : 'Next live session'}
        </p>
        <p className="text-sm font-bold leading-snug truncate" style={{ color: C.text, margin: 0 }}>{ev.title || 'Live session'}</p>
        <p className="text-xs flex items-center gap-1.5 flex-wrap" style={{ color: C.muted, margin: 0 }}>
          {whenLabel}
          {repeat && <span className="inline-flex items-center gap-1" style={{ color: C.faint }}><Repeat className="w-3 h-3"/> {repeat}</span>}
        </p>
      </div>
      {!live && (
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, margin: 0 }}>Starts in</p>
          <p className="text-lg font-bold tabular-nums" style={{ color: C.text, margin: 0 }}>{formatCountdown(msLeft)}</p>
        </div>
      )}
      {canJoin && (
        <button type="button" onClick={join} disabled={joining}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg dashboard-cta"
          style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: 'pointer', opacity: joining ? 0.6 : 1 }}>
          <Video className="w-3.5 h-3.5"/> {live ? 'Join now' : 'Meeting link'}
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss"
        className="w-7 h-7 rounded-full grid place-items-center flex-shrink-0 hover:opacity-70"
        style={{ color: C.faint }}>
        <X className="w-4 h-4"/>
      </button>
      {joinErr && <p className="w-full text-xs" style={{ color: '#ef4444', margin: 0 }}>{joinErr}</p>}
    </div>
  );
}
