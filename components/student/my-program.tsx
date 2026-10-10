'use client';

// My Program section: where a bootcamp student is in their program. Overall progress, pace against
// the cohort calendar, the most urgent next item, and a week-by-week journey through everything
// assigned to the cohort. The group button in the header opens a modal with the student's group.
// Data comes from /api/student/program; the week and status rules live in lib/student-program.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen, Briefcase, ClipboardList, Video, Users, X, Check, Clock, ArrowRight, Route, RefreshCw, CalendarClock, Lock,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import {
  buildProgramTimeline, countsTowardCompletion, dueDateKey, isCompleteStatus, localDateKey,
  type ProgramGroup, type ProgramItemType, type ProgramPayload, type ProgramStatus, type ProgramTimeline, type TimelineItem,
} from '@/lib/student-program';

const GREEN = '#16a34a';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const TEAL = '#14b8a6';
const GREY = '#94a3b8';

// `color` tells statuses apart on the dots, pips and legend. `chip` is the badge, kept to the house
// rule: positive states green with white text, overdue and not passed red, the rest neutral.
// null = neutral, drawn from theme tokens so it reads in both modes.
const STATUS_META: Record<ProgramStatus, { label: string; color: string | null; chip: string | null }> = {
  done:     { label: 'Done',           color: GREEN, chip: GREEN },
  awaiting: { label: 'Awaiting grade', color: TEAL,  chip: GREEN },
  progress: { label: 'In progress',    color: AMBER, chip: GREEN },
  overdue:  { label: 'Overdue',        color: RED,   chip: RED },
  failed:   { label: 'Not passed',     color: RED,   chip: RED },
  todo:     { label: 'Not started',    color: null,  chip: null },
  attended: { label: 'Attended',       color: GREEN, chip: GREEN },
  missed:   { label: 'Missed',         color: GREY,  chip: null },
  upcoming: { label: 'Upcoming',       color: null,  chip: null },
};

const TYPE_META: Record<ProgramItemType, { label: string; plural: string; Icon: typeof BookOpen }> = {
  course:             { label: 'Course',             plural: 'Courses',             Icon: BookOpen },
  virtual_experience: { label: 'Virtual Experience', plural: 'Virtual Experiences', Icon: Briefcase },
  assignment:         { label: 'Assignment',         plural: 'Assignments',         Icon: ClipboardList },
  certification:      { label: 'Certification',      plural: 'Certifications',      Icon: ShieldCheck },
  event:              { label: 'Live Session',       plural: 'Live Sessions',       Icon: Video },
};
const TYPE_ORDER: ProgramItemType[] = ['course', 'virtual_experience', 'assignment', 'certification', 'event'];

const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#14b8a6', '#ef4444', '#64748b'];

const statusColor = (s: ProgramStatus, C: typeof LIGHT_C) => STATUS_META[s].color ?? C.faint;

function formatDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function actionLabel(item: TimelineItem) {
  if (item.type === 'event') return 'Open';
  switch (item.status) {
    case 'done': return 'Review';
    case 'awaiting': return 'View';
    case 'failed': return 'Retake';
    case 'progress': case 'overdue': return 'Continue';
    default: return 'Start';
  }
}

type WeekKey = number | 'anytime';

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

  return <ProgramView payload={view.payload} timeline={view.timeline} coursesLocked={coursesLocked} C={C}/>;
}

