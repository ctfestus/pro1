-- What a visitor with no account can actually obtain.
--
-- The landing page lists every published row, so it advertises bootcamp-cohort content that
-- nobody outside that cohort can ever get. Clicking one is a dead end, and it puts private
-- client delivery on a public marketing page.
--
-- The rule matches what the content detail page already enforces, so the two surfaces finally
-- agree: it is offered to everyone, or an active plan with a live price covers it -- directly,
-- or through a published learning path that plan includes.
--
-- This is a view rather than a filter in the app because the landing page reads with the
-- anonymous key, and anonymous callers cannot read plan coverage: the RLS policy on
-- subscription_plan_content requires a matching subscription. A view runs with its owner's
-- rights, which is how the existing published_* views already serve anonymous visitors.
--
-- The existing published_* views are deliberately left alone. They are also used by the
-- certification authoring and taking screens, where an instructor must still see bootcamp
-- content, and narrowing them would break that.

CREATE OR REPLACE VIEW public.publicly_offered_content
WITH (security_barrier = true)
AS
WITH sellable_plans AS (
  -- Active plan, an access cohort that really is an individual subscription, and at least one
  -- live price. A plan with no price is not something anyone can buy.
  SELECT p.id
  FROM public.subscription_plans p
  JOIN public.cohorts c ON c.id = p.cohort_id
  WHERE p.status = 'active'
    AND c.cohort_kind IN ('legacy_individual', 'subscription_plan')
    AND EXISTS (
      SELECT 1 FROM public.subscription_plan_prices pr
      WHERE pr.plan_id = p.id AND pr.is_active
    )
),
sold_direct AS (
  SELECT spc.content_table, spc.content_id
  FROM public.subscription_plan_content spc
  JOIN sellable_plans sp ON sp.id = spc.plan_id
),
sold_via_path AS (
  -- A plan can grant a course or experience by including a learning path rather than the item
  -- itself. Miss this and content someone can genuinely buy still reads as unavailable.
  SELECT unnest(lp.item_ids) AS content_id
  FROM public.learning_paths lp
  JOIN sold_direct sd ON sd.content_table = 'learning_paths' AND sd.content_id = lp.id
  WHERE lp.status = 'published'
)
SELECT 'courses'::text AS content_table, c.id AS content_id
FROM public.courses c
WHERE c.status = 'published'
  AND (
    c.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'courses' AND s.content_id = c.id)
    OR EXISTS (SELECT 1 FROM sold_via_path v WHERE v.content_id = c.id)
  )
UNION ALL
SELECT 'virtual_experiences'::text, v.id
FROM public.virtual_experiences v
WHERE v.status = 'published'
  AND (
    v.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'virtual_experiences' AND s.content_id = v.id)
    OR EXISTS (SELECT 1 FROM sold_via_path p WHERE p.content_id = v.id)
  )
UNION ALL
SELECT 'certifications'::text, ce.id
FROM public.certifications ce
WHERE ce.status = 'published'
  AND (
    ce.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'certifications' AND s.content_id = ce.id)
    OR EXISTS (SELECT 1 FROM sold_via_path p WHERE p.content_id = ce.id)
  )
UNION ALL
-- A path is obtainable in its own right; it is never reached "through" another path.
SELECT 'learning_paths'::text, lp.id
FROM public.learning_paths lp
WHERE lp.status = 'published'
  AND (
    lp.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'learning_paths' AND s.content_id = lp.id)
  );

GRANT SELECT ON public.publicly_offered_content TO anon, authenticated;
