-- Virtual experience tags.
--
-- Topics an experience covers, such as Financial analysis or Reporting, set in the experience
-- editor and shown on the landing page's and Explore's cards (as many as fit) and in the hover
-- preview (all of them). Same shape as courses.tags (migration 246). Separate from tools, which
-- are the software the learner uses, and from industry, which is shown on the cover.
--
-- No new policy: the column sits on virtual_experiences, whose existing RLS already decides who
-- can read and write an experience.

ALTER TABLE public.virtual_experiences
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
