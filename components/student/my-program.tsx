'use client';

// My Program section: where a bootcamp student is in their program, built around one journey
// timeline. The road shows every week; the week in view opens in a panel hanging off it, with the
// one next step first. An amber marker with a small runner travels to whichever week is chosen.
// Only the road uses the tenant's two brand colours; the rest follows lib/theme.
// Data comes from /api/student/program; the week and status rules live in lib/student-program.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Lock, RefreshCw, Route, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { Sk, EmptyState } from '@/components/student/shared';
import {
  buildProgramTimeline, dueDateKey, isCompleteStatus, localDateKey,
  type ProgramGroup, type ProgramItemType, type ProgramPayload, type ProgramTimeline, type ProgramWeek, type TimelineItem,
} from '@/lib/student-program';

const GREEN = '#16a34a';
const SKY = '#0ea5e9';
const ATTN = '#f59e0b';
const ATTN_SOFT = 'rgba(245,158,11,0.13)';
// Amber text: deep in light mode, light in dark mode, so it stays readable on its soft tint.
const useAttnInk = () => (useTheme().theme === 'dark' ? '#fbbf24' : '#b45309');
const ROAD_ATTN = '#e5484d';
const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#14b8a6', '#ef4444', '#64748b'];

const TYPE_LABEL: Record<ProgramItemType, string> = {
  course: 'Course', virtual_experience: 'Virtual Experience', assignment: 'Assignment',
  certification: 'Certification', event: 'Live Session',
};

function formatDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  // The week in view starts on the current one (clamped onto the road), else the first; "anytime"
  // holds undated work. "This week" in the stepper returns here.
  const homeWeek: WeekKey = currentWeek && weeks.length
    ? Math.min(currentWeek, weeks.length)
    : weeks.length ? 1 : 'anytime';
  const [sel, setSel] = useState<WeekKey>(homeWeek);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  const closeGroup = useCallback(() => { setGroupOpen(false); groupButtonRef.current?.focus(); }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const [notchX, setNotchX] = useState<number | null>(null);
  const onAnchor = useCallback((clientX: number | null) => {
    const panel = panelRef.current;
    if (!panel || clientX === null) { setNotchX(null); return; }
    const box = panel.getBoundingClientRect();
    setNotchX(Math.max(24, Math.min(box.width - 24, clientX - box.left)));
  }, []);

  const catchUpEnd = timeline.catchUpEndDate;
  const days = (n: number) => plural(n, 'day');
  const heading = phase === 'before' && timeline.daysUntilStart !== null ? `Starts in ${days(timeline.daysUntilStart)}`
    : phase === 'after' ? 'Program complete'
    : phase === 'catch_up' ? 'Catch-up period'
    : currentWeek ? (timeline.hasEndDate ? `Week ${currentWeek} of ${weeks.length}` : `Week ${currentWeek}`)
    : cohort.name;
  const daysNote = phase === 'catch_up' && timeline.daysLeft !== null ? `${days(timeline.daysLeft)} left to catch up`
    : phase === 'during' && timeline.daysLeft !== null ? `${days(timeline.daysLeft)} ${catchUpEnd ? 'of classes ' : ''}left`
    : null;
  const remaining = timeline.required - timeline.completed;
  const pace = timeline.behind > 0
    ? { text: `${plural(timeline.behind, 'thing')} ${timeline.behind === 1 ? 'needs' : 'need'} your attention`, attn: true }
    : (phase === 'catch_up' || phase === 'after') && remaining > 0 ? { text: `${plural(remaining, 'item')} left to finish`, attn: true }
    : phase === 'before' ? null
    : { text: remaining === 0 && timeline.required > 0 ? 'All caught up' : 'You are on track', attn: false };

  return (
    <div className="max-w-6xl">
      <section className="rounded-[28px] min-w-0 overflow-hidden" style={{ background: C.card }} aria-labelledby="program-heading">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 sm:pt-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm" style={{ color: C.muted }}>{greeting(studentName)}</p>
            <h1 id="program-heading" className="text-[28px] sm:text-[34px] font-extrabold leading-[1.08] tracking-tight mt-0.5" style={{ color: C.text }}>
              {heading}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
              {pace && (
                <span className="inline-flex items-center gap-2 text-[13px] font-bold px-3 py-1.5 rounded-full"
                  style={pace.attn ? { background: ATTN_SOFT, color: attnInk } : { background: C.lime, color: C.cta }}>
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: 'currentColor' }}/>{pace.text}
                </span>
              )}
              {timeline.required > 0 && (
                <span className="text-[13px] tabular-nums" style={{ color: C.muted }}>{timeline.completed} of {timeline.required} done</span>
              )}
              {daysNote && <span className="text-[13px] tabular-nums" style={{ color: C.faint }}>{daysNote}</span>}
            </div>
            <p className="text-xs mt-2" style={{ color: C.faint }}>{cohort.name}</p>
          </div>
          {payload.group && <GroupButton ref={groupButtonRef} group={payload.group} C={C} onOpen={() => setGroupOpen(true)}/>}
        </div>

        {payload.items.some(i => i.locked) && (
          <p className="mx-5 sm:mx-6 mt-4 text-[13px] font-medium px-4 py-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
            Some of your work is locked until your payment is up to date. It stays on your journey so you can see what is coming.
          </p>
        )}

        {payload.items.length === 0 ? (
          <div className="pb-4">
            <EmptyState icon={Route} title="Nothing assigned yet" body="When your instructor assigns courses, projects and assignments to your cohort, they will show here."/>
          </div>
        ) : (
          <>
            {weeks.length > 0 && (
              <JourneyRoad weeks={weeks} currentWeek={currentWeek} phase={phase}
                sel={typeof sel === 'number' ? sel : null} onPick={setSel} onAnchor={onAnchor} C={C}/>
            )}
            <div ref={panelRef} className="relative px-5 sm:px-6 pt-5 pb-6" style={{ borderTop: weeks.length ? `1px solid ${C.divider}` : 'none' }}>
              {weeks.length > 0 && notchX !== null && sel !== 'anytime' && (
                <span aria-hidden className="absolute -top-[8px] w-[14px] h-[14px] rounded-tl-[3px] transition-[left] duration-500"
                  style={{ left: notchX, transform: 'translateX(-50%) rotate(45deg)', background: C.card, borderTop: `1px solid ${C.divider}`, borderLeft: `1px solid ${C.divider}` }}/>
              )}
              <WeekPanel sel={sel} setSel={setSel} homeWeek={homeWeek} timeline={timeline} anytime={anytime} C={C}/>
            </div>
          </>
        )}
      </section>

      <AnimatePresence>
        {groupOpen && payload.group && <GroupModal group={payload.group} C={C} onClose={closeGroup}/>}
      </AnimatePresence>
    </div>
  );
}

