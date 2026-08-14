import { describe, expect, it } from 'vitest';
import { announcementCohortFilter, isIndividualCohort, isLegacyIndividualCohort, isSubscriptionPlanCohort } from '@/lib/cohort-kind';

describe('cohort kind', () => {
  it('treats both individual kinds as individual', () => {
    expect(isIndividualCohort('legacy_individual')).toBe(true);
    expect(isIndividualCohort('subscription_plan')).toBe(true);
    expect(isIndividualCohort('bootcamp')).toBe(false);
  });

  // The student surfaces branch on this for a student who may have no cohort at all.
  // The column it replaced was a boolean, so a missing cohort read as falsy; returning
  // true here would blank out events, community and the leaderboard for every student
  // between cohorts.
  it('does not treat a missing cohort as individual', () => {
    expect(isIndividualCohort(undefined)).toBe(false);
    expect(isIndividualCohort(null)).toBe(false);
    expect(isIndividualCohort('')).toBe(false);
  });

  it('separates a shared plan cohort from a one-person legacy cohort', () => {
    expect(isSubscriptionPlanCohort('subscription_plan')).toBe(true);
    expect(isSubscriptionPlanCohort('legacy_individual')).toBe(false);
    expect(isLegacyIndividualCohort('legacy_individual')).toBe(true);
    expect(isLegacyIndividualCohort('subscription_plan')).toBe(false);
  });

  it('limits both individual kinds to global announcements', () => {
    expect(announcementCohortFilter('legacy-1', 'legacy_individual')).toBeNull();
    expect(announcementCohortFilter('plan-1', 'subscription_plan')).toBeNull();
    expect(announcementCohortFilter('bootcamp-1', 'bootcamp')).toBe(
      'cohort_ids.cs.{bootcamp-1},cohort_ids.eq.{}',
    );
  });
});
