-- Migration 167 made an explicit cohort removal detach the student's enrollment by
-- nulling bootcamp_enrollments.student_id. That stops payment enforcement (the grace
-- cron filters on student_id IS NOT NULL), but it also severs the only link between a
-- student and the money they paid.
--
-- The damage shows up on re-admission. app/api/admissions/route.ts looks for an existing
-- enrollment by student_id; with the link gone it finds nothing, the pre-signup lookup is
-- scoped to the target cohort, so adding the student to a DIFFERENT cohort falls through
-- to createAdmissionRecord and writes a fresh enrollment with paid_total = 0 and a full
-- new installment schedule. The student is billed a second time and their real payment
-- history is stranded on an unreachable row. The removal dialog meanwhile promises that
-- bootcamp payment history will be preserved.
--
-- Release is now recorded explicitly instead. student_id stays intact so paid_total,
-- installments and receipts remain attached to the person who paid them, and released_at
-- becomes the flag that payment enforcement filters on. Nulling student_id also made a
-- released row indistinguishable from a genuine pre-signup row (student_id IS NULL by
-- design), which is a second ambiguity this removes.
--
-- payment_exempt is no longer cleared on release either. It records a sponsorship or
-- waiver decision, not cohort membership, and silently resetting it re-bills a sponsored
-- student the moment they are re-added.

BEGIN;

ALTER TABLE public.bootcamp_enrollments
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

COMMENT ON COLUMN public.bootcamp_enrollments.released_at IS
  'Set when a student is explicitly removed from their cohort. The enrollment is retained as financial history; payment enforcement skips released rows.';

CREATE INDEX IF NOT EXISTS idx_bootcamp_enrollments_released
  ON public.bootcamp_enrollments(released_at)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.release_student_from_bootcamp(
  p_student_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_model text;
BEGIN
  SELECT enrollment_model INTO v_model
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student % not found', p_student_id; END IF;
  IF v_model = 'individual' THEN
    RAISE EXCEPTION 'an individual subscriber cannot be unassigned through the bootcamp workflow'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE public.bootcamp_enrollments
  SET released_at = now(), updated_at = now()
  WHERE student_id = p_student_id
    AND released_at IS NULL;

  UPDATE public.students
  SET cohort_id = NULL,
      original_cohort_id = NULL,
      enrollment_model = NULL
  WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true, 'released', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) TO service_role;

-- The bootcamp to individual conversion detached the enrollment for the same reason and
-- with the same consequence. Mark it released instead, so a subscriber who later returns
-- to a bootcamp still has their prior payments on record.
CREATE OR REPLACE FUNCTION public.claim_student_enrollment_model(
  p_student_id uuid,
  p_requested_model text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current text;
  v_cohort_id uuid;
  v_original_cohort_id uuid;
BEGIN
  IF p_requested_model NOT IN ('bootcamp', 'individual') THEN
    RAISE EXCEPTION 'invalid enrollment model: %', p_requested_model;
  END IF;

  SELECT enrollment_model, cohort_id, original_cohort_id
  INTO v_current, v_cohort_id, v_original_cohort_id
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student % not found', p_student_id; END IF;

  IF v_current IS NULL THEN
    UPDATE public.students SET enrollment_model = p_requested_model WHERE id = p_student_id;
  ELSIF v_current = 'bootcamp' AND p_requested_model = 'individual'
        AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL THEN
    UPDATE public.bootcamp_enrollments
    SET released_at = COALESCE(released_at, now()), updated_at = now()
    WHERE student_id = p_student_id
      AND released_at IS NULL;
    UPDATE public.students SET enrollment_model = 'individual' WHERE id = p_student_id;
  ELSIF v_current <> p_requested_model THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', p_student_id, v_current
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) TO service_role;

-- Re-attaching a released student is an explicit admin action, so clear the flag there.
CREATE OR REPLACE FUNCTION public.reattach_released_enrollment(
  p_enrollment_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.bootcamp_enrollments
  SET released_at = NULL, updated_at = now()
  WHERE id = p_enrollment_id
    AND released_at IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.reattach_released_enrollment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reattach_released_enrollment(uuid) TO service_role;

COMMIT;

-- No backfill. Rows with student_id IS NULL cannot be repaired automatically because a
-- null student_id is also the legitimate representation of a pre-signup admission record
-- (see idx_bootcamp_enrollments_email_cohort and the activateEnrollment path), so there is
-- no way to tell a detached enrollment from one that was never claimed. Any rows detached
-- by the migration 167 behavior must be re-linked by hand after confirming the student.
