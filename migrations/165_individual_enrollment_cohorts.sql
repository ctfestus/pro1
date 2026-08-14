-- Individual (non-cohort) enrollment, implemented as a synthetic per-student cohort.
--
-- Why: every access check in the platform (RLS, API routes, dashboard queries) is
-- `student.cohort_id = ANY(content.cohort_ids)`. There is no per-course entitlement
-- concept. Rather than build a parallel enrollment mechanism that would require
-- touching every one of those checks, a student enrolled individually gets a real
-- cohorts row created just for them, tagged is_individual, and their cohort_id points
-- at it -- every existing gate keeps working unmodified.
--
-- is_individual is a permanent classification, set once at creation and never flipped
-- by any later event (including the owning student's account being deleted). It is
-- deliberately independent of individual_student_id rather than derived from it: if a
-- student's account is deleted, individual_student_id is nulled out (see below), but
-- the cohort must stay excluded from every "pick a real cohort" admin list forever,
-- not silently reclassify as a real cohort just because the reverse-lookup went stale.
--
-- individual_student_id is a reverse lookup used to find-and-reuse the SAME synthetic
-- cohort across a student's multiple individual course purchases over time. This
-- matters because students.cohort_id is a single column: if a second purchase created
-- a second synthetic cohort, cohort_id could only point at one of them and the student
-- would silently lose access to the other course. ON DELETE SET NULL, not CASCADE --
-- payments.cohort_id is ON DELETE RESTRICT, so cascading a cohort delete through
-- student deletion would make the existing "delete student" admin action start failing
-- for anyone who was ever individually enrolled and charged.

BEGIN;

ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS is_individual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS individual_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;

ALTER TABLE public.cohorts
  DROP CONSTRAINT IF EXISTS cohorts_individual_student_consistency;
ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_individual_student_consistency
  CHECK (individual_student_id IS NULL OR is_individual);

-- One live synthetic cohort per student -- also guards a create-race between two
-- concurrent individual-enrollment requests for the same student.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_individual_student
  ON public.cohorts (individual_student_id)
  WHERE individual_student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cohorts_is_individual ON public.cohorts (is_individual);

COMMENT ON COLUMN public.cohorts.is_individual IS
  'True for synthetic per-student cohorts created by individual course enrollment. Permanent -- never cleared even if individual_student_id later goes NULL.';
COMMENT ON COLUMN public.cohorts.individual_student_id IS
  'Reverse lookup to the owning student. NULL for real cohorts, and also NULL for an individual cohort whose student account was later deleted (orphaned, historical record).';

COMMIT;
