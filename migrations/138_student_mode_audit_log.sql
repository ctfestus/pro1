-- Revocable Student Mode sessions and their immutable audit trail.

CREATE TABLE IF NOT EXISTS public.student_mode_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  user_agent text,
  CONSTRAINT student_mode_distinct_accounts CHECK (actor_id <> student_id)
);

CREATE TABLE IF NOT EXISTS public.student_mode_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.student_mode_sessions(id) ON DELETE CASCADE,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_mode_sessions_actor_active
  ON public.student_mode_sessions(actor_id, expires_at DESC)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_mode_audit_actor_created
  ON public.student_mode_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_mode_audit_student_created
  ON public.student_mode_audit_log(student_id, created_at DESC);

ALTER TABLE public.student_mode_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_mode_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student mode sessions: admins read" ON public.student_mode_sessions;
CREATE POLICY "student mode sessions: admins read"
  ON public.student_mode_sessions FOR SELECT
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "student mode audit: admins read" ON public.student_mode_audit_log;
CREATE POLICY "student mode audit: admins read"
  ON public.student_mode_audit_log FOR SELECT
  USING ((SELECT public.is_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.student_mode_sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_mode_audit_log FROM authenticated;
