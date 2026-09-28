-- Keep application responses and review records in Postgres, with private uploads
-- in Supabase Storage. Existing Google files are not deleted by this migration.

ALTER TABLE public.application_forms
  DROP COLUMN IF EXISTS response_spreadsheet_id,
  DROP COLUMN IF EXISTS response_spreadsheet_url,
  DROP COLUMN IF EXISTS response_sheet_layout;

ALTER TABLE public.application_submission_index RENAME TO application_submissions;
ALTER TABLE public.application_submissions
  ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS question_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS private_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.application_submissions
  DROP COLUMN IF EXISTS sheet_row,
  DROP COLUMN IF EXISTS sync_state,
  DROP COLUMN IF EXISTS last_sync_error;

ALTER INDEX IF EXISTS public.application_submission_index_form_idx RENAME TO application_submissions_form_idx;
ALTER INDEX IF EXISTS public.application_submission_index_reviewer_idx RENAME TO application_submissions_reviewer_idx;
ALTER INDEX IF EXISTS public.application_submission_index_tokens_idx RENAME TO application_submissions_tokens_idx;
ALTER INDEX IF EXISTS public.application_submission_index_submitted_email_idx RENAME TO application_submissions_submitted_email_idx;
ALTER TRIGGER trg_application_submission_index_updated_at ON public.application_submissions
  RENAME TO trg_application_submissions_updated_at;
DROP POLICY IF EXISTS "Application index owners can read" ON public.application_submissions;
DROP POLICY IF EXISTS "Application index owners can insert" ON public.application_submissions;
DROP POLICY IF EXISTS "Application index owners can update" ON public.application_submissions;
DROP POLICY IF EXISTS "Application index owners can delete" ON public.application_submissions;
CREATE POLICY "Application submissions owners can read" ON public.application_submissions FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY "Application submissions owners can insert" ON public.application_submissions FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY "Application submissions owners can update" ON public.application_submissions FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY "Application submissions owners can delete" ON public.application_submissions FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('application-uploads', 'application-uploads', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;
-- No storage.objects policy is granted for this bucket. Upload URLs are minted
-- after a server-side draft check, and staff download URLs after role checks.