function ProgramView({ payload, timeline, coursesLocked, C }: {
  payload: ProgramPayload; timeline: ProgramTimeline; coursesLocked: boolean; C: typeof LIGHT_C;
}) {
  const cohort = payload.cohort!;
  const [filter, setFilter] = useState<ProgramItemType | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  const closeGroup = useCallback(() => {
    setGroupOpen(false);
    groupButtonRef.current?.focus();
  }, []);

  const catchUpEnd = timeline.catchUpEndDate;
  const classesEnd = timeline.classesEndDate;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const withYear = (d: string) => `${formatDay(d)}, ${d.slice(0, 4)}`;
  const dateRange = cohort.startDate && catchUpEnd && classesEnd
    ? `Classes ${formatDay(cohort.startDate)} to ${withYear(classesEnd)}. Catch-up period until ${withYear(catchUpEnd)}.`
    : cohort.startDate && cohort.endDate
      ? `${formatDay(cohort.startDate)} to ${formatDay(cohort.endDate)}, ${cohort.endDate.slice(0, 4)}`
      : cohort.startDate ? `${timeline.phase === 'before' ? 'Starts' : 'Started'} ${formatDay(cohort.startDate)}` : null;

  const weekChip = timeline.phase === 'before' && timeline.daysUntilStart !== null
    ? `Starts in ${days(timeline.daysUntilStart)}`
    : timeline.phase === 'after' ? 'Program ended'
    : timeline.phase === 'catch_up'
      ? `Catch-up period${timeline.daysLeft !== null ? `, ${days(timeline.daysLeft)} left` : ''}`
    : timeline.phase === 'during' && timeline.currentWeek
      ? timeline.hasEndDate
        ? `Week ${timeline.currentWeek} of ${timeline.weeks.length}${timeline.daysLeft !== null
            ? `, ${days(timeline.daysLeft)} ${catchUpEnd ? 'of classes ' : ''}left` : ''}`
        : `Week ${timeline.currentWeek}`
      : null;

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.cta }}>My Program</p>
          <h1 className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight mt-0.5" style={{ color: C.text }}>{cohort.name}</h1>
          {dateRange && <p className="text-sm mt-1" style={{ color: C.muted }}>{dateRange}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {payload.group && <GroupButton ref={groupButtonRef} group={payload.group} C={C} onOpen={() => setGroupOpen(true)}/>}
          {weekChip && (
            <span className="text-xs font-semibold px-3 py-2 rounded-full tabular-nums" style={{ background: C.card, color: C.muted }}>
              {weekChip}
            </span>
          )}
        </div>
      </div>

      {payload.items.length === 0 ? (
        <div className="rounded-2xl" style={{ background: C.card }}>
          <EmptyState icon={Route} title="Nothing assigned yet" body="When your instructor assigns courses, projects and assignments to your cohort, they will show here."/>
        </div>
      ) : (
        <>
          {payload.items.some(i => i.locked) && (
            <p className="text-[13px] font-medium px-4 py-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
              Some of your work is locked until your payment is up to date. It stays on your journey so you can see what is coming.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <ProgressCard timeline={timeline} C={C}/>
            <PaceCard timeline={timeline} C={C}/>
            <UpNextCard item={timeline.upNext} C={C}/>
          </div>
          <TypeTiles items={payload.items} timeline={timeline} filter={filter} setFilter={setFilter} C={C}/>
          <Journey timeline={timeline} filter={filter} C={C}/>
        </>
      )}

      <AnimatePresence>
        {groupOpen && payload.group && <GroupModal group={payload.group} C={C} onClose={closeGroup}/>}
      </AnimatePresence>
    </div>
  );
}

// --- Summary cards ---

function Ring({ pct, size, stroke, color, track }: { pct: number; size: number; stroke: number; color: string; track: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke}/>
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }}
        transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}/>
    </svg>
  );
}

function CardTitle({ children, C }: { children: React.ReactNode; C: typeof LIGHT_C }) {
  return <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.faint }}>{children}</p>;
}

