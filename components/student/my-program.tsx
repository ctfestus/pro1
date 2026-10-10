'use client';

// My Program: completion and the next action lead, with a compact week selector beneath.
// Dates, locks, ongoing work and progress still come from the shared timeline contract.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react';
import {
  ArrowLeft, ArrowRight, BookOpen, BriefcaseBusiness, CalendarDays, Check, ChevronRight,
  ClipboardList, Lock, RefreshCw, Route, ShieldCheck, Users, X, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { useTheme } from '@/components/ThemeProvider';
import { Sk, EmptyState } from '@/components/student/shared';
import {
  buildProgramTimeline, dueDateKey, isCompleteStatus, localDateKey,
  type ProgramGroup, type ProgramItemType, type ProgramPayload, type ProgramTimeline,
  type ProgramWeek, type TimelineItem,
} from '@/lib/student-program';

const ATTN_SOFT = 'rgba(245,158,11,0.13)';
const useAttnInk = () => (useTheme().theme === 'dark' ? '#fbbf24' : '#92400e');
const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#14b8a6', '#ef4444', '#64748b'];

const TYPE_META: Record<ProgramItemType, { label: string; Icon: LucideIcon }> = {
  course: { label: 'Course', Icon: BookOpen },
  virtual_experience: { label: 'Virtual Experience', Icon: BriefcaseBusiness },
  assignment: { label: 'Assignment', Icon: ClipboardList },
  certification: { label: 'Certification', Icon: ShieldCheck },
  event: { label: 'Live Session', Icon: CalendarDays },
};

function formatDay(date: string) {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
const completedItem = (item: TimelineItem) => isCompleteStatus(item.status) || item.status === 'attended';

function actionLabel(item: TimelineItem) {
  if (item.type === 'event') return 'Open';
  if (item.status === 'done') return 'Review';
  if (item.status === 'awaiting') return 'View';
  if (item.status === 'failed') return 'Retake';
  return item.baseStatus === 'in_progress' ? 'Continue' : 'Start';
}

type WeekKey = number | 'all';
type WorkFilter = 'all' | 'todo' | 'completed';

/**
 * `coursesLocked` mirrors My Learning: while a payment is outstanding the courses cannot be opened,
 * so they stay on the journey (they are still part of the program) but show as locked. A student
 * moved to the outstanding-payments cohort has the rest of their work locked by the route too.
 */
export function MyProgramSection({ C, coursesLocked = false, studentName = null }: {
  C: typeof LIGHT_C; coursesLocked?: boolean; studentName?: string | null;
}) {
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

  return <ProgramView payload={view.payload} timeline={view.timeline} studentName={studentName} C={C}/>;
}

function greeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function ProgramView({ payload, timeline, studentName, C }: {
  payload: ProgramPayload; timeline: ProgramTimeline; studentName: string | null; C: typeof LIGHT_C;
}) {
  const cohort = payload.cohort!;
  const attnInk = useAttnInk();
  const { weeks, currentWeek, phase, anytime } = timeline;
  const homeWeek: WeekKey = weeks.length
    ? Math.min(currentWeek ?? 1, weeks.length)
    : 'all';
  // Keep the user's chosen week while the clock advances; always clamp against the live payload.
  const [choice, setChoice] = useState<WeekKey>(homeWeek);
  const sel: WeekKey = !weeks.length ? 'all' : choice === 'all' ? homeWeek : Math.min(choice, weeks.length);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  const closeGroup = useCallback(() => { setGroupOpen(false); groupButtonRef.current?.focus(); }, []);
  const remaining = timeline.required - timeline.completed;
  const hasLocked = payload.items.some(i => i.locked);
  const stage = phase === 'before' && timeline.daysUntilStart !== null
    ? 'Starts in ' + plural(timeline.daysUntilStart, 'day')
    : phase === 'after' ? 'Program ended'
    : phase === 'catch_up' ? 'Catch-up period'
    : currentWeek ? 'Week ' + currentWeek + (timeline.hasEndDate ? ' of ' + weeks.length : '')
    : 'Your learning journey';
  const daysNote = timeline.daysLeft === null || (phase !== 'during' && phase !== 'catch_up') ? null
    : plural(timeline.daysLeft, 'day') + (phase === 'catch_up' ? ' to catch up' : ' of classes left');
  const pace = timeline.behind > 0
    ? plural(timeline.behind, 'item') + ' past due'
    : hasLocked && remaining > 0 ? 'Some work is paused'
    : phase === 'before' ? 'Ready when you are'
    : remaining === 0 && timeline.required > 0 ? 'All caught up'
    : phase === 'after' || phase === 'catch_up' ? plural(remaining, 'item') + ' left to finish'
    : timeline.required > 0 ? 'You are on track' : 'Your program is getting started';
  const attention = timeline.behind > 0 || hasLocked && remaining > 0;

  return (
    <MotionConfig reducedMotion="user">
      <div className="max-w-6xl min-w-0 space-y-4 sm:space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm" style={{ color: C.muted }}>{greeting(studentName)}</p>
            <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight mt-1" style={{ color: C.text }}>My Program</h1>
            <p className="text-sm mt-1.5 break-words [overflow-wrap:anywhere]" style={{ color: C.muted }}>{cohort.name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs sm:text-[13px]" style={{ color: C.muted }}>
              <span className="font-semibold">{stage}</span>
              {daysNote && <span>{daysNote}</span>}
            </div>
          </div>
          {payload.group && <GroupButton ref={groupButtonRef} group={payload.group} C={C} onOpen={() => setGroupOpen(true)}/>}
        </header>

        <section aria-label="Program progress" className="rounded-2xl sm:rounded-3xl p-4 sm:p-6" style={{ background: C.card }}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <h2 className="text-sm font-semibold" style={{ color: C.text }}>Your progress</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: attention ? attnInk : C.muted }}>
              {attention ? (timeline.behind > 0 ? <CalendarDays className="w-3.5 h-3.5" aria-hidden="true"/> : <Lock className="w-3.5 h-3.5" aria-hidden="true"/>) : <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.successText }}/>}
              {pace}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
            <div className="min-w-0">
              <p className="text-[30px] sm:text-[36px] font-bold tracking-tight tabular-nums leading-none" style={{ color: C.text }}>
                {timeline.pct}<span className="text-lg sm:text-xl ml-0.5" style={{ color: C.muted }}>%</span>
              </p>
              <p className="text-xs sm:text-sm mt-2" style={{ color: C.muted }}>Complete</p>
            </div>
            <div className="min-w-0">
              <p className="text-[30px] sm:text-[36px] font-bold tracking-tight tabular-nums leading-none" style={{ color: C.text }}>{timeline.completed}<span className="text-lg sm:text-xl ml-1.5" style={{ color: C.muted }}>/ {timeline.required}</span></p>
              <p className="text-xs sm:text-sm mt-2" style={{ color: C.muted }}>Items finished</p>
            </div>
            <div className="col-span-2 sm:col-span-1 flex sm:block items-baseline justify-between gap-3">
              <p className="order-2 sm:order-none text-xl sm:text-[36px] font-bold tracking-tight tabular-nums leading-none"
                style={{ color: timeline.behind ? attnInk : C.text }}>{timeline.behind}</p>
              <p className="text-xs sm:text-sm sm:mt-2" style={{ color: C.muted }}>Past due</p>
            </div>
          </div>
          <ProgressBar pct={timeline.pct} label="Overall completion" valueText={timeline.completed + ' of ' + timeline.required + ' items finished'} C={C} className="mt-5"/>
          {timeline.statusCounts.awaiting > 0 && <p className="text-xs mt-2.5" style={{ color: C.muted }}>Submitted work counts as finished while it waits for review.</p>}
        </section>

        {hasLocked && (
          <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5 text-[13px]" style={{ background: C.card, color: C.muted }}>
            <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true"/>
            <p>Some work is paused until your payment is up to date. Locked items stay visible and do not count as past due.</p>
          </div>
        )}

        {payload.items.length === 0 ? (
          <div className="rounded-2xl" style={{ background: C.card }}>
            <EmptyState icon={Route} title="Nothing assigned yet" body="Your courses, projects and assignments will appear here when your instructor assigns them."/>
          </div>
        ) : (
          <>
            <NextAction timeline={timeline} C={C}/>
            <section className="rounded-2xl sm:rounded-3xl p-4 sm:p-6 min-w-0" style={{ background: C.card }} aria-labelledby="journey-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="journey-heading" className="text-lg font-bold tracking-tight" style={{ color: C.text }}>Your journey</h2>
                  <p className="text-[13px] mt-1" style={{ color: C.muted }}>{weeks.length ? 'Browse your weeks and see what is planned.' : 'All your assigned work, in one place.'}</p>
                </div>
                {weeks.length > 0 && (
                  <button type="button" onClick={() => setChoice(homeWeek)}
                    className="min-h-11 px-3.5 rounded-xl text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ background: C.pill, color: C.text, outlineColor: C.cta }}>
                    {phase === 'during' ? 'This week' : phase === 'before' ? 'First week' : 'Latest week'}
                  </button>
                )}
              </div>
              {weeks.length > 0 && <WeekSelector weeks={weeks} currentWeek={currentWeek} phase={phase} sel={typeof sel === 'number' ? sel : 1} onPick={setChoice} C={C}/>}
              <WeekPanel sel={sel} setSel={setChoice} timeline={timeline} undated={anytime} C={C}/>
            </section>
          </>
        )}

        <AnimatePresence>
          {groupOpen && payload.group && <GroupModal group={payload.group} C={C} onClose={closeGroup}/>}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function ProgressBar({ pct, label, valueText, C, className = '' }: {
  pct: number; label: string; valueText?: string; C: typeof LIGHT_C; className?: string;
}) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(pct)} aria-valuetext={valueText}
      className={'h-2 rounded-full overflow-hidden ' + className} style={{ background: C.pill }}>
      <div className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
        style={{ background: C.cta, width: Math.max(0, Math.min(100, pct)) + '%' }}/>
    </div>
  );
}

