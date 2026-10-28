-- Migration 227: save a learning path in one locked transaction.
--
-- Migration 226's save_learning_path_shape wrote only item_ids and tracks under the path lock, and
-- the API then saved the remaining fields (title, cohorts, status, ...) in a second request. If
-- that second write failed, the API reported failure although the sequence and tracks had already
-- changed, so a retry acted on a partly saved path.
--
-- save_learning_path replaces it: the same lock and completer check, then every submitted field in
-- one UPDATE. p_patch holds only the fields the request changes, keyed by column name; a key that
-- is absent keeps its stored value (jsonb_populate_record over the locked row), and only the
-- editable columns listed below are written, so a patch can never touch id, instructor_id,
-- created_at or the cohort date baseline. A constraint violation aborts the whole save.
--
-- Returns 'ok', 'stale' (the path changed since the caller read it, or is not theirs) or
-- 'completed' (a completer on a changed track, or the core, would have their requirements change).
--
-- Called by the service role only (app/api/learning-paths). No table changes, so no RLS changes.
-- Safe to run whether or not 226 has been run: it drops 226's function if present.

DROP FUNCTION IF EXISTS public.save_learning_path_shape(uuid, uuid, timestamptz, uuid[], jsonb, text[], boolean);

CREATE OR REPLACE FUNCTION public.save_learning_path(
  p_path_id             uuid,
  p_instructor_id       uuid,
  p_expected_updated_at timestamptz,
  p_patch               jsonb,
  p_changed_track_ids   text[],
  p_core_changed        boolean
) RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_row public.learning_paths;
  v_new public.learning_paths;
BEGIN
  SELECT * INTO v_row FROM public.learning_paths
    WHERE id = p_path_id AND instructor_id = p_instructor_id AND updated_at = p_expected_updated_at
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.learning_path_progress
    WHERE learning_path_id = p_path_id
      AND completed_at IS NOT NULL
      AND (track_id = ANY (p_changed_track_ids) OR (p_core_changed AND track_id IS NULL))
  ) THEN
    RETURN 'completed';
  END IF;

  v_new := jsonb_populate_record(v_row, COALESCE(p_patch, '{}'::jsonb));

  UPDATE public.learning_paths SET
    title                 = v_new.title,
    description           = v_new.description,
    cover_image           = v_new.cover_image,
    badge_image_url       = v_new.badge_image_url,
    item_ids              = v_new.item_ids,
    tracks                = v_new.tracks,
    overview              = v_new.overview,
    skills                = v_new.skills,
    who_should_take       = v_new.who_should_take,
    tools                 = v_new.tools,
    cohort_ids            = v_new.cohort_ids,
    available_to_everyone = v_new.available_to_everyone,
    status                = v_new.status,
    next_path_id          = v_new.next_path_id
  WHERE id = p_path_id;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION public.save_learning_path(uuid, uuid, timestamptz, jsonb, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_learning_path(uuid, uuid, timestamptz, jsonb, text[], boolean) TO service_role;