function ProgressCard({ timeline, C }: { timeline: ProgramTimeline; C: typeof LIGHT_C }) {
  const legend: ProgramStatus[] = ['done', 'awaiting', 'progress', 'overdue', 'failed', 'todo'];
  return (
    <section className="rounded-2xl p-5 flex flex-wrap items-center gap-5" style={{ background: C.card }}>
      <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
        <Ring pct={timeline.pct} size={128} stroke={12} color={GREEN} track={C.pill}/>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-3xl font-extrabold leading-none tabular-nums" style={{ color: C.text }}>{timeline.pct}%</p>
            <p className="text-[11px] mt-1" style={{ color: C.faint }}>complete</p>
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-[150px] space-y-1.5 text-[13px]">
        <p className="font-bold tabular-nums" style={{ color: C.text }}>{timeline.completed} of {timeline.required} items</p>
        {legend.filter(s => s !== 'failed' || timeline.statusCounts.failed > 0).map(s => (
          <div key={s} className="flex items-center gap-2" style={{ color: C.muted }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor(s, C) }}/>
            {STATUS_META[s].label}
            <span className="ml-auto font-bold tabular-nums" style={{ color: C.text }}>{timeline.statusCounts[s]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Bar({ label, pct, color, C }: { label: string; pct: number; color: string; C: typeof LIGHT_C }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[13px]" style={{ color: C.muted }}>
        <span>{label}</span><span className="font-bold tabular-nums" style={{ color: C.text }}>{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: C.pill }}>
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}/>
      </div>
    </div>
  );
}

function PaceCard({ timeline, C }: { timeline: ProgramTimeline; C: typeof LIGHT_C }) {
  const { behind, phase } = timeline;
  const catchUpEnd = timeline.catchUpEndDate;
  const remaining = timeline.required - timeline.completed;
  const verdict = phase === 'before'
    ? { text: 'Your program has not started yet. You can get a head start.', color: C.muted, bg: C.pill }
    : phase === 'catch_up' && catchUpEnd
      ? behind > 0
        ? { text: `Classes have ended. Finish ${behind} overdue item${behind === 1 ? '' : 's'} by ${formatDay(catchUpEnd)}.`, color: '#b45309', bg: 'rgba(245,158,11,0.12)' }
        : remaining > 0
          ? { text: `Classes have ended. ${remaining} item${remaining === 1 ? '' : 's'} left to finish by ${formatDay(catchUpEnd)}.`, color: '#b45309', bg: 'rgba(245,158,11,0.12)' }
          : { text: 'Classes have ended and you are all caught up.', color: GREEN, bg: 'rgba(22,163,74,0.10)' }
    : behind > 0
      ? { text: `${behind} item${behind === 1 ? '' : 's'} behind. Finish overdue work to get back on track.`, color: '#b45309', bg: 'rgba(245,158,11,0.12)' }
      : { text: 'You are on track. Keep going.', color: GREEN, bg: 'rgba(22,163,74,0.10)' };
  return (
    <section className="rounded-2xl p-5" style={{ background: C.card }}>
      <CardTitle C={C}>Your pace</CardTitle>
      <div className="space-y-3.5 mb-4">
        {timeline.timePct !== null && <Bar label="Class time passed" pct={timeline.timePct} color={GREY} C={C}/>}
        <Bar label="Your progress" pct={timeline.pct} color={GREEN} C={C}/>
      </div>
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold" style={{ background: verdict.bg, color: verdict.color }}>
        <Clock className="w-4 h-4 flex-shrink-0 mt-px"/>{verdict.text}
      </div>
    </section>
  );
}

function ItemLink({ item, className, style, children }: { item: TimelineItem; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  // Assignments live inside the dashboard; courses, projects and sessions open their own player,
  // matching how the rest of the dashboard links them.
  const external = item.type !== 'assignment';
  return (
    <a href={item.href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className={className} style={style}>
      {children}
    </a>
  );
}

function StatusChip({ status, locked, C }: { status: ProgramStatus; locked?: boolean; C: typeof LIGHT_C }) {
  const chip = locked ? null : STATUS_META[status].chip;
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap"
      style={{ background: chip ?? C.pill, color: chip ? '#ffffff' : C.muted }}>
      {locked ? 'Locked' : STATUS_META[status].label}
    </span>
  );
}

function UpNextCard({ item, C }: { item: TimelineItem | null; C: typeof LIGHT_C }) {
  return (
    <section className="rounded-2xl p-5 md:col-span-2 xl:col-span-1 flex flex-col" style={{ background: C.card }}>
      <CardTitle C={C}>Up next</CardTitle>
      {item ? (
        <>
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.cta }}>{TYPE_META[item.type].label}</p>
          <p className="text-base font-bold leading-snug mt-1 mb-2 line-clamp-2" style={{ color: C.text }}>{item.title}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs mb-4" style={{ color: C.muted }}>
            <StatusChip status={item.status} C={C}/>
            {item.dueDate && <span>Due {formatDay(item.dueDate)}</span>}
            {item.week && <span>Week {item.week}</span>}
          </div>
          <ItemLink item={item} className="mt-auto self-start inline-flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: C.cta, color: C.ctaText }}>
            {actionLabel(item)} <ArrowRight className="w-4 h-4"/>
          </ItemLink>
        </>
      ) : (
        <div className="flex items-center gap-3 text-sm" style={{ color: C.muted }}>
          <span className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{ background: GREEN, color: '#ffffff' }}><Check className="w-4 h-4"/></span>
          You are all caught up. New work will show here when it is assigned.
        </div>
      )}
    </section>
  );
}

// --- Type tiles (filter the journey) ---

