'use client';

// Shared by the Cohorts page's sections and pop-ups.

import type { Tone } from '../subscriptions/ui';
import { amountText } from '../payments/shared';

export type CohortBucket = 'running' | 'upcoming' | 'ended';

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

/** Running, Upcoming or Ended, worked out from the cohort's dates. */
export function cohortStatus(c: any): { label: string; tone: Tone; bucket: CohortBucket } {
  const today = todayKey();
  if (c.end_date && c.end_date < today) return { label: 'Ended', tone: 'mute', bucket: 'ended' };
  if (c.start_date && c.start_date > today) return { label: 'Upcoming', tone: 'mute', bucket: 'upcoming' };
  return { label: 'Running', tone: 'good', bucket: 'running' };
}

function day(value: string, withYear: boolean) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** "1 Sep to 30 Nov 2026", "From 12 Jan 2027", or "No dates set". */
export function dateRange(c: any) {
  if (!c.start_date) return c.end_date ? `Until ${day(c.end_date, true)}` : 'No dates set';
  if (!c.end_date) return `From ${day(c.start_date, true)}`;
  const sameYear = c.start_date.slice(0, 4) === c.end_date.slice(0, 4);
  return `${day(c.start_date, !sameYear)} to ${day(c.end_date, true)}`;
}

export const PLANS: [string, string, string][] = [
  ['flexible', 'Flexible', 'A deposit, then installments.'],
  ['full', 'Full payment', 'The whole fee in one go.'],
  ['sponsored', 'Sponsored', 'Someone else pays. Learners get access without paying.'],
  ['waived', 'Waived', 'No fee. Learners get access without paying.'],
];

/** The cohort's fee with its currency, or null when no payment terms are saved. */
export function feeText(settings: any) {
  return settings?.total_fee != null ? amountText(settings.currency, settings.total_fee) : null;
}

/** "Flexible: 50% deposit, 3 installments" for the fee tile. */
export function termsText(settings: any) {
  const plan = PLANS.find(([id]) => id === settings.payment_plan)?.[1] ?? 'Flexible';
  return settings.payment_plan === 'flexible' || !settings.payment_plan
    ? `${plan}: ${Number(settings.deposit_percent ?? 0)}% deposit, ${settings.installment_count ?? 3} installments`
    : plan;
}

export const CONTENT_TYPES = {
  course: { label: 'Course', plural: 'Courses', table: 'courses' },
  learning_path: { label: 'Learning path', plural: 'Learning paths', table: 'learning_paths' },
  virtual_experience: { label: 'Virtual experience', plural: 'Virtual experiences', table: 'virtual_experiences' },
  assignment: { label: 'Assignment', plural: 'Assignments', table: 'assignments' },
} as const;
export type ContentType = keyof typeof CONTENT_TYPES;

/** True when the learner's name or email contains the search text. */
export function matches(s: any, term: string) {
  return !term || `${s.full_name ?? ''} ${s.email ?? ''}`.toLowerCase().includes(term);
}
