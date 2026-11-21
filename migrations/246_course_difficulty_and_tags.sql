-- Course level and tags.
--
-- A course can now say how hard it is (beginner, intermediate or advanced) and carry tags such
-- as Excel or AI. Same shape as virtual_experiences.difficulty and books.topics, so every
-- content type uses the same three levels.
--
-- difficulty: NULL means the instructor has not set a level.
-- tags:       short labels, empty by default.
--
-- No new policy: both columns sit on courses, whose existing RLS already decides who can read
-- and write a course.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS difficulty text
    CONSTRAINT courses_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('beginner', 'intermediate', 'advanced')),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