// --- Journey road ---

const ROAD_H = 150;
const MIN_GAP = 46; // px per week before the road scrolls sideways

function JourneyRoad({ weeks, currentWeek, phase, sel, onPick, onAnchor, C }: {
  weeks: ProgramWeek[]; currentWeek: number | null; phase: ProgramTimeline['phase'];
  sel: number | null; onPick: (w: WeekKey) => void; onAnchor: (clientX: number | null) => void; C: typeof LIGHT_C;
}) {
  const { primaryColor, accentColor } = useTenant();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  // The road alone carries the tenant's brand: primary for progress, secondary for "you".
  const road = dark ? `color-mix(in srgb, ${primaryColor} 62%, white)` : primaryColor;
  const roadHi = accentColor || ATTN;
  const roadBed = dark ? '#262a35' : '#e9edf4';

  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hlRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const tagRef = useRef<SVGTextElement>(null);
  const [viewW, setViewW] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = weeks.length;
  const phone = viewW > 0 && viewW < 620;
  const W = Math.max(viewW, n * MIN_GAP + 90);
  const scrolls = W > viewW;
  const padL = 28, padR = 60, y = ROAD_H / 2;
  const r0 = phone ? 12 : 15, thick = phone ? 14 : 18;
  const xAt = useCallback((w: number) => padL + (W - padL - padR) * (w - 0.5) / n, [W, n]);
  const fillTo = phase === 'before' || !currentWeek ? null : phase === 'after' ? W - padR : xAt(Math.min(currentWeek, n));

  // Slide the marker to the selected week with a small springy overshoot; the runner faces the
  // way it is going. Positioned imperatively so its stride animation never restarts.
  const hlX = useRef<number | null>(null);
  useEffect(() => {
    if (!viewW || sel === null) return;
    const to = xAt(sel);
    const from = hlX.current ?? to;
    const g = hlRef.current, face = faceRef.current, tag = tagRef.current;
    if (!g || !face || !tag) return;
    if (to !== from) face.setAttribute('transform', to < from ? 'translate(24 0) scale(-1 1)' : '');
    const label = sel === currentWeek && phase === 'during' ? 'You are here' : 'Viewing';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 0 : Math.min(900, 260 + Math.abs(to - from) * 0.9);
    const t0 = performance.now();
    let raf = 0;
    tag.textContent = '';
    const step = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const c1 = 1.4, c3 = c1 + 1;
      const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      hlX.current = from + (to - from) * e;
      g.setAttribute('transform', `translate(${hlX.current} ${y})`);
      if (k < 1) raf = requestAnimationFrame(step);
      else { hlX.current = to; tag.textContent = label; }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sel, viewW, xAt, y, currentWeek, phase]);

  // Keep the chosen week in view on a scrolling road, and tell the panel where its pointer goes.
  const reportAnchor = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || sel === null) { onAnchor(null); return; }
    const box = svg.getBoundingClientRect();
    onAnchor(box.left + xAt(sel) * (box.width / W));
  }, [sel, xAt, W, onAnchor]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && scrolls && sel !== null) el.scrollTo({ left: xAt(sel) - el.clientWidth / 2, behavior: 'smooth' });
    reportAnchor();
  }, [sel, scrolls, xAt, reportAnchor, viewW]);
  const scrollFrame = useRef(0);
  const onScroll = () => {
    setTip(null);
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; reportAnchor(); });
  };
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  const move = (w: number) => onPick(Math.max(1, Math.min(n, w)));
  const onKey = (e: React.KeyboardEvent, w: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move((sel ?? w) + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move((sel ?? w) - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(1); }
    else if (e.key === 'End') { e.preventDefault(); move(n); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(w); }
  };
  // Focus follows the arrow keys so screen readers announce the week.
  useEffect(() => {
    if (sel === null) return;
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-week="${sel}"]`);
    if (el && svgRef.current?.contains(document.activeElement)) el.focus();
  }, [sel]);

  return (
    <div className="relative mt-3">
      <div ref={scrollRef} onScroll={onScroll}
        className={`relative ${scrolls ? 'overflow-x-auto overflow-y-hidden' : ''}`}
        style={scrolls ? {
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
        } : undefined}>
        {viewW > 0 && (
          <svg ref={svgRef} width={W} height={ROAD_H} viewBox={`0 0 ${W} ${ROAD_H}`} className="block"
            style={{ width: scrolls ? W : '100%', overflow: 'visible' }}
            role="group" aria-label="Your journey, one stop per week. Use the arrow keys to move between weeks.">
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={roadBed} strokeWidth={thick} strokeLinecap="round"/>
            {fillTo !== null && (
              <motion.line x1={padL} y1={y} y2={y} stroke={road} strokeWidth={thick} strokeLinecap="round"
                initial={{ x2: padL }} animate={{ x2: fillTo }} transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}/>
            )}
            {/* Dashed centre line in the tenant's secondary colour. */}
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={roadHi} strokeWidth={2} strokeDasharray="10 12" strokeLinecap="round"
              className="mp-lane"/>

            {weeks.map(week => {
              const w = week.week, x = xAt(w);
              const full = week.required > 0 && week.completed === week.required;
              const late = week.items.filter(i => i.status === 'overdue').length;
              const fill = late ? ROAD_ATTN : C.card;
              const stroke = late ? 'none' : full ? road : C.skeleton;
              const ink = late ? '#ffffff' : full ? road : C.muted;
              const text = `${late ? `${late} past due, ` : ''}${week.completed} of ${week.required} done`;
              return (
                <g key={w} data-week={w} role="button" tabIndex={w === (sel ?? 1) ? 0 : -1} className="cursor-pointer outline-none group"
                  aria-label={`Week ${w}, from ${formatDay(week.startDate)}, ${text}${w === currentWeek ? ', this week' : ''}`}
                  aria-pressed={w === sel}
                  onClick={() => onPick(w)} onKeyDown={e => onKey(e, w)}
                  onPointerEnter={e => { if (e.pointerType === 'mouse') setTip({ x: x - (scrollRef.current?.scrollLeft ?? 0), y: y - r0, text }); }}
                  onPointerLeave={() => setTip(null)}>
                  <circle cx={x} cy={y} r={r0 + 8} fill="transparent"/>
                  <circle cx={x} cy={y} r={r0} fill={fill} stroke={stroke} strokeWidth={3}
                    className="transition-transform group-hover:scale-110 group-focus-visible:stroke-[4]"
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}/>
                  {full && !late
                    ? <path d={`M${x - r0 * 0.36} ${y + r0 * 0.02} l${r0 * 0.24} ${r0 * 0.26} l${r0 * 0.46} ${-r0 * 0.5}`}
                        fill="none" stroke={ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}/>
                    : <text x={x} y={y} fill={ink} textAnchor="middle" dominantBaseline="central"
                        style={{ fontWeight: 800, fontSize: late ? 15 : 12, pointerEvents: 'none' }}>
                        {late ? '!' : w}
                      </text>}
                </g>
              );
            })}

            {/* Finish flag */}
            <line x1={W - padR + 14} y1={y + 12} x2={W - padR + 14} y2={y - 40} stroke={C.text} strokeWidth={3} strokeLinecap="round"/>
            <path d={`M${W - padR + 15} ${y - 40} l24 7 -24 8 z`} fill={roadHi}/>
            <text x={W - padR + 12} y={y + 30} textAnchor="middle" style={{ fontWeight: 700, fontSize: 11 }} fill={C.muted}>Finish</text>

            {sel !== null && (
              <g ref={hlRef} style={{ pointerEvents: 'none' }} transform={`translate(${xAt(sel)} ${y})`}>
                <circle className="mp-focus" r={r0 + 6} fill="none" stroke={C.text} strokeWidth={2}/>
                <circle r={r0 + 1} fill="#ffffff" stroke={roadHi} strokeWidth={3}/>
                <svg x={-r0} y={-r0} width={2 * r0} height={2 * r0} viewBox="0 0 24 24" overflow="visible">
                  <g ref={faceRef}><Runner/></g>
                </svg>
                <text ref={tagRef} y={r0 + 18} textAnchor="middle" fill={`color-mix(in srgb, ${roadHi} 55%, ${C.text})`} style={{ fontWeight: 800, fontSize: 11 }}/>
              </g>
            )}
          </svg>
        )}
      </div>
      {tip && (
        <div className="absolute pointer-events-none text-xs font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap"
          style={{ left: Math.max(70, Math.min(viewW - 70, tip.x)), top: tip.y, transform: 'translate(-50%, calc(-100% - 10px))', background: C.text, color: C.card }}>
          {tip.text}
        </div>
      )}
      <style>{`.mp-focus { opacity: 0; } svg:has(:focus-visible) .mp-focus { opacity: 1; }
        .mp-lane { animation: mp-flow 1.6s linear infinite; } @keyframes mp-flow { to { stroke-dashoffset: -22; } }
        .mp-rn { animation: mp-bob .22s ease-in-out infinite alternate; }
        .mp-rn .mp-a { animation: mp-a .44s steps(1) infinite; } .mp-rn .mp-b { animation: mp-b .44s steps(1) infinite; }
        @keyframes mp-a { 0% { opacity: 1; } 50% { opacity: 0; } } @keyframes mp-b { 0% { opacity: 0; } 50% { opacity: 1; } }
        @keyframes mp-bob { from { transform: translate(2.6px, 1.8px) scale(0.8); } to { transform: translate(2.6px, 1px) scale(0.8); } }
        @media (prefers-reduced-motion: reduce) { .mp-lane, .mp-rn, .mp-rn .mp-a { animation: none; } .mp-rn .mp-b { display: none; } }`}</style>
    </div>
  );
}

// A small full-colour runner (shirt, jeans, boots). Two stride poses swap like a flip-book.
const SHIRT = '#0ea5a4', SKIN = '#f2c27b', HAIR = '#4a2c1a', JEANS = '#2f5fd0', BOOT = '#6b3f1f';
type Pt = [number, number];
const limb = (pts: Pt[], color: string, w: number) => (
  <path d={'M' + pts.map(p => p.join(' ')).join(' L')} stroke={color} strokeWidth={w}/>
);
function Pose({ cls, backArm, backLeg, backBoot, frontArm, frontLeg, frontBoot }: {
  cls: string; backArm: Pt[]; backLeg: Pt[]; backBoot: Pt[]; frontArm: Pt[]; frontLeg: Pt[]; frontBoot: Pt[];
}) {
  const hand = (pts: Pt[]) => <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={1.25} fill={SKIN}/>;
  return (
    <g className={cls}>
      {limb(backLeg, JEANS, 3.4)}{limb(backBoot, BOOT, 3.6)}
      {limb(backArm, SHIRT, 2.8)}{hand(backArm)}
      <path d="M13.6 7.6 L11.4 13.6" stroke={SHIRT} strokeWidth={4.4}/>
      {limb(frontLeg, JEANS, 3.4)}{limb(frontBoot, BOOT, 3.6)}
      {limb(frontArm, SHIRT, 2.8)}{hand(frontArm)}
    </g>
  );
}
function Runner() {
  return (
    <g className="mp-rn" transform="translate(2.6 1.8) scale(0.8)" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <Pose cls="mp-a"
        backArm={[[13.2, 8.9], [10, 10.3], [8.7, 12.6]]} backLeg={[[11.4, 13.6], [8.6, 16.8], [5.9, 17.9]]} backBoot={[[5.9, 17.9], [4.4, 16.4]]}
        frontArm={[[13.2, 8.9], [16.3, 10.4], [17.5, 8.3]]} frontLeg={[[11.4, 13.6], [14.4, 16.8], [13.5, 20.6]]} frontBoot={[[13.3, 21], [15.6, 21]]}/>
      <Pose cls="mp-b"
        backArm={[[13.2, 8.9], [15.4, 11.2], [17.7, 11.8]]} backLeg={[[11.4, 13.6], [10.4, 17.5], [8.6, 20.6]]} backBoot={[[8.4, 21], [6.4, 20.8]]}
        frontArm={[[13.2, 8.9], [10.7, 11], [11.6, 13.2]]} frontLeg={[[11.4, 13.6], [15.4, 15.6], [17.7, 17.9]]} frontBoot={[[17.7, 17.9], [19.3, 16.8]]}/>
      <circle cx="14.6" cy="4.4" r="2.6" fill={SKIN}/>
      <path d="M12.1 4.1 C12.2 1.6 15.6 1.1 16.9 3 C16.1 2.7 15.2 3 14.7 3.6 C14 3 13 3.2 12.1 4.1 Z" fill={HAIR}/>
    </g>
  );
}

// --- Week panel ---

function WeekPanel({ sel, setSel, homeWeek, timeline, anytime, C }: {
  sel: WeekKey; setSel: (w: WeekKey) => void; homeWeek: WeekKey; timeline: ProgramTimeline; anytime: TimelineItem[]; C: typeof LIGHT_C;
}) {
  const { weeks, currentWeek, phase, upNext } = timeline;
  const week = typeof sel === 'number' ? weeks[sel - 1] : null;
  const list = week ? week.items : anytime;
  const isHome = sel === homeWeek;
  const when = sel === 'anytime' ? 'No due or assigned date'
    : phase === 'during' && sel === currentWeek ? 'This week'
    : currentWeek && typeof sel === 'number' && sel < currentWeek ? 'Earlier'
    : phase === 'after' || phase === 'catch_up' ? 'Earlier' : 'Coming up';
  // The one next step leads the current week, even when it belongs to an earlier one.
  const focus = isHome && phase !== 'before' && upNext ? upNext : null;
  const rest = list.filter(i => i !== focus);
  const settled = (i: TimelineItem) => isCompleteStatus(i.status) || i.status === 'attended' || i.status === 'missed';
  const open = rest.filter(i => !settled(i));
  const fin = rest.filter(settled);
  const required = week ? week.required : list.filter(i => i.type !== 'event').length;
  const done = week ? week.completed : list.filter(i => i.type !== 'event' && isCompleteStatus(i.status)).length;
  const allDone = !!week && required > 0 && done === required;
  const pct = required ? (done / required) * 100 : 0;
  const lastWeek = weeks.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <h2 className="text-xl font-bold tracking-tight" style={{ color: C.text }}>{week ? `Week ${week.week}` : 'Any time'}</h2>
          <p className="text-[13px] mt-0.5 tabular-nums" style={{ color: C.muted }}>
            {when}{week ? `, from ${formatDay(week.startDate)}` : ''}{required ? `, ${done} of ${required} done` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anytime.length > 0 && sel !== 'anytime' && (
            <button onClick={() => setSel('anytime')} className="text-[12.5px] font-bold px-3 py-2 rounded-full" style={{ background: C.pill, color: C.muted }}>
              Any time ({anytime.length})
            </button>
          )}
          {lastWeek > 0 && (
            <div className="flex items-center gap-1.5 p-1 rounded-full" style={{ background: C.pill }} role="group" aria-label="Choose a week">
              <StepButton label="Previous week" disabled={sel === 1} onClick={() => setSel(typeof sel === 'number' ? sel - 1 : lastWeek)} C={C}>
                <ArrowLeft className="w-4 h-4"/>
              </StepButton>
              {!isHome && (
                <button onClick={() => setSel(homeWeek)} className="text-[12.5px] font-extrabold px-3 py-2 rounded-full" style={{ background: C.lime, color: C.cta }}>
                  {phase === 'during' ? 'This week' : 'Back'}
                </button>
              )}
              <StepButton label="Next week" disabled={sel === lastWeek || sel === 'anytime'} onClick={() => typeof sel === 'number' && setSel(sel + 1)} C={C}>
                <ArrowRight className="w-4 h-4"/>
              </StepButton>
            </div>
          )}
        </div>
      </div>
      {required > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden mt-3.5" style={{ background: C.pill }}>
          <motion.div className="h-full rounded-full" style={{ background: C.cta }} initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}/>
        </div>
      )}

      {focus && <FocusCard item={focus} C={C}/>}

      <AnimatePresence mode="wait">
        <motion.div key={String(sel)} className="space-y-2 mt-3"
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {allDone && currentWeek && typeof sel === 'number' && sel < currentWeek && (
            <div className="text-center px-4 py-5 rounded-2xl" style={{ background: C.page }}>
              <p className="text-base font-bold" style={{ color: C.text }}>Week {sel} complete</p>
              <p className="text-sm mt-0.5" style={{ color: C.muted }}>You finished everything planned for this week.</p>
            </div>
          )}
          {[...open, ...fin].map(item => <ItemRow key={`${item.type}-${item.id}`} item={item} C={C}/>)}
          {!focus && open.length + fin.length === 0 && (
            <div className="text-center px-4 py-6 rounded-2xl" style={{ background: C.page }}>
              <p className="text-base font-bold" style={{ color: C.text }}>Nothing planned</p>
              <p className="text-sm mt-0.5" style={{ color: C.muted }}>No work is scheduled for this week.</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children, C }: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode; C: typeof LIGHT_C;
}) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick}
      className="w-[34px] h-[34px] rounded-full grid place-items-center transition-opacity disabled:opacity-35"
      style={{ background: C.card, color: C.text, border: `1.5px solid ${C.divider}` }}>
      {children}
    </button>
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

function itemMeta(item: TimelineItem) {
  const parts: string[] = [TYPE_LABEL[item.type]];
  if (item.dueDate) parts.push(item.type === 'event' ? formatDay(item.dueDate) : item.status === 'overdue' ? `Was due ${formatDay(item.dueDate)}` : `Due ${formatDay(item.dueDate)}`);
  const assigned = dueDateKey(item.assignedAt);
  if (!item.dueDate && assigned) parts.push(`Assigned ${formatDay(assigned)}`);
  if (item.recurring) parts.push('Repeats');
  if ((item.status === 'progress' || item.status === 'overdue') && item.progressPct > 0) parts.push(`${item.progressPct}% done`);
  if (item.status === 'awaiting') parts.push('In review');
  if (item.type === 'event') parts.push('Not counted toward progress');
  return parts.join(', ');
}

function FocusCard({ item, C }: { item: TimelineItem; C: typeof LIGHT_C }) {
  return (
    <div className="relative isolate overflow-hidden mt-4 rounded-2xl p-4 flex flex-wrap sm:flex-nowrap items-center gap-3.5" style={{ background: C.page }}>
      <span aria-hidden className="absolute -right-16 -top-20 w-56 h-56 rounded-full -z-10"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${C.cta} 28%, transparent), transparent 65%)` }}/>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.cta }}>Start here</p>
        <p className="text-[17px] font-extrabold mt-0.5 truncate" style={{ color: C.text }}>{item.title}</p>
        <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>{itemMeta(item)}{item.week ? `, Week ${item.week}` : ''}</p>
      </div>
      <ItemLink item={item}
        className="w-full sm:w-auto justify-center inline-flex items-center gap-2 text-sm font-extrabold px-5 py-3 rounded-2xl transition-transform hover:-translate-y-px"
        style={{ background: C.cta, color: C.ctaText }}>
        {actionLabel(item)} <ArrowRight className="w-4 h-4"/>
      </ItemLink>
    </div>
  );
}

