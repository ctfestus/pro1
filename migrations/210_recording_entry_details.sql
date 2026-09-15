-- Recordings: rich session notes and per-session resources.
--
-- A recording entry used to be a week number, a topic and a link. Instructors also
-- hand out the class workbook, the slides and follow-up reading for that session, so
-- each entry now carries its own rich-text description and a list of resources. Each
-- resource is either an uploaded file (public form-assets bucket, the same path lesson
-- files use) or an external link; `kind` records which, so the student surface can label
-- a download differently from a link out.
--
-- attachments row shape:
--   { "id": uuid, "name": text, "url": text, "kind": "file" | "link", "size": int | null }

ALTER TABLE public.recording_entries
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Guard against a non-array value reaching the readers, which index into it.
ALTER TABLE public.recording_entries
  DROP CONSTRAINT IF EXISTS recording_entries_attachments_is_array;
ALTER TABLE public.recording_entries
  ADD CONSTRAINT recording_entries_attachments_is_array
  CHECK (jsonb_typeof(attachments) = 'array');
