-- Promotions: small closable promo cards (image, title, short text, button) that instructors show
-- on the public landing pages, the student dashboard, and inside courses.
--
-- The table itself is owner-scoped like announcements. Pages never read it directly: they call
-- /api/promotions, which resolves the viewer (including a Student Mode target) and then calls
-- get_active_promotion() with the service role. Only live rows for one placement and audience come
-- back, so a cohort-targeted promo is never visible to anyone outside that cohort, including
-- signed-out visitors and staff browsing the site.

CREATE TABLE IF NOT EXISTS public.promotions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL CHECK (length(btrim(title)) > 0),
  body        text,
  image_url   text,
  cta_label   text,
  cta_url     text,
  -- Where it may appear: 'landing' (home + pricing), 'student' (dashboard), 'course' (course player).
  placements  text[]      NOT NULL DEFAULT '{landing,student,course}'
              CHECK (cardinality(placements) > 0 AND placements <@ ARRAY['landing', 'student', 'course']::text[]),
  -- Empty = everyone, including signed-out visitors. Otherwise only students whose cohort_id
  -- (a bootcamp intake or a subscription plan's cohort) is listed.
  cohort_ids  uuid[]      NOT NULL DEFAULT '{}',
  is_active   boolean     NOT NULL DEFAULT true,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  author_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_window_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_promotions_author ON public.promotions(author_id);
CREATE INDEX IF NOT EXISTS idx_promotions_live   ON public.promotions(starts_at, ends_at) WHERE is_active;

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON public.promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promotions: instructor select" ON public.promotions;
CREATE POLICY "promotions: instructor select"
  ON public.promotions FOR SELECT TO authenticated
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

DROP POLICY IF EXISTS "promotions: instructor insert" ON public.promotions;
CREATE POLICY "promotions: instructor insert"
  ON public.promotions FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND author_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "promotions: instructor update" ON public.promotions;
CREATE POLICY "promotions: instructor update"
  ON public.promotions FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

DROP POLICY IF EXISTS "promotions: instructor delete" ON public.promotions;
CREATE POLICY "promotions: instructor delete"
  ON public.promotions FOR DELETE TO authenticated
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- The newest live promotion for one placement and viewer, skipping the ones this browser has
-- already closed. The exclusion happens here, before the LIMIT, so closing promos can never hide
-- an older live one. p_cohort_id is the viewer's students.cohort_id as resolved by the route
-- (NULL for a signed-out visitor, who then only sees everyone-audience promos).
CREATE OR REPLACE FUNCTION public.get_active_promotion(
  p_placement text,
  p_cohort_id uuid DEFAULT NULL,
  p_exclude   uuid[] DEFAULT '{}'
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
    AND NOT (p.id = ANY(COALESCE(p_exclude, '{}')))
  ORDER BY p.starts_at DESC, p.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_promotion(text, uuid, uuid[]) TO service_role;
