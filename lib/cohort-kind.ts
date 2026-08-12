// What a cohort actually is. See migration 172.
//
// cohorts.is_individual used to mean two different things -- a one-person synthetic cohort
// (migration 165) and a subscription plan's shared access cohort (migration 167) -- so a
// screen could not tell a single learner from a plan with hundreds of subscribers. It is
// kept in sync by trigger for now and is deprecated; read cohort_kind instead.

export type CohortKind = 'bootcamp' | 'legacy_individual' | 'subscription_plan';

export const COHORT_KIND_BOOTCAMP: CohortKind = 'bootcamp';

// True for any cohort that is not a real bootcamp intake. Mirrors the old
// is_individual truthiness exactly, including for a student with no cohort at all
// (undefined is not individual), so callers keep their existing behavior.
export function isIndividualCohort(kind?: string | null): boolean {
  return kind === 'legacy_individual' || kind === 'subscription_plan';
}

// A plan's shared access cohort. Many subscribers, no owning student. This is the
// distinction is_individual could not express.
export function isSubscriptionPlanCohort(kind?: string | null): boolean {
  return kind === 'subscription_plan';
}

// The per-student synthetic cohort from migration 165. One learner, no shared surfaces.
export function isLegacyIndividualCohort(kind?: string | null): boolean {
  return kind === 'legacy_individual';
}

// null means platform-wide announcements only. Bootcamp students also receive
// announcements addressed to their cohort.
export function announcementCohortFilter(cohortId?: string | null, kind?: string | null): string | null {
  if (!cohortId || isIndividualCohort(kind)) return null;
  return `cohort_ids.cs.{${cohortId}},cohort_ids.eq.{}`;
}
