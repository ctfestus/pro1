-- What the public pricing page is allowed to read, defined in SQL rather than in a projection.
--
-- The page was reading with the service role. That is not a key leak from a server component,
-- but it is the wrong boundary for a public page: the contract lives in TypeScript, where the
-- next person widening a select silently widens what the world can see. These views put it in
-- one reviewable place and let the page read with the anonymous key, like the rest of the
-- public catalogue already does.
--
-- Views run with their owner's rights, which is how published_courses already serves anonymous
-- visitors past RLS.

-- ---------------------------------------------------------------------------
-- Everything an account with no plan can already open.
--
-- Not just rows flagged available_to_everyone. The access rule on each content table also opens
-- an item that sits inside a PUBLISHED, FREE learning path, and that clause carries no login
-- requirement either. Counting only the flag understates the free tier and makes the pricing
-- page promise less than a new learner actually gets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_free_content
WITH (security_barrier = true)
AS
WITH free_path_items AS (
  SELECT unnest(lp.item_ids) AS content_id
  FROM public.learning_paths lp
  WHERE lp.status = 'published' AND lp.available_to_everyone
)
SELECT 'courses'::text AS content_table, c.id AS content_id
FROM public.courses c
WHERE c.status = 'published'
  AND (c.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = c.id))
UNION
SELECT 'virtual_experiences'::text, v.id
FROM public.virtual_experiences v
WHERE v.status = 'published'
  AND (v.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = v.id))
UNION
SELECT 'certifications'::text, ce.id
FROM public.certifications ce
WHERE ce.status = 'published'
  AND (ce.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = ce.id))
UNION
-- A path is free in its own right; it is never reached through another path.
SELECT 'learning_paths'::text, lp.id
FROM public.learning_paths lp
WHERE lp.status = 'published' AND lp.available_to_everyone;

GRANT SELECT ON public.public_free_content TO anon, authenticated;

CREATE OR REPLACE VIEW public.public_free_content_counts
WITH (security_barrier = true)
AS
SELECT content_table, count(*)::int AS content_count
FROM public.public_free_content
GROUP BY content_table;

GRANT SELECT ON public.public_free_content_counts TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plans a visitor could actually buy, with their live prices and how much of each kind of
-- content they grant.
--
-- Names and counts only. Nothing here reaches into what the content contains.
-- ---------------------------------------------------------------------------
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