function NextAction({ timeline, C }: { timeline: ProgramTimeline; C: typeof LIGHT_C }) {
  const item = timeline.upNext;
  if (item) return <FocusCard item={item} beforeStart={timeline.phase === 'before'} C={C}/>;
  const remaining = timeline.required - timeline.completed;
  const waiting = timeline.statusCounts.awaiting > 0;
  return (
    <section aria-label="Next step" className="rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex items-start gap-3" style={{ background: C.card }}>
      <span className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center" style={{ background: C.pill, color: C.muted }}>
        {remaining > 0 ? <Lock className="w-5 h-5" aria-hidden="true"/> : <Check className="w-5 h-5" aria-hidden="true"/>}
      </span>
      <div className="min-w-0">
        <h2 className="font-semibold text-sm" style={{ color: C.text }}>{remaining > 0 ? 'Your next step is paused' : timeline.required ? 'You are up to date' : 'Check your live sessions'}</h2>
        <p className="text-[13px] leading-relaxed mt-1" style={{ color: C.muted }}>
          {remaining > 0 ? 'Your remaining work is locked. It will be ready to continue when access is restored.'
            : waiting ? 'Your submitted work is waiting for review. You can still revisit finished items below.'
            : timeline.required ? 'Explore your journey below or revisit work you have finished.' : 'Upcoming sessions are listed in your journey below.'}
        </p>
      </div>
    </section>
  );
}

