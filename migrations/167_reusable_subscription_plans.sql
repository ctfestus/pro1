-- Upgrade the already-deployed per-student subscription model from migration 166
-- to reusable plans. Existing subscriptions become one-person legacy plans so
-- their billing and content access remain unchanged.

BEGIN;

CREATE TABLE public.subscription_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  cohort_id   uuid NOT NULL UNIQUE REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, cohort_id)
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscription_plans: instructor select"
  ON public.subscription_plans FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Use the existing subscription UUID as its legacy plan UUID. This gives every
-- deployed subscription an exact, deterministic mapping without changing its
-- synthetic cohort or access tags.
INSERT INTO public.subscription_plans (id, name, description, cohort_id, status, created_at, updated_at)
SELECT
  s.id,
  'Legacy individual plan - ' || COALESCE(NULLIF(st.full_name, ''), st.email, left(s.id::text, 8)),
  'Automatically created from the individual subscription deployed in migration 166.',
  s.cohort_id,
  'active',
  s.created_at,
  s.updated_at
FROM public.individual_subscriptions s
LEFT JOIN public.students st ON st.id = s.student_id;

ALTER TABLE public.individual_subscriptions
  ADD COLUMN plan_id uuid;
UPDATE public.individual_subscriptions SET plan_id = id;
ALTER TABLE public.individual_subscriptions
  ALTER COLUMN plan_id SET NOT NULL,
  ADD CONSTRAINT individual_subscriptions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  ADD CONSTRAINT individual_subscriptions_plan_cohort_fkey
    FOREIGN KEY (plan_id, cohort_id) REFERENCES public.subscription_plans(id, cohort_id) ON DELETE RESTRICT;
DROP INDEX IF EXISTS public.idx_individual_subscriptions_cohort;
CREATE INDEX idx_individual_subscriptions_plan
  ON public.individual_subscriptions(plan_id);

CREATE POLICY "subscription_plans: student read assigned"
  ON public.subscription_plans FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.individual_subscriptions s
    WHERE s.plan_id = subscription_plans.id AND s.student_id = (SELECT auth.uid())
  ));

ALTER TABLE public.subscription_payments
  ADD COLUMN plan_id uuid,
  ADD COLUMN plan_name text;
UPDATE public.subscription_payments p
SET plan_id = s.plan_id,
    plan_name = sp.name
FROM public.individual_subscriptions s
JOIN public.subscription_plans sp ON sp.id = s.plan_id
WHERE s.id = p.subscription_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.subscription_payments
    WHERE plan_id IS NULL OR plan_name IS NULL
  ) THEN
    RAISE EXCEPTION 'subscription payment history contains an orphaned subscription_id; repair it before applying migration 167';
  END IF;
END;
$$;

ALTER TABLE public.subscription_payments
  ALTER COLUMN plan_id SET NOT NULL,
  ALTER COLUMN plan_name SET NOT NULL,
  ADD CONSTRAINT subscription_payments_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT;

ALTER TABLE public.subscription_content RENAME TO subscription_plan_content;
ALTER TABLE public.subscription_plan_content RENAME COLUMN subscription_id TO plan_id;
ALTER TABLE public.subscription_plan_content
  DROP CONSTRAINT IF EXISTS subscription_content_subscription_id_fkey,
  DROP CONSTRAINT IF EXISTS subscription_plan_content_subscription_id_fkey,
  DROP CONSTRAINT IF EXISTS subscription_content_subscription_id_content_table_content_id_key,
  DROP CONSTRAINT IF EXISTS subscription_plan_content_subscription_id_content_table_content_id_key;
ALTER TABLE public.subscription_plan_content
  ADD CONSTRAINT subscription_plan_content_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  ADD CONSTRAINT subscription_plan_content_plan_content_key
    UNIQUE (plan_id, content_table, content_id);
CREATE INDEX idx_subscription_plan_content_plan
  ON public.subscription_plan_content(plan_id);
CREATE INDEX idx_subscription_payments_plan
  ON public.subscription_payments(plan_id);

DROP POLICY IF EXISTS "subscription_content: instructor select" ON public.subscription_plan_content;
DROP POLICY IF EXISTS "subscription_content: student read own" ON public.subscription_plan_content;
CREATE POLICY "subscription_plan_content: instructor select"
  ON public.subscription_plan_content FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_plan_content: student read assigned"
  ON public.subscription_plan_content FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.individual_subscriptions s
    WHERE s.plan_id = subscription_plan_content.plan_id
      AND s.student_id = (SELECT auth.uid())
  ));

