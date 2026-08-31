-- Putting content into a plan, or taking it out, as one operation.
--
-- Four writes have to agree: closing open access where the author asked for it, the coverage
-- row, the cohort tag that actually grants access, and the cohort_assignments bookkeeping. They
-- were four separate round trips, so any failure after the first left the rest undone and
-- returned an error -- with the earlier writes standing.
--
-- The worst of those was real rather than theoretical. Every content table carries
-- CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0), so tagging open content with
-- a cohort fails at the database. Attaching an open virtual experience or learning path wrote
-- the coverage row, then failed on the tag, leaving content recorded as sold in a plan that
-- granted nobody anything. And with the author's consent to close open access, the close
-- happened first: a later failure meant learners lost access to content that never joined a
-- plan.
--
-- A plpgsql function is one transaction, so either all four land or none do.

CREATE OR REPLACE FUNCTION public.set_subscription_plan_content(
  p_plan_id uuid,
  p_content_table text,
  p_content_id uuid,
  p_actor_id uuid,
  p_add boolean,
  p_clear_public boolean DEFAULT false,
  p_ca_content_type text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cohort_id uuid;
BEGIN
  IF p_content_table NOT IN ('courses','virtual_experiences','certifications','learning_paths') THEN
    RAISE EXCEPTION 'invalid content table: %', p_content_table;
  END IF;

  SELECT cohort_id INTO v_cohort_id FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  -- Only ever on request, and only while adding. The caller has already shown the author who
  -- loses access; this is the point where that answer is acted on.
  IF p_add AND p_clear_public THEN
    EXECUTE format('UPDATE public.%I SET available_to_everyone = false WHERE id = $1', p_content_table)
      USING p_content_id;
  END IF;

  IF p_add THEN
    INSERT INTO public.subscription_plan_content (plan_id, content_table, content_id, added_by)
    VALUES (p_plan_id, p_content_table, p_content_id, p_actor_id)
    ON CONFLICT (plan_id, content_table, content_id) DO NOTHING;
  ELSE
    DELETE FROM public.subscription_plan_content
    WHERE plan_id = p_plan_id
      AND content_table = p_content_table
      AND content_id = p_content_id;
  END IF;

  -- The tag is what actually grants access. If it fails, nothing above it may stand.
  PERFORM public.toggle_content_cohort_tag(p_content_table, p_content_id, v_cohort_id, p_add);

  IF p_ca_content_type IS NOT NULL THEN
    IF p_add THEN
      INSERT INTO public.cohort_assignments (content_id, content_type, cohort_id)
      VALUES (p_content_id, p_ca_content_type, v_cohort_id)
      ON CONFLICT (content_id, cohort_id) DO NOTHING;
    ELSE
      DELETE FROM public.cohort_assignments
      WHERE content_id = p_content_id AND cohort_id = v_cohort_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'planId', p_plan_id, 'contentId', p_content_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  TO service_role;
