-- One way to pay at a time, decided where the decision is already serialized.
--
-- A learner holding a payable Paystack link who also has a bank transfer raised for the same plan
-- can settle both. The online path already refuses while a request is open; the reverse was
-- checked in application code, which reads the transactions and then inserts the request as two
-- separate operations -- so a checkout opened in between slipped through. It also missed a
-- 'success' that had not been credited yet, which is money already taken.
--
-- Moved inside the function that raises the request, immediately after the lock it already holds
-- on the learner's row, so the check and the insert cannot be separated. The predicate is the same
-- one the direct-checkout unique index uses; if that list ever changes, both must change together.
--
-- Unconditional, and deliberately so. This first shipped with a flag that administrators and bulk
-- imports could switch off, on the assumption an import would otherwise fail wholesale -- it does
-- not, since it collects errors per learner. Whether somebody ends up able to pay twice cannot
-- depend on who filled in the form, so there is no flag: the rule holds for every caller.
CREATE OR REPLACE FUNCTION public.create_individual_subscription_payment_request(
  p_student_id uuid, p_plan_id uuid, p_duration_months integer, p_amount numeric,
  p_currency text, p_due_date date, p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_kind text;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_student_model text;
  v_request_id uuid;
  v_currency text;
BEGIN
  IF p_duration_months NOT IN (1,3,6,12) THEN RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  IF p_due_date IS NULL OR p_due_date < current_date THEN RAISE EXCEPTION 'payment deadline cannot be in the past'; END IF;
  v_currency := upper(btrim(COALESCE(p_currency,'')));
  IF v_currency='' THEN RAISE EXCEPTION 'currency is required'; END IF;

  SELECT enrollment_model INTO v_student_model FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found'; END IF;
  IF v_student_model='bootcamp' THEN
    RAISE EXCEPTION 'bootcamp learners cannot purchase an individual subscription' USING ERRCODE='unique_violation';
  END IF;

  -- Under the lock above, so a checkout cannot appear between this and the insert below.
  IF EXISTS(
    SELECT 1 FROM public.paystack_subscription_transactions t
    WHERE t.student_id=p_student_id AND t.request_id IS NULL
      AND (t.status IN('initialized','pending','ongoing','processing','queued','needs_review')
           OR (t.status='success' AND t.processed_payment_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'an online checkout is already open for this learner' USING ERRCODE='55006';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT cohort_kind INTO v_plan_kind FROM public.cohorts WHERE id=v_plan.cohort_id;
  IF v_plan.status<>'active' OR v_plan_kind NOT IN ('legacy_individual','subscription_plan') THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;
  SELECT * INTO v_subscription FROM public.individual_subscriptions WHERE student_id=p_student_id;
  IF FOUND AND v_subscription.plan_id<>p_plan_id THEN RAISE EXCEPTION 'change the student plan before assigning a renewal payment'; END IF;

  INSERT INTO public.subscription_payment_requests(
    student_id,subscription_id,plan_id,plan_name,kind,duration_months,amount,currency,due_date,created_by
  ) VALUES (
    p_student_id,CASE WHEN v_subscription.id IS NULL THEN NULL ELSE v_subscription.id END,
    p_plan_id,v_plan.name,CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END,
    p_duration_months,p_amount,v_currency,p_due_date,p_created_by
  ) RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('ok',true,'requestId',v_request_id,'planName',v_plan.name);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) TO service_role;
