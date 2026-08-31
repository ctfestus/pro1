-- New subscription plans must remain drafts until their prices and content are ready.
-- The builder finishes setup through several requests, so an active default briefly put an
-- incomplete plan on sale and made a failed retry unsafe.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_individual_subscription_plan(
  p_name text,
  p_description text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid := gen_random_uuid();
  v_cohort_id uuid;
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'plan name is required';
  END IF;

  INSERT INTO public.cohorts (name, status, cohort_kind, individual_student_id, start_date, created_by)
  VALUES ('Subscription - ' || btrim(p_name), 'active', 'subscription_plan', NULL, current_date, p_created_by)
  RETURNING id INTO v_cohort_id;

  INSERT INTO public.subscription_plans (id, name, description, cohort_id, status, created_by)
  VALUES (v_plan_id, btrim(p_name), NULLIF(btrim(p_description), ''), v_cohort_id, 'inactive', p_created_by);

  RETURN jsonb_build_object('ok', true, 'planId', v_plan_id, 'cohortId', v_cohort_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) TO service_role;

COMMIT;
