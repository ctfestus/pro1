-- Application forms: form definitions, applicant submissions with review history, an audit
-- log, and a private bucket for applicant uploads. All server access uses the service role;
-- the RLS policies below are the owner-scoped defence for any authenticated client access.

-- Forms -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_forms (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'closed')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
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

-- Submissions -----------------------------------------------------------------------------
-- A row starts as a 'draft' when an applicant first uploads a file (drafts expire after 24h)
-- and becomes 'submitted' once. Access tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS public.application_submissions (
  id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES public.application_forms(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hashes text[] NOT NULL DEFAULT '{}',
  email_hash text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted')),
  assigned_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reference text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  private_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  stage_id text NOT NULL DEFAULT 'submitted',
  assigned_reviewer_email text NOT NULL DEFAULT '',
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_submissions_form_idx ON public.application_submissions(form_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS application_submissions_reviewer_idx ON public.application_submissions(assigned_reviewer_id) WHERE assigned_reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_submissions_tokens_idx ON public.application_submissions USING gin(token_hashes);
-- One submitted application per email address per form.
CREATE UNIQUE INDEX IF NOT EXISTS application_submissions_submitted_email_idx
  ON public.application_submissions(form_id, email_hash) WHERE state = 'submitted';
DROP TRIGGER IF EXISTS trg_application_submissions_updated_at ON public.application_submissions;
CREATE TRIGGER trg_application_submissions_updated_at
  BEFORE UPDATE ON public.application_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.application_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Application submissions owners can read" ON public.application_submissions;
CREATE POLICY "Application submissions owners can read" ON public.application_submissions FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application submissions owners can insert" ON public.application_submissions;
CREATE POLICY "Application submissions owners can insert" ON public.application_submissions FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application submissions owners can update" ON public.application_submissions;
CREATE POLICY "Application submissions owners can update" ON public.application_submissions FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Application submissions owners can delete" ON public.application_submissions;
CREATE POLICY "Application submissions owners can delete" ON public.application_submissions FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

-- Applicant uploads -----------------------------------------------------------------------
-- Private bucket, 10 MB, PDF / Word / JPG / PNG only. No storage.objects policy is granted:
-- upload URLs are minted after a server-side draft check, and staff download URLs after role
-- checks. The upload route narrows the allowed types further per file question.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('application-uploads', 'application-uploads', false, 10485760, ARRAY[
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Audit log -------------------------------------------------------------------------------
-- form_id has no foreign key on purpose, so the record of a deleted form survives.
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
