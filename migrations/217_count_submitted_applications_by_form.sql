-- Count submitted applications per form inside the database, for the application forms
-- list. Returns one row per form that has submissions, so the server no longer downloads
-- every application row to count them, and the form IDs travel in the request body rather
-- than a URL. Authorization stays in the API route, which passes only form IDs the caller
-- may see (and, for reviewers, their own ID so only assigned applications are counted).
-- SECURITY INVOKER (the default): the route already calls it with the service role.

CREATE OR REPLACE FUNCTION public.count_submitted_applications_by_form(
  p_form_ids text[],
  p_reviewer_id uuid DEFAULT NULL
)
RETURNS TABLE(form_id text, total bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT submissions.form_id, count(*)::bigint
  FROM public.application_submissions AS submissions
  WHERE submissions.state = 'submitted'
    AND submissions.form_id = ANY(p_form_ids)
    AND (
      p_reviewer_id IS NULL
      OR submissions.assigned_reviewer_id = p_reviewer_id
    )
  GROUP BY submissions.form_id;
$$;

REVOKE EXECUTE ON FUNCTION public.count_submitted_applications_by_form(text[], uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.count_submitted_applications_by_form(text[], uuid)
  TO service_role;
