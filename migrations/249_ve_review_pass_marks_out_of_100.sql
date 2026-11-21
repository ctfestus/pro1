-- Virtual experience AI review pass marks: from the old 0-10 scale to 0-100.
--
-- Every AI review grades out of 100 (lib/review-target reviewMinScore, lib/review-gate), but the
-- experience generator used to write minScore 6 on code, Excel and dashboard reviews, and the
-- publish check capped code and Excel reviews at 10. A mark of 6 against a score out of 100
-- passes almost any submission. #537 fixed the generator (70) and the check (0-100); this fixes
-- the marks already stored.
--
-- A mark above 0 and below 10 on those three review types is read as the old 0-10 scale and
-- multiplied by 10, so the AI's 6 becomes 60 and an instructor's 8 becomes 80: the pass rate each
-- was meant to be. 0 (no gate), empty marks, 10 and above, and every other task type are left
-- alone. Order of modules, missions and tasks is kept.
--
-- Data only: nothing to apply to festman-fresh-schema.sql, which holds no experiences.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ve_fix_pass_mark(req jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN req->>'type' IN ('code_review', 'excel_review', 'dashboard_critique')
     AND jsonb_typeof(req->'minScore') IN ('number', 'string')
     AND btrim(req->>'minScore') ~ '^[0-9]+(\.[0-9]+)?$'
     AND btrim(req->>'minScore')::numeric > 0
     AND btrim(req->>'minScore')::numeric < 10
    THEN jsonb_set(req, '{minScore}', to_jsonb(btrim(req->>'minScore')::numeric * 10))
    ELSE req
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.ve_fix_lesson(lesson jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(lesson->'requirements') = 'array' THEN jsonb_set(lesson, '{requirements}', COALESCE(
      (SELECT jsonb_agg(pg_temp.ve_fix_pass_mark(r.value) ORDER BY r.ordinality)
         FROM jsonb_array_elements(lesson->'requirements') WITH ORDINALITY AS r(value, ordinality)),
      '[]'::jsonb))
    ELSE lesson
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.ve_fix_module(module jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(module->'lessons') = 'array' THEN jsonb_set(module, '{lessons}', COALESCE(
      (SELECT jsonb_agg(pg_temp.ve_fix_lesson(l.value) ORDER BY l.ordinality)
         FROM jsonb_array_elements(module->'lessons') WITH ORDINALITY AS l(value, ordinality)),
      '[]'::jsonb))
    ELSE module
  END
$$;

UPDATE public.virtual_experiences ve
SET modules = fixed.modules
FROM (
  SELECT v.id,
         COALESCE(jsonb_agg(pg_temp.ve_fix_module(m.value) ORDER BY m.ordinality), '[]'::jsonb) AS modules
  FROM public.virtual_experiences v
  CROSS JOIN LATERAL jsonb_array_elements(v.modules) WITH ORDINALITY AS m(value, ordinality)
  WHERE jsonb_typeof(v.modules) = 'array'
    AND v.modules::text LIKE '%minScore%'
  GROUP BY v.id
) AS fixed
WHERE ve.id = fixed.id
  AND ve.modules IS DISTINCT FROM fixed.modules;

COMMIT;
