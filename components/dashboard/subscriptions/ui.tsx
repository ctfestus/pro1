'use client';

// Shared helpers and small building blocks for the Subscriptions page tabs.

import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { DARK_C, cardStyle, type ThemeColors } from '@/lib/theme';
import { formatMoney } from '@/lib/pricing-offer';

export const DISPLAY_FONT = 'var(--font-display), sans-serif';

// The shared formatter, so this page and the pricing pages write amounts the same way.
export const money = (currency: string, amount: number | string) => formatMoney(currency, Number(amount));

export function daysRemaining(value?: string | null) {
  return value ? Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000) : 0;
}

export function dateLabel(value?: string | null) {
  return value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '--';
}

export function shortDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '--';
}

/** Live access: marked active and not past its end date. Used for every count and pill on the page. */
export function isLive(sub: any) {
  return sub.status === 'active' && daysRemaining(sub.current_period_end) >= 0;
}

/** Whether a payment request's deadline (a calendar date) has passed, judged in UTC as the server does. */
export function pastDeadline(dueDate?: string | null) {
  return Boolean(dueDate) && new Date(`${dueDate}T23:59:59Z`).getTime() < Date.now();
}

export function daysLate(dueDate: string) {
  return Math.max(1, Math.ceil((Date.now() - new Date(`${dueDate}T23:59:59Z`).getTime()) / 86_400_000));
}

/** The status filter a subscription falls under: live access ending within 30 days is "soon". */
export type SubscriberBucket = 'active' | 'soon' | 'ended' | 'cancelled';
export function subscriberBucket(sub: any): SubscriberBucket {
  if (sub.status === 'cancelled') return 'cancelled';
  if (!isLive(sub)) return 'ended';
  return daysRemaining(sub.current_period_end) <= 30 ? 'soon' : 'active';
}

/** How much of the current access period has gone, as a percentage (100 once it has ended). */
export function accessUsed(sub: any) {
  const start = new Date(sub.current_period_start).getTime();
  const end = new Date(sub.current_period_end).getTime();
  return !isLive(sub) || !(end > start) ? 100 : ((Date.now() - start) / (end - start)) * 100;
}

export function learnerName(person: any) {
  return person?.full_name || person?.email || 'Unnamed learner';
}

