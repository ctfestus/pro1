-- Course tools.
--
-- The software a course uses, such as Claude, Perplexity or Excel, picked in the course editor
-- from the tool icon library and shown with each tool's logo on the landing page's course cards
-- and pop-up. A course can have several. Separate from category on purpose: the category (AI,
-- SQL, Power BI ...) groups courses into the landing page's tabs, while an AI course may use
-- Claude and Perplexity, and a course may use Excel and Claude together.
--
-- Same shape as virtual_experiences.tools. No new policy: the column sits on courses, whose
-- existing RLS already decides who can read and write a course.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}';
