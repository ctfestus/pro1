-- Public purchase prices for reusable subscription plans.
-- Admins own the pricing; students can only choose an active price row.

CREATE TABLE IF NOT EXISTS public.subscription_plan_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  duration_months integer NOT NULL CHECK (duration_months IN (1, 3, 6, 12)),
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  currency        text NOT NULL DEFAULT 'GHS',
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, duration_months, currency)
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan
  ON public.subscription_plan_prices(plan_id, sort_order, duration_months);

ALTER TABLE public.subscription_plan_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_plan_prices: instructor all"
  ON public.subscription_plan_prices FOR ALL
  USING (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND (p.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND (p.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  );

CREATE POLICY "subscription_plan_prices: student read active"
  ON public.subscription_plan_prices FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND p.status = 'active'
    )
  );

CREATE TRIGGER trg_subscription_plan_prices_updated_at
  BEFORE UPDATE ON public.subscription_plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_individual_subscription_payment_request(
  p_student_id uuid,p_plan_id uuid,p_duration_months integer,p_amount numeric,
  p_currency text,p_due_date date,p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_kind text;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_student_model text;
  v_request_id uuid;
  v_currency text;
BEGIN
  IF p_duration_months NOT IN(1,3,6,12) THEN RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  IF p_due_date IS NULL OR p_due_date<current_date THEN RAISE EXCEPTION 'payment deadline cannot be in the past'; END IF;
  v_currency:=upper(btrim(COALESCE(p_currency,'')));
  IF v_currency='' THEN RAISE EXCEPTION 'currency is required'; END IF;

  SELECT enrollment_model INTO v_student_model FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found'; END IF;
  IF v_student_model='bootcamp' THEN
    RAISE EXCEPTION 'bootcamp learners cannot purchase an individual subscription' USING ERRCODE='unique_violation';
  END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT cohort_kind INTO v_plan_kind FROM public.cohorts WHERE id=v_plan.cohort_id;
  IF v_plan.status<>'active' OR v_plan_kind NOT IN('legacy_individual','subscription_plan') THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;
  SELECT * INTO v_subscription FROM public.individual_subscriptions WHERE student_id=p_student_id;
  IF FOUND AND v_subscription.plan_id<>p_plan_id THEN RAISE EXCEPTION 'change the student plan before assigning a renewal payment'; END IF;

  INSERT INTO public.subscription_payment_requests(
    student_id,subscription_id,plan_id,plan_name,kind,duration_months,amount,currency,due_date,created_by
  ) VALUES(
    p_student_id,CASE WHEN v_subscription.id IS NULL THEN NULL ELSE v_subscription.id END,
    p_plan_id,v_plan.name,CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END,
    p_duration_months,p_amount,v_currency,p_due_date,p_created_by
  ) RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('ok',true,'requestId',v_request_id,'planName',v_plan.name);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_subscription_plan_prices(
  p_plan_id uuid,p_prices jsonb,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plan public.subscription_plans%ROWTYPE; v_role text;
BEGIN
  IF jsonb_typeof(p_prices)<>'array' THEN RAISE EXCEPTION 'prices must be an array'; END IF;
  SELECT role INTO v_role FROM public.students WHERE id=p_actor_id;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  IF v_role<>'admin' AND(v_role<>'instructor' OR v_plan.created_by IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_prices) AS x(duration_months integer,amount numeric,currency text,is_active boolean,sort_order integer)
    WHERE duration_months NOT IN(1,3,6,12) OR amount IS NULL OR amount<=0 OR btrim(COALESCE(currency,''))=''
  ) THEN RAISE EXCEPTION 'invalid subscription price'; END IF;
  IF EXISTS(
    SELECT duration_months FROM jsonb_to_recordset(p_prices) AS x(duration_months integer)
    GROUP BY duration_months HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'duplicate subscription price duration'; END IF;
  DELETE FROM public.subscription_plan_prices WHERE plan_id=p_plan_id;
  INSERT INTO public.subscription_plan_prices(plan_id,duration_months,amount,currency,is_active,sort_order)
  SELECT p_plan_id,x.duration_months,x.amount,upper(btrim(x.currency)),COALESCE(x.is_active,true),COALESCE(x.sort_order,x.duration_months)
  FROM jsonb_to_recordset(p_prices) AS x(duration_months integer,amount numeric,currency text,is_active boolean,sort_order integer);
  RETURN jsonb_build_object('ok',true,'count',jsonb_array_length(p_prices));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.replace_subscription_plan_prices(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_subscription_plan_prices(uuid,jsonb,uuid) TO service_role;