function TypeTiles({ items, timeline, filter, setFilter, C }: {
  items: ProgramPayload['items']; timeline: ProgramTimeline; filter: ProgramItemType | null;
  setFilter: (t: ProgramItemType | null) => void; C: typeof LIGHT_C;
}) {
  const statusById = new Map([...timeline.weeks.flatMap(w => w.items), ...timeline.anytime].map(i => [i.id, i.status]));
  const types = TYPE_ORDER.filter(t => items.some(i => i.type === t));
  return (
    // auto-fit: as many columns as fit (two on a phone), whether the cohort has two types or five.
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {types.map(type => {
        const list = items.filter(i => i.type === type);
        const done = list.filter(i => {
          const s = statusById.get(i.id)!;
          return type === 'event' ? s === 'attended' : isCompleteStatus(s);
        }).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const on = filter === type;
        const { Icon, plural } = TYPE_META[type];
        return (
          <button key={type} onClick={() => setFilter(on ? null : type)} aria-pressed={on}
            className="rounded-2xl p-3.5 sm:px-4 flex items-center gap-3 text-left transition-transform hover:-translate-y-0.5 min-w-0"
            style={{ background: C.card, boxShadow: on ? `inset 0 0 0 2px ${C.cta}` : 'none' }}>
            <span className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: C.lime, color: C.cta }}>
              <Icon className="w-[18px] h-[18px]"/>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs leading-tight" style={{ color: C.faint }}>{plural}{type === 'event' ? ' attended' : ''}</span>
              <span className="block text-[17px] font-extrabold tabular-nums" style={{ color: C.text }}>{done}/{list.length}</span>
            </span>
            <span className="hidden sm:block flex-shrink-0"><Ring pct={pct} size={38} stroke={5} color={GREEN} track={C.pill}/></span>
          </button>
        );
      })}
    </div>
  );
}

// --- Journey ---

