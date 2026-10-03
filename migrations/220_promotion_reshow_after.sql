-- Promotions: optionally show a closed promo again after a number of days, chosen per promo.
-- NULL keeps the original behavior (closed means never shown again in that browser).
--
-- The browser sends each closed promo with the time it was closed; whether that closure has
-- expired is decided here against the promo's current setting, so changing the setting later
-- also applies to people who already closed it.

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS reshow_after_days integer
  CHECK (reshow_after_days IS NULL OR reshow_after_days BETWEEN 1 AND 365);

DROP FUNCTION IF EXISTS public.get_active_promotion(text, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.get_active_promotion(
  p_placement  text,
  p_cohort_id  uuid DEFAULT NULL,
  p_closed_ids uuid[] DEFAULT '{}',
  p_closed_at  timestamptz[] DEFAULT '{}'
)
RETURNS TABLE(id uuid, title text, body text, image_url text, cta_label text, cta_url text, updated_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.title, p.body, p.image_url, p.cta_label, p.cta_url, p.updated_at
  FROM public.promotions AS p
  WHERE p.is_active
    AND p_placement = ANY(p.placements)
    AND p.starts_at <= now()
    AND (p.ends_at IS NULL OR p.ends_at > now())
    AND (p.cohort_ids = '{}' OR p_cohort_id = ANY(p.cohort_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_closed_ids, '{}'), COALESCE(p_closed_at, '{}')) AS closed(id, closed_at)
      WHERE closed.id = p.id
        AND (
          p.reshow_after_days IS NULL
          OR closed.closed_at IS NULL
          OR closed.closed_at > now() - make_interval(days => p.reshow_after_days)
        )
    )
  ORDER BY p.starts_at DESC, p.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[]) TO service_role;
