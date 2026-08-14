-- Audit and transactionally apply plan-only changes. A plan change moves access
-- but never changes price, duration, paid period dates, or payment history.

BEGIN;

CREATE TABLE public.subscription_plan_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  student_id       uuid REFERENCES public.students(id) ON DELETE SET NULL,
  old_plan_id      uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  new_plan_id      uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  changed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes            text,
  changed_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (old_plan_id <> new_plan_id)
);
CREATE INDEX idx_subscription_plan_changes_subscription
  ON public.subscription_plan_changes(subscription_id, changed_at DESC);

ALTER TABLE public.subscription_plan_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscription_plan_changes: instructor select"
  ON public.subscription_plan_changes FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_plan_changes: student read own"
  ON public.subscription_plan_changes FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.change_individual_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_id uuid,
  p_changed_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_student_id uuid;
  v_old_plan_id uuid;
  v_old_cohort_id uuid;
  v_new_cohort_id uuid;
  v_new_plan_status text;
  v_new_cohort_is_individual boolean;
  v_subscription_status text;
  v_period_end timestamptz;
BEGIN
  SELECT student_id INTO v_student_id
  FROM public.individual_subscriptions
  WHERE id = p_subscription_id;
  IF NOT FOUND OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'subscription not found';
  END IF;

  PERFORM public.claim_student_enrollment_model(v_student_id, 'individual');

  SELECT plan_id, cohort_id, status, current_period_end
  INTO v_old_plan_id, v_old_cohort_id, v_subscription_status, v_period_end
  FROM public.individual_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  SELECT cohort_id, status
  INTO v_new_cohort_id, v_new_plan_status
  FROM public.subscription_plans
  WHERE id = p_new_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  SELECT is_individual INTO v_new_cohort_is_individual
  FROM public.cohorts
  WHERE id = v_new_cohort_id;
  IF v_new_plan_status <> 'active' OR NOT COALESCE(v_new_cohort_is_individual, false) THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;

  IF v_old_plan_id = p_new_plan_id THEN
    RETURN jsonb_build_object('ok', true, 'alreadyAssigned', true, 'subscriptionId', p_subscription_id);
  END IF;

  UPDATE public.individual_subscriptions
  SET plan_id = p_new_plan_id,
      cohort_id = v_new_cohort_id
  WHERE id = p_subscription_id;

  IF v_subscription_status = 'active' AND v_period_end > now() THEN
    UPDATE public.students SET cohort_id = v_new_cohort_id WHERE id = v_student_id;
  ELSE
    UPDATE public.students SET cohort_id = NULL
    WHERE id = v_student_id AND cohort_id = v_old_cohort_id;
  END IF;

  INSERT INTO public.subscription_plan_changes (
    subscription_id, student_id, old_plan_id, new_plan_id, changed_by, notes
  ) VALUES (
    p_subscription_id, v_student_id, v_old_plan_id, p_new_plan_id,
    p_changed_by, NULLIF(btrim(p_notes), '')
  );

  RETURN jsonb_build_object('ok', true, 'alreadyAssigned', false,
    'subscriptionId', p_subscription_id, 'planId', p_new_plan_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.change_individual_subscription_plan(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_individual_subscription_plan(uuid, uuid, uuid, text) TO service_role;

COMMIT;