CREATE OR REPLACE FUNCTION public.create_individual_subscription_plan(
  p_name text,
  p_description text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid := gen_random_uuid();
  v_cohort_id uuid := gen_random_uuid();
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'plan name is required';
  END IF;

  INSERT INTO public.cohorts (id, name, status, is_individual, individual_student_id, start_date, created_by)
  VALUES (v_cohort_id, 'Subscription - ' || btrim(p_name), 'active', true, NULL, current_date, p_created_by);

  INSERT INTO public.subscription_plans (id, name, description, cohort_id, created_by)
  VALUES (v_plan_id, btrim(p_name), NULLIF(btrim(p_description), ''), v_cohort_id, p_created_by);

  RETURN jsonb_build_object('ok', true, 'planId', v_plan_id, 'cohortId', v_cohort_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_plan(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_plan(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_enrollment_model_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'permission denied: enrollment_model may only be changed by an enrollment-model function'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- An explicit cohort removal releases the student from the bootcamp model.
-- Financial rows remain intact, but their current enrollment link is detached
-- so bootcamp enforcement can no longer alter this student's access pointer.
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
  SET student_id = NULL, updated_at = now()
  WHERE student_id = p_student_id;

  UPDATE public.students
  SET cohort_id = NULL,
      original_cohort_id = NULL,
      payment_exempt = false,
      enrollment_model = NULL
  WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true, 'released', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) TO service_role;

-- Replace the permanent discriminator behavior from 166. A bootcamp student may
-- move to individual only after their cohort pointers have been explicitly
-- cleared. This also repairs students unassigned before migration 167.
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
    SET student_id = NULL, updated_at = now()
    WHERE student_id = p_student_id;
    UPDATE public.students SET enrollment_model = 'individual' WHERE id = p_student_id;
  ELSIF v_current <> p_requested_model THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', p_student_id, v_current
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.purchase_or_renew_individual_subscription(uuid, integer, numeric, text, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.purchase_or_renew_individual_subscription(
  p_student_id uuid,
  p_plan_id uuid,
  p_duration_months integer,
  p_amount numeric,
  p_currency text,
  p_idempotency_key text,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_currency text;
  v_payment public.subscription_payments%ROWTYPE;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_cohort_is_individual boolean;
  v_base timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_is_activating boolean;
  v_kind text;
  v_subscription_id uuid;
  v_payment_id uuid;
BEGIN
  IF p_duration_months NOT IN (1, 3, 6, 12) THEN
    RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  v_currency := upper(btrim(COALESCE(p_currency, '')));
  IF v_currency = '' THEN RAISE EXCEPTION 'currency is required'; END IF;
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN RAISE EXCEPTION 'idempotencyKey is required'; END IF;

  PERFORM public.claim_student_enrollment_model(p_student_id, 'individual');

  SELECT * INTO v_payment
  FROM public.subscription_payments
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_payment.student_id IS DISTINCT FROM p_student_id
       OR v_payment.plan_id IS DISTINCT FROM p_plan_id
       OR v_payment.amount IS DISTINCT FROM p_amount
       OR v_payment.currency IS DISTINCT FROM v_currency
       OR v_payment.duration_months IS DISTINCT FROM p_duration_months THEN
      RAISE EXCEPTION 'idempotency key was already used for a different subscription payment'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('ok', true, 'subscriptionId', v_payment.subscription_id,
      'paymentId', v_payment.id, 'alreadyProcessed', true);
  END IF;

  SELECT * INTO v_plan
  FROM public.subscription_plans
  WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  SELECT is_individual INTO v_plan_cohort_is_individual
  FROM public.cohorts
  WHERE id = v_plan.cohort_id;
  IF v_plan.status <> 'active' OR NOT COALESCE(v_plan_cohort_is_individual, false) THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;

  SELECT * INTO v_subscription
  FROM public.individual_subscriptions
  WHERE student_id = p_student_id;
  v_is_activating := NOT (FOUND AND v_subscription.status = 'active' AND v_subscription.current_period_end > now());
  v_base := CASE WHEN v_is_activating THEN now() ELSE v_subscription.current_period_end END;
  v_period_start := v_base;
  v_period_end := public.add_months_clamped(v_base, p_duration_months);
  v_kind := CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END;

  IF v_subscription.id IS NOT NULL AND v_subscription.plan_id <> p_plan_id THEN
    RAISE EXCEPTION 'this student is already assigned to a different subscription plan'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF v_subscription.id IS NULL THEN
    INSERT INTO public.individual_subscriptions (
      student_id, plan_id, cohort_id, status, duration_months, amount, currency,
      current_period_start, current_period_end, cancelled_at
    ) VALUES (
      p_student_id, p_plan_id, v_plan.cohort_id, 'active', p_duration_months, p_amount, v_currency,
      v_period_start, v_period_end, NULL
    ) RETURNING id INTO v_subscription_id;
  ELSE
    UPDATE public.individual_subscriptions
    SET status = 'active', duration_months = p_duration_months, amount = p_amount,
        currency = v_currency,
        current_period_start = CASE WHEN v_is_activating THEN v_period_start ELSE current_period_start END,
        current_period_end = v_period_end, cancelled_at = NULL
    WHERE id = v_subscription.id
    RETURNING id INTO v_subscription_id;
  END IF;

  INSERT INTO public.subscription_payments (
    subscription_id, student_id, plan_id, plan_name, idempotency_key, status, is_activating, kind,
    duration_months, amount, currency, period_start, period_end,
    payment_method, payment_reference, notes, created_by
  ) VALUES (
    v_subscription_id, p_student_id, p_plan_id, v_plan.name, p_idempotency_key, 'completed', v_is_activating, v_kind,
    p_duration_months, p_amount, v_currency, v_period_start, v_period_end,
    NULLIF(btrim(p_payment_method), ''), NULLIF(btrim(p_payment_reference), ''), NULLIF(btrim(p_notes), ''), p_created_by
  ) RETURNING id INTO v_payment_id;

  UPDATE public.students SET cohort_id = v_plan.cohort_id WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true, 'subscriptionId', v_subscription_id,
    'paymentId', v_payment_id, 'alreadyProcessed', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid, uuid, integer, numeric, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid, uuid, integer, numeric, text, text, text, text, text, uuid) TO service_role;

COMMIT;
