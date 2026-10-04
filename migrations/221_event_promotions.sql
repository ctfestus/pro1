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

-- Code deployed before this migration calls get_active_promotion() and knows nothing about
-- events rows; it would draw an events promo as a bare heading. Keep that function, with the
-- same signature and return shape as migration 219, but limited to standard promos, so running
-- this migration ahead of the code deploy never shows a broken card. New code calls
-- get_live_promotion() below. Drop the old function in a later migration.
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
    AND p.kind = 'standard'
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
          OR (closed.closed_at IS NOT NULL
              AND closed.closed_at > now() - make_interval(days => p.reshow_after_days))
        )
    )
  ORDER BY p.starts_at DESC, p.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[], timestamptz[]) TO service_role;

-- The newest live promotion of either kind for one placement and viewer. p_today is the date the
-- card will judge event rows by; the route always passes it (the viewer's local date, or the
-- server's when the viewer's is implausible) and returns it alongside the promo.
CREATE OR REPLACE FUNCTION public.get_live_promotion(
  p_placement  text,
  p_cohort_id  uuid,
  p_closed_ids uuid[],
  p_closed_at  timestamptz[],
  p_today      date
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
    -- An events promo needs at least one row the card will actually show, by exactly the rules of
    -- upcomingEventItems() in lib/promotions.ts: string date of ASCII digits as YYYY-MM-DD, string
    -- title with a character other than ASCII whitespace, dated p_today or later. If the two
    -- disagreed, this could pick a promo the card then refuses to show, hiding every other live
    -- promo. Character classes are spelled out (no \d, \s) because those follow the database
    -- locale and JavaScript's do not. Dates compare as ISO text, so a malformed date in the JSON
    -- can never make the lookup error.
    AND (
      p.kind <> 'events'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.event_items) AS item
        WHERE jsonb_typeof(item->'date') = 'string'
          AND jsonb_typeof(item->'title') = 'string'
          AND item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND btrim(item->>'title', ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) <> ''
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

REVOKE EXECUTE ON FUNCTION public.get_live_promotion(text, uuid, uuid[], timestamptz[], date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_live_promotion(text, uuid, uuid[], timestamptz[], date) TO service_role;
