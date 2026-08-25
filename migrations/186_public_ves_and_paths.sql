-- Let a virtual experience or a learning path be offered to everyone, the way a course or a
-- certification already can.
--
-- Until now `available_to_everyone` existed only on courses and certifications, so a free account
-- with no cohort could never reach a VE or a path -- Explore showed every one of them padlocked
-- with no way for an instructor to open one up. That caps the free tier at two content types.
--
-- THREE things are needed, and the column alone is the least important of them. Adding it without
-- the policy change produces a feature that looks built and does nothing: the row stays invisible,
-- so the student sees the same padlock and the instructor sees a toggle that appears broken.

BEGIN;

-- 1. The flag itself, mirroring courses/certifications: open access and cohort targeting are
--    mutually exclusive, so "everyone" can never quietly mean "everyone plus these cohorts".
ALTER TABLE public.virtual_experiences
  ADD COLUMN IF NOT EXISTS available_to_everyone boolean NOT NULL DEFAULT false;

ALTER TABLE public.virtual_experiences
  DROP CONSTRAINT IF EXISTS virtual_experiences_open_access_excl;
ALTER TABLE public.virtual_experiences
  ADD CONSTRAINT virtual_experiences_open_access_excl
  CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0);

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS available_to_everyone boolean NOT NULL DEFAULT false;

ALTER TABLE public.learning_paths
  DROP CONSTRAINT IF EXISTS learning_paths_open_access_excl;
ALTER TABLE public.learning_paths
  ADD CONSTRAINT learning_paths_open_access_excl
  CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0);

-- 2. A published path currently MUST name at least one cohort. A public path names none, so
--    publishing one would fail this check -- the instructor would set the toggle, press publish,
--    and get a constraint error with nothing explaining it. Open access becomes a third way to
--    satisfy the same intent: a published path reaches somebody.
ALTER TABLE public.learning_paths
  DROP CONSTRAINT IF EXISTS check_published_requires_cohort;
ALTER TABLE public.learning_paths
  ADD CONSTRAINT check_published_requires_cohort CHECK (
    status = 'draft'
    OR available_to_everyone
    OR (status = 'published' AND array_length(cohort_ids, 1) > 0)
  );

-- 3. The policies. Without these the flag is decorative: RLS still hides the row, so the content
--    remains unreachable however it is tagged. Both keep every existing branch untouched and add
--    one -- published AND open to everyone -- so no current access is altered.
DROP POLICY IF EXISTS "virtual_experiences: participants select" ON public.virtual_experiences;
CREATE POLICY "virtual_experiences: participants select"
  ON public.virtual_experiences FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (status = 'published' AND available_to_everyone)
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND virtual_experiences.id = ANY(lp.item_ids)
        AND (
          lp.available_to_everyone
          OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
        )
    )
  );

-- A public path grants its contents too, or a student could open the path and find every item
-- inside it locked -- which is how the path/course grant already works for cohorts.
DROP POLICY IF EXISTS "students_read_published_paths" ON public.learning_paths;
CREATE POLICY "students_read_published_paths"
  ON public.learning_paths FOR SELECT
  USING (
    status = 'published'
    AND (
      available_to_everyone
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
      )
    )
  );

-- A public path must grant its COURSES too, for the same reason it grants its virtual
-- experiences: otherwise a student opens a path that is offered to everyone and finds every course
-- inside it padlocked. Only the path branch changes; open-access courses and cohort courses are
-- untouched.
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
        AND (
          lp.available_to_everyone
          OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
        )
    )
  );

COMMIT;
