-- Migration 228: let learners skip specializing on a path with tracks.
--
--   learning_paths.tracks_optional  When true, learners are also offered "no specialization" and
--                                   can complete the path on the core alone. Default false: every
--                                   existing path still requires a track.
--
-- A learner who takes that option has learning_path_progress.track_id = '__core_only__'
-- (CORE_ONLY_TRACK in lib/learning-path-tracks.ts). No column change is needed for it: track_id is
-- already free text.
--
-- save_learning_path (migration 227) writes an explicit column list, so it is replaced here to
-- write tracks_optional too. Same signature, lock, completer check and grants.
--
-- No new table, so no new RLS policy.

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS tracks_optional boolean NOT NULL DEFAULT false;

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
    tracks_optional       = v_new.tracks_optional,
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
