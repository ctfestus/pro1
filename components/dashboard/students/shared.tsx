'use client';

// Shared by the Students page and its details panel.

import { isIndividualCohort } from '@/lib/cohort-kind';
import type { Tone } from '../subscriptions/ui';

/** "1 Oct 2026, 09:00", or null with no date. */
export function dateTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
}

/** The setup steps a learner's account goes through, in order. */
export const SETUP_STEPS = [
  ['account_provisioned_at', 'Account created'],
  ['setup_email_sent_at', 'Setup email sent'],
  ['password_setup_started_at', 'Setup link opened'],
  ['password_set_at', 'Password set'],
  ['onboarding_completed_at', 'Onboarding finished'],
  ['last_login_at', 'Last sign-in'],
] as const;

export type SetupBucket = 'signed_in' | 'setting_up' | 'not_invited';

/** How far a learner has got with their account: the furthest step reached, and which filter it falls under. */
export function accountStatus(s: any): { label: string; tone: Tone; at: string | null; bucket: SetupBucket } {
  if (s.last_login_at) return { label: 'Signed in', tone: 'good', at: s.last_login_at, bucket: 'signed_in' };
  if (s.onboarding_done) return { label: 'Onboarded', tone: 'warn', at: s.onboarding_completed_at, bucket: 'setting_up' };
  if (s.password_set_at) return { label: 'Password set', tone: 'warn', at: s.password_set_at, bucket: 'setting_up' };
  if (s.password_setup_started_at) return { label: 'Link opened', tone: 'warn', at: s.password_setup_started_at, bucket: 'setting_up' };
  if (s.setup_email_sent_at) return { label: 'Email sent', tone: 'warn', at: s.setup_email_sent_at, bucket: 'setting_up' };
  return { label: 'Not invited', tone: 'mute', at: s.account_provisioned_at ?? null, bucket: 'not_invited' };
}

/** A learner's bootcamp cohort, or null for someone learning on their own (no cohort, or a plan's). */
export function bootcampOf(s: any, cohortsById: Map<string, any>) {
  const cohort = s.cohort_id ? cohortsById.get(s.cohort_id) : null;
  return cohort && !isIndividualCohort(cohort.cohort_kind) ? cohort : null;
}
