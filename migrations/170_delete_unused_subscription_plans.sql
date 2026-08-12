-- Permanently delete a subscription plan only when it has never been used.
-- Used plans remain deactivatable but retain all financial and audit history.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_unused_subscription_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_cohort_id uuid;
  v_content record;
BEGIN
  SELECT cohort_id INTO v_cohort_id
  FROM public.subscription_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.individual_subscriptions WHERE plan_id = p_plan_id) THEN
    RAISE EXCEPTION 'This plan has subscriber history and cannot be deleted. Deactivate it instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE plan_id = p_plan_id) THEN
    RAISE EXCEPTION 'This plan has payment history and cannot be deleted. Deactivate it instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payment_requests WHERE plan_id = p_plan_id) THEN
    RAISE EXCEPTION 'This plan has payment-request history and cannot be deleted. Deactivate it instead.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscription_plan_changes
    WHERE old_plan_id = p_plan_id OR new_plan_id = p_plan_id
  ) THEN
    RAISE EXCEPTION 'This plan has plan-change history and cannot be deleted. Deactivate it instead.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE cohort_id = v_cohort_id OR original_cohort_id = v_cohort_id
  ) THEN
    RAISE EXCEPTION 'This plan access cohort is still assigned to a student and cannot be deleted.';
  END IF;

  -- Remove the synthetic cohort tag from each covered content item before the
  -- plan-content rows cascade away.
  FOR v_content IN
    SELECT content_table, content_id
    FROM public.subscription_plan_content
    WHERE plan_id = p_plan_id
  LOOP
    PERFORM public.toggle_content_cohort_tag(
      v_content.content_table, v_content.content_id, v_cohort_id, false
    );
  END LOOP;

  DELETE FROM public.cohort_assignments WHERE cohort_id = v_cohort_id;
  DELETE FROM public.subscription_plans WHERE id = p_plan_id;
  DELETE FROM public.cohorts WHERE id = v_cohort_id;

  RETURN jsonb_build_object('ok', true, 'planId', p_plan_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_unused_subscription_plan(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unused_subscription_plan(uuid)
  TO service_role;

COMMIT;
