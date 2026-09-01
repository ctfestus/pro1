-- Stop advertising a subscription plan when all of its attached content has been unpublished.
-- The published_content CTE already defines the content that counts toward plan coverage; use
-- the same set to decide whether the plan is sellable at all.

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
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plan_content spc
      JOIN published_content pc
        ON pc.content_table = spc.content_table AND pc.id = spc.content_id
      WHERE spc.plan_id = p.id
    )
),
plan_coverage AS (
  SELECT spc.plan_id, spc.content_table, count(*)::int AS content_count
  FROM public.subscription_plan_content spc
  JOIN published_content pc
    ON pc.content_table = spc.content_table AND pc.id = spc.content_id
  GROUP BY spc.plan_id, spc.content_table
)
SELECT
  s.id AS plan_id,
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
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'courses'), 0) AS courses,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'learning_paths'), 0) AS learning_paths,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'virtual_experiences'), 0) AS virtual_experiences,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'certifications'), 0) AS certifications
FROM sellable_plans s;

GRANT SELECT ON public.public_pricing_plans TO anon, authenticated;
