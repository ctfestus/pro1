-- The plan the seller wants people to choose.
--
-- The pricing page ordered plans by name, so which one came first was an accident of spelling,
-- and the hero led with whichever happened to save the most. Neither is a decision anyone made.
--
-- "Recommended" rather than "most popular" on purpose. Popularity is a claim about other buyers
-- that nobody checks and that can simply be false; a recommendation is the seller's own opinion,
-- which is true by saying it.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscription_plans.recommended IS
  'The plan to put in front of people: shown first after the free tier, badged, and led with in '
  'the pricing hero. At most one plan may hold this.';

-- At most one. A page with two recommendations recommends nothing, and the ordering would be
-- ambiguous again. Indexing the constant true means a second row cannot be stored.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_one_recommended
  ON public.subscription_plans ((recommended))
  WHERE recommended;

-- The public page needs to know which one it is. Copied verbatim from festman-fresh-schema.sql
-- with the column carried through, so the two cannot drift.
CREATE OR REPLACE VIEW public.public_pricing_plans
WITH (security_barrier = true)
AS
WITH published_content AS (
  SELECT 'courses'::text AS content_table, id FROM public.courses WHERE status = 'published'
  UNION ALL
  SELECT 'learning_paths'::text, id FROM public.learning_paths WHERE status = 'published'
  UNION ALL
  SELECT 'virtual_experiences'::text, id FROM public.virtual_experiences WHERE status = 'published'
  UNION ALL
  SELECT 'certifications'::text, id FROM public.certifications WHERE status = 'published'
),
sellable_plans AS (
  -- Active, an access cohort that really is an individual subscription, and at least one live
  -- price. A plan nobody can buy has no place on a pricing page.
  SELECT p.id, p.name, p.description, p.recommended
  FROM public.subscription_plans p
  JOIN public.cohorts c ON c.id = p.cohort_id
  WHERE p.status = 'active'
    AND p.archived_at IS NULL
    AND c.cohort_kind IN ('legacy_individual', 'subscription_plan')
    AND EXISTS (
      SELECT 1 FROM public.subscription_plan_prices pr
      WHERE pr.plan_id = p.id AND pr.is_active
    )
),
plan_coverage AS (
  -- Published only. Content withdrawn after it was attached to a plan is no longer something
  -- the plan effectively grants, so counting it would overstate the offer.
  SELECT spc.plan_id, spc.content_table, count(*)::int AS content_count
  FROM public.subscription_plan_content spc
  JOIN published_content pc
    ON pc.content_table = spc.content_table AND pc.id = spc.content_id
  GROUP BY spc.plan_id, spc.content_table
)
SELECT
  s.id   AS plan_id,
  s.name AS plan_name,
  s.description AS plan_description,
  COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', pr.id,
               'durationMonths', pr.duration_months,
               'amount', pr.amount,
               'currency', pr.currency
             ) ORDER BY pr.duration_months
           )
    FROM public.subscription_plan_prices pr
    WHERE pr.plan_id = s.id AND pr.is_active
  ), '[]'::jsonb) AS prices,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'courses'), 0)             AS courses,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'learning_paths'), 0)      AS learning_paths,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'virtual_experiences'), 0) AS virtual_experiences,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'certifications'), 0)      AS certifications,
  -- Appended, never inserted: CREATE OR REPLACE VIEW can only add columns at the end.
  s.recommended AS recommended
FROM sellable_plans s;

GRANT SELECT ON public.public_pricing_plans TO anon, authenticated;

-- Moving the mark, as one operation.
--
-- It was two updates: clear whoever held it, then set the new one. If the second failed, nothing
-- was marked at all, and two people doing this at once could collide on the unique index below
-- with one of them having already cleared the other. Neither is recoverable by retrying, because
-- by then the old mark is gone.
--
-- Everything the decision depends on is read inside the transaction and locked, so the answer
-- cannot change between checking it and acting on it.
CREATE OR REPLACE FUNCTION public.set_recommended_subscription_plan(
  p_plan_id uuid,
  p_actor_id uuid,
  p_is_admin boolean,
  p_recommended boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_target record;
  v_current record;
BEGIN
  -- Taken before anything is read, and held to the end of the transaction.
  --
  -- Locking the rows was not enough. Two callers marking different plans lock the same current
  -- holder, and the one that waits re-reads after the other has committed -- by which time that
  -- row no longer matches "recommended", so it finds nothing and marks its own target anyway,
  -- colliding on the unique index. Worse, with no plan marked at all there is no row to lock and
  -- nothing serialises them in the first place.
  --
  -- This is one mark for the whole platform, so the thing to lock is the decision, not a row.
  -- The second caller waits here and reads the state the first one left.
  PERFORM pg_advisory_xact_lock(hashtext('subscription_plans.recommended'));

  SELECT id, name, status, archived_at, created_by INTO v_target
  FROM public.subscription_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF NOT p_is_admin AND v_target.created_by IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF NOT p_recommended THEN
    UPDATE public.subscription_plans SET recommended = false WHERE id = p_plan_id;
    RETURN jsonb_build_object('ok', true, 'recommended', false);
  END IF;

  -- A plan visitors cannot see must not hold the one mark there is. Archived hides it outright;
  -- inactive keeps it off the pricing page just as surely.
  IF v_target.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'archived');
  END IF;
  IF v_target.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'inactive');
  END IF;

  -- Locked before it is read, so a second caller waits here rather than racing the unique index.
  SELECT id, name, created_by INTO v_current
  FROM public.subscription_plans WHERE recommended AND id <> p_plan_id FOR UPDATE;

  IF FOUND THEN
    IF NOT p_is_admin AND v_current.created_by IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'held_by_other', 'planName', v_current.name);
    END IF;
    UPDATE public.subscription_plans SET recommended = false WHERE id = v_current.id;
  END IF;

  UPDATE public.subscription_plans SET recommended = true WHERE id = p_plan_id;
  RETURN jsonb_build_object('ok', true, 'recommended', true,
                            'replaced', CASE WHEN v_current.id IS NULL THEN NULL ELSE v_current.name END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_recommended_subscription_plan(uuid, uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_recommended_subscription_plan(uuid, uuid, boolean, boolean)
  TO service_role;
