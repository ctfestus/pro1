-- Open access was inferred from an empty cohort_ids array, which conflated two different
-- intentions: "everyone may access this" and "nobody has been given access yet".
--
-- For certifications the empty array meant everyone (app/api/certification-attempt:45), so
-- removing a certification's last cohort tag silently published it platform-wide. That is
-- reachable through ordinary subscription work: restrict a certification to a cohort, add
-- it to a plan, drop the original cohort, then remove it from the plan (or delete the
-- plan, which untags every covered item -- migration 170:44-52). The certification becomes
-- available to every signed-in student with no action that looks like publishing.
--
-- available_to_everyone makes the intention explicit:
--   available_to_everyone = true                     -> every signed-in student
--   available_to_everyone = false, cohort_ids <> {}  -> only those cohorts
--   available_to_everyone = false, cohort_ids = {}   -> nobody
--
-- Subscription assignment only ever changes cohort_ids, so removing the final plan tag now
-- leaves a certification inaccessible rather than open.

BEGIN;

-- Preserve today's behavior exactly. Every certification whose cohort_ids is empty is
-- currently readable by any signed-in student, so that is what "everyone" meant for it.
-- Run the legacy backfill only when the column is first introduced. Re-running this
-- migration later must not turn intentionally inaccessible certifications into global ones.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.certifications'::regclass
      AND attname = 'available_to_everyone'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE public.certifications
      ADD COLUMN available_to_everyone boolean NOT NULL DEFAULT false;
    UPDATE public.certifications
    SET available_to_everyone = true
    WHERE cohort_ids = '{}';
  END IF;
END;
$migration$;

-- Courses are intentionally not backfilled. Their catalog and RLS already treat an empty
-- cohort_ids as inaccessible; only the service-role direct-course route historically
-- treated it as open. available_to_everyone=false closes that inconsistent direct-link
-- path, while owners/staff, assigned cohorts, and learning-path access remain unchanged.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS available_to_everyone boolean NOT NULL DEFAULT false;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.certifications'::regclass
      AND conname = 'certifications_everyone_has_no_cohorts'
  ) THEN
    ALTER TABLE public.certifications
      ADD CONSTRAINT certifications_everyone_has_no_cohorts
      CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND conname = 'courses_everyone_has_no_cohorts'
  ) THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_everyone_has_no_cohorts
      CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0);
  END IF;
END;
$migration$;

DROP POLICY IF EXISTS "courses: participants select" ON public.courses;
CREATE POLICY "courses: participants select"
  ON public.courses FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (status = 'published' AND available_to_everyone)
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND courses.id = ANY(lp.item_ids)
        AND (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
    )
  );

COMMENT ON COLUMN public.certifications.available_to_everyone IS
  'Explicit open access. When false, access is limited to cohort_ids; an empty cohort_ids then means nobody.';
COMMENT ON COLUMN public.courses.available_to_everyone IS
  'Explicit open access. When false, access is limited to cohort_ids or an assigned learning path; an empty cohort_ids alone means nobody.';

COMMIT;
