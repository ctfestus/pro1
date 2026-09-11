-- A name for the promotion, so a discount can say why it exists.
--
-- "15% off" tells a learner the size of the saving but not the reason, which reads as though the
-- price was simply wrong before. "Black Friday - 15% off" is a reason with an end to it, and it
-- matches whatever the seller put in the email that brought the learner to the page.
--
-- Optional: a promotion with no name keeps the plain "15% off" it has today.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS discount_label text;

COMMENT ON COLUMN public.subscription_plans.discount_label IS
  'Optional name for the promotion, shown beside the saving. Null means the saving speaks alone.';

-- Rebuilt rather than added to: the label belongs on the same "all four or none" rule as the rest
-- of the promotion, so a cleared discount cannot leave its name behind on the plan.
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_discount_complete,
  DROP CONSTRAINT IF EXISTS subscription_plans_discount_window,
  DROP CONSTRAINT IF EXISTS subscription_plans_discount_label_shape;

ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_discount_complete
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL
        AND discount_starts_at IS NULL AND discount_ends_at IS NULL
        AND discount_label IS NULL)
      OR
      (discount_type IS NOT NULL AND discount_type IN ('percentage', 'fixed')
        AND discount_value IS NOT NULL AND discount_value > 0
        AND (discount_type <> 'percentage' OR discount_value < 100))
    ),
  ADD CONSTRAINT subscription_plans_discount_window
    CHECK (discount_starts_at IS NULL OR discount_ends_at IS NULL
      OR discount_starts_at < discount_ends_at),
  -- A blank name is not a name, and one long enough to wrap would break the badge it sits in.
  ADD CONSTRAINT subscription_plans_discount_label_shape
    CHECK (discount_label IS NULL
      OR (btrim(discount_label) = discount_label
        AND length(discount_label) BETWEEN 1 AND 40));

-- Replaced, not extended: a plpgsql function's parameters are part of its identity, so taking one
-- more means dropping the old signature. Only the prices route calls it.
DROP FUNCTION IF EXISTS public.replace_subscription_plan_prices_and_discount(
  uuid, jsonb, text, numeric, timestamptz, timestamptz, uuid
);

CREATE OR REPLACE FUNCTION public.replace_subscription_plan_prices_and_discount(
  p_plan_id uuid,
  p_prices jsonb,
  p_discount_type text,
  p_discount_value numeric,
  p_discount_starts_at timestamptz,
  p_discount_ends_at timestamptz,
  p_discount_label text,
  p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_role text;
  v_label text := NULLIF(btrim(COALESCE(p_discount_label, '')), '');
BEGIN
  IF jsonb_typeof(p_prices) <> 'array' THEN RAISE EXCEPTION 'prices must be an array'; END IF;
  SELECT role INTO v_role FROM public.students WHERE id = p_actor_id;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  IF v_role <> 'admin' AND (v_role <> 'instructor' OR v_plan.created_by IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_prices)
      AS x(duration_months integer, amount numeric, currency text, is_active boolean, sort_order integer)
    WHERE duration_months NOT IN (1, 3, 6, 12)
      OR amount IS NULL OR amount <= 0 OR btrim(COALESCE(currency, '')) = ''
  ) THEN RAISE EXCEPTION 'invalid subscription price'; END IF;
  IF EXISTS (
    SELECT duration_months FROM jsonb_to_recordset(p_prices) AS x(duration_months integer)
    GROUP BY duration_months HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate subscription price duration'; END IF;

  IF p_discount_type IS NULL THEN
    IF p_discount_value IS NOT NULL OR p_discount_starts_at IS NOT NULL
      OR p_discount_ends_at IS NOT NULL OR v_label IS NOT NULL THEN
      RAISE EXCEPTION 'discount fields require a discount type';
    END IF;
  ELSIF p_discount_type NOT IN ('percentage', 'fixed')
    OR p_discount_value IS NULL OR p_discount_value <= 0
    OR (p_discount_type = 'percentage' AND p_discount_value >= 100) THEN
    RAISE EXCEPTION 'invalid subscription discount';
  END IF;
  IF v_label IS NOT NULL AND length(v_label) > 40 THEN
    RAISE EXCEPTION 'discount name is too long';
  END IF;
  IF p_discount_starts_at IS NOT NULL AND p_discount_ends_at IS NOT NULL
    AND p_discount_starts_at >= p_discount_ends_at THEN
    RAISE EXCEPTION 'discount end must be later than its start';
  END IF;

  IF p_discount_type = 'fixed' AND (
    SELECT count(DISTINCT upper(btrim(currency)))
    FROM jsonb_to_recordset(p_prices)
      AS x(duration_months integer, amount numeric, currency text, is_active boolean, sort_order integer)
    WHERE COALESCE(is_active, true)
  ) > 1 THEN
    RAISE EXCEPTION 'fixed discount requires one active price currency';
  END IF;

  IF p_discount_type IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_prices)
      AS x(duration_months integer, amount numeric, currency text, is_active boolean, sort_order integer)
    WHERE COALESCE(is_active, true)
      AND round(CASE p_discount_type
        WHEN 'percentage' THEN amount * (1 - p_discount_value / 100)
        WHEN 'fixed' THEN amount - p_discount_value
      END, 2) <= 0
  ) THEN RAISE EXCEPTION 'discount must leave a payable amount'; END IF;

  UPDATE public.subscription_plans
  SET discount_type = p_discount_type,
      discount_value = p_discount_value,
      discount_starts_at = p_discount_starts_at,
      discount_ends_at = p_discount_ends_at,
      discount_label = v_label
  WHERE id = p_plan_id;

  DELETE FROM public.subscription_plan_prices WHERE plan_id = p_plan_id;
  INSERT INTO public.subscription_plan_prices(
    plan_id, duration_months, amount, currency, is_active, sort_order
  )
  SELECT p_plan_id, x.duration_months, x.amount, upper(btrim(x.currency)),
    COALESCE(x.is_active, true), COALESCE(x.sort_order, x.duration_months)
  FROM jsonb_to_recordset(p_prices)
    AS x(duration_months integer, amount numeric, currency text, is_active boolean, sort_order integer);

  RETURN jsonb_build_object('ok', true, 'count', jsonb_array_length(p_prices));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_subscription_plan_prices_and_discount(
  uuid, jsonb, text, numeric, timestamptz, timestamptz, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_subscription_plan_prices_and_discount(
  uuid, jsonb, text, numeric, timestamptz, timestamptz, text, uuid
) TO service_role;

-- The pricing page reads plans through this view as an anonymous visitor, so the name has to
-- travel with the price it belongs to. Carried only while the promotion is actually running,
-- exactly like the type and the value beside it.
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