function WeekSelector({ weeks, currentWeek, phase, sel, onPick, C }: {
  weeks: ProgramWeek[]; currentWeek: number | null; phase: ProgramTimeline['phase'];
  sel: number; onPick: (w: WeekKey) => void; C: typeof LIGHT_C;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const reduceMotion = useReducedMotion();
  const attnInk = useAttnInk();

  useEffect(() => {
    const container = scrollRef.current;
    const button = buttons.current.get(sel);
    if (!container || !button) return;
    const reveal = () => {
      const left = container.scrollLeft + button.getBoundingClientRect().left - container.getBoundingClientRect().left
        - (container.clientWidth - button.offsetWidth) / 2;
      container.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [sel, reduceMotion]);

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, week: number) => {
    let next: number;
    if (e.key === 'ArrowRight') next = Math.min(weeks.length, week + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(1, week - 1);
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = weeks.length;
    else return;
    e.preventDefault();
    onPick(next);
    buttons.current.get(next)?.focus({ preventScroll: true });
  };

  return (
    <div className="mt-5 mb-6 min-w-0">
      <div ref={scrollRef} role="group" aria-label="Program weeks. Use the left and right arrow keys to move."
        className="relative overflow-x-auto overscroll-x-contain p-1 -mx-1"
        style={{ scrollbarWidth: 'thin' }}>
        <div className="flex gap-2 w-max min-w-full">
          {weeks.map(week => {
            const active = sel === week.week;
            const current = phase === 'during' && currentWeek === week.week;
            const complete = week.required > 0 && week.completed === week.required;
            const note = week.hasOverdue ? 'Past due' : complete ? 'Complete' : current ? 'Current week' : formatDay(week.startDate);
            return (
              <button key={week.week} ref={el => { if (el) buttons.current.set(week.week, el); else buttons.current.delete(week.week); }}
                type="button" aria-pressed={active} aria-current={current ? 'step' : undefined}
                aria-label={'Week ' + week.week + ', from ' + formatDay(week.startDate) + ', ' + week.completed + ' of ' + week.required + ' finished' + (current ? ', current week' : '') + (week.hasOverdue ? ', past due work' : '')}
                tabIndex={active ? 0 : -1} onKeyDown={e => onKey(e, week.week)} onClick={() => onPick(week.week)}
                className="min-w-[100px] flex-1 rounded-xl px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors motion-reduce:transition-none"
                style={{ background: active ? C.lime : C.pill, color: C.text, outlineColor: C.cta }}>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  Week {week.week}
                  {complete ? <Check className="w-3.5 h-3.5" style={{ color: C.successText }} aria-hidden="true"/>
                    : active ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.cta }}/> : null}
                </span>
                <span className="block text-xs mt-1.5 whitespace-nowrap"
                  style={{ color: week.hasOverdue ? attnInk : complete ? C.successText : C.muted }}>{note}</span>
              </button>
            );
          })}
        </div>
      </div>
      {weeks.length > 3 && <p className="sm:hidden text-xs mt-2" style={{ color: C.muted }}>Swipe to browse weeks</p>}
    </div>
  );
}

function WeekPanel({ sel, setSel, timeline, undated, C }: {
  sel: WeekKey; setSel: (w: WeekKey) => void; timeline: ProgramTimeline; undated: TimelineItem[]; C: typeof LIGHT_C;
}) {
  const [filter, setFilter] = useState<WorkFilter>('all');
  const { weeks } = timeline;
  const week = typeof sel === 'number' ? weeks[sel - 1] : null;
  const list = [
    ...(week ? week.items : undated).map(item => ({ item, ongoing: false })),
    ...(week?.ongoing ?? []).map(item => ({ item, ongoing: true })),
  ];
  const doneInView = (row: typeof list[number]) => !row.ongoing && completedItem(row.item);
  const counts: Record<WorkFilter, number> = {
    all: list.length,
    todo: list.filter(row => !doneInView(row) && row.item.status !== 'missed').length,
    completed: list.filter(doneInView).length,
  };
  const visible = list.filter(row => filter === 'all'
    || (filter === 'completed' ? doneInView(row) : !doneInView(row) && row.item.status !== 'missed'));
  // Keep completed rows quiet and below actionable work without changing the timeline's counts.
  const ordered = [...visible.filter(row => !doneInView(row)), ...visible.filter(doneInView)];
  const required = week ? week.required : list.filter(row => row.item.type !== 'event').length;
  const done = week ? week.completed : list.filter(row => row.item.type !== 'event' && completedItem(row.item)).length;
  const filters: { key: WorkFilter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'todo', label: 'To do' }, { key: 'completed', label: 'Completed' },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <h3 className="text-base sm:text-lg font-bold" style={{ color: C.text }}>{week ? 'Week ' + week.week + ' work' : 'Your work'}</h3>
          <p className="text-[13px] mt-1" style={{ color: C.muted }}>
            {week ? 'From ' + formatDay(week.startDate) : 'No schedule set yet'}
            {required > 0 ? ', ' + done + ' of ' + required + ' required items finished' : ', live sessions and ongoing work'}
          </p>
        </div>
        {week && (
          <div className="flex items-center gap-1" role="group" aria-label="Change selected week">
            <StepButton label="Previous week" disabled={week.week === 1} onClick={() => setSel(week.week - 1)} C={C}><ArrowLeft className="w-4 h-4"/></StepButton>
            <StepButton label="Next week" disabled={week.week === weeks.length} onClick={() => setSel(week.week + 1)} C={C}><ArrowRight className="w-4 h-4"/></StepButton>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 sm:flex gap-1 rounded-xl p-1 mt-4 mb-3 w-full sm:w-fit" role="group" aria-label="Filter work">
        {filters.map(f => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
            className="min-h-11 rounded-lg px-2 sm:px-3 text-xs sm:text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: filter === f.key ? C.pill : 'transparent', color: filter === f.key ? C.text : C.muted, outlineColor: C.cta }}>
            {f.label}<span className="tabular-nums ml-1.5" style={{ color: C.muted }}>{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">{plural(ordered.length, 'item')} shown</p>
      <div className="space-y-2">
        {ordered.map(({ item, ongoing }) => <ItemRow key={(ongoing ? 'ongoing-' : '') + item.type + '-' + item.id} item={item} ongoing={ongoing} C={C}/>)}
        {ordered.length === 0 && (
          <div className="text-center px-4 py-8 rounded-2xl" style={{ background: C.page }}>
            <p className="text-sm font-semibold" style={{ color: C.text }}>{list.length === 0 ? 'Nothing planned for this week' : filter === 'completed' ? 'No completed items yet' : 'You are caught up here'}</p>
            <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: C.muted }}>
              {list.length === 0 ? 'Choose another week to explore your program.' : filter === 'completed' ? 'Finished work will appear here as you make progress.' : 'Switch to All to see the rest of this week.'}
            </p>
          </div>
        )}
      </div>
      {(week?.ongoing.length ?? 0) > 0 && <p className="text-xs leading-relaxed mt-3" style={{ color: C.muted }}>Ongoing work appears across weeks and counts toward progress once.</p>}
    </div>
  );
}

function StepButton({ label, disabled, onClick, children, C }: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode; C: typeof LIGHT_C;
}) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="w-11 h-11 rounded-xl grid place-items-center disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: C.pill, color: C.text, outlineColor: C.cta }}>
      {children}
    </button>
  );
}

