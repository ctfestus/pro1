-- ── 182_course_ai_tutor ─────────────────────────────────────────────────────
-- Per-course opt-in for the lesson AI tutor.
--
-- The tutor answers student questions about the lesson they are reading. It is
-- off by default: it spends AI quota on a student-facing surface, and an author
-- running a course as an assessment may not want a helper available at all.
-- /api/lesson-tutor refuses every request for a course where this is false.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS ai_tutor_enabled boolean NOT NULL DEFAULT false;
