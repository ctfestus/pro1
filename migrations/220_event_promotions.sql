-- Event promotions: a second promo layout for webinars and events. The instructor types every
-- detail (nothing is linked to the events table): title = heading, body = subheading (no image),
-- and event_items = the rows, each
--   { "date": "YYYY-MM-DD", "format": "virtual" | "in_person" | "hybrid",
--     "title": text, "note": text (e.g. "Register by October 5"), "url": text }
-- Rows whose date has passed are hidden by the card; once every row has passed, the function
-- below stops returning the promo, so it can never block a live one.

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard'
  CHECK (kind IN ('standard', 'events'));

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS event_items jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(event_items) = 'array' AND jsonb_array_length(event_items) <= 6);

-- The return shape and arguments change, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS public.get_active_promotion(text, uuid, uuid[], timestamptz[]);

-- p_today is the viewer's local date, sent by the browser, so "has this event passed" is decided
-- on the same calendar day the card uses (NULL falls back to the database's date).
CREATE OR REPLACE FUNCTION public.get_active_promotion(
  p_placement  text,
  p_cohort_id  uuid DEFAULT NULL,
  p_closed_ids uuid[] DEFAULT '{}',
  p_closed_at  timestamptz[] DEFAULT '{}',
  p_today      date DEFAULT NULL
)
RETURNS TABLE(
  id uuid, kind text, title text, body text, image_url text, cta_label text, cta_url text,
  event_items jsonb, updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.kind, p.title, p.body, p.image_url, p.cta_label, p.cta_url, p.event_items, p.updated_at
  FROM public.promotions AS p
  WHERE p.is_active
    AND p_placement = ANY(p.placements)
    AND p.starts_at <= now()
    AND (p.ends_at IS NULL OR p.ends_at > now())
    AND (p.cohort_ids = '{}' OR p_cohort_id = ANY(p.cohort_ids))
    -- An events promo needs at least one row the card will actually show: the same rules as
    -- upcomingEventItems() in lib/promotions.ts (a YYYY-MM-DD date, a non-blank title, dated
    -- today or later). If the two disagreed, this could pick a promo the card then refuses to
    -- show, hiding every other live promo. Compared as ISO text so a malformed date in the JSON
    -- can never make the whole lookup error.
    AND (
      p.kind <> 'events'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.event_items) AS item
        WHERE jsonb_typeof(item->'date') = 'string'
          AND jsonb_typeof(item->'title') = 'string'
          AND item->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
          AND item->>'title' ~ '\S'
          AND item->>'date' >= to_char(COALESCE(p_today, current_date), 'YYYY-MM-DD')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_closed_ids, '{}'), COALESCE(p_closed_at, '{}')) AS closed(id, closed_at)
      WHERE closed.id = p.id
        AND (
          p.reshow_after_days IS NULL
          -- A closure with no known time (saved before closings were timed) counts as expired
          -- for a promo that reshows, so it shows once and the next close starts a real clock.
          OR (closed.closed_at IS NOT NULL
              AND closed.closed_at > now() - make_interval(days => p.reshow_after_days))
        )
    )
  ORDER BY p.starts_at DESC, p.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[], date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[], date) TO service_role;
