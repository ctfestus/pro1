-- Migration 226: make track changes and path completion atomic.
--
-- Three writers decide something from a read and then write it in a separate request, so each
-- could act on a state that changed in between:
--
--   * A learner finishing a path (completion is computed for the track they had) while they
--     switch track: the certificate was issued for one track and the row ended up holding another.
--   * An author changing a path's tracks or sequence while a learner completes it: the guard that
--     protects completers read the completers before the write, so one finishing in between could
--     have their requirements changed after the fact.
--
-- The track switch is closed in the API with a single conditional UPDATE (only while the path is
-- unfinished). The other two need a lock on the path row shared by both sides, which these two
-- functions provide:
--
--   complete_learning_path_progress   takes the path row FOR SHARE, and only when the path is
--                                     unchanged since completion was computed (updated_at, bumped
--                                     by trg_learning_paths_updated_at on every write). It
--                                     finalizes the learner's row only while the row still holds
--                                     the track completion was computed for. Returns the progress
--                                     row id, or NULL when nothing was finalized (the caller saves
--                                     the progress without completing; reconciliation retries).
--
--   save_learning_path_shape          takes the path row FOR UPDATE, refuses when any completer is
--                                     on a track (or the core, NULL) whose required items change,
--                                     and otherwise writes item_ids + tracks. Which tracks change
--                                     is decided by the caller (lib/learning-path-tracks has the
--                                     rule); the lock makes the completer check and the write one
--                                     step. Returns 'ok', 'stale' (the path changed since the
--                                     caller read it) or 'completed'.
--
-- Called by the service role only (app/api/learning-paths, lib/learning-path-progress).
-- No table changes, so no RLS changes.

CREATE OR REPLACE FUNCTION public.complete_learning_path_progress(
  p_student_id         uuid,
  p_path_id            uuid,
  p_track_id           text,
  p_path_updated_at    timestamptz,
  p_completed_item_ids uuid[]
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM 1 FROM public.learning_paths
    WHERE id = p_path_id AND updated_at = p_path_updated_at
    FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.learning_path_progress AS lpp
    (student_id, learning_path_id, track_id, completed_item_ids, completed_at)
  VALUES (p_student_id, p_path_id, p_track_id, p_completed_item_ids, now())
  ON CONFLICT (student_id, learning_path_id) DO UPDATE
    SET completed_item_ids = EXCLUDED.completed_item_ids,
        completed_at       = COALESCE(lpp.completed_at, EXCLUDED.completed_at)
    WHERE lpp.track_id IS NOT DISTINCT FROM p_track_id
  RETURNING lpp.id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_learning_path_shape(
  p_path_id             uuid,
  p_instructor_id       uuid,
  p_expected_updated_at timestamptz,
  p_item_ids            uuid[],
  p_tracks              jsonb,
  p_changed_track_ids   text[],
  p_core_changed        boolean
) RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.learning_paths
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

  UPDATE public.learning_paths
    SET item_ids = p_item_ids, tracks = p_tracks
    WHERE id = p_path_id;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION public.complete_learning_path_progress(uuid, uuid, text, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_learning_path_shape(uuid, uuid, timestamptz, uuid[], jsonb, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_learning_path_progress(uuid, uuid, text, timestamptz, uuid[]) TO service_role;
GRANT  EXECUTE ON FUNCTION public.save_learning_path_shape(uuid, uuid, timestamptz, uuid[], jsonb, text[], boolean) TO service_role;
