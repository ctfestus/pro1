'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, X, CalendarDays, List, Calendar,
  Clock, MapPin, ClipboardList, ExternalLink, Video,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { useC as usePlatformC } from '@/lib/theme';
import { sanitizeRichText } from '@/lib/sanitize';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

/* --- tokens --- */
const LIGHT = {
  isDark: false,
  bg: '#F2F5FA', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.07)',
  cardShadow: 'none',
  text: '#111827', muted: '#4B5563', faint: '#9CA3AF',
  divider: 'rgba(0,0,0,0.07)', pill: '#F4F4F4',
  todayBg: '#0e09dd', todayText: '#ffffff',
  hoverCell: 'rgba(14,9,221,0.04)',
};
const DARK = {
  isDark: true,
  bg: '#17181E', card: '#1E1F26', cardBorder: 'rgba(255,255,255,0.07)',
  cardShadow: 'none',
  text: '#F0F2F5', muted: '#9CA3AF', faint: '#6B7280',
  divider: 'rgba(255,255,255,0.07)', pill: '#2a2b34',
  todayBg: '#3E93FF', todayText: '#ffffff',
  hoverCell: 'rgba(62,147,255,0.06)',
};
type Colors = typeof LIGHT;
function useColors(): Colors { const { theme } = useTheme(); return theme === 'dark' ? DARK : LIGHT; }

/* --- mobile hook --- */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

/* --- types --- */
type ItemKind = 'event' | 'assignment';
type CalView = 'month' | 'week' | 'list';

interface CalItem {
  id: string;
  kind: ItemKind;
  title: string;
  date: Date;
  coverImage: string | null;
  description: string | null;
  eventType?: string;
  locationText?: string | null;
  meetingLink?: string | null;
  slug?: string | null;
  deadlineLabel?: string;
  submissionStatus?: string | null;
  hasTime: boolean;
  recurrence?: string | null;
  recurrenceEndDate?: string | null;
  joinToken?: string | null;
}

/* --- kind metadata --- */
const KIND_META: Record<ItemKind, { bg: string; border: string; text: string; dot: string; label: string }> = {
  // --cal-live is the platform colour, set on the calendar's root.
  event:      { bg: 'color-mix(in srgb, var(--cal-live) 11%, transparent)', border: 'var(--cal-live)', text: 'var(--cal-live)', dot: 'var(--cal-live)', label: 'Live Session' },
  assignment: { bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b', text: '#d97706', dot: '#f59e0b', label: 'Assignment'    },
};

/* --- date utils --- */
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDOW(y: number, m: number) { return new Date(y, m, 1).getDay(); }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d: Date): Date { const r = new Date(d); r.setDate(d.getDate() - d.getDay()); r.setHours(0, 0, 0, 0); return r; }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WDAY_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WDAY_LETTER = ['S','M','T','W','T','F','S'];

