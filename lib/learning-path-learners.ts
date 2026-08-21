// Enrolled-learner counts for learning paths.
//
// A path is assigned to cohorts and a student belongs to exactly one cohort, so the learners
// on a path are the active students of its assigned cohorts -- summing per-cohort counts can
// never double-count anyone. Counting per cohort with a head request (no rows transferred)
// keeps this cheap enough to run on both the instructor list and the student dashboard load.

export async function countPathLearners(
  supabase: any,
  paths: { id: string; cohort_ids?: string[] | null }[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const path of paths) counts[path.id] = 0;

  const cohortIds = [...new Set(paths.flatMap((p) => p.cohort_ids ?? []).filter(Boolean))];
  if (!cohortIds.length) return counts;

  const perCohort: Record<string, number> = {};
  await Promise.all(cohortIds.map(async (cohortId) => {
    const { count, error } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('cohort_id', cohortId)
      .eq('role', 'student')
      .eq('status', 'active');
    // A failed count must never fail the page it decorates -- that path just reports 0.
    if (error) console.error('[countPathLearners]', error);
    perCohort[cohortId] = count ?? 0;
  }));

  for (const path of paths) {
    counts[path.id] = [...new Set(path.cohort_ids ?? [])]
      .reduce((total: number, cohortId: string) => total + (perCohort[cohortId] ?? 0), 0);
  }
  return counts;
}
