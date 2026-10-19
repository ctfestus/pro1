-- Migration 225: carry a running promotion's end time on the public pricing view.
--
-- Learning pages offer the running discount mid-course, which can be hours after the page loaded
-- the offer. Without the end time the page could only ask again -- a round trip at the exact
-- moment the prompt should open between two lessons -- or advertise a promotion that had already
-- stopped. With it, the page checks the clock before opening.
--
-- Same view as migration 209 plus one key inside each price object, carried only while the
-- promotion is running, exactly like the type, value and label beside it. No column changes, so
-- CREATE OR REPLACE is enough, and the grant is unchanged.

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
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plan_content spc
      JOIN published_content pc
        ON pc.content_table = spc.content_table AND pc.id = spc.content_id
      WHERE spc.plan_id = p.id
    )
),
-- Keep this effective-price arithmetic aligned with lib/subscription-discount.ts, which protects
-- authenticated checkout and other server-rendered plan lists.
price_promotions AS (
  SELECT
    pr.*,
    p.discount_type,
    p.discount_value,
    p.discount_label,
    p.discount_ends_at,
    (
      p.discount_type IN ('percentage', 'fixed')
      AND p.discount_value > 0
      AND (p.discount_starts_at IS NULL OR now() >= p.discount_starts_at)
      AND (p.discount_ends_at IS NULL OR now() < p.discount_ends_at)
      AND round(CASE p.discount_type
        WHEN 'percentage' THEN pr.amount * (1 - p.discount_value / 100)
        WHEN 'fixed' THEN pr.amount - p.discount_value
        ELSE 0
      END, 2) > 0
    ) AS promotion_active
  FROM public.subscription_plan_prices pr
  JOIN public.subscription_plans p ON p.id = pr.plan_id
),
effective_prices AS (
  SELECT
    pp.*,
    CASE WHEN pp.promotion_active THEN round(
      CASE pp.discount_type
        WHEN 'percentage' THEN pp.amount * (1 - pp.discount_value / 100)
        WHEN 'fixed' THEN pp.amount - pp.discount_value
      END,
      2
    ) ELSE pp.amount END AS effective_amount
  FROM price_promotions pp
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
               'amount', pr.effective_amount,
               'listAmount', pr.amount,
               'discountType', CASE WHEN pr.promotion_active THEN pr.discount_type ELSE NULL END,
               'discountValue', CASE WHEN pr.promotion_active THEN pr.discount_value ELSE NULL END,
               'discountLabel', CASE WHEN pr.promotion_active THEN pr.discount_label ELSE NULL END,
               -- migration 225: when a running promotion stops, so a page left open past it can
               -- stop advertising it without asking again. Null for an open-ended one.
               'discountEndsAt', CASE WHEN pr.promotion_active THEN pr.discount_ends_at ELSE NULL END,
               'discountAmount', pr.amount - pr.effective_amount,
               'currency', pr.currency
             ) ORDER BY pr.duration_months
           )
    FROM effective_prices pr
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
