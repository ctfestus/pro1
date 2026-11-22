-- Course outlines: what My learning needs from a course's slides, without the slides themselves.
--
-- My learning counts lessons and works out progress for every course a student can see. It used
-- to download each course's full `questions` (lesson bodies, options, answer keys) for that, which
-- made the page slow on large courses and slow networks. This view returns one small entry per
-- slide instead: its id, whether it is a section or a LinkedIn share (progress skips those), and
-- whether it has a lesson, with the lesson's title for the course's details list.
--
-- security_invoker: the view reads `courses` as the student, so the "courses: participants select"
-- policy decides which rows come back, exactly as for a direct read. No new policy is needed.
-- lesson.body and lesson.doc are true/false flags, not the content: they only say a lesson exists.

BEGIN;

CREATE OR REPLACE VIEW public.course_outlines
WITH (security_invoker = true)
AS
  SELECT c.id,
         COALESCE((
           SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'id',                    q.value->'id',
                    'isSection',             q.value->'isSection',
                    'isLinkedInShare',       q.value->'isLinkedInShare',
                    'linkedInShareRequired', q.value->'linkedInShareRequired',
                    'lesson', CASE WHEN jsonb_typeof(q.value->'lesson') = 'object' THEN jsonb_build_object(
                                'title', q.value->'lesson'->'title',
                                'body',  COALESCE(q.value->'lesson'->>'body', '') <> '',
                                'doc',   q.value->'lesson'->'doc' IS NOT NULL AND q.value->'lesson'->'doc' <> 'null'::jsonb)
                              END
                  )) ORDER BY q.ordinality)
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.questions) = 'array' THEN c.questions ELSE '[]'::jsonb END)
                WITH ORDINALITY AS q(value, ordinality)
         ), '[]'::jsonb) AS outline
  FROM public.courses c;

GRANT SELECT ON public.course_outlines TO authenticated;

COMMIT;
