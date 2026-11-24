-- Cover videos: an optional video beside the cover image on courses, virtual experiences,
-- certifications and learning paths.
--
-- The value is the video picked from the Bunny library in the editor:
--   { "embedUrl": "https://iframe.mediadelivery.net/embed/<library>/<guid>",
--     "thumbnail": "https://<cdn>/<guid>/<file>.jpg", "title": "...", "duration": 568 }
-- The content page shows the thumbnail with a play button and loads the Bunny player on press;
-- the editor shows the title and length. The cover image stays: cards, phones and link previews
-- still use it.
--
-- No new policy: each table's existing row policies already cover a new column.

BEGIN;

ALTER TABLE public.courses             ADD COLUMN IF NOT EXISTS cover_video jsonb;
ALTER TABLE public.virtual_experiences ADD COLUMN IF NOT EXISTS cover_video jsonb;
ALTER TABLE public.certifications      ADD COLUMN IF NOT EXISTS cover_video jsonb;
ALTER TABLE public.learning_paths      ADD COLUMN IF NOT EXISTS cover_video jsonb;

COMMIT;