function Journey({ timeline, filter, C }: { timeline: ProgramTimeline; filter: ProgramItemType | null; C: typeof LIGHT_C }) {
  const { weeks, anytime, phase } = timeline;
  // Without an end date the calendar can run past the last dated week; the trail stops there.
  const currentWeek = timeline.currentWeek !== null && timeline.currentWeek <= weeks.length ? timeline.currentWeek : null;
  const lastWeekPassed = timeline.currentWeek !== null && timeline.currentWeek > weeks.length;
  const initial: WeekKey = currentWeek ?? (weeks.length ? (lastWeekPassed ? weeks.length : 1) : 'anytime');
  const [selected, setSelected] = useState<WeekKey>(initial);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<WeekKey, HTMLButtonElement>());

  // Bring the current week into view inside the trail without scrolling the page.
  useEffect(() => {
    const box = scrollRef.current;
    const node = nodeRefs.current.get(initial);
    if (box && node) box.scrollLeft = node.offsetLeft - box.clientWidth / 2 + node.offsetWidth / 2;
  }, [initial]);

  const columns = weeks.length + (anytime.length ? 1 : 0);
  const lastComplete = weeks.findIndex(w => !(w.required > 0 && w.completed === w.required));
  const completedRun = lastComplete === -1 ? weeks.length : lastComplete;
  const pctAlong = (w: number) => (weeks.length > 1 ? ((w - 1) / (weeks.length - 1)) * 100 : 0);

  const panelItems = (selected === 'anytime' ? anytime : weeks[selected - 1]?.items ?? [])
    .filter(i => !filter || i.type === filter);
  const selectedWeek = selected === 'anytime' ? null : weeks[selected - 1];

  return (
    <section className="rounded-2xl p-5" style={{ background: C.card }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: C.text }}>Your journey</h2>
          <p className="text-[13px]" style={{ color: C.muted }}>
            {weeks.length ? 'Each circle is a week. Tap one to see what is due.' : 'Your program has no dates yet, so everything is listed together.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: C.muted }}>
          {(['done', 'progress', 'awaiting', 'overdue', 'todo'] as ProgramStatus[]).map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: statusColor(s, C) }}/>{STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {columns > 0 && weeks.length > 0 && (
        <div ref={scrollRef} className="overflow-x-auto pt-6 pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))`, minWidth: columns * 76 }}>
            {/* Rail from the first week's centre to the last week's; Any time sits after it. */}
            <div className="absolute h-1.5 rounded-full" style={{
              top: 25, left: `${50 / columns}%`,
              width: `${((weeks.length - 1) / columns) * 100}%`,
              background: C.pill,
            }}>
              <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: GREEN }}
                initial={{ width: 0 }} animate={{ width: `${completedRun > 0 ? pctAlong(completedRun) : 0}%` }}
                transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}/>
              {phase === 'during' && currentWeek && (
                <span className="absolute -top-5 -translate-x-1/2 text-[10px] font-bold tracking-wider whitespace-nowrap"
                  style={{ left: `${pctAlong(currentWeek)}%`, color: C.cta }}>TODAY</span>
              )}
            </div>

            {weeks.map(w => {
              const complete = w.required > 0 && w.completed === w.required;
              const isCurrent = w.week === currentWeek && phase === 'during';
              const isSel = selected === w.week;
              const fill = w.required ? w.completed / w.required : 0;
              return (
                <div key={w.week} className="flex flex-col items-center gap-2">
                  <WeekNode
                    ref={el => { if (el) nodeRefs.current.set(w.week, el); }}
                    label={complete ? <Check className="w-5 h-5"/> : String(w.week)}
                    ariaLabel={`Week ${w.week}, ${w.completed} of ${w.required} done`}
                    fill={fill} complete={complete} isCurrent={isCurrent} isSel={isSel} hasOverdue={w.hasOverdue}
                    onClick={() => setSelected(w.week)} C={C}/>
                  <span className="text-[11px] tabular-nums" style={{ color: isCurrent ? C.cta : C.faint }}>{formatDay(w.startDate)}</span>
                  <Pips items={w.items} filter={filter} C={C}/>
                </div>
              );
            })}

            {anytime.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <WeekNode
                  ref={el => { if (el) nodeRefs.current.set('anytime', el); }}
                  label={<CalendarClock className="w-5 h-5"/>} ariaLabel="Items with no due date"
                  fill={0} complete={false} isCurrent={false} isSel={selected === 'anytime'} hasOverdue={false}
                  onClick={() => setSelected('anytime')} C={C}/>
                <span className="text-[11px]" style={{ color: C.faint }}>Any time</span>
                <Pips items={anytime} filter={filter} C={C}/>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4" style={{ borderTop: weeks.length ? `1px solid ${C.divider}` : 'none' }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            {selectedWeek && (
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.cta }}>
                {phase === 'during' && selectedWeek.week === currentWeek ? 'This week'
                  : phase === 'after' || phase === 'catch_up' || lastWeekPassed || (currentWeek && selectedWeek.week < currentWeek) ? 'Past week' : 'Coming up'}
              </p>
            )}
            <h3 className="text-base font-bold" style={{ color: C.text }}>
              {selectedWeek ? `Week ${selectedWeek.week}, from ${formatDay(selectedWeek.startDate)}` : 'Any time'}
            </h3>
          </div>
          {selectedWeek
            ? <span className="text-[13px] tabular-nums" style={{ color: C.muted }}>{selectedWeek.completed} of {selectedWeek.required} required items done</span>
            : <span className="text-[13px]" style={{ color: C.muted }}>No due or assigned date</span>}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={`${selected}-${filter ?? 'all'}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="space-y-2">
            {panelItems.length
              ? panelItems.map(item => <ItemRow key={`${item.type}-${item.id}`} item={item} C={C}/>)
              : <p className="text-sm text-center py-6" style={{ color: C.faint }}>
                  {filter ? `No ${TYPE_META[filter].plural.toLowerCase()} in this week.` : 'Nothing is due this week.'}
                </p>}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

type WeekNodeProps = {
  label: React.ReactNode; ariaLabel: string; fill: number; complete: boolean; isCurrent: boolean;
  isSel: boolean; hasOverdue: boolean; onClick: () => void; C: typeof LIGHT_C;
  ref?: React.Ref<HTMLButtonElement>;
};

function WeekNode({ label, ariaLabel, fill, complete, isCurrent, isSel, hasOverdue, onClick, C, ref }: WeekNodeProps) {
  const r = 25;
  const circ = 2 * Math.PI * r;
  return (
    <button ref={ref} onClick={onClick} aria-label={ariaLabel} aria-pressed={isSel}
      className="relative w-14 h-14 rounded-full grid place-items-center text-[15px] font-extrabold transition-transform hover:scale-105 z-[1]"
      style={{
        background: complete ? GREEN : C.card,
        color: complete ? '#ffffff' : isCurrent ? C.text : C.muted,
        boxShadow: isSel ? `0 0 0 4px ${C.card}, 0 0 0 6px ${C.cta}` : `0 0 0 4px ${C.card}`,
        transform: isSel ? 'scale(1.08)' : undefined,
      }}>
      {!complete && (
        <svg className="absolute inset-0" width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
          <circle cx="28" cy="28" r={r} fill="none" stroke={C.pill} strokeWidth="5"/>
          {fill > 0 && <circle cx="28" cy="28" r={r} fill="none" stroke={isCurrent ? C.cta : GREEN} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - fill)}/>}
        </svg>
      )}
      <span className="relative">{label}</span>
      {hasOverdue && (
        <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full grid place-items-center text-[11px] font-bold"
          style={{ background: RED, color: '#ffffff', boxShadow: `0 0 0 2px ${C.card}` }} aria-hidden>!</span>
      )}
    </button>
  );
}

function Pips({ items, filter, C }: { items: TimelineItem[]; filter: ProgramItemType | null; C: typeof LIGHT_C }) {
  return (
    <div className="flex flex-wrap justify-center gap-[3px] max-w-[60px] min-h-2">
      {items.map(i => (
        <span key={`${i.type}-${i.id}`} title={i.title} className="w-2 h-2 rounded-[3px] transition-opacity"
          style={{ background: statusColor(i.status, C), opacity: filter && i.type !== filter ? 0.18 : 1 }}/>
      ))}
    </div>
  );
}

function ItemRow({ item, C }: { item: TimelineItem; C: typeof LIGHT_C }) {
  const { Icon, label } = TYPE_META[item.type];
  const color = STATUS_META[item.status].color;
  const quiet = item.status === 'done' || item.status === 'awaiting' || item.type === 'event';
  const showProgress = (item.status === 'progress' || item.status === 'overdue') && item.progressPct > 0;
  const assigned = dueDateKey(item.assignedAt);
  return (
    <div className="grid grid-cols-[40px_1fr] sm:grid-cols-[40px_1fr_auto] items-center gap-x-3.5 gap-y-2 p-3 rounded-xl" style={{ background: C.page }}>
      <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: C.card, color: color ?? C.muted }}>
        <Icon className="w-[18px] h-[18px]"/>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: C.text }}>{item.title}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs mt-1" style={{ color: C.faint }}>
          <span>{label}</span>
          {item.dueDate && <span>{item.type === 'event' ? formatDay(item.dueDate) : `Due ${formatDay(item.dueDate)}`}</span>}
          {item.recurring && <span>Repeats</span>}
          {!item.dueDate && assigned && <span>Assigned {formatDay(assigned)}</span>}
          {item.carriedFrom && <span className="font-semibold" style={{ color: AMBER }}>From Week {item.carriedFrom}</span>}
          {showProgress && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: C.pill }}>
                <span className="block h-full" style={{ width: `${item.progressPct}%`, background: AMBER }}/>
              </span>
              <span className="tabular-nums">{item.progressPct}%</span>
            </span>
          )}
          {!countsTowardCompletion(item) && <span>Not counted toward completion</span>}
        </div>
      </div>
      <div className="col-start-2 sm:col-start-auto flex items-center gap-2.5">
        <StatusChip status={item.status} locked={item.locked} C={C}/>
        {item.locked
          ? <Lock className="w-4 h-4 mx-2" style={{ color: C.faint }} aria-label="Locked"/>
          : (
            <ItemLink item={item} className="text-[13px] font-bold px-3.5 py-2 rounded-xl transition-opacity hover:opacity-90"
              style={quiet ? { background: C.pill, color: C.text } : { background: C.cta, color: C.ctaText }}>
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

function GroupButton({ group, C, onOpen, ref }: {
  group: ProgramGroup; C: typeof LIGHT_C; onOpen: () => void; ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={ref} onClick={onOpen} aria-haspopup="dialog"
      className="inline-flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-full text-[13px] font-bold transition-transform hover:-translate-y-px max-w-full min-w-0"
      style={{ background: C.card, color: C.text }}>
      <span className="flex items-center pl-2">
        {group.members.slice(0, 3).map((m, i) => (
          <span key={m.id} className="-ml-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${C.card}` }}><Avatar member={m} index={i} size={26}/></span>
        ))}
        {group.members.length === 0 && <Users className="w-4 h-4" style={{ color: C.cta }}/>}
      </span>
      <span className="truncate min-w-0">{group.name}</span>
    </button>
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
    <div className="space-y-4 max-w-6xl">
      <div className="space-y-2"><Sk w={90} h={10}/><Sk w={280} h={26}/><Sk w={160} h={12}/></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="rounded-2xl p-5 space-y-3" style={{ background: C.card }}><Sk w="40%" h={10}/><Sk h={90}/></div>)}
      </div>
      <div className="rounded-2xl p-5 space-y-3" style={{ background: C.card }}><Sk w={140} h={16}/><Sk h={110}/></div>
    </div>
  );
}
