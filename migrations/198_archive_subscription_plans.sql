-- Somewhere to put a plan that is finished with.
--
-- A plan carrying any history cannot be deleted, and that is right: deleting it would orphan the
-- records of what people paid and what they got. Deactivating is the intended action, but an
-- inactive plan stays in the list beside the live ones for ever, so the list only grows.
--
-- Archiving is a separate axis from status on purpose. "Inactive" is a plan that is off right
-- now and may come back -- a seasonal offer, a plan being repriced -- and staff still need to see
-- it. "Archived" is a plan nobody expects to use again. Reusing status for both would mean an
-- admin could not tell those two apart, and hiding every inactive plan would hide the ones they
-- switched off this morning and are about to switch back on.
--
-- Nothing here changes who can be charged or what anyone already bought. An archived plan is
-- already unsellable, because the public pricing view requires status = 'active'.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.subscription_plans.archived_at IS
  'When this plan was put out of the way. Archived plans are hidden from the plan list and the '
  'content editors by default. Independent of status: archiving requires the plan to be '
  'inactive, and unarchiving leaves it inactive rather than switching it back on.';

-- The invariant, enforced rather than described. An archived plan that is switched back on is
-- on sale while hidden from the list that would show it -- money taken for something nobody can
-- see they are still selling. Application checks are the first line, but the only reason this
-- cannot happen is that the database will not store it.
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_archived_is_inactive;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_archived_is_inactive
  CHECK (archived_at IS NULL OR status = 'inactive');

-- Partial, because the list's default view asks for exactly this: the plans that are not
-- archived. The archived ones are a rare, deliberate lookup and can be scanned.
CREATE INDEX IF NOT EXISTS idx_subscription_plans_not_archived
  ON public.subscription_plans (created_at DESC)
  WHERE archived_at IS NULL;

-- Defence in depth on the public page. The constraint above already keeps an archived plan
-- inactive, and the view only sells active plans, so this changes nothing today -- which is the
-- point. If that constraint is ever dropped, the public page still refuses to sell an archived
-- plan rather than quietly listing it.
--
-- Copied verbatim from festman-fresh-schema.sql with one line added, so the two cannot drift.
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
  SELECT p.id, p.name, p.description
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
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'certifications'), 0)      AS certifications
FROM sellable_plans s;

GRANT SELECT ON public.public_pricing_plans TO anon, authenticated;
