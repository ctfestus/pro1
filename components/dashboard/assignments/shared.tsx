'use client';

// Shared by the Assignments list and an assignment's report.

import type { Tone } from '@/components/dashboard/subscriptions/ui';

/** "Standard", "Scenario", "Virtual experience", with ", groups" for a group assignment. */
export function typeLabel(a: any) {
  const base = String(a.type || 'standard').replaceAll('_', ' ');
  return base.charAt(0).toUpperCase() + base.slice(1) + (a.group_ids?.length ? ', groups' : '');
}

/** A response's status, most urgent first: the order rows are listed in. */
export const RESPONSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: 'To grade', tone: 'warn' },
  graded: { label: 'Graded', tone: 'good' },
  done_unsubmitted: { label: 'Done, not submitted', tone: 'warn' },
  in_progress: { label: 'In progress', tone: 'warn' },
  draft: { label: 'Draft', tone: 'mute' },
  not_started: { label: 'Not started', tone: 'mute' },
};
export const RESPONSE_ORDER = Object.keys(RESPONSE_STATUS);

export function responseLabel(status: string, pct?: number) {
  const s = RESPONSE_STATUS[status] ?? RESPONSE_STATUS.not_started;
  return status === 'in_progress' && pct != null ? `${s.label} ${pct}%` : s.label;
}
