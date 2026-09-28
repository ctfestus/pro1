-- Harden per-form Google Sheet storage with exact-row routing and synchronization state.

ALTER TABLE public.application_forms
  ADD COLUMN IF NOT EXISTS response_sheet_layout jsonb;

ALTER TABLE public.application_submission_index
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sheet_row integer,
  ADD COLUMN IF NOT EXISTS stage_id text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS assigned_reviewer_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS last_sync_error text;

ALTER TABLE public.application_submission_index
  DROP CONSTRAINT IF EXISTS application_submission_index_sheet_row_check,
  ADD CONSTRAINT application_submission_index_sheet_row_check CHECK (sheet_row IS NULL OR sheet_row >= 3),
  DROP CONSTRAINT IF EXISTS application_submission_index_score_check,
  ADD CONSTRAINT application_submission_index_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  DROP CONSTRAINT IF EXISTS application_submission_index_sync_state_check,
  ADD CONSTRAINT application_submission_index_sync_state_check CHECK (sync_state IN ('pending', 'synced', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS application_submission_index_sheet_row_idx
  ON public.application_submission_index(form_id, sheet_row)
  WHERE sheet_row IS NOT NULL;
