-- Reusable public-facing professionals for Virtual Experiences.
-- External guides never need an auth account. Instructor guides may optionally
-- point at an existing staff account, while each VE keeps a public snapshot so
-- previously published experiences do not change unexpectedly.

CREATE TABLE IF NOT EXISTS public.experience_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'external' CHECK (source_type IN ('external', 'instructor')),
  full_name text NOT NULL,
  profile_photo_url text,
  professional_title text,
  company text,
  bio text,
  linkedin_url text,
  expertise text[] NOT NULL DEFAULT '{}',
  consent_status text NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'confirmed', 'not_required')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, linked_user_id)
);

CREATE INDEX IF NOT EXISTS experience_guides_owner_idx ON public.experience_guides(owner_id, status);
DROP TRIGGER IF EXISTS trg_experience_guides_updated_at ON public.experience_guides;
CREATE TRIGGER trg_experience_guides_updated_at
  BEFORE UPDATE ON public.experience_guides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.experience_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guide owners can read" ON public.experience_guides;
CREATE POLICY "Guide owners can read" ON public.experience_guides FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Guide owners can insert" ON public.experience_guides;
CREATE POLICY "Guide owners can insert" ON public.experience_guides FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Guide owners can update" ON public.experience_guides;
CREATE POLICY "Guide owners can update" ON public.experience_guides FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Guide owners can delete" ON public.experience_guides;
CREATE POLICY "Guide owners can delete" ON public.experience_guides FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

ALTER TABLE public.virtual_experiences
  ADD COLUMN IF NOT EXISTS guide_id uuid REFERENCES public.experience_guides(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guide_snapshot jsonb;
