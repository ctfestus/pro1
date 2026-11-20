'use client';

// Shared by the cohort Payments page's sections and pop-ups.

import type { ThemeColors } from '@/lib/theme';
import { Pill, daysLate, money, pastDeadline, shortDate, type Tone } from '../subscriptions/ui';

/** What each access status reads as, and its colour. */
export const ACCESS_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'good' },
  completed: { label: 'Paid in full', tone: 'good' },
  waived: { label: 'Waived', tone: 'mute' },
  overdue: { label: 'Overdue', tone: 'bad' },
  pending_deposit: { label: 'Waiting for deposit', tone: 'warn' },
  expired: { label: 'Expired', tone: 'mute' },
};

export function StatusPill({ status, C }: { status: string; C: ThemeColors }) {
  const s = ACCESS_STATUS[status] ?? { label: String(status || 'Unknown').replaceAll('_', ' '), tone: 'mute' as Tone };
  return <Pill tone={s.tone} dot C={C}>{s.label}</Pill>;
}

/** An amount with its currency, or the bare number when the currency is not known (never a guessed one). */
export function amountText(currency: string | null | undefined, amount: number | string) {
  return currency ? money(currency, amount) : Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** A waived enrollment owes nothing, whatever its stored balance says. */
export function owed(row: any) {
  return row.access_status === 'waived' ? 0 : Math.max(0, Number(row.balance ?? 0));
}

/** "5 Dec", or "1 Nov, 19 days late" for a payment still owed after its due date. */
export function dueText(row: any) {
  if (!row.next_due_date) return null;
  const due = String(row.next_due_date).slice(0, 10);
  return owed(row) > 0 && pastDeadline(due) ? `${shortDate(due)}, ${daysLate(due)} day${daysLate(due) === 1 ? '' : 's'} late` : shortDate(due);
}

/** Totals per currency, so cohorts that charge in different currencies are never added together. */
export function totalsByCurrency(rows: any[], value: (row: any) => number) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency ?? '', (totals.get(row.currency ?? '') ?? 0) + value(row));
  return [...totals.entries()].filter(([, total]) => total > 0);
}

export function totalsText(totals: [string, number][]) {
  return totals.length ? totals.map(([currency, total]) => amountText(currency, total)).join(', ') : amountText(null, 0);
}