function fmtTime(d: Date) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
function fmtDateMed(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateLong(d: Date) { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

function groupLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

function sanitizeUrl(v?: string | null) {
  if (!v) return null;
  const normalized = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(normalized);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch { return null; }
}

/* Expand a recurring event into one date-string per occurrence.
   Mirrors the reminder-cron semantics: weekly repeats on recurrence_days
   (empty = every day), daily repeats every day.

   Iteration begins at the later of the series start and the start of the
   current month, so a long-running series can never exhaust the cap on
   historical dates before reaching upcoming sessions. A series with an
   explicit recurrence_end_date is expanded fully through that date (bounded
   only by the safety cap); an open-ended series falls back to a 6-month
   horizon since "all upcoming" is otherwise unbounded. */
function expandEventDates(
  startStr: string,
  recurrence: string | null,
  days: number[],
  endStr: string | null,
): string[] {
  if (!recurrence || recurrence === 'once') return [startStr];

  const [sy, sm, sd] = startStr.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  if (isNaN(start.getTime())) return [startStr];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today.getFullYear(), today.getMonth(), 1);

  let end: Date;
  if (endStr) {
    const [ey, em, ed] = endStr.split('-').map(Number);
    end = new Date(ey, em - 1, ed);
  } else {
    end = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  }

  const out: string[] = [];
  const cur = start > windowStart ? new Date(start) : new Date(windowStart);
  const MAX = 400; // safety cap
  while (cur <= end && out.length < MAX) {
    const matches = recurrence === 'weekly'
      ? (days.length === 0 || days.includes(cur.getDay()))
      : true; // daily
    if (matches) out.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  // Fallback: series fully in the past, or starts beyond the horizon --
  // still surface the original date so the event is never dropped entirely.
  return out.length ? out : [startStr];
}

/* --- Skeleton --- */
function Sk({ w = '100%', h = 16, r = 8 }: { w?: string | number; h?: number; r?: number }) {
  const C = useColors();
  return <div style={{ width: w, height: h, borderRadius: r, background: C.pill, flexShrink: 0 }} className="animate-pulse" />;
}

/* ==========================================================
   ItemModal
   ========================================================== */
function ItemModal({ item, onClose, onNavigate }: {
  item: CalItem;
  onClose: () => void;
  onNavigate: (section: string) => void;
}) {
  const C = useColors();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const meta = KIND_META[item.kind];
  const [imgErr, setImgErr] = useState(false);
  const [localToken, setLocalToken] = useState<string | null>(item.joinToken ?? null);
  const [joinErr, setJoinErr] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const now = new Date();
  const isPast = item.date < now;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden"
        style={{
          background: C.card,
          boxShadow: isDark ? '0 24px 80px rgba(0,0,0,0.75)' : '0 24px 80px rgba(0,0,0,0.22)',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cover */}
        <div className="relative w-full flex-shrink-0" style={{ height: 200, background: meta.bg }}>
          {item.coverImage && !imgErr
            ? (
              <img
                src={resolveCoverUrl(item.coverImage)} alt={item.title}
                className="w-full h-full object-cover"
                onError={() => setImgErr(true)}
              />
            )
            : (
              <div className="w-full h-full flex items-center justify-center">
                {item.kind === 'event'
                  ? <CalendarDays className="w-14 h-14 opacity-20" style={{ color: meta.dot }} />
                  : <ClipboardList className="w-14 h-14 opacity-20" style={{ color: meta.dot }} />}
              </div>
            )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 60%)' }} />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{ background: 'rgba(0,0,0,0.40)', color: '#fff' }}
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute bottom-3 left-4">
            <span
              className="text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: meta.bg, color: meta.text, border: isDark ? 'none' : `1px solid ${meta.border}30` }}
            >
              {meta.label}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <h2 className="text-lg font-bold leading-snug" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
            {item.title}
          </h2>

          <div className="flex items-start gap-2.5 text-sm" style={{ color: C.muted }}>
            <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: meta.dot }} />
            <span>
              {item.kind === 'event'
                ? item.hasTime ? `${fmtDateLong(item.date)} at ${fmtTime(item.date)}` : fmtDateLong(item.date)
                : `Due ${fmtDateLong(item.date)}`}
            </span>
          </div>

          {item.kind === 'event' && item.locationText && (
            <div className="flex items-center gap-2.5 text-sm" style={{ color: C.muted }}>
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: meta.dot }} />
              <span>{item.locationText}</span>
            </div>
          )}

          {item.kind === 'event' && (
            <div className="flex items-center gap-2.5 text-sm" style={{ color: C.muted }}>
              <Video className="w-4 h-4 flex-shrink-0" style={{ color: meta.dot }} />
              <span>{(item.eventType ?? '').toLowerCase() === 'virtual' ? 'Virtual event' : 'In-person event'}</span>
            </div>
          )}

          {item.kind === 'assignment' && item.submissionStatus && (
            <div
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={
                item.submissionStatus === 'graded' || item.submissionStatus === 'submitted'
                  ? { background: 'rgba(22,163,74,0.10)', color: '#16a34a' }
                  : { background: 'rgba(245,158,11,0.12)', color: '#d97706' }
              }
            >
              {item.submissionStatus === 'graded' ? 'Graded' : item.submissionStatus === 'submitted' ? 'Submitted' : 'Draft'}
            </div>
          )}

          {item.description && (
            <div
              className="text-sm leading-relaxed line-clamp-4"
              style={{ color: C.muted }}
              dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.description) }}
            />
          )}

          <div className="pt-2 space-y-2">
            {item.kind === 'event' && (localToken || item.meetingLink) && !isPast && (
              <>
                <button
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                  style={{ background: meta.dot, color: '#fff', border: 'none', cursor: 'pointer' }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setJoinErr('');
                    if (localToken) {
                      window.open(`/api/join?token=${localToken}`, '_blank', 'noopener,noreferrer');
                      return;
                    }
                    const win = window.open('', '_blank', 'noopener,noreferrer');
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (session?.access_token) {
                        const res = await fetch('/api/event-register', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                          body: JSON.stringify({ formId: item.id }),
                        });
                        const json = await res.json();
                        if (json.join_token) {
                          setLocalToken(json.join_token);
                          if (win) { win.location.href = `/api/join?token=${json.join_token}`; return; }
                        }
                      }
                    } catch {}
                    win?.close();
                    setJoinErr('Could not get your join link. Please refresh and try again.');
                  }}
                >
                  <ExternalLink className="w-4 h-4" /> Join Session
                </button>
                {joinErr && (
                  <p className="text-xs text-center" style={{ color: '#ef4444', margin: 0 }}>{joinErr}</p>
                )}
              </>
            )}
            <button
              onClick={() => { onClose(); onNavigate(item.kind === 'event' ? 'events' : 'assignments'); }}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
              style={{ background: C.pill, color: C.muted }}
            >
              {item.kind === 'event' ? 'Open in Live Sessions' : 'Open in Assignments'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ==========================================================
   MonthView
   ========================================================== */
function MonthView({ year, month, today, itemsByDay, onSelect, isMobile }: {
  year: number; month: number; today: Date;
  itemsByDay: Map<string, CalItem[]>;
  onSelect: (item: CalItem) => void;
  isMobile: boolean;
}) {
  const C = useColors();
  const first = firstDOW(year, month);
  const total = daysInMonth(year, month);

  const cells: (Date | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayLabels = isMobile ? WDAY_LETTER : WDAY_SHORT;
  const cellMinH  = isMobile ? 64 : 96;
  const cellPad   = isMobile ? '4px' : '8px';

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: C.card, border: C.isDark ? 'none' : `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow }}
    >
      {/* Day headers */}
      <div className="grid grid-cols-7" style={{ borderBottom: `1px solid ${C.divider}` }}>
        {dayLabels.map((d, i) => (
          <div key={i} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div
          key={wi}
          className="grid grid-cols-7"
          style={{ borderBottom: wi < weeks.length - 1 ? `1px solid ${C.divider}` : 'none' }}
        >
          {week.map((date, di) => {
            const borderLeft = di > 0 ? `1px solid ${C.divider}` : 'none';

            if (!date) {
              return (
                <div
                  key={di}
                  style={{ minHeight: cellMinH, background: C.bg, opacity: 0.5, borderLeft }}
                />
              );
            }

            const k = dateKey(date);
            const dayItems = itemsByDay.get(k) ?? [];
            const isToday  = sameDay(date, today);
            const isPast   = date < today && !isToday;
            const shown    = dayItems.slice(0, isMobile ? 3 : 3);
            const overflow = dayItems.length - 3;

            return (
              <div
                key={di}
                className="transition-colors"
                style={{ minHeight: cellMinH, padding: cellPad, borderLeft, background: isToday ? C.hoverCell : 'transparent' }}
              >
                {/* Day number */}
                <div className="flex justify-end mb-1">
                  <span
                    className="font-semibold flex items-center justify-center rounded-full"
                    style={{
                      width: 22, height: 22, fontSize: 11,
                      background: isToday ? C.todayBg : 'transparent',
                      color: isToday ? C.todayText : isPast ? C.faint : C.text,
                    }}
                  >
                    {date.getDate()}
                  </span>
                </div>

                {/* Items: dots on mobile, pills on desktop */}
                {isMobile ? (
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {shown.map(item => (
                      <button
                        key={item.id}
                        onClick={() => onSelect(item)}
                        className="w-2 h-2 rounded-full flex-shrink-0 transition-opacity hover:opacity-70"
                        style={{ background: KIND_META[item.kind].dot }}
                      />
                    ))}
                    {overflow > 0 && (
                      <span className="text-[9px] leading-none font-bold" style={{ color: C.faint }}>+{overflow}</span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {shown.map(item => (
                      <button
                        key={item.id}
                        onClick={() => onSelect(item)}
                        className="w-full text-left flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium truncate transition-opacity hover:opacity-70"
                        style={{ background: KIND_META[item.kind].bg, color: KIND_META[item.kind].text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: KIND_META[item.kind].dot }} />
                        <span className="truncate">{item.title}</span>
                      </button>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] pl-1.5 font-medium" style={{ color: C.faint }}>+{overflow} more</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ==========================================================
   WeekView  (3-day on mobile, 7-day on desktop)
   ========================================================== */
function WeekView({ focusDate, today, itemsByDay, onSelect, isMobile }: {
  focusDate: Date; today: Date;
  itemsByDay: Map<string, CalItem[]>;
  onSelect: (item: CalItem) => void;
  isMobile: boolean;
}) {
  const C = useColors();

  const days = isMobile
    ? Array.from({ length: 3 }, (_, i) => addDays(focusDate, i - 1))
    : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(focusDate), i));

  const colClass = isMobile ? 'grid-cols-3' : 'grid-cols-7';

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: C.card, border: C.isDark ? 'none' : `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow }}
    >
      {/* Day headers */}
      <div className={`grid ${colClass}`} style={{ borderBottom: `1px solid ${C.divider}` }}>
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={i}
              className="py-3 text-center"
              style={{ borderLeft: i > 0 ? `1px solid ${C.divider}` : 'none' }}
            >
              <p
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: isToday ? C.todayBg : C.faint }}
              >
                {isMobile
                  ? d.toLocaleDateString('en-US', { weekday: 'short' })
                  : WDAY_SHORT[d.getDay()]}
              </p>
              <div
                className="mx-auto mt-1 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{
                  background: isToday ? C.todayBg : 'transparent',
                  color: isToday ? C.todayText : C.text,
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className={`grid ${colClass}`} style={{ minHeight: isMobile ? 180 : 240 }}>
        {days.map((d, i) => {
          const k        = dateKey(d);
          const dayItems = itemsByDay.get(k) ?? [];
          const isToday  = sameDay(d, today);
          return (
            <div
              key={i}
              className="p-2 space-y-1.5"
              style={{
                borderLeft: i > 0 ? `1px solid ${C.divider}` : 'none',
                minHeight: isMobile ? 140 : 200,
                background: isToday ? C.hoverCell : 'transparent',
              }}
            >
              {dayItems.map(item => {
                const meta = KIND_META[item.kind];
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item)}
                    className="w-full text-left p-2 rounded-lg transition-all hover:opacity-75"
                    style={{ background: meta.bg, border: `1px solid ${meta.border}20` }}
                  >
                    <div className="text-[11px] font-semibold truncate" style={{ color: meta.text }}>
                      {item.title}
                    </div>
                    {item.hasTime && (
                      <div className="text-[10px] mt-0.5 font-medium opacity-70" style={{ color: meta.text }}>
                        {fmtTime(item.date)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================
   ListView
   ========================================================== */
function ListRow({ item, onSelect }: { item: CalItem; onSelect: (i: CalItem) => void }) {
  const C = useColors();
  const meta = KIND_META[item.kind];
  const [imgErr, setImgErr] = useState(false);
  const now = new Date();
  const isPast = item.date < now;

  return (
    <button
      onClick={() => onSelect(item)}
      className="w-full text-left flex items-center gap-3 p-3 rounded-xl transition-all"
      style={{
        background: C.card,
        border: C.isDark ? 'none' : `1px solid ${C.cardBorder}`,
        opacity: isPast ? 0.65 : 1,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.80'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isPast ? '0.65' : '1'; }}
    >
      <div
        className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
        style={{ background: meta.bg }}
      >
        {item.coverImage && !imgErr
          ? <img src={resolveCoverUrl(item.coverImage)} alt={item.title} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
          : item.kind === 'event'
            ? <CalendarDays className="w-5 h-5" style={{ color: meta.dot }} />
            : <ClipboardList className="w-5 h-5" style={{ color: meta.dot }} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.title}</p>
        <p className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>
          {item.kind === 'event'
            ? item.hasTime ? `${fmtDateMed(item.date)} at ${fmtTime(item.date)}` : fmtDateMed(item.date)
            : item.deadlineLabel ?? fmtDateMed(item.date)}
        </p>
      </div>

      <span
        className="text-[11px] font-semibold px-2 py-1 rounded-full flex-shrink-0"
        style={{ background: meta.bg, color: meta.text }}
      >
        {meta.label}
      </span>
    </button>
  );
}

function ListView({ items, onSelect }: { items: CalItem[]; onSelect: (item: CalItem) => void }) {
  const C = useColors();

  const grouped: { label: string; key: string; items: CalItem[] }[] = [];
  const keyToIdx = new Map<string, number>();
  for (const item of items) {
    const k = dateKey(item.date);
    if (!keyToIdx.has(k)) {
      keyToIdx.set(k, grouped.length);
      grouped.push({ label: groupLabel(item.date), key: k, items: [] });
    }
    grouped[keyToIdx.get(k)!].items.push(item);
  }

  if (!grouped.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CalendarDays className="w-10 h-10 mb-3" style={{ color: C.faint }} />
        <p className="text-sm font-semibold" style={{ color: C.muted }}>No upcoming events or deadlines</p>
        <p className="text-xs mt-1" style={{ color: C.faint }}>Check back when new items are published.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(group => (
        <div key={group.key}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2.5" style={{ color: C.faint }}>
            {group.label}
          </p>
          <div className="space-y-2">
            {group.items.map(item => (
              <ListRow key={item.id} item={item} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ==========================================================
   CalendarSection -- main export
   ========================================================== */
export default function CalendarSection({ userId, onNavigate }: {
  userId: string;
  onNavigate: (section: string) => void;
}) {
  const platformColor = usePlatformC().cta;
  const C       = useColors();
  const isMobile = useIsMobile();
  const today   = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const [items,      setItems]      = useState<CalItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [view,       setView]       = useState<CalView>('month');
  const [focusDate,  setFocusDate]  = useState<Date>(() => new Date());
  const [selected,   setSelected]   = useState<CalItem | null>(null);
  const [viewInited, setViewInited] = useState(false);

  /* default to list on mobile, month on desktop -- once we know screen size */
  useEffect(() => {
    if (viewInited) return;
    setView(isMobile ? 'list' : 'month');
    setViewInited(true);
  }, [isMobile, viewInited]);

  /* --- fetch --- */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: student } = await supabase.from('students').select('cohort_id').eq('id', userId).single();
        if (!student?.cohort_id) return;

        const { data: gmRows } = await supabase.from('group_members').select('group_id').eq('student_id', userId);
        const myGroupIds = (gmRows ?? []).map((r: any) => r.group_id as string);

        const [{ data: events }, { data: cohortAssignments }, { data: groupAssignments }] = await Promise.all([
          supabase
            .from('events')
            .select('id, title, description, slug, cover_image, event_date, event_time, event_type, location, meeting_link, recurrence, recurrence_end_date, recurrence_days')
            .contains('cohort_ids', [student.cohort_id])
            .eq('status', 'published'),
          supabase
            .from('assignments')
            .select('id, title, scenario, cover_image, deadline_date')
            .contains('cohort_ids', [student.cohort_id])
            .eq('status', 'published')
            .not('deadline_date', 'is', null),
          myGroupIds.length > 0
            ? supabase
                .from('assignments')
                .select('id, title, scenario, cover_image, deadline_date')
                .overlaps('group_ids', myGroupIds)
                .eq('status', 'published')
                .not('deadline_date', 'is', null)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        // Deduplicate assignments by id
        const asmById = new Map<string, any>();
        for (const a of [...(cohortAssignments ?? []), ...(groupAssignments ?? [])]) asmById.set(a.id, a);
        const assignments = Array.from(asmById.values());

        const aIds = assignments.map((a: any) => a.id as string);

        // Fetch both individual subs and group subs for complete status coverage
        const [{ data: indivSubs }, { data: groupSubs }] = await Promise.all([
          aIds.length
            ? supabase.from('assignment_submissions').select('assignment_id, status').eq('student_id', userId).in('assignment_id', aIds)
            : Promise.resolve({ data: [] as any[] }),
          myGroupIds.length > 0 && aIds.length
            ? supabase.from('assignment_submissions').select('assignment_id, status').in('group_id', myGroupIds).in('assignment_id', aIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        // Individual wins over group on conflict
        const subById = new Map<string, string>();
        for (const s of [...(groupSubs ?? []), ...(indivSubs ?? [])]) subById.set(s.assignment_id as string, s.status as string);
        const subMap = Object.fromEntries(subById.entries());

        const eventIds = (events ?? []).map((e: any) => e.id as string).filter(Boolean);
        const { data: regRows } = eventIds.length
          ? await supabase.from('event_registrations').select('event_id, join_token').eq('student_id', userId).in('event_id', eventIds)
          : { data: [] as any[] };
        const tokenMap = new Map<string, string>();
        for (const r of regRows ?? []) if (r.join_token) tokenMap.set(r.event_id as string, r.join_token as string);

        const calItems: CalItem[] = [];

        for (const e of events ?? []) {
          if (!e.event_date) continue;
          const timeStr = e.event_time ? (e.event_time as string).substring(0, 5) : null;
          const recurrenceDays = Array.isArray(e.recurrence_days) ? (e.recurrence_days as number[]) : [];
          const occurrences = expandEventDates(e.event_date, e.recurrence, recurrenceDays, e.recurrence_end_date);

          for (const occDate of occurrences) {
            const d = timeStr ? new Date(`${occDate}T${timeStr}:00`) : new Date(`${occDate}T00:00:00`);
            if (isNaN(d.getTime())) continue;
            calItems.push({
              id: e.id, kind: 'event',
              title: e.title || 'Untitled Event',
              date: d,
              coverImage: e.cover_image || null,
              description: e.description || null,
              eventType: e.event_type || 'Virtual',
              locationText: e.location || null,
              meetingLink: sanitizeUrl(e.meeting_link),
              slug: e.slug || null,
              hasTime: !!timeStr,
              recurrence: e.recurrence || null,
              recurrenceEndDate: e.recurrence_end_date || null,
              joinToken: tokenMap.get(e.id) ?? null,
            });
          }
        }

        for (const a of assignments ?? []) {
          if (!a.deadline_date) continue;
          const d = new Date(`${a.deadline_date}T23:59:00`);
          if (isNaN(d.getTime())) continue;
          calItems.push({
            id: a.id, kind: 'assignment',
            title: a.title || 'Untitled Assignment',
            date: d,
            coverImage: a.cover_image || null,
            description: a.scenario || null,
            deadlineLabel: `Due ${fmtDateMed(d)}`,
            submissionStatus: subMap[a.id] ?? null,
            hasTime: false,
          });
        }

        setItems(calItems.sort((a, b) => a.date.getTime() - b.date.getTime()));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  /* --- itemsByDay --- */
  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const item of items) {
      const k = dateKey(item.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return map;
  }, [items]);

  /* --- navigation --- */
  const weekStep = isMobile ? 3 : 7;

  function navPrev() {
    if (view === 'month') setFocusDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else if (view === 'week') setFocusDate(d => addDays(d, -weekStep));
  }
  function navNext() {
    if (view === 'month') setFocusDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else if (view === 'week') setFocusDate(d => addDays(d, weekStep));
  }

  function navTitle(): string {
    if (view === 'month') {
      return isMobile
        ? `${MONTHS_SHORT[focusDate.getMonth()]} ${focusDate.getFullYear()}`
        : `${MONTHS[focusDate.getMonth()]} ${focusDate.getFullYear()}`;
    }
    if (view === 'week') {
      if (isMobile) {
        const start = addDays(focusDate, -1);
        const end   = addDays(focusDate, 1);
        return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} - ${end.getDate()}`;
      }
      const ws = startOfWeek(focusDate);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) return `${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`;
      return `${MONTHS[ws.getMonth()]} - ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;
    }
    return 'All Events';
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", ['--cal-live' as string]: platformColor }}>

      {/* Toolbar -- stacks on mobile */}
      <div className={`flex mb-5 gap-2 ${isMobile ? 'flex-col' : 'items-center justify-between flex-wrap'}`}>

        {/* Nav controls row */}
        <div className="flex items-center gap-1.5">
          {view !== 'list' && (
            <>
              <button
                onClick={navPrev}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: C.pill, color: C.muted }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span
                className="text-sm font-bold text-center"
                style={{ color: C.text, minWidth: isMobile ? 120 : 148 }}
              >
                {navTitle()}
              </span>
              <button
                onClick={navNext}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: C.pill, color: C.muted }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setFocusDate(new Date())}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-70"
                style={{ background: C.pill, color: C.muted }}
              >
                Today
              </button>
            </>
          )}
          {view === 'list' && (
            <span className="text-sm font-bold" style={{ color: C.text }}>All Events &amp; Deadlines</span>
          )}
        </div>

        {/* View switcher -- icons-only on mobile */}
        <div
          className={`flex items-center gap-0.5 p-1 rounded-xl ${isMobile ? 'self-start' : ''}`}
          style={{ background: C.pill }}
        >
          {([
            ['month', 'Month', Calendar],
            ['week',  'Week',  CalendarDays],
            ['list',  'List',  List],
          ] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                padding: isMobile ? '6px 10px' : '6px 12px',
                background: view === v ? C.card : 'transparent',
                color: view === v ? C.text : C.faint,
                boxShadow: view === v ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {!isMobile && label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-4">
        {(['event', 'assignment'] as ItemKind[]).map(k => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: KIND_META[k].dot }} />
            <span className="text-xs" style={{ color: C.faint }}>{KIND_META[k].label}</span>
          </div>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          <Sk h={48} r={12} />
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: 35 }).map((_, i) => <Sk key={i} h={isMobile ? 64 : 96} r={0} />)}
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {view === 'month' && (
              <MonthView
                year={focusDate.getFullYear()}
                month={focusDate.getMonth()}
                today={today}
                itemsByDay={itemsByDay}
                onSelect={setSelected}
                isMobile={isMobile}
              />
            )}
            {view === 'week' && (
              <WeekView
                focusDate={focusDate}
                today={today}
                itemsByDay={itemsByDay}
                onSelect={setSelected}
                isMobile={isMobile}
              />
            )}
            {view === 'list' && (
              <ListView items={items} onSelect={setSelected} />
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Item modal */}
      <AnimatePresence>
        {selected && (
          <ItemModal
            item={selected}
            onClose={() => setSelected(null)}
            onNavigate={(section) => { setSelected(null); onNavigate(section); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
