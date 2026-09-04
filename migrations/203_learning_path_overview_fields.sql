-- Learning paths: the fields their public overview page needs.
--
-- A path could say what it contained but not what it was for. The detail page had a title, a
-- blurb and a list of items, so a visitor deciding whether to enrol had to infer the skills, the
-- audience and the tooling from the course names.
--
-- All four are additive and defaulted, so every existing path keeps working and simply shows
-- fewer sections until an author fills them in.
--
--   overview         long-form prose, shown full width above the two columns
--   skills           the skills a learner comes away with, rendered as pills
--   who_should_take  audience bullets
--   tools            tool NAMES only; the icons resolve through the existing tool_icons
--                    registry, so a path does not carry its own copy of a logo

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS overview        text,
  ADD COLUMN IF NOT EXISTS skills          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS who_should_take text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools           text[] NOT NULL DEFAULT '{}';
