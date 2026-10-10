// The rule for a cohort's "classes end" date (migration 223), shared by the create form, the edit
// form and PATCH /api/cohorts/[id] so they cannot disagree. Dates are YYYY-MM-DD strings, which
// compare correctly as plain strings.

/** Why the classes end date is invalid, or null when it is fine (including when it is blank). */
export function classesEndDateError(
  startDate: string | null | undefined,
  classesEndDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  if (!classesEndDate) return null;
  if (startDate && classesEndDate < startDate) return 'Classes cannot end before the cohort starts.';
  if (endDate && classesEndDate > endDate) return 'Classes must end on or before the cohort end date.';
  return null;
}
