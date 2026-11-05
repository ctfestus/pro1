-- Migration 230: move a bootcamp enrollment to another cohort in one transaction.
--
-- Moving a student used to repoint bootcamp_enrollments.cohort_id only, so the student kept the
-- old cohort's dates and installments. The app now rebuilds the schedule on a move. Doing that as
-- separate requests (delete installments, insert new ones, apply payments, repoint the enrollment,
-- repoint the student) could stop partway and leave no schedule, a half-applied one, or the new
-- dates on an enrollment still pointing at the old cohort. This function does all of it in one
-- transaction: any error rolls the whole move back.
--
-- The new schedule is computed by the app (lib/db-payments.ts generateInstallments, so admission
-- and move share one rule) and passed in p_installments as [{ "due_date": "YYYY-MM-DD",
-- "amount_due": n }, ...]. The agreed fee is not changed. paid_total is applied to the new rows
-- oldest due date first, the same order applyAmountToInstallments uses.
--
-- p_expected_cohort_id and p_expected_paid_total are what the app read when it built the
-- schedule. If either changed since (another move, or a payment recorded meanwhile) the function
-- returns 'stale' and changes nothing, so the app can report it rather than apply a schedule built
-- from old figures. Returns 'ok', 'stale', 'not_found' or 'no_start_date'.
--
-- Called by the service role only (lib/assign-student-cohort.ts). No table changes, so no RLS
-- changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.move_enrollment_to_cohort(
  p_enrollment_id        uuid,
  p_student_id           uuid,
  p_cohort_id            uuid,
  p_expected_cohort_id   uuid,
  p_expected_paid_total  numeric,
  p_installments         jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_enroll    public.bootcamp_enrollments;
  v_start     date;
  v_end       date;
  v_remaining numeric;
  v_inst      record;
  v_apply     numeric;
BEGIN
  SELECT * INTO v_enroll FROM public.bootcamp_enrollments
    WHERE id = p_enrollment_id AND student_id = p_student_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF v_enroll.cohort_id IS DISTINCT FROM p_expected_cohort_id
     OR v_enroll.paid_total <> p_expected_paid_total THEN
    RETURN 'stale';
  END IF;

  SELECT start_date, end_date INTO v_start, v_end FROM public.cohorts WHERE id = p_cohort_id;
  IF v_start IS NULL THEN RETURN 'no_start_date'; END IF;

  DELETE FROM public.payment_installments WHERE enrollment_id = p_enrollment_id;

  INSERT INTO public.payment_installments (enrollment_id, due_date, amount_due, amount_paid, status)
  SELECT p_enrollment_id, r.due_date, r.amount_due, 0, 'unpaid'
  FROM jsonb_to_recordset(COALESCE(p_installments, '[]'::jsonb)) AS r(due_date date, amount_due numeric);

  v_remaining := v_enroll.paid_total;
  FOR v_inst IN
    SELECT id, amount_due FROM public.payment_installments
    WHERE enrollment_id = p_enrollment_id
    ORDER BY due_date, created_at
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_inst.amount_due);
    UPDATE public.payment_installments
      SET amount_paid = v_apply,
          status      = CASE WHEN v_apply >= v_inst.amount_due THEN 'paid' ELSE 'partial' END,
          updated_at  = now()
      WHERE id = v_inst.id;
    v_remaining := v_remaining - v_apply;
  END LOOP;

  UPDATE public.bootcamp_enrollments
    SET cohort_id          = p_cohort_id,
        bootcamp_starts_at = v_start,
        bootcamp_ends_at   = v_end,
        updated_at         = now()
    WHERE id = p_enrollment_id;

  UPDATE public.students SET cohort_id = p_cohort_id WHERE id = p_student_id;

  RETURN 'ok';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.move_enrollment_to_cohort(uuid, uuid, uuid, uuid, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_enrollment_to_cohort(uuid, uuid, uuid, uuid, numeric, jsonb) TO service_role;

COMMIT;