function ItemLink({ item, className, style, children, label }: {
  item: TimelineItem; className?: string; style?: React.CSSProperties; children: React.ReactNode; label?: string;
}) {
  const external = item.type !== 'assignment';
  return (
    <a href={item.href} aria-label={label} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}
      className={className} style={style}>
      {children}
    </a>
  );
}

function itemMeta(item: TimelineItem) {
  const parts: string[] = [TYPE_META[item.type].label];
  if (item.dueDate) parts.push(item.type === 'event' ? formatDay(item.dueDate)
    : item.status === 'overdue' ? 'Was due ' + formatDay(item.dueDate) : 'Due ' + formatDay(item.dueDate));
  const assigned = dueDateKey(item.assignedAt);
  if (!item.dueDate && assigned) parts.push('Assigned ' + formatDay(assigned));
  if (item.recurring) parts.push('Repeats');
  return parts.join(' / ');
}

function FocusCard({ item, beforeStart, C }: { item: TimelineItem; beforeStart: boolean; C: typeof LIGHT_C }) {
  const { Icon } = TYPE_META[item.type];
  const started = item.baseStatus === 'in_progress';
  return (
    <section className="rounded-2xl sm:rounded-3xl p-4 sm:p-6" style={{ background: C.card }} aria-labelledby="next-action-heading">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: C.muted }}>
          {beforeStart ? 'Get a head start' : started ? 'Continue learning' : 'Your next step'}
        </p>
        <StatusBadge item={item} C={C}/>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="w-11 h-11 sm:w-12 sm:h-12 grid place-items-center rounded-xl flex-shrink-0"
            style={{ background: C.lime, color: C.text }}><Icon className="w-5 h-5" aria-hidden="true"/></span>
          <div className="min-w-0 flex-1">
            <h2 id="next-action-heading" className="text-lg sm:text-xl font-bold leading-snug break-words [overflow-wrap:anywhere]" style={{ color: C.text }}>{item.title}</h2>
            <p className="text-[13px] leading-relaxed mt-1.5" style={{ color: C.muted }}>{itemMeta(item)}{item.week ? ' / Week ' + item.week : ''}</p>
          </div>
        </div>
        <ItemLink item={item} label={actionLabel(item) + ' ' + item.title}
          className="min-h-12 w-full sm:w-auto flex-shrink-0 justify-center inline-flex items-center gap-2 text-sm font-semibold px-5 py-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4"
          style={{ background: C.text, color: C.card, outlineColor: C.cta }}>
          {actionLabel(item)} <ArrowRight className="w-4 h-4" aria-hidden="true"/>
        </ItemLink>
      </div>
      {started && item.progressPct > 0 && (
        <div className="mt-4">
          <div className="flex justify-between gap-2 text-xs mb-2" style={{ color: C.muted }}><span>Item progress</span><span className="tabular-nums">{item.progressPct}%</span></div>
          <ProgressBar pct={item.progressPct} label={item.title + ' progress'} C={C}/>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ item, ongoing = false, C }: { item: TimelineItem; ongoing?: boolean; C: typeof LIGHT_C }) {
  const attnInk = useAttnInk();
  const complete = !ongoing && completedItem(item);
  const text = item.locked ? 'Locked'
    : ongoing ? isCompleteStatus(item.status) && item.week ? 'Finished week ' + item.week : 'Ongoing'
    : item.status === 'awaiting' ? 'In review'
    : complete ? item.type === 'event' ? 'Attended' : 'Completed'
    : item.status === 'overdue' ? 'Past due'
    : item.status === 'failed' ? 'Not passed'
    : item.status === 'progress' ? 'In progress'
    : item.status === 'missed' ? 'Missed'
    : item.status === 'upcoming' ? 'Upcoming' : 'Not started';
  const attention = !item.locked && !ongoing && (item.status === 'overdue' || item.status === 'failed');
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap"
      style={{ background: attention ? ATTN_SOFT : complete && !item.locked ? C.successBg : C.pill,
        color: attention ? attnInk : complete && !item.locked ? 'color-mix(in srgb, ' + C.successText + ' 70%, ' + C.text + ')' : C.muted }}>
      {item.locked ? <Lock className="w-3 h-3" aria-hidden="true"/> : complete ? <Check className="w-3 h-3" aria-hidden="true"/> : null}{text}
    </span>
  );
}

