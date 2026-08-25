-- 185: instructor-managed tool icons.
--
-- The tool/software logos beside a course category, a dashboard tool row and a learner's
-- skills were a hardcoded list of thirteen names in lib/tool-icons.ts, each pointing at a
-- Supabase Storage bucket in ONE tenant's project. Two consequences: a tool outside those
-- names rendered no logo at all with nothing explaining why, and every tenant depended on
-- another tenant's storage staying put.
--
-- This makes the list data. The built-in thirteen stay in code as defaults so nothing changes
-- until a row overrides them -- notably the ChatGPT and Claude marks in lesson prompt blocks,
-- which label which assistant a prompt targets and must never depend on a tenant having
-- uploaded anything.
--
-- `name` is the primary key and is stored already normalized (trimmed, lower-cased) because the
-- lookup is an exact match on typed text: a course's category, a learner's skill. One row per
-- tool name, so an upsert replaces a logo rather than accumulating duplicates.
--
-- `image` holds a Cloudinary public_id, resolved at render by lib/cloudinary-url.ts. Storing the
-- id and not a baked URL is the lesson from cover_image: those stored absolute vendor URLs and
-- every cover broke when the Cloudinary account changed. The same resolver passes a full URL
-- through untouched, so the legacy Storage URLs in the code defaults keep working.

CREATE TABLE IF NOT EXISTS public.tool_icons (
  name        text        PRIMARY KEY CHECK (name = lower(btrim(name)) AND length(name) BETWEEN 1 AND 80),
  image       text        NOT NULL CHECK (length(btrim(image)) > 0),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tool_icons ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_tool_icons_updated_at ON public.tool_icons;
CREATE TRIGGER trg_tool_icons_updated_at
  BEFORE UPDATE ON public.tool_icons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Readable by everyone, signed in or not: these logos render on the public landing page and on
-- public profile pages. A logo is decoration attached to a tool's name and reveals nothing about
-- a learner, a cohort or unpublished content.
DROP POLICY IF EXISTS "tool_icons: public select" ON public.tool_icons;
CREATE POLICY "tool_icons: public select"
  ON public.tool_icons FOR SELECT
  USING (true);

-- Writes follow the same rule as the other platform-appearance surfaces.
DROP POLICY IF EXISTS "tool_icons: staff write" ON public.tool_icons;
CREATE POLICY "tool_icons: staff write"
  ON public.tool_icons FOR ALL
  USING ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

GRANT SELECT ON public.tool_icons TO anon, authenticated;