function StateMark({ item, C }: { item: TimelineItem; C: typeof LIGHT_C }) {
  const base = 'w-[22px] h-[22px] rounded-full grid place-items-center flex-shrink-0';
  if (isCompleteStatus(item.status) || item.status === 'attended') {
    return <span className={base} style={{ background: GREEN, color: '#ffffff' }}><Check className="w-3 h-3" strokeWidth={3.5}/></span>;
  }
  if (item.status === 'progress') {
    const p = Math.max(item.progressPct, 8);
    return <span className={base} style={{ border: `2px solid ${SKY}`, background: `conic-gradient(${SKY} ${p}%, transparent 0)` }}/>;
  }
  const attn = item.status === 'overdue' || item.status === 'failed';
  return <span className={base} style={{ border: `2px solid ${attn ? ATTN : C.skeleton}` }}/>;
}

function ItemRow({ item, C }: { item: TimelineItem; C: typeof LIGHT_C }) {
  const attnInk = useAttnInk();
  const finished = isCompleteStatus(item.status) || item.status === 'attended';
  const tags: { text: string; attn?: boolean }[] = [];
  if (item.status === 'overdue') tags.push({ text: 'Past due', attn: true });
  if (item.status === 'failed') tags.push({ text: 'Not passed', attn: true });
  if (item.status === 'missed') tags.push({ text: 'Missed' });
  if (item.carriedFrom) tags.push({ text: `From week ${item.carriedFrom}` });
  if (item.locked) tags.push({ text: 'Locked' });
  return (
    <div className="flex items-center gap-3.5 px-3.5 py-3 rounded-2xl" style={{ background: C.page }}>
      <StateMark item={item} C={C}/>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold truncate" style={{ color: finished ? C.muted : C.text }}>{item.title}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] mt-0.5" style={{ color: C.faint }}>
          <span>{itemMeta(item)}</span>
          {tags.map(t => (
            <span key={t.text} className="text-[11px] font-bold px-2 py-0.5 rounded-md"
              style={t.attn ? { background: ATTN_SOFT, color: attnInk } : { background: C.pill, color: C.muted }}>{t.text}</span>
          ))}
        </div>
      </div>
      {item.locked
        ? <span className="w-9 h-9 grid place-items-center flex-shrink-0" style={{ color: C.faint }}><Lock className="w-4 h-4" aria-label="Locked"/></span>
        : (
          <ItemLink item={item} label={`${actionLabel(item)} ${item.title}`}
            className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ background: C.card, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </ItemLink>
        )}
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
      style={{ background: C.pill, color: C.text }}>
      <span className="flex items-center pl-2">
        {group.members.slice(0, 3).map((m, i) => (
          <span key={m.id} className="-ml-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${C.pill}` }}><Avatar member={m} index={i} size={26}/></span>
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
    <div className="max-w-6xl rounded-[28px] p-6 space-y-5" style={{ background: C.card }}>
      <div className="space-y-2"><Sk w={140} h={12}/><Sk w={260} h={30}/><Sk w={220} h={14}/></div>
      <Sk h={56} r={28}/>
      <div className="space-y-2.5"><Sk w={120} h={18}/><Sk h={64} r={16}/><Sk h={56} r={16}/><Sk h={56} r={16}/></div>
    </div>
  );
}
