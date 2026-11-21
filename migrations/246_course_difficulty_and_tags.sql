-- Course level and tags.
--
-- difficulty: beginner, intermediate or advanced; NULL when the instructor has not set one.
--             Same three levels as virtual_experiences.difficulty and books.difficulty.
-- tags:       topics, such as AI or Automation. Empty by default.
--
-- A course's tool is its category (AI, SQL, Excel ...), shown with the logo the tool icon list
-- has for that name, so there is no separate tools column.
--
-- No new policy: the columns sit on courses, whose existing RLS already decides who can read
-- and write a course.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS difficulty text
    CONSTRAINT courses_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('beginner', 'intermediate', 'advanced')),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
