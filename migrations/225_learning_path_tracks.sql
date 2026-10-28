-- Migration 225: learning path tracks.
--
-- One path personalised by the learner's background, instead of a separate path per
-- specialisation. See lib/learning-path-tracks.ts for the rules.
--
--   learning_paths.tracks            [{ id, name, description?, item_ids[] }]. item_ids stays the
--                                    full ordered list; a track names the items only its learners
--                                    take. Items in no track are core (everyone).
--   learning_path_progress.track_id  the track the learner picked (a tracks[].id). NULL until they
--                                    pick, and always NULL on a path without tracks.
--
-- Additive and defaulted: every existing path has no tracks and behaves exactly as before.
-- No new table, so no new RLS policy; both tables keep their existing policies.

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS tracks jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_paths_tracks_is_array') THEN
    ALTER TABLE public.learning_paths
      ADD CONSTRAINT learning_paths_tracks_is_array CHECK (jsonb_typeof(tracks) = 'array');
  END IF;
END $$;

ALTER TABLE public.learning_path_progress
  ADD COLUMN IF NOT EXISTS track_id text;
