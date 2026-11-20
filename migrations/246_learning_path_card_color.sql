-- Learning path card colour.
--
-- The landing page shows each learning path as a coloured card. The instructor picks the colour
-- in the path editor from a fixed set (lib/path-card-colors.ts); NULL means none was picked and
-- the page assigns one by position. The CHECK keeps the column to that set.
--
-- No new policy: the column sits on learning_paths, whose existing RLS already decides who can
-- read and write a path. The landing page reads it with the service role, only for paths the
-- publicly_offered_content gate already lists.

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS card_color text
    CONSTRAINT learning_paths_card_color_check
    CHECK (card_color IS NULL OR card_color IN ('green', 'yellow', 'red', 'blue', 'teal', 'orange'));

-- save_learning_path (migration 228) names every column it writes, so a path save that goes
-- through it (any path with tracks) would drop the colour. Same function, plus card_color.
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
    next_path_id          = v_new.next_path_id,
    card_color            = v_new.card_color
  WHERE id = p_path_id;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION public.save_learning_path(uuid, uuid, timestamptz, jsonb, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_learning_path(uuid, uuid, timestamptz, jsonb, text[], boolean) TO service_role;