export function initials(name: string) {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export type Palette = ReturnType<typeof palette>;
export function palette(C: ThemeColors) {
  return C.page === DARK_C.page
    ? {
        good: '#3DD68C', goodSoft: 'rgba(61,214,140,0.12)',
        warn: '#F5B454', warnSoft: 'rgba(245,180,84,0.14)',
        bad: '#FF7A6E', badSoft: 'rgba(255,122,110,0.14)',
        gold: C.cta, goldText: '#FFFFFF', ctaSoft: `${C.cta}24`,
      }
    : {
        good: '#12A150', goodSoft: 'rgba(18,161,80,0.10)',
        warn: '#B45309', warnSoft: 'rgba(217,119,6,0.12)',
        bad: '#D92D20', badSoft: 'rgba(217,45,32,0.10)',
        gold: '#F5D77A', goldText: '#3D2E00', ctaSoft: `${C.cta}14`,
      };
}

export type Tone = 'good' | 'warn' | 'bad' | 'mute' | 'cta' | 'gold';

export function Pill({ tone, dot, C, children }: { tone: Tone; dot?: boolean; C: ThemeColors; children: ReactNode }) {
  const P = palette(C);
  const style =
    tone === 'good' ? { color: P.good, background: C.card, boxShadow: `inset 0 0 0 1px ${P.goodSoft}` }
    : tone === 'warn' ? { color: P.warn, background: P.warnSoft }
    : tone === 'bad' ? { color: P.bad, background: P.badSoft }
    : tone === 'cta' ? { color: C.cta, background: P.ctaSoft }
    : tone === 'gold' ? { color: P.goldText, background: P.gold }
    : { color: C.muted, background: C.pill };
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2 whitespace-nowrap leading-5 ${tone === 'gold' ? 'text-[11px] font-black uppercase tracking-[0.06em]' : 'text-xs font-semibold'}`}
      style={style}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  );
}

export function IconChip({ color, background, children }: { color: string; background: string; children: ReactNode }) {
  return (
    <span className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ color, background }}>
      {children}
    </span>
  );
}

export function Avatar({ name, color, background }: { name: string; color: string; background: string }) {
  return (
    <span className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 text-xs font-bold" style={{ color, background }}>
      {initials(name)}
    </span>
  );
}

export function Bar({ parts, C }: { parts: { pct: number; color: string }[]; C: ThemeColors }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: C.pill }}>
      {parts.map((part, index) => (
        <i key={index} className="block h-full" style={{ width: `${Math.max(0, Math.min(100, part.pct))}%`, background: part.color }} />
      ))}
    </div>
  );
}

export function Count({ n, alert, C }: { n: number; alert?: boolean; C: ThemeColors }) {
  return (
    <span
      className="rounded-full px-2 text-xs font-bold leading-5"
      style={alert ? { background: palette(C).bad, color: '#FFFFFF' } : { background: C.pill, color: C.muted }}
    >
      {n}
    </span>
  );
}

export type BtnKind = 'pri' | 'sec' | 'ghost' | 'danger';
export function btnStyle(kind: BtnKind, C: ThemeColors) {
  const P = palette(C);
  return kind === 'pri' ? { background: C.cta, color: C.ctaText }
    : kind === 'sec' ? { background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.divider}` }
    : kind === 'danger' ? { background: P.badSoft, color: P.bad }
    : { background: C.pill, color: C.text };
}
export const btnClass = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50';
export const btnSmClass = 'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-[10px] text-xs font-semibold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50';

export function LinkBtn({ onClick, C, children }: { onClick: () => void; C: ThemeColors; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap" style={{ color: C.cta }}>
      {children}
      <ChevronRight className="w-4 h-4" />
    </button>
  );
}

export function Card({ C, className = '', children, style }: { C: ThemeColors; className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`rounded-2xl ${className}`} style={{ ...cardStyle(C), ...style }}>
      {children}
    </div>
  );
}

export function CardHead({ title, sub, action, C }: { title: string; sub: string; action?: ReactNode; C: ThemeColors }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
      <div className="min-w-0">
        <h3 className="text-base font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
        <p className="text-xs mt-1" style={{ color: C.muted }}>{sub}</p>
      </div>
      {action}
    </div>
  );
}

/** One line in a card list. Rows after the first get a hairline above them. */
export function Row({ C, first, children, className = '' }: { C: ThemeColors; first?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3 ${className}`} style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      {children}
    </div>
  );
}

/** Phone width: the text takes the whole line and the buttons after it wrap below. */
export const WIDE = 'grow shrink basis-[calc(100%-48px)] sm:basis-0';

export function Lines({ title, sub, C, wide }: { title: ReactNode; sub?: ReactNode; C: ThemeColors; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? WIDE : 'flex-1'}`}>
      <div className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: C.text }}>{title}</div>
      {sub && <div className="text-xs" style={{ color: C.muted }}>{sub}</div>}
    </div>
  );
}

export function Empty({ C, title, sub }: { C: ThemeColors; title: string; sub?: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>
      {sub && <p className="text-xs mt-1" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

export function Money({ children, C, className = '' }: { children: ReactNode; C: ThemeColors; className?: string }) {
  return (
    <span className={`font-bold whitespace-nowrap tabular-nums ${className}`} style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
      {children}
    </span>
  );
}

export function pendingConfirmation(request: any) {
  return request.subscription_payment_confirmations?.find((row: any) => row.status === 'pending')
    ?? request.subscription_payment_confirmations?.[0];
}

export function reviewTitle(item: any) {
  const reason = String(item.reason || 'review required').replaceAll('_', ' ');
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}
