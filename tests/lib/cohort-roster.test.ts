import { describe, it, expect } from 'vitest';

// What this guards: event_registrations and group_members snapshot cohort membership at the moment
// a student is added and are never cleaned up. Reading them raw sent old-cohort reminders to people
// who had moved onto a subscription, and kept them on attendance rosters as permanent no-shows.
// The predicate below is the read-time replacement, and it has to match the database rule for these
// surfaces (is_bootcamp_cohort_member, migration 184).

import { isStillInCohorts, isStillInGroupCohort, studentsStillInCohorts, loadCohortMembership } from '@/lib/cohort-roster';

const inCohort = { role: 'student', cohortId: 'co1', cohortKind: 'bootcamp', originalCohortId: null };

describe('isStillInCohorts', () => {
  it('keeps a student whose current cohort is one of the surface cohorts', () => {
    expect(isStillInCohorts(inCohort, ['co1', 'co2'])).toBe(true);
  });

  it('drops a student moved to another cohort', () => {
    expect(isStillInCohorts({ ...inCohort, cohortId: 'co9' }, ['co1'])).toBe(false);
  });

  it('drops a student moved onto a subscription plan cohort', () => {
    // The exact case reported: moved from a bootcamp cohort to a plan, still getting the
    // cohort's event reminders. A plan cohort never unlocks bootcamp surfaces.
    expect(isStillInCohorts({ role: 'student', cohortId: 'plan1', cohortKind: 'subscription_plan', originalCohortId: null }, ['co1'])).toBe(false);
  });

  it('drops a student with no cohort at all', () => {
    expect(isStillInCohorts({ role: 'student', cohortId: null, cohortKind: null, originalCohortId: null }, ['co1'])).toBe(false);
  });

  it('drops a student whose cohort is in the list but is not a bootcamp intake', () => {
    // Membership alone is not access: the surface policies require a real intake.
    expect(isStillInCohorts({ role: 'student', cohortId: 'co1', cohortKind: 'legacy_individual', originalCohortId: null }, ['co1'])).toBe(false);
  });

  it('keeps staff, who reach these surfaces without a cohort of their own', () => {
    for (const role of ['admin', 'instructor', 'staff']) {
      expect(isStillInCohorts({ role, cohortId: null, cohortKind: null, originalCohortId: null }, ['co1'])).toBe(true);
    }
  });

  it('keeps everyone when the surface names no cohorts', () => {
    // An unassigned event still has an attendance record worth reading; emptying its roster
    // would be a second bug rather than a fix.
    expect(isStillInCohorts({ role: 'student', cohortId: null, cohortKind: null, originalCohortId: null }, [])).toBe(true);
    expect(isStillInCohorts(undefined, null)).toBe(true);
  });

  it('drops a registrant with no student record when the surface does name cohorts', () => {
    expect(isStillInCohorts(undefined, ['co1'])).toBe(false);
  });

  it('drops a student parked in the outstanding-payments cohort', () => {
    // Their access to the event surfaces really does stop while they are held: the events policy
    // admits their current cohort only, which is the point of the hold.
    const held = { role: 'student', cohortId: 'outstanding', cohortKind: 'bootcamp', originalCohortId: 'co1' };
    expect(isStillInCohorts(held, ['co1'])).toBe(false);
  });
});

describe('isStillInGroupCohort', () => {
  const held = { role: 'student', cohortId: 'outstanding', cohortKind: 'bootcamp', originalCohortId: 'co1' };

  it('keeps a student parked over a payment in their group', () => {
    // The outstanding sweep parks a late payer automatically. Group work carries on -- the
    // assignments policy admits group members without reference to any cohort -- so a hold must
    // not read as leaving the group, and nothing would restore the membership if it did.
    expect(isStillInGroupCohort(held, 'co1')).toBe(true);
  });

  it('does not keep them in the group of some other cohort', () => {
    expect(isStillInGroupCohort(held, 'co9')).toBe(false);
  });

  it('still drops a student who genuinely moved on', () => {
    expect(isStillInGroupCohort({ role: 'student', cohortId: 'plan1', cohortKind: 'subscription_plan', originalCohortId: null }, 'co1')).toBe(false);
  });

  it('keeps a current member', () => {
    expect(isStillInGroupCohort(inCohort, 'co1')).toBe(true);
  });
});

// Minimal stand-in for the two paged reads the loader makes. fetchAllRowsByIds asks for an exact
// count and applies .range(), so the stub answers with both.
function rosterDb(students: any[], cohorts: any[]) {
  const rows: Record<string, any[]> = { students, cohorts };
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => chain,
        then: (onFulfilled: any, onRejected: any) =>
          Promise.resolve({ data: rows[table] ?? [], count: (rows[table] ?? []).length, error: null })
            .then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
}

describe('studentsStillInCohorts', () => {
  it('returns only the students still in one of the cohorts', async () => {
    const db = rosterDb(
      [
        { id: 's1', role: 'student', cohort_id: 'co1' },
        { id: 's2', role: 'student', cohort_id: 'plan1' },
        { id: 's3', role: 'student', cohort_id: null },
      ],
      [
        { id: 'co1', cohort_kind: 'bootcamp' },
        { id: 'plan1', cohort_kind: 'subscription_plan' },
      ],
    );

    const kept = await studentsStillInCohorts(db, ['s1', 's2', 's3'], ['co1']);
    expect([...kept]).toEqual(['s1']);
  });

  it('skips the lookup entirely when the surface names no cohorts', async () => {
    const db = {
      from() { throw new Error('should not query'); },
    };
    const kept = await studentsStillInCohorts(db as any, ['s1', 's2'], []);
    expect([...kept]).toEqual(['s1', 's2']);
  });

  it('reads cohort kind through a second query rather than an embed', async () => {
    // students has two foreign keys to cohorts (cohort_id and original_cohort_id), so an
    // embedded select is ambiguous. This asserts the loader keeps them separate.
    const db = rosterDb(
      [{ id: 's1', role: 'student', cohort_id: 'co1' }],
      [{ id: 'co1', cohort_kind: 'bootcamp' }],
    );
    const membership = await loadCohortMembership(db, ['s1']);
    expect(membership.get('s1')).toEqual({ role: 'student', cohortId: 'co1', cohortKind: 'bootcamp', originalCohortId: null });
  });
});
