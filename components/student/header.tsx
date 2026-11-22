'use client';

// Dashboard header pieces: cohort and subscription timelines, the plan-upgrade prompt,
// and the profile menu. Date helpers remain file-internal.

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useTheme } from '@/components/ThemeProvider';
import { useC } from '@/lib/theme';
import type { SubscriptionStatus } from '@/lib/db-subscriptions';
import { ArrowUpRight, Award, TrendingUp } from 'lucide-react';

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
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CohortTimelineBadge({ cohort }: { cohort: CohortTimeline | null }) {
  return <TimelineBadge timeline={cohort} variant="cohort" />;
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

function PlanActionButton({ label, onClick }: { label: 'Upgrade' | 'Renew'; onClick: () => void }) {
  const C = useC();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="relative flex-shrink-0 overflow-hidden rounded-full p-px"
      style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.12)' }}
      whileHover={reduceMotion ? undefined : { scale: 1.05 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8"
        style={{ background: 'conic-gradient(from 0deg, #00f5ff, #39ff14, #fff200, #ff6b00, #00f5ff)' }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={reduceMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: 'linear' }}
      />
      <button
        type="button"
        onClick={onClick}
        className="relative z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-2 text-[10px] font-semibold sm:gap-1.5 sm:px-3.5 sm:text-[11px]"
        style={{
          background: `color-mix(in srgb, ${C.card} 78%, transparent)`,
          color: C.text,
          backdropFilter: 'blur(8px)',
        }}>
        {label === 'Renew' ? <>
          <span className="sm:hidden">Renew plan</span>
          <span className="hidden sm:inline">Renew</span>
        </> : label}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

function TimelineBadge(props: TimelineBadgeProps) {
  const C = useC();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);

  const green     = '#22c55e';
  const greenDim  = isDark ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.12)';
  const greenGrad = 'linear-gradient(90deg,#16a34a 0%,#22c55e 55%,#4ade80 100%)';

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
  const isActive   = !isUpcoming && !isDone;
  const daysLeft   = Math.max(diffDays(today, isCatchUp ? end : teachEnd), 0);

  const endedLabel = props.variant === 'subscription'
    ? subscriptionStatus === 'cancelled' ? 'Cancelled' : 'Expired'
    : 'Done';
  const chipLabel   = isUpcoming ? 'Soon' : isDone ? endedLabel : isCatchUp ? 'Catch-up' : 'Active';
  const badgeStatus = isUpcoming
    ? `Starts in ${daysToStart}d`
    : isDone ? endedLabel
    : isCatchUp ? `Catch-up, ${daysLeft}d left`
    : props.variant === 'subscription' ? `${daysLeft}d left` : `Wk ${weekNum}/${totalWeeks}`;
  const detailLine  = isUpcoming
    ? `Starts ${formatTimelineDate(start)}`
    : isDone ? props.variant === 'subscription'
      ? subscriptionStatus === 'cancelled' ? 'Subscription cancelled' : `Access ended ${formatTimelineDate(end)}`
      : 'This cohort has ended'
    : isCatchUp ? `Catch-up period, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
    : `${daysLeft} day${daysLeft === 1 ? '' : 's'} ${teachEnd !== end ? 'of classes ' : ''}remaining`;
  const durationLine = props.variant === 'subscription'
    ? `${props.timeline.duration_months} month${props.timeline.duration_months === 1 ? '' : 's'} subscription`
    : null;

  // circular ring: r=9 in viewBox 0 0 24 24 => circ ~56.55
  const r    = 9;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;


  return (
    <div
      className="relative hidden md:block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 transition-all hover:shadow-md"
        style={{ background: C.card, borderColor: C.cardBorder }}>
        {/* Circular progress ring */}
        <div className="relative w-8 h-8 flex-shrink-0">
          <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="12" cy="12" r={r} fill="none" stroke={greenDim} strokeWidth="2.5"/>
            <circle cx="12" cy="12" r={r} fill="none" stroke={green} strokeWidth="2.5"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <TrendingUp className="w-3 h-3" style={{ color: green }}/>
          </div>
        </div>
        <div className="text-left leading-none pr-0.5">
          <p className="text-[11px] font-bold truncate max-w-[160px]" style={{ color: C.text }}>{timeline.name}</p>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: C.faint }}>{badgeStatus}</p>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-72 rounded-2xl z-50"
            style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: C.hoverShadow }}>

            {/* Header */}
            <div className="px-4 pt-4 pb-3 flex items-start gap-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black truncate leading-tight" style={{ color: C.text }}>{timeline.name}</p>
                <p className="text-xs mt-0.5 font-medium" style={{ color: C.muted }}>{detailLine}</p>
                {durationLine && <p className="text-[11px] mt-1 font-semibold" style={{ color: C.faint }}>{durationLine}</p>}
              </div>
              <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full mt-0.5"
                style={{ background: greenDim, color: green }}>{chipLabel}</span>
            </div>

            {/* Timeline track */}
            <div className="px-4 pb-4">
              <div className="relative h-16">
                {/* Track bg */}
                <div className="absolute inset-x-0 top-1/2 h-[3px] rounded-full"
                  style={{ background: greenDim, transform: 'translateY(-50%)' }}/>
                {/* Progress fill */}
                <div className="absolute left-0 top-1/2 h-[3px] rounded-full"
                  style={{ width: `${pct}%`, background: greenGrad, transform: 'translateY(-50%)' }}/>
                {/* Start dot */}
                <div className="absolute left-0 top-1/2 w-3 h-3 rounded-full border-2"
                  style={{ background: C.card, borderColor: green, transform: 'translate(-1px, -50%)' }}/>
                {/* End node */}
                <div className="absolute right-0 top-1/2 w-6 h-6 rounded-full border-2 flex items-center justify-center"
                  style={{ background: C.card, borderColor: green, transform: 'translate(4px, -50%)', boxShadow: `0 0 0 4px ${greenDim}` }}>
                  <Award className="w-3 h-3" style={{ color: green }}/>
                </div>
                {/* Today: 3D pencil writing, tip planted on track */}
                {isActive && (
                  <div className="absolute pointer-events-none z-10"
                    style={{ left: `${pct}%`, bottom: '50%', transform: 'translateX(-50%)' }}>
                    <svg
                      viewBox="0 0 14 34"
                      width="13"
                      height="32"
                      style={{
                        transform: 'rotate(-15deg)',
                        transformOrigin: '50% 100%',
                        filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.32))',
                        display: 'block',
                      }}>
                      {/* Eraser */}
                      <rect x="3" y="0.5" width="8" height="4" rx="1.5" fill="#fda4af"/>
                      {/* Ferrule highlight */}
                      <rect x="2.5" y="4.5" width="9" height="1" fill="#e5e7eb"/>
                      {/* Ferrule band */}
                      <rect x="2.5" y="5.5" width="9" height="2.5" fill="#9ca3af"/>
                      {/* Body: light left / amber center / dark right = 3D barrel */}
                      <rect x="2.5" y="8"   width="2.5" height="14.5" fill="#fde68a"/>
                      <rect x="5"   y="8"   width="4.5" height="14.5" fill="#fbbf24"/>
                      <rect x="9.5" y="8"   width="2"   height="14.5" fill="#d97706"/>
                      {/* Tip wood: left face lighter, right face darker */}
                      <polygon points="2.5,22.5 7,22.5 7,29.5" fill="#f59e0b"/>
                      <polygon points="7,22.5 11.5,22.5 7,29.5" fill="#b45309"/>
                      {/* Lead tip */}
                      <polygon points="5.8,29.5 7,33 8.2,29.5" fill="#1f2937"/>
                    </svg>
                  </div>
                )}
              </div>
              {/* Date labels */}
              <div className="flex justify-between mt-1">
                <span className="text-xs font-semibold" style={{ color: C.faint }}>{formatTimelineDate(start)}</span>
                {/* The track measures classes, so it ends on the last day of classes. */}
                <span className="text-xs font-semibold" style={{ color: C.faint }}>{formatTimelineDate(teachEnd)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// NAV_ITEMS, NAV_GROUPS, SectionId live in @/components/student/nav
