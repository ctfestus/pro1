/**
 * Who is still in the cohort behind a shared surface.
 *
 * Cohort membership lives in one place -- students.cohort_id -- but two tables snapshot it and
 * never let go. event_registrations rows are written once, when an event is assigned to a cohort
 * (see lib/auto-register-event-cohorts.ts), and group_members rows when a group is formed.
 * Nothing removes either row when the student later moves to another cohort or onto a
 * subscription. Reading those tables raw is what kept sending old-cohort event reminders, and
 * kept moved-out students on attendance rosters and in absence nudges.
 *
 * The rule below is the one the database already enforces for these surfaces
 * (is_bootcamp_cohort_member, migration 184): a student's *current* cohort must be one of the
 * surface's cohorts, and it must be a real bootcamp intake. Staff keep their place regardless,
 * because the same policies admit them without a cohort of their own.
 *
 * This narrows rosters only. Attendance already recorded in live_attendance is history and is
 * never filtered: who turned up does not change because someone moved cohort afterwards.
 */
import { COHORT_KIND_BOOTCAMP } from '@/lib/cohort-kind';
import { fetchAllRowsByIds } from '@/lib/fetch-all-rows';

type RosterDb = { from: (table: string) => any };

export type CohortMembership = {
  role:             string | null;
  cohortId:         string | null;
  cohortKind:       string | null;
  /** Set only while a student is parked in the outstanding-payments cohort: where they belong. */
  originalCohortId: string | null;
};

// The events, assignment and community policies admit these roles without a cohort of their own.
const STAFF_ROLES = new Set(['admin', 'instructor', 'staff']);

/**
 * Current cohort of each given student, keyed by student id. Students and cohorts are read
 * separately rather than as one embed: students has two foreign keys to cohorts (cohort_id and
 * original_cohort_id), which makes an embedded select ambiguous.
 */
export async function loadCohortMembership(
  db: RosterDb,
  studentIds: string[],
): Promise<Map<string, CohortMembership>> {
  const ids  = [...new Set(studentIds.filter(Boolean))];
  const byId = new Map<string, CohortMembership>();
  if (!ids.length) return byId;

  const students = await fetchAllRowsByIds<{ id: string; role: string | null; cohort_id: string | null; original_cohort_id: string | null }>(
    ids,
    (idChunk, from, to) => db.from('students')
      .select('id, role, cohort_id, original_cohort_id', { count: 'exact' })
      .in('id', idChunk)
      .order('id')
      .range(from, to),
  );

  const cohortIds = [...new Set(students.map(s => s.cohort_id).filter(Boolean) as string[])];
  const cohorts = await fetchAllRowsByIds<{ id: string; cohort_kind: string | null }>(
    cohortIds,
    (idChunk, from, to) => db.from('cohorts')
      .select('id, cohort_kind', { count: 'exact' })
      .in('id', idChunk)
      .order('id')
      .range(from, to),
  );
  const kindById = new Map(cohorts.map(c => [c.id, c.cohort_kind ?? null]));

  for (const s of students) {
    byId.set(s.id, {
      role:             s.role ?? null,
      cohortId:         s.cohort_id ?? null,
      cohortKind:       s.cohort_id ? kindById.get(s.cohort_id) ?? null : null,
      originalCohortId: s.original_cohort_id ?? null,
    });
  }
  return byId;
}

/**
 * `cohortIds` empty or absent means the surface names no cohorts, so there is no membership to
 * check and everyone is kept. An event whose cohorts were unassigned still has an attendance
 * record worth reading, and emptying its roster would be a second bug rather than a fix.
 */
export function isStillInCohorts(
  membership: CohortMembership | undefined,
  cohortIds: string[] | null | undefined,
): boolean {
  if (!cohortIds?.length) return true;
  if (!membership) return false;
  if (STAFF_ROLES.has(membership.role ?? '')) return true;
  return !!membership.cohortId
    && cohortIds.includes(membership.cohortId)
    && membership.cohortKind === COHORT_KIND_BOOTCAMP;
}

/**
 * Group membership is not the same rule. A student behind on a payment is parked in the
 * outstanding-payments cohort with original_cohort_id remembering where they belong, and the
 * outstanding sweep does that automatically the moment an installment falls due. Their access to
 * the event surfaces really does stop there -- the events policy admits their current cohort only,
 * which is the whole point of the hold -- but their group work carries on, because the assignments
 * policy admits group members without reference to any cohort. So a hold must not read as leaving
 * the group.
 */
export function isStillInGroupCohort(
  membership: CohortMembership | undefined,
  groupCohortId: string | null | undefined,
): boolean {
  if (!groupCohortId) return true;
  if (!membership) return false;
  if (membership.originalCohortId === groupCohortId) return true;
  return isStillInCohorts(membership, [groupCohortId]);
}

/** Convenience wrapper: the subset of `studentIds` still admitted to a surface. */
export async function studentsStillInCohorts(
  db: RosterDb,
  studentIds: string[],
  cohortIds: string[] | null | undefined,
): Promise<Set<string>> {
  if (!cohortIds?.length) return new Set(studentIds);
  const membership = await loadCohortMembership(db, studentIds);
  return new Set(studentIds.filter(id => isStillInCohorts(membership.get(id), cohortIds)));
}