function ItemRow({ item, ongoing = false, C }: { item: TimelineItem; ongoing?: boolean; C: typeof LIGHT_C }) {
  const { Icon } = TYPE_META[item.type];
  const finished = !ongoing && completedItem(item);
  return (
    <div className="rounded-xl sm:rounded-2xl px-3 sm:px-4 py-3.5" style={{ background: C.page }}>
      <div className="flex items-start gap-3">
        <span className="hidden sm:grid w-10 h-10 flex-shrink-0 rounded-xl place-items-center"
          style={{ background: C.card, color: finished ? C.successText : C.muted }}><Icon className="w-[18px] h-[18px]" aria-hidden="true"/></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere]" style={{ color: finished ? C.muted : C.text }}>{item.title}</p>
          <p className="text-xs leading-relaxed mt-1" style={{ color: C.muted }}>{itemMeta(item)}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <StatusBadge item={item} ongoing={ongoing} C={C}/>
            {item.carriedFrom && !ongoing && <span className="text-xs" style={{ color: C.muted }}>From week {item.carriedFrom}</span>}
            {item.type === 'event' && <span className="text-xs" style={{ color: C.muted }}>Not counted toward completion</span>}
          </div>
          {!finished && !item.locked && !ongoing && item.progressPct > 0 && (
            <div className="flex items-center gap-2 mt-2.5 max-w-48">
              <ProgressBar pct={item.progressPct} label={item.title + ' progress'} C={C} className="flex-1"/>
              <span className="text-xs tabular-nums" style={{ color: C.muted }}>{item.progressPct}%</span>
            </div>
          )}
        </div>
        {item.locked
          ? <span className="w-11 h-11 flex-shrink-0 grid place-items-center" style={{ color: C.muted }}><Lock className="w-4 h-4" aria-label="Locked"/></span>
          : (
            <ItemLink item={item} label={actionLabel(item) + ' ' + item.title}
              className="min-h-11 min-w-11 flex-shrink-0 rounded-xl px-2 sm:px-3 inline-flex items-center justify-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: C.card, color: C.text, outlineColor: C.cta }}>
              <span className="hidden sm:inline text-xs font-semibold">{actionLabel(item)}</span><ChevronRight className="w-4 h-4" aria-hidden="true"/>
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
    <button ref={ref} type="button" onClick={onOpen} aria-haspopup="dialog" aria-label={'My group, ' + group.name}
      className="min-h-11 inline-flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-xl text-[13px] font-semibold max-w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: C.card, color: C.text, outlineColor: C.cta }}>
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
      {m.isLeader && <span className="text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: C.successBg, color: C.successText }}>Leader</span>}
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
            className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: C.pill, color: C.muted, outlineColor: C.cta }}>
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
    <div className="max-w-6xl min-w-0 space-y-4 sm:space-y-5" aria-label="Loading your program" aria-busy="true">
      <div className="space-y-2"><Sk w={140} h={12}/><Sk w={200} h={32}/><Sk w={180} h={14}/></div>
      <div className="rounded-2xl p-4 sm:p-6 space-y-5" style={{ background: C.card }}>
        <Sk w={120} h={14}/><div className="grid grid-cols-2 sm:grid-cols-3 gap-4"><Sk h={56}/><Sk h={56}/><div className="hidden sm:block"><Sk h={56}/></div></div><Sk h={8} r={4}/>
      </div>
      <div className="rounded-2xl p-4 sm:p-6" style={{ background: C.card }}><Sk h={100} r={12}/></div>
      <div className="rounded-2xl p-4 sm:p-6 space-y-4" style={{ background: C.card }}>
        <Sk w={160} h={20}/><Sk h={68} r={12}/><Sk h={88} r={12}/><Sk h={88} r={12}/>
      </div>
    </div>
  );
}
