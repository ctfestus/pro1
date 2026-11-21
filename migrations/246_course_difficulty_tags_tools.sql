-- Course level, tags and tools.
--
-- A course can now say how hard it is, what it is about and which software it teaches:
--
-- difficulty: beginner, intermediate or advanced; NULL when the instructor has not set one.
--             Same three levels as virtual_experiences.difficulty and books.difficulty.
-- tags:       topics, such as AI or Automation. Empty by default.
-- tools:      software the course uses, such as Excel or Zapier, shown with the tool's logo.
--             Same shape as virtual_experiences.tools. Empty by default.
--
-- Tags and tools are kept apart on purpose: a tag says what a course is about, a tool says
-- what the learner works in.
--
-- No new policy: the columns sit on courses, whose existing RLS already decides who can read
-- and write a course.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS difficulty text
    CONSTRAINT courses_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('beginner', 'intermediate', 'advanced')),
  ADD COLUMN IF NOT EXISTS tags  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}';
