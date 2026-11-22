'use client';

// Dashboard header pieces: cohort and subscription timelines and the plan-upgrade prompt.
// Date helpers remain file-internal.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DARK_C, useC } from '@/lib/theme';
import { Pill, palette } from '@/components/dashboard/subscriptions/ui';
import type { SubscriptionStatus } from '@/lib/db-subscriptions';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { FlagBanner, RocketLaunch } from '@phosphor-icons/react';

export type CohortTimeline = {
  id: string;
  name: string;
  start_date: string | null;
  /** End of the cohort, including any catch-up period after classes. */
  end_date: string | null;
  /** Last day of classes (migration 223); null = classes run to end_date. */
  classes_end_date?: string | null;
};

export type SubscriptionTimeline = {
  name: string;
  start_at: string | null;
  end_at: string | null;
  status: SubscriptionStatus;
  duration_months: number;
};

type TimelineBadgeProps =
  | { variant: 'cohort'; timeline: CohortTimeline | null }
  | { variant: 'subscription'; timeline: SubscriptionTimeline | null };

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function subscriptionHasEnded(status: SubscriptionStatus, end: Date | null) {
  return status !== 'active' || (end !== null && end.getTime() < Date.now());
}

function diffDays(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86400000);
}

function formatTimelineDate(value: Date) {
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function CohortTimelineBadge({ cohort, inMenu }: { cohort: CohortTimeline | null; inMenu?: boolean }) {
  return <TimelineBadge timeline={cohort} variant="cohort" inMenu={inMenu} />;
}

export function SubscriptionTimelineBadge({
  subscription,
  onRenew,
}: {
  subscription: SubscriptionTimeline | null;
  onRenew?: () => void;
}) {
  const ended = subscription
    ? subscriptionHasEnded(subscription.status, parseTimestamp(subscription.end_at))
    : false;

  return <>
    <TimelineBadge timeline={subscription} variant="subscription" />
    {ended && onRenew && <PlanActionButton label="Renew" onClick={onRenew} />}
  </>;
}

export function UpgradePlanButton({ onUpgrade }: { onUpgrade?: () => void }) {
  return onUpgrade ? <PlanActionButton label="Upgrade" onClick={onUpgrade} /> : null;
}

// A plain button in the page's blue: the upgrade or renew prompt.
function PlanActionButton({ label, onClick }: { label: 'Upgrade' | 'Renew'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-opacity hover:opacity-90"
      style={{ background: DARK_C.cta, color: '#ffffff' }}>
      {label === 'Renew' ? 'Renew plan' : 'Upgrade'}
      <ArrowUpRight className="h-4 w-4" />
    </button>
  );
}

// The cohort (or subscription) at a glance: name, week and a thin bar. A click or tap opens the
// details; in the phone menu the same chip spans the menu's width.
function TimelineBadge(props: TimelineBadgeProps & { inMenu?: boolean }) {
  const C = useC();
  const P = palette(C);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!props.timeline) return null;
  const start = props.variant === 'cohort'
    ? parseDateOnly(props.timeline.start_date)
    : parseTimestamp(props.timeline.start_at);
  const end = props.variant === 'cohort'
    ? parseDateOnly(props.timeline.end_date)
    : parseTimestamp(props.timeline.end_at);
  if (!start || !end) return null;
  const timeline = props.timeline;

  // A cohort's weeks and progress run to its last day of classes; the rest of the cohort, up to
  // end_date, is the catch-up period. A classes end outside the cohort's dates is ignored.
  const classesEnd  = props.variant === 'cohort' ? parseDateOnly(props.timeline.classes_end_date) : null;
  const teachEnd    = classesEnd && classesEnd >= start && classesEnd < end ? classesEnd : end;

  const today       = new Date();
  const totalDays   = Math.max(diffDays(start, teachEnd), 1);
  const elapsed     = diffDays(start, today);
  const bounded     = Math.min(Math.max(elapsed, 0), totalDays);
  const pct         = Math.round((bounded / totalDays) * 100);
  const daysToStart = Math.max(diffDays(today, start), 0);
  const totalWeeks  = Math.max(Math.ceil(totalDays / 7), 1);
  const weekNum     = Math.min(Math.max(Math.floor(bounded / 7) + 1, 1), totalWeeks);

  const subscriptionStatus = props.variant === 'subscription' ? props.timeline.status : null;
  const isUpcoming = elapsed < 0;
  const isDone     = props.variant === 'subscription'
    ? subscriptionHasEnded(props.timeline.status, end)
    : elapsed > Math.max(diffDays(start, end), 1);
  const isCatchUp  = !isDone && teachEnd !== end && elapsed > totalDays;
  const daysLeft   = Math.max(diffDays(today, isCatchUp ? end : teachEnd), 0);
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  const endedLabel = props.variant === 'subscription'
    ? subscriptionStatus === 'cancelled' ? 'Cancelled' : 'Expired'
    : 'Ended';
  const status: { label: string; tone: 'good' | 'warn' | 'mute' } = isUpcoming ? { label: 'Starting soon', tone: 'warn' }
    : isDone ? { label: endedLabel, tone: 'mute' }
    : isCatchUp ? { label: 'Catch-up', tone: 'warn' }
    : { label: 'Active', tone: 'good' };
  const short = isUpcoming ? `Starts ${formatTimelineDate(start)}`
    : isDone ? endedLabel
    : isCatchUp ? `Catch-up, ${days(daysLeft)} left`
    : props.variant === 'subscription' ? `${days(daysLeft)} left` : `Week ${weekNum} of ${totalWeeks}`;
  const detail = isUpcoming ? `Starts in ${days(daysToStart)}`
    : isDone ? props.variant === 'subscription'
      ? subscriptionStatus === 'cancelled' ? 'Subscription cancelled' : `Access ended ${formatTimelineDate(end)}`
      : 'This cohort has ended'
    : isCatchUp ? `Catch-up period, ${days(daysLeft)} left`
    : `${days(daysLeft)} ${teachEnd !== end ? 'of classes ' : ''}left`;
  const fill = isDone ? C.faint : P.good;
  const bar = (className: string) => (
    <span className={`block overflow-hidden rounded-full ${className}`} style={{ background: C.pill }}>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
    </span>
  );

  return (
    <div ref={ref} className={props.inMenu ? 'relative' : 'relative hidden md:block'}>
      {/* One line, the height of the buttons beside it: the name. The week, progress and
          timeline are in the details it opens. */}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title={short}
        className={`flex h-9 items-center gap-2 rounded-full pl-3.5 pr-3 text-left transition-colors ${props.inMenu ? 'w-full rounded-xl' : ''}`}
        style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: status.tone === 'good' ? P.good : status.tone === 'warn' ? P.warn : C.faint }} />
        <span className={`min-w-0 truncate text-[13px] font-semibold ${props.inMenu ? 'flex-1' : 'max-w-[200px]'}`} style={{ color: C.text }}>{timeline.name}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.muted }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            // In the phone menu the details open in place, under the chip; in the top bar they drop down.
            className={props.inMenu ? 'mt-2 rounded-xl p-4' : 'absolute right-0 top-full z-50 mt-2 w-[360px] rounded-2xl p-5'}
            style={{ background: C.card, boxShadow: `0 20px 60px rgba(0,0,0,0.14), 0 0 0 1px ${C.divider}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-5" style={{ color: C.text }}>{timeline.name}</p>
                <p className="mt-1 text-[13px]" style={{ color: C.muted }}>{detail}</p>
                {props.variant === 'subscription' && (
                  <p className="mt-0.5 text-[13px]" style={{ color: C.muted }}>
                    {props.timeline.duration_months} month{props.timeline.duration_months === 1 ? '' : 's'} plan
                  </p>
                )}
              </div>
              <Pill tone={status.tone} dot={status.tone === 'good'} C={C}>{status.label}</Pill>
            </div>
            {props.variant === 'cohort' ? (
              <CohortTrack C={C} start={start} teachEnd={teachEnd} end={end} today={today}
                weekNum={weekNum} totalWeeks={totalWeeks} pct={pct} isUpcoming={isUpcoming} isDone={isDone} isCatchUp={isCatchUp} />
            ) : (
              <>
                {!isUpcoming && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-baseline justify-between text-[13px]">
                      <span style={{ color: C.text }}>Progress</span>
                      <span className="font-semibold tabular-nums" style={{ color: C.text }}>{pct}%</span>
                    </div>
                    {bar('h-2 w-full')}
                  </div>
                )}
                <div className="mt-4 flex justify-between text-[13px]" style={{ color: C.muted }}>
                  <span>Started <b style={{ color: C.text }}>{formatTimelineDate(start)}</b></span>
                  <span>Ends <b style={{ color: C.text }}>{formatTimelineDate(end)}</b></span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// The cohort as a picture: one block per week of classes (done, this week, still to come), the
// catch-up period as an amber dashed stretch after classes end, and a rocket on the track for today.
function CohortTrack({ C, start, teachEnd, end, today, weekNum, totalWeeks, pct, isUpcoming, isDone, isCatchUp }: {
  C: ReturnType<typeof useC>; start: Date; teachEnd: Date; end: Date; today: Date;
  weekNum: number; totalWeeks: number; pct: number; isUpcoming: boolean; isDone: boolean; isCatchUp: boolean;
}) {
  const P = palette(C);
  const teachDays = Math.max(diffDays(start, teachEnd), 1);
  const catchDays = Math.max(diffDays(teachEnd, end), 0);
  const allDays = teachDays + catchDays;
  // Where today sits on the whole track (classes and catch-up), for the rocket.
  const at = Math.min(Math.max(diffDays(start, today) / allDays, 0), 1) * 100;
  const weekState = (i: number) => isDone || isCatchUp ? 'done' : isUpcoming ? 'todo' : i < weekNum - 1 ? 'done' : i === weekNum - 1 ? 'now' : 'todo';
  const caption = isUpcoming ? 'Not started' : isDone ? 'Finished' : isCatchUp ? 'Catch-up period' : `Week ${weekNum} of ${totalWeeks}`;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold" style={{ color: C.text }}>{caption}</span>
        <span className="font-semibold tabular-nums" style={{ color: C.text }}>{pct}% of classes</span>
      </div>
      <div className="relative mt-2 pt-9">
        {/* Today: a small bubble with a rocket, its stem pointing at the track. */}
        {!isUpcoming && !isDone && (
          <div className="absolute top-0 flex flex-col items-center" style={{ left: `${at}%`, transform: 'translateX(-50%)' }}>
            <span className="flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold leading-none"
              style={{ background: C.text, color: C.card }}>
              <RocketLaunch size={12} weight="fill" /> Today
            </span>
            <span className="h-3 w-px" style={{ background: C.text }} />
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="flex gap-[3px]" style={{ flex: teachDays }}>
            {Array.from({ length: totalWeeks }, (_, i) => {
              const state = weekState(i);
              return (
                <span key={i} className="h-2.5 flex-1 rounded-[3px]" title={`Week ${i + 1}`}
                  style={state === 'done' ? { background: P.good }
                    : state === 'now' ? { background: P.goodSoft, boxShadow: `inset 0 0 0 1.5px ${P.good}` }
                    : { background: C.pill }} />
              );
            })}
          </div>
          {catchDays > 0 && (
            <span className="h-2.5 rounded-[3px]" title="Catch-up period"
              style={{ flex: catchDays, background: P.warnSoft, border: `1.5px dashed ${P.warn}` }} />
          )}
        </div>
        <div className="mt-2 flex gap-1 text-[12px]" style={{ color: C.muted }}>
          <div className="flex justify-between gap-2" style={{ flex: teachDays }}>
            <span>Start <b style={{ color: C.text }}>{formatTimelineDate(start)}</b></span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <FlagBanner size={13} weight="fill" style={{ color: P.good }} />
              <b style={{ color: C.text }}>{formatTimelineDate(teachEnd)}</b>
            </span>
          </div>
          {catchDays > 0 && (
            <div className="flex justify-end whitespace-nowrap" style={{ flex: catchDays, minWidth: 48 }}>
              <b style={{ color: C.text }}>{formatTimelineDate(end)}</b>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: C.muted }}>
          <span className="flex items-center gap-1.5"><FlagBanner size={12} weight="fill" style={{ color: P.good }} /> Classes end</span>
          {catchDays > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px]" style={{ background: P.warnSoft, border: `1px dashed ${P.warn}` }} /> Catch-up to finish</span>}
        </div>
      </div>
    </div>
  );
}

// NAV_ITEMS, NAV_GROUPS, SectionId live in @/components/student/nav
