-- "Available to everyone" means every signed-in account, not anonymous visitors.
--
-- Migrations 174 and 186 added the `status = 'published' AND available_to_everyone` branch (and the
-- matching open-path branch) to the participant SELECT policies so a free account with no cohort
-- could open free content. The policies had no TO clause, so they also applied to the anon role,
-- and none of those branches look at auth.uid(). Result: anyone with the public anon key, signed
-- in or not, could read the whole row of a free course, virtual experience or learning path --
-- every lesson, module brief and dataset link -- straight from the REST API. The experience page
-- did exactly that for signed-out visitors, which is how a dataset became downloadable without an
-- account.
--
-- Anonymous visitors are meant to see the sales page only. That already exists and is safe:
-- /api/catalogue-preview (pinned display columns, no content) and the published_* /
-- publicly_offered_* views, which are granted to anon. With these policies restricted to
-- authenticated, a signed-out read of the base table returns nothing and the page falls back to
-- that preview, exactly as it already does for paid content.
--
-- No branch of these policies can match an anon caller except the open-access ones (auth.uid() is
-- null, so no ownership, admin or cohort match), so TO authenticated removes only anonymous access.
-- Signed-in students, instructors, admins and staff are unaffected.

BEGIN;

ALTER POLICY "courses: participants select"
  ON public.courses TO authenticated;

ALTER POLICY "virtual_experiences: participants select"
  ON public.virtual_experiences TO authenticated;

ALTER POLICY "students_read_published_paths"
  ON public.learning_paths TO authenticated;

-- An instructor's public profile (/u/<username>) lists their free courses to signed-out visitors
-- by reading the courses table, which the change above closes to anon. It moves to this view,
-- which holds free courses only (the same set public_free_content counts as free) and the owner
-- and date the profile filters and sorts by. It is a separate view on purpose: published_courses
-- also covers cohort-only courses, and adding owner ids there would name the instructor behind
-- every private course to anyone with the anon key.
CREATE OR REPLACE VIEW public.public_free_courses
WITH (security_barrier = true)
AS
  SELECT c.id, c.slug, c.title, c.description, c.cover_image, c.user_id, c.created_at
  FROM public.courses c
  WHERE c.id IN (
    SELECT f.content_id FROM public.public_free_content f WHERE f.content_table = 'courses'
  );

GRANT SELECT ON public.public_free_courses TO anon, authenticated;

COMMIT;
