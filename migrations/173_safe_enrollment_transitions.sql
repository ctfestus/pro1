-- Make enrollment-model changes reversible at an explicit assignment boundary, and
-- create subscription payment requests in the same transaction as the individual
-- model claim. This preserves migration 171's released_at financial-history behavior
-- and migration 172's cohort_kind distinction.

BEGIN;

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

  IF v_current = p_requested_model THEN
    RETURN;
  END IF;

  IF v_current IS NULL THEN
    IF p_requested_model = 'individual'
       AND (v_cohort_id IS NOT NULL OR v_original_cohort_id IS NOT NULL) THEN
      RAISE EXCEPTION 'remove this student from their bootcamp cohort before assigning an individual subscription'
        USING ERRCODE = 'unique_violation';
    END IF;
    UPDATE public.students SET enrollment_model = p_requested_model WHERE id = p_student_id;
    RETURN;
  END IF;

  IF v_current = 'bootcamp' AND p_requested_model = 'individual'
     AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL THEN
    UPDATE public.bootcamp_enrollments
    SET released_at = COALESCE(released_at, now()), updated_at = now()
    WHERE student_id = p_student_id AND released_at IS NULL;
    UPDATE public.students SET enrollment_model = 'individual' WHERE id = p_student_id;
    RETURN;
  END IF;

  IF v_current = 'individual' AND p_requested_model = 'bootcamp'
     AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.individual_subscriptions
       WHERE student_id = p_student_id AND status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.subscription_payment_requests
       WHERE student_id = p_student_id AND status IN ('pending', 'confirmation_submitted')
     ) THEN
    UPDATE public.students SET enrollment_model = 'bootcamp' WHERE id = p_student_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'student % already belongs to the % enrollment model', p_student_id, v_current
    USING ERRCODE = 'unique_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_individual_subscription_payment_request(
  p_student_id uuid,
  p_plan_id uuid,
  p_duration_months integer,
  p_amount numeric,
  p_currency text,
  p_due_date date,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_kind text;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_request_id uuid;
  v_currency text;
BEGIN
  IF p_duration_months NOT IN (1, 3, 6, 12) THEN
    RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  IF p_due_date IS NULL OR p_due_date < current_date THEN RAISE EXCEPTION 'payment deadline cannot be in the past'; END IF;
  v_currency := upper(btrim(COALESCE(p_currency, '')));
  IF v_currency = '' THEN RAISE EXCEPTION 'currency is required'; END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT cohort_kind INTO v_plan_kind FROM public.cohorts WHERE id = v_plan.cohort_id;
  IF v_plan.status <> 'active' OR v_plan_kind NOT IN ('legacy_individual', 'subscription_plan') THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;

  SELECT * INTO v_subscription
  FROM public.individual_subscriptions
  WHERE student_id = p_student_id;
  IF FOUND AND v_subscription.plan_id <> p_plan_id THEN
    RAISE EXCEPTION 'change the student plan before assigning a renewal payment';
  END IF;

  PERFORM public.claim_student_enrollment_model(p_student_id, 'individual');

  INSERT INTO public.subscription_payment_requests (
    student_id, subscription_id, plan_id, plan_name, kind, duration_months,
    amount, currency, due_date, created_by
  ) VALUES (
    p_student_id, CASE WHEN v_subscription.id IS NULL THEN NULL ELSE v_subscription.id END,
    p_plan_id, v_plan.name, CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END,
    p_duration_months, p_amount, v_currency, p_due_date, p_created_by
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'requestId', v_request_id, 'planName', v_plan.name);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid, uuid, integer, numeric, text, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid, uuid, integer, numeric, text, date, uuid) TO service_role;

COMMIT;
