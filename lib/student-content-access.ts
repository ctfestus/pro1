type ContentAccessInput = {
  contentId: string;
  status: string | null | undefined;
  cohortId: string | null | undefined;
  cohortIds: string[] | null | undefined;
  availableToEveryone: boolean | null | undefined;
};

/**
 * The published-content grant shared by service-role routes.
 *
 * Subscription plans deliberately use a synthetic cohort, so the direct-cohort and
 * path-cohort branches cover both bootcamp learners and active subscribers. Public content and
 * public paths also work for accounts that have no cohort at all.
 */
export async function hasPublishedStudentContentAccess(
  db: any,
  input: ContentAccessInput,
): Promise<boolean> {
  if (input.status !== 'published') return false;
  if (input.availableToEveryone === true) return true;

  const cohortIds = Array.isArray(input.cohortIds) ? input.cohortIds : [];
  if (input.cohortId && cohortIds.includes(input.cohortId)) return true;

  const pathQuery = db
    .from('learning_paths')
    .select('id')
    .eq('status', 'published')
    .contains('item_ids', [input.contentId]);

  const { data: path } = await (input.cohortId
    ? pathQuery.or(`available_to_everyone.eq.true,cohort_ids.cs.{${input.cohortId}}`)
    : pathQuery.eq('available_to_everyone', true))
    .limit(1)
    .maybeSingle();

  return !!path;
}
