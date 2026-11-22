'use client';

// My bootcamp: where a bootcamp student stands in their program. Four cards say where they stand
// (pace, due this week, awaiting a grade, their group), a row of week tiles picks a week, and the
// week's work follows as plain rows with one action each, the next step first.
// Data comes from /api/student/program; the week and status rules live in lib/student-program.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, RefreshCw, Route, Users, X } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { supabase } from '@/lib/supabase';
import { DARK_C, type LIGHT_C } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import { DISPLAY_FONT, Pill, btnSmClass, btnStyle, palette, type Tone } from '@/components/dashboard/subscriptions/ui';
import { DepthBar } from '@/components/student/learning-card';
import {
  buildProgramTimeline, dueDateKey, isCompleteStatus, localDateKey,
  type ProgramGroup, type ProgramItemType, type ProgramPayload, type ProgramTimeline, type ProgramWeek, type TimelineItem,
} from '@/lib/student-program';

const GREEN = '#16a34a';
const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#14b8a6', '#ef4444', '#64748b'];

const TYPE_LABEL: Record<ProgramItemType, string> = {
  course: 'Course', virtual_experience: 'Virtual experience', assignment: 'Assignment',
  certification: 'Certification', event: 'Live session',
};

function formatDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function actionLabel(item: TimelineItem) {
  if (item.type === 'event') return item.status === 'upcoming' ? 'Join' : 'Open';
  switch (item.status) {
    case 'done': return 'Review';
    case 'awaiting': return 'View';
    case 'failed': return 'Retake';
    case 'progress': case 'overdue': return 'Continue';
    default: return 'Start';
  }
}

// A week, or 'all' for a program with no dates at all (no weeks to show).
type WeekKey = number | 'all';

/**
 * `coursesLocked` mirrors My Learning: while a payment is outstanding the courses cannot be opened,
 * so they stay on the journey (they are still part of the program) but show as locked. A student
 * moved to the outstanding-payments cohort has the rest of their work locked by the route too.
 */
