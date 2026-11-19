-- Learner count for the public course, experience and path pages.
--
-- How many learners have started an item, each counted once: a course attempt, a virtual
-- experience attempt, or learning path progress. Retakes leave several course attempts for one
-- learner, so courses and experiences count distinct students; learning_path_progress is already
-- one row per learner and path.
--
-- Only the server calls it (lib/content-learner-count.ts, with the service role), and only for an
-- item the page already shows to the public, so the attempt tables stay closed to everyone else.

CREATE OR REPLACE FUNCTION public.content_learner_count(p_table text, p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_table
    WHEN 'courses' THEN (SELECT count(DISTINCT student_id) FROM public.course_attempts WHERE course_id = p_id)
    WHEN 'virtual_experiences' THEN (SELECT count(DISTINCT student_id) FROM public.guided_project_attempts WHERE ve_id = p_id)
    WHEN 'learning_paths' THEN (SELECT count(*) FROM public.learning_path_progress WHERE learning_path_id = p_id)
    ELSE 0
  END::integer;
$$;

REVOKE EXECUTE ON FUNCTION public.content_learner_count(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.content_learner_count(text, uuid) TO service_role;
