CREATE TABLE IF NOT EXISTS public.email_template_overrides (
  template_key text PRIMARY KEY,
  subject_template text NOT NULL CHECK (char_length(subject_template) BETWEEN 1 AND 200),
  body_template text NOT NULL CHECK (char_length(body_template) BETWEEN 1 AND 20000),
  updated_by uuid REFERENCES public.students(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_template_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'reset')),
  changed_by uuid REFERENCES public.students(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_template_history_key_changed_idx
  ON public.email_template_history(template_key, changed_at DESC);

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_template_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email template overrides: staff read"
  ON public.email_template_overrides FOR SELECT TO authenticated
  USING (public.is_instructor_or_admin());

CREATE POLICY "email template history: staff read"
  ON public.email_template_history FOR SELECT TO authenticated
  USING (public.is_instructor_or_admin());

REVOKE INSERT, UPDATE, DELETE ON public.email_template_overrides FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.email_template_history FROM anon, authenticated;
GRANT SELECT ON public.email_template_overrides TO authenticated;
GRANT SELECT ON public.email_template_history TO authenticated;
GRANT ALL ON public.email_template_overrides TO service_role;
GRANT ALL ON public.email_template_history TO service_role;

CREATE OR REPLACE FUNCTION public.save_email_template_override(
  p_template_key text,
  p_subject_template text,
  p_body_template text,
  p_actor_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_reset boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.email_template_overrides%ROWTYPE;
  saved_row public.email_template_overrides%ROWTYPE;
  actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.students WHERE id = p_actor_id;
  IF actor_role IS NULL OR actor_role NOT IN ('admin', 'instructor') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_template_key IS NULL OR char_length(p_template_key) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_template_key'; END IF;

  -- Serialize writes for this key even when no row exists yet. A row lock alone
  -- cannot protect two concurrent first-time creates.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_template_key, 0));
  SELECT * INTO current_row FROM public.email_template_overrides
  WHERE template_key = p_template_key FOR UPDATE;

  IF p_reset THEN
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ok', 'reset', true); END IF;
    IF p_expected_updated_at IS NULL OR current_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
    INSERT INTO public.email_template_history(template_key, subject_template, body_template, action, changed_by)
    VALUES (current_row.template_key, current_row.subject_template, current_row.body_template, 'reset', p_actor_id);
    DELETE FROM public.email_template_overrides WHERE template_key = p_template_key;
    RETURN jsonb_build_object('status', 'ok', 'reset', true);
  END IF;

  IF char_length(COALESCE(p_subject_template, '')) NOT BETWEEN 1 AND 200
     OR char_length(COALESCE(p_body_template, '')) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'invalid_template_length';
  END IF;
  IF FOUND THEN
    IF p_expected_updated_at IS NULL OR current_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
  ELSIF p_expected_updated_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  INSERT INTO public.email_template_overrides(template_key, subject_template, body_template, updated_by, updated_at)
  VALUES (p_template_key, p_subject_template, p_body_template, p_actor_id, now())
  ON CONFLICT (template_key) DO UPDATE SET
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO saved_row;

  INSERT INTO public.email_template_history(template_key, subject_template, body_template, action, changed_by)
  VALUES (saved_row.template_key, saved_row.subject_template, saved_row.body_template,
          CASE WHEN current_row.template_key IS NULL THEN 'created' ELSE 'updated' END, p_actor_id);
  RETURN jsonb_build_object('status', 'ok', 'template', to_jsonb(saved_row));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_email_template_override(text, text, text, uuid, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_email_template_override(text, text, text, uuid, timestamptz, boolean) TO service_role;
