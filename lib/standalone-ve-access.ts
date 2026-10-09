import { fetchAllRows, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';

export type StandaloneVeAccess = {
  id: string;
  status: string | null;
  cohort_ids: string[] | null;
  available_to_everyone: boolean | null;
};

export type VeStudentAccess = {
  id: string;
  cohort_id: string | null;
};

/**
 * Resolve which student profiles belong in a standalone VE report.
 *
 * Assignment players share guided_project_attempts with the standalone player. The attempt row has
 * no provenance, so report eligibility uses the VE's standalone audience rather than whether the
 * learner can open it today. Historical enrollment rows preserve legitimate work after a learner is
 * moved or a subscription expires. Publication status is deliberately irrelevant to reports and
 * reviews: unpublishing content closes access, but must not erase work already submitted.
 */
export async function loadStandaloneVeReportStudentIds(
  db: any,
  ve: StandaloneVeAccess,
  students: VeStudentAccess[],
): Promise<Set<string>> {
  if (!students.length) return new Set();
  if (ve.available_to_everyone === true) return new Set(students.map(student => student.id));

  const paths = await fetchAllRows<any>((from, to) => db
    .from('learning_paths')
    .select('cohort_ids, available_to_everyone', { count: 'exact' })
    .eq('status', 'published')
    .contains('item_ids', [ve.id])
    .order('id')
    .range(from, to));

  if (paths.some(path => path.available_to_everyone === true)) {
    return new Set(students.map(student => student.id));
  }

  const allowedCohorts = new Set(Array.isArray(ve.cohort_ids) ? ve.cohort_ids : []);
  for (const path of paths) {
    for (const cohortId of Array.isArray(path.cohort_ids) ? path.cohort_ids : []) {
      allowedCohorts.add(cohortId);
    }
  }

  if (!allowedCohorts.size) return new Set();

  const eligible = new Set(
    students
      .filter(student => !!student.cohort_id && allowedCohorts.has(student.cohort_id))
      .map(student => student.id),
  );
  const remainingIds = students.map(student => student.id).filter(id => !eligible.has(id));
  if (!remainingIds.length) return eligible;

  const cohortIds = [...allowedCohorts];
  const [bootcampHistory, subscriptionHistory] = await Promise.all([
    fetchAllRowsByIdPairs<any>(remainingIds, cohortIds, (studentIds, cohorts, from, to) => db
      .from('bootcamp_enrollments')
      .select('student_id, cohort_id', { count: 'exact' })
      .in('student_id', studentIds)
      .in('cohort_id', cohorts)
      .order('id')
      .range(from, to)),
    fetchAllRowsByIdPairs<any>(remainingIds, cohortIds, (studentIds, cohorts, from, to) => db
      .from('individual_subscriptions')
      .select('student_id, cohort_id', { count: 'exact' })
      .in('student_id', studentIds)
      .in('cohort_id', cohorts)
      .order('id')
      .range(from, to)),
  ]);
  for (const row of [...bootcampHistory, ...subscriptionHistory]) {
    if (row.student_id) eligible.add(row.student_id);
  }

  return eligible;
}

/** Server-side guard for instructor actions that are valid only for standalone VE work. */
export async function hasStandaloneVeReportEligibility(
  db: any,
  ve: StandaloneVeAccess,
  studentId: string,
): Promise<boolean> {
  const { data: student } = await db
    .from('students')
    .select('cohort_id, role')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || student.role !== 'student') return false;

  return (await loadStandaloneVeReportStudentIds(db, ve, [{
    id: studentId,
    cohort_id: student.cohort_id,
  }])).has(studentId);
}
