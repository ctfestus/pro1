-- An icon for each "What you'll learn" outcome, chosen in the course or experience editor.
--
-- The content page shows each outcome with an icon picked from its words; this holds the ones an
-- author picked instead, keyed by the outcome's text:
--   { "Clean messy sales exports": "clean", "Build a Power BI dashboard": "tool:power bi" }
-- Keyed by text rather than position, so reordering outcomes keeps their icons. An outcome with
-- no entry (or edited since) keeps the automatic icon.
--
-- No new policy: each table's existing row policies already cover a new column.

BEGIN;

ALTER TABLE public.courses             ADD COLUMN IF NOT EXISTS learn_outcome_icons jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.virtual_experiences ADD COLUMN IF NOT EXISTS learn_outcome_icons jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
