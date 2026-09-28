-- Store application form definitions in Postgres while keeping applicant responses
-- in one Google spreadsheet file per form.

CREATE TABLE IF NOT EXISTS public.application_forms (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'closed')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_spreadsheet_id text,
  response_spreadsheet_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_forms_owner_idx ON public.application_forms(owner_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_application_forms_updated_at ON public.application_forms;
CREATE TRIGGER trg_application_forms_updated_at
  BEFORE UPDATE ON public.application_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.application_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Application form owners can read" ON public.application_forms;
CREATE POLICY "Application form owners can read" ON public.application_forms FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application form owners can insert" ON public.application_forms;
CREATE POLICY "Application form owners can insert" ON public.application_forms FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application form owners can update" ON public.application_forms;
CREATE POLICY "Application form owners can update" ON public.application_forms FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application form owners can delete" ON public.application_forms;
CREATE POLICY "Application form owners can delete" ON public.application_forms FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

-- This table contains lookup metadata only. Answers, applicant email addresses,
-- notes, scores, status history, and sent emails remain in the form spreadsheet.
CREATE TABLE IF NOT EXISTS public.application_submission_index (
  id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES public.application_forms(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hashes text[] NOT NULL DEFAULT '{}',
  email_hash text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted')),
  assigned_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_submission_index_form_idx ON public.application_submission_index(form_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS application_submission_index_reviewer_idx ON public.application_submission_index(assigned_reviewer_id) WHERE assigned_reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_submission_index_tokens_idx ON public.application_submission_index USING gin(token_hashes);
CREATE UNIQUE INDEX IF NOT EXISTS application_submission_index_submitted_email_idx
  ON public.application_submission_index(form_id, email_hash) WHERE state = 'submitted';
DROP TRIGGER IF EXISTS trg_application_submission_index_updated_at ON public.application_submission_index;
CREATE TRIGGER trg_application_submission_index_updated_at
  BEFORE UPDATE ON public.application_submission_index FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.application_submission_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Application index owners can read" ON public.application_submission_index;
CREATE POLICY "Application index owners can read" ON public.application_submission_index FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application index owners can insert" ON public.application_submission_index;
CREATE POLICY "Application index owners can insert" ON public.application_submission_index FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application index owners can update" ON public.application_submission_index;
CREATE POLICY "Application index owners can update" ON public.application_submission_index FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application index owners can delete" ON public.application_submission_index;
CREATE POLICY "Application index owners can delete" ON public.application_submission_index FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.application_audit_log (
  id text PRIMARY KEY,
  form_id text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('form', 'submission')),
  entity_id text NOT NULL,
  action text NOT NULL,
  actor_id text,
  actor_email text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS application_audit_log_form_idx ON public.application_audit_log(form_id, occurred_at DESC);
ALTER TABLE public.application_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Application audit owners can read" ON public.application_audit_log;
CREATE POLICY "Application audit owners can read" ON public.application_audit_log FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application audit owners can insert" ON public.application_audit_log;
CREATE POLICY "Application audit owners can insert" ON public.application_audit_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