export function MyProgramSection({ C, coursesLocked = false }: { C: typeof LIGHT_C; coursesLocked?: boolean }) {
  const [payload, setPayload] = useState<ProgramPayload | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [today, setToday] = useState(() => localDateKey());

  // Overdue and the current week are date-based; keep them right in a tab left open past midnight.
  useEffect(() => {
    const refresh = () => setToday(localDateKey());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/student/program', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json() as ProgramPayload;
        if (!cancelled) setPayload(json);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const view = useMemo(() => {
    if (!payload) return null;
    const withLocks = coursesLocked
      ? { ...payload, items: payload.items.map(i => i.type === 'course' ? { ...i, locked: true } : i) }
      : payload;
    return { payload: withLocks, timeline: buildProgramTimeline(withLocks, today) };
  }, [payload, coursesLocked, today]);

  if (error) {
    return (
      <EmptyState icon={Route} title="Could not load your program" body="Check your connection and try again."
        action={
          <button onClick={() => { setPayload(null); setReloadKey(k => k + 1); }}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl"
            style={{ background: C.cta, color: C.ctaText }}>
            <RefreshCw className="w-4 h-4"/> Try again
          </button>
        }/>
    );
  }
  if (!view) return <ProgramSkeleton C={C}/>;
  if (!view.payload.cohort) {
    return <EmptyState icon={Route} title="No program yet" body="Your program will show here once you join a cohort."/>;
  }

  return <ProgramView payload={view.payload} timeline={view.timeline} C={C}/>;
}

function ProgramView({ payload, timeline, C }: { payload: ProgramPayload; timeline: ProgramTimeline; C: typeof LIGHT_C }) {
  const cohort = payload.cohort!;
  const P = palette(C);
  const { weeks, currentWeek, phase, anytime } = timeline;
  // The week in view starts on the current one (clamped onto the program), else the first. Work with
  // no deadline is placed on a week, so there is no separate undated list; only a program with no
  // dates at all shows its work as one plain list.
  const homeWeek: WeekKey = currentWeek && weeks.length
    ? Math.min(currentWeek, weeks.length)
    : weeks.length ? 1 : 'all';
  const [sel, setSel] = useState<WeekKey>(homeWeek);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  const closeGroup = useCallback(() => { setGroupOpen(false); groupButtonRef.current?.focus(); }, []);

  const days = (n: number) => plural(n, 'day');
  const heading = phase === 'before' && timeline.daysUntilStart !== null ? `Starts in ${days(timeline.daysUntilStart)}`
    : phase === 'after' ? 'Program complete'
    : phase === 'catch_up' ? 'Catch-up period'
    : currentWeek ? (timeline.hasEndDate ? `Week ${currentWeek} of ${weeks.length}` : `Week ${currentWeek}`)
    : null;
  const daysNote = phase === 'catch_up' && timeline.daysLeft !== null ? `${days(timeline.daysLeft)} left to catch up`
    : phase === 'during' && timeline.daysLeft !== null ? `${days(timeline.daysLeft)} ${timeline.catchUpEndDate ? 'of classes ' : ''}left`
    : null;
  const where = [heading, daysNote].filter(Boolean).join(', ');

  const remaining = timeline.required - timeline.completed;
  const doneLine = timeline.required > 0 ? `${timeline.completed} of ${timeline.required} done` : 'Nothing assigned yet';
  const pace: { value: string; tone: 'good' | 'warn' | null; sub: string } = timeline.behind > 0
    ? { value: 'Behind', tone: 'warn', sub: `${plural(timeline.behind, 'thing')} ${timeline.behind === 1 ? 'needs' : 'need'} your attention` }
    : (phase === 'catch_up' || phase === 'after') && remaining > 0 ? { value: 'Catch up', tone: 'warn', sub: `${plural(remaining, 'item')} left to finish` }
    : phase === 'before' ? { value: 'Not started', tone: null, sub: doneLine }
    : { value: remaining === 0 && timeline.required > 0 ? 'All caught up' : 'On track', tone: 'good', sub: doneLine };

  // What is still open in the current week, and what is waiting on a grade anywhere.
  const thisWeek = typeof homeWeek === 'number' ? weeks[homeWeek - 1]?.items ?? [] : anytime;
  const due = thisWeek.filter(i => i.type !== 'event' && !isCompleteStatus(i.status));
  const awaiting = [...weeks.flatMap(w => w.items), ...anytime].filter(i => i.status === 'awaiting');
  const leads = payload.group?.members.filter(m => m.isLeader && !m.isYou) ?? [];

  const card = 'rounded-2xl p-4 min-w-0 text-left';
  const value = 'text-[22px] sm:text-[26px] leading-8 font-semibold truncate';
  const label = 'text-[13px] font-semibold mt-1';
  const sub = 'text-xs mt-0.5 truncate';

  return (
    <div className="max-w-6xl">
      <h1 className="text-[28px] leading-9 font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>My bootcamp</h1>
      <p className="text-sm mt-1" style={{ color: C.muted }}>{cohort.name}{where ? `. ${where}.` : ''}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        <div className={card} style={{ background: C.card }}>
          <p className={value} style={{ color: pace.tone ? P[pace.tone] : C.text, fontFamily: DISPLAY_FONT }}>{pace.value}</p>
          <p className={label} style={{ color: C.text }}>Your pace</p>
          <p className={sub} style={{ color: C.muted }}>{pace.sub}</p>
        </div>
        <div className={card} style={{ background: C.card }}>
          <p className={`${value} tabular-nums`} style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{due.length}</p>
          <p className={label} style={{ color: C.text }}>Due this week</p>
          <p className={sub} style={{ color: C.muted }}>
            {due[0] ? `${due[0].title}${due[0].dueDate ? `, ${formatDay(due[0].dueDate)}` : ''}` : 'Nothing left this week'}
          </p>
        </div>
        <div className={card} style={{ background: C.card }}>
          <p className={`${value} tabular-nums`} style={{ color: awaiting.length ? P.warn : C.text, fontFamily: DISPLAY_FONT }}>{awaiting.length}</p>
          <p className={label} style={{ color: C.text }}>Awaiting a grade</p>
          <p className={sub} style={{ color: C.muted }}>{awaiting[0]?.title ?? 'Nothing waiting'}</p>
        </div>
        {payload.group ? (
          <button ref={groupButtonRef} type="button" onClick={() => setGroupOpen(true)} aria-haspopup="dialog"
            className={`${card} transition-transform hover:-translate-y-px`} style={{ background: C.card }}>
            <p className={value} style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{payload.group.name}</p>
            <p className={label} style={{ color: C.text }}>Your group</p>
            <p className={sub} style={{ color: C.muted }}>
              {leads.length ? `With ${leads[0].name} (lead)` : plural(payload.group.members.length, 'member')}
            </p>
          </button>
        ) : (
          <div className={card} style={{ background: C.card }}>
            <p className={value} style={{ color: C.faint, fontFamily: DISPLAY_FONT }}>None yet</p>
            <p className={label} style={{ color: C.text }}>Your group</p>
            <p className={sub} style={{ color: C.muted }}>Your instructor adds you to one</p>
          </div>
        )}
      </div>

      {payload.items.some(i => i.locked) && (
        <p className="mt-4 text-[13px] font-medium px-4 py-3 rounded-xl" style={{ background: P.badSoft, color: P.bad }}>
          Some of your work is locked until your payment is up to date. It stays here so you can see what is coming.
        </p>
      )}

      {payload.items.length === 0 ? (
        <div className="mt-4 rounded-2xl" style={{ background: C.card }}>
          <EmptyState icon={Route} title="Nothing assigned yet" body="When your instructor assigns courses, projects and assignments to your cohort, they will show here."/>
        </div>
      ) : (
        <>
          {weeks.length > 0 && <WeekTiles weeks={weeks} currentWeek={currentWeek} sel={sel} onPick={setSel} C={C}/>}
          <WeekCard sel={sel} homeWeek={homeWeek} timeline={timeline} C={C}/>
        </>
      )}

      <AnimatePresence>
        {groupOpen && payload.group && <GroupModal group={payload.group} C={C} onClose={closeGroup}/>}
      </AnimatePresence>
    </div>
  );
}

// --- Week tiles ---

function WeekTiles({ weeks, currentWeek, sel, onPick, C }: {
  weeks: ProgramWeek[]; currentWeek: number | null; sel: WeekKey; onPick: (w: WeekKey) => void; C: typeof LIGHT_C;
}) {
  const P = palette(C);
  const rowRef = useRef<HTMLDivElement>(null);
  // Keep the chosen week in view when the row scrolls sideways (long programs, phones).
  useEffect(() => {
    const row = rowRef.current;
    const tile = row?.querySelector<HTMLElement>(`[data-week="${sel}"]`);
    if (row && tile) row.scrollLeft = tile.offsetLeft - row.clientWidth / 2 + tile.offsetWidth / 2;
  }, [sel]);

  return (
    <section className="mt-4 rounded-2xl p-4 sm:p-5" style={{ background: C.card }} aria-label="Weeks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: C.text }}>Weeks</h2>
        <p className="text-xs" style={{ color: C.muted }}>Tap a week to see its work</p>
      </div>
      <div ref={rowRef} className="flex gap-1.5 overflow-x-auto py-1 mt-2.5 px-1 -mx-1" style={{ scrollbarWidth: 'none' }}>
        {weeks.map(week => {
          const w = week.week;
          const full = week.required > 0 && week.completed === week.required;
          const now = w === currentWeek;
          const late = !now && week.hasOverdue;
          const on = w === sel;
          const look = now ? { background: DARK_C.cta, color: '#ffffff' }
            : late ? { background: P.warnSoft, color: P.warn }
            : full ? { background: P.goodSoft, color: P.good }
            : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` };
          const text = `${week.completed} of ${week.required} done${late ? ', past due work' : ''}`;
          return (
            <button key={w} type="button" data-week={w} onClick={() => onPick(w)} aria-pressed={on} title={text}
              aria-label={`Week ${w}, from ${formatDay(week.startDate)}, ${text}${now ? ', this week' : ''}`}
              className="min-w-11 h-11 px-2 rounded-xl grid place-items-center text-[13px] font-bold tabular-nums flex-shrink-0 transition-transform hover:-translate-y-px"
              style={{ ...look, ...(on ? { boxShadow: `0 0 0 2px ${C.card}, 0 0 0 4px ${DARK_C.cta}` } : null) }}>
              {w}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// --- Week card ---

type Filter = 'all' | 'todo' | 'done';
const FILTER_LABEL: Record<Filter, string> = { all: 'All', todo: 'To do', done: 'Done' };
const isFinished = (item: TimelineItem) => isCompleteStatus(item.status) || item.status === 'attended';
// A missed live session sits in All only.
const inFilter = (item: TimelineItem, f: Filter) =>
  f === 'all' || (f === 'done' ? isFinished(item) : !isFinished(item) && item.status !== 'missed');

// The soft surface for rows inside the card: a light tint of the platform's pill grey.
const soft = (C: typeof LIGHT_C) => `color-mix(in srgb, ${C.pill} 55%, ${C.card})`;

function WeekCard({ sel, homeWeek, timeline, C }: { sel: WeekKey; homeWeek: WeekKey; timeline: ProgramTimeline; C: typeof LIGHT_C }) {
  const { weeks, currentWeek, phase, upNext, anytime } = timeline;
  const [filter, setFilter] = useState<Filter>('all');
  const week = typeof sel === 'number' ? weeks[sel - 1] : null;
  const list = week ? week.items : anytime;
  // The one next step leads the current week, even when it belongs to an earlier one.
  const focus = sel === homeWeek && phase !== 'before' && upNext ? upNext : null;
  // The week's own work, then deadline-free work running through it (counted in a later week).
  const entries: { item: TimelineItem; ongoing: boolean }[] = [
    ...list.map(item => ({ item, ongoing: false })),
    ...(week ? week.ongoing : []).map(item => ({ item, ongoing: true })),
  ];
  if (focus && !entries.some(e => e.item === focus)) entries.unshift({ item: focus, ongoing: false });
  // Next step first, then what still needs doing, then finished work.
  const rank = (i: TimelineItem) => i === focus ? 0 : isFinished(i) ? 2 : 1;
  const shown = entries.filter(e => inFilter(e.item, filter)).sort((a, b) => rank(a.item) - rank(b.item));
  const required = week ? week.required : list.filter(i => i.type !== 'event').length;
  const done = week ? week.completed : list.filter(i => i.type !== 'event' && isCompleteStatus(i.status)).length;
  const allDone = !!week && required > 0 && done === required;

  return (
    <section className="mt-4 rounded-2xl p-4 sm:p-5" style={{ background: C.card }} aria-labelledby="week-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <h2 id="week-title" className="text-base font-semibold" style={{ color: C.text }}>{week ? `Week ${week.week}` : 'Your work'}</h2>
          {(required > 0 || !week) && (
            <p className="text-xs mt-0.5 tabular-nums" style={{ color: C.muted }}>
              {week ? `${done} of ${required} done` : `This program has no dates yet${required ? `, ${done} of ${required} done` : ''}`}
            </p>
          )}
        </div>
        {entries.length > 0 && (
          <div className="flex gap-2" role="group" aria-label="Show">
            {(['all', 'todo', 'done'] as const).map(key => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className="h-9 px-3.5 rounded-[10px] text-[13px] font-semibold transition-colors"
                style={filter === key ? { background: C.text, color: C.card } : { background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 mt-3">
        {filter === 'all' && allDone && currentWeek && typeof sel === 'number' && sel < currentWeek && (
          <div className="text-center px-4 py-4 rounded-xl" style={{ background: soft(C) }}>
            <p className="text-[15px] font-bold" style={{ color: C.text }}>Week {sel} complete</p>
            <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>You finished everything planned for this week.</p>
          </div>
        )}
        {shown.map(e => <ItemRow key={`${e.ongoing ? 'ongoing-' : ''}${e.item.type}-${e.item.id}`} item={e.item} ongoing={e.ongoing} first={e.item === focus} C={C}/>)}
        {shown.length === 0 && (
          <div className="text-center px-4 py-5 rounded-xl" style={{ background: soft(C) }}>
            <p className="text-[15px] font-bold" style={{ color: C.text }}>{filter === 'all' ? 'Nothing planned' : filter === 'done' ? 'Nothing done yet' : 'Nothing to do'}</p>
            <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>{filter === 'all' ? 'No work is scheduled for this week.' : 'Nothing in this group for this week.'}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ItemLink({ item, className, style, children, label }: {
  item: TimelineItem; className?: string; style?: React.CSSProperties; children: React.ReactNode; label?: string;
}) {
  // Assignments live inside the dashboard; courses, projects and sessions open their own player,
  // matching how the rest of the dashboard links them.
  const external = item.type !== 'assignment';
  return (
    <a href={item.href} aria-label={label} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className={className} style={style}>
      {children}
    </a>
  );
}

/** "Course, due Fri, Nov 28": the type, the date that matters, and how it sits in the week. */
function itemMeta(item: TimelineItem, ongoing: boolean) {
  const parts: string[] = [TYPE_LABEL[item.type]];
  if (item.dueDate) parts.push(item.type === 'event' ? formatDay(item.dueDate) : item.status === 'overdue' ? `was due ${formatDay(item.dueDate)}` : `due ${formatDay(item.dueDate)}`);
  const assigned = dueDateKey(item.assignedAt);
  if (!item.dueDate && assigned) parts.push(`assigned ${formatDay(assigned)}`);
  if (item.recurring) parts.push('repeats');
  if (ongoing) parts.push(isCompleteStatus(item.status) && item.week ? `finished week ${item.week}` : 'ongoing');
  else if (item.carriedFrom) parts.push(`from week ${item.carriedFrom}`);
  if (item.type === 'event') parts.push('not counted toward progress');
  return parts.join(', ');
}

/** The pill beside a row, or null where the bar or the action already says it. */
function statusPill(item: TimelineItem): { label: string; tone: Tone } | null {
  if (item.locked) return { label: 'Locked', tone: 'mute' };
  switch (item.status) {
    case 'done': return { label: 'Completed', tone: 'good' };
    case 'attended': return { label: 'Attended', tone: 'good' };
    case 'awaiting': return { label: 'Awaiting grade', tone: 'warn' };
    case 'failed': return { label: 'Not passed', tone: 'bad' };
    case 'overdue': return { label: 'Past due', tone: 'bad' };
    case 'missed': return { label: 'Missed', tone: 'mute' };
    case 'todo': return { label: 'Not started', tone: 'mute' };
    default: return null;
  }
}

const TYPE_TINT: Record<ProgramItemType, string> = {
  course: '#0ea5e9', virtual_experience: '#14b8a6', assignment: '#f59e0b', certification: '#16a34a', event: '#64748b',
};

// The content's real cover; a tinted tile with its initial when there is none (or it fails to load).
function Thumb({ item, C }: { item: TimelineItem; C: typeof LIGHT_C }) {
  const [broken, setBroken] = useState(false);
  const src = item.coverImage && !broken ? resolveCoverUrl(item.coverImage) : null;
  const tint = TYPE_TINT[item.type];
  return (
    <span className="relative w-11 h-11 flex-shrink-0 rounded-[10px] overflow-hidden" style={{ background: `color-mix(in srgb, ${tint} 18%, ${C.card})` }}>
      {src
        ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover"/>
        : <span className="absolute inset-0 grid place-items-center text-[15px] font-bold" style={{ color: tint }}>{item.title.trim().charAt(0).toUpperCase()}</span>}
    </span>
  );
}

/** `ongoing`: shown in a week it runs through but is not counted in (see ProgramWeek.ongoing). */
function ItemRow({ item, ongoing, first, C }: { item: TimelineItem; ongoing: boolean; first: boolean; C: typeof LIGHT_C }) {
  const finished = !ongoing && isFinished(item);
  const pill = statusPill(item);
  const showBar = !finished && !item.locked && (item.status === 'progress' || item.status === 'overdue') && item.progressPct > 0;
  // A graded-and-waiting item has nothing to do; its title still opens it.
  const showAction = !item.locked && item.status !== 'awaiting';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-xl" style={{ background: soft(C) }}>
      <Thumb item={item} C={C}/>
      <div className="min-w-0 flex-1 basis-[160px]">
        {first && <p className="text-xs font-semibold" style={{ color: DARK_C.cta }}>Start here</p>}
        <ItemLink item={item} className="block text-sm font-semibold truncate hover:underline" style={{ color: finished ? C.muted : C.text }}>{item.title}</ItemLink>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>{itemMeta(item, ongoing)}</p>
      </div>
      <div className="flex items-center gap-2.5 ml-auto">
        {showBar && (
          <span className="hidden sm:flex items-center gap-2">
            <DepthBar pct={item.progressPct} done={false} C={C} className="h-1.5 w-[120px]"/>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: C.muted }}>{item.progressPct}%</span>
          </span>
        )}
        {pill && (!showBar || item.status === 'overdue') && <Pill tone={pill.tone} C={C}>{pill.label}</Pill>}
        {item.locked && <Lock className="w-4 h-4" style={{ color: C.faint }} aria-hidden/>}
        {showAction && (
          <ItemLink item={item} label={`${actionLabel(item)} ${item.title}`} className={`${btnSmClass} h-9 px-3.5 text-[13px]`}
            style={first ? { background: DARK_C.cta, color: '#ffffff' } : btnStyle('sec', C)}>
            {actionLabel(item)}
          </ItemLink>
        )}
      </div>
    </div>
  );
}

// --- Group ---

function Avatar({ member, index, size }: { member: ProgramGroup['members'][number]; index: number; size: number }) {
  const initials = member.name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const [broken, setBroken] = useState(false);
  if (member.avatarUrl && !broken) {
    return <img src={member.avatarUrl} alt="" onError={() => setBroken(true)} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }}/>;
  }
  return (
    <span className="rounded-full grid place-items-center font-extrabold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36, background: AVATAR_COLORS[index % AVATAR_COLORS.length], color: '#ffffff' }}>
      {initials || '?'}
    </span>
  );
}

function GroupModal({ group, C, onClose }: { group: ProgramGroup; C: typeof LIGHT_C; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    // Close is the dialog's only control, so Tab stays on it rather than reaching the page behind.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    // Stop the dashboard scrolling behind the dialog on phones.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const leaders = group.members.filter(m => m.isLeader);
  const members = group.members.filter(m => !m.isLeader);
  const row = (m: ProgramGroup['members'][number]) => (
    <div key={m.id} className="flex items-center gap-3 px-2.5 py-2 rounded-xl min-w-0" style={{ background: m.isLeader ? C.lime : 'transparent' }}>
      <Avatar member={m} index={group.members.indexOf(m)} size={36}/>
      <span className="flex-1 min-w-0 text-sm font-bold truncate" style={{ color: C.text }}>{m.name}</span>
      {m.isYou && <span className="text-xs font-semibold" style={{ color: C.faint }}>You</span>}
      {m.isLeader && <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: GREEN, color: '#ffffff' }}>Leader</span>}
    </div>
  );

  return createPortal(
    <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(10,12,18,0.45)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="my-group-title"
        className="w-full max-w-[440px] max-h-[85vh] overflow-y-auto rounded-2xl p-5"
        style={{ background: C.card }}
        initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: C.lime, color: C.cta }}><Users className="w-5 h-5"/></span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.cta }}>My Group</p>
            <h2 id="my-group-title" className="text-lg font-bold leading-tight break-words" style={{ color: C.text }}>{group.name}</h2>
            <p className="text-[13px] mt-0.5 tabular-nums" style={{ color: C.muted }}>
              {group.members.length} member{group.members.length === 1 ? '' : 's'}
              {leaders.length > 0 && `, ${leaders.length} leader${leaders.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
            className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ background: C.pill, color: C.muted }}>
            <X className="w-4 h-4"/>
          </button>
        </div>
        {group.description && <p className="text-[13px] mt-3" style={{ color: C.muted }}>{group.description}</p>}
        {leaders.length > 0 && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest mt-5 mb-2" style={{ color: C.faint }}>Leaders</p>
            <div className="space-y-1.5">{leaders.map(row)}</div>
          </>
        )}
        {members.length > 0 && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest mt-5 mb-2" style={{ color: C.faint }}>Members</p>
            <div className="space-y-1">{members.map(row)}</div>
          </>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function ProgramSkeleton({ C }: { C: typeof LIGHT_C }) {
  return (
    <div className="max-w-6xl space-y-4">
      <div className="space-y-2"><Sk w={220} h={32}/><Sk w={320} h={14}/></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Sk key={i} h={96} r={16}/>)}</div>
      <Sk h={96} r={16}/>
      <div className="rounded-2xl p-5 space-y-2.5" style={{ background: C.card }}><Sk w={120} h={18}/><Sk h={68} r={12}/><Sk h={68} r={12}/><Sk h={68} r={12}/></div>
    </div>
  );
}
