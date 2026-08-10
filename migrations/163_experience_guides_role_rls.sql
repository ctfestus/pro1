-- Restrict guide identity and consent records to their instructor/admin owner.
-- Migration 162 checked ownership but omitted the staff-role requirement.

DROP TRIGGER IF EXISTS trg_experience_guides_updated_at ON public.experience_guides;
CREATE TRIGGER trg_experience_guides_updated_at
  BEFORE UPDATE ON public.experience_guides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
