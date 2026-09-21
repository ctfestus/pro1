-- Enforce Excel review worksheet names for direct assignment writes.
--
-- The assignment editor writes through the authenticated Supabase client, so client validation
-- alone is not authoritative. NOT VALID avoids blocking deployment on legacy rows while still
-- enforcing the constraint for every new or updated assignment.

CREATE OR REPLACE FUNCTION public.valid_excel_review_sheet_names(sheet_names jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN sheet_names IS NULL THEN true
    WHEN jsonb_typeof(sheet_names) <> 'array' THEN false
    WHEN jsonb_array_length(sheet_names) > 20 THEN false
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(sheet_names) AS entry(value)
      WHERE jsonb_typeof(value) <> 'string'
         OR length(btrim(value #>> '{}')) = 0
         OR length(value #>> '{}') > 31
         OR value #>> '{}' <> btrim(value #>> '{}')
    ) THEN false
    ELSE (
      SELECT count(*) = count(DISTINCT lower(value #>> '{}'))
      FROM jsonb_array_elements(sheet_names) AS entry(value)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_excel_review_sheets_valid(
  assignment_type text,
  assignment_config jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  scenario jsonb;
  task jsonb;
BEGIN
  IF assignment_type = 'excel_review' THEN
    RETURN public.valid_excel_review_sheet_names(assignment_config->'reviewSheetNames');
  END IF;

  IF assignment_type <> 'standard'
     OR jsonb_typeof(assignment_config->'scenarios') <> 'array' THEN
    RETURN true;
  END IF;

  FOR scenario IN SELECT value FROM jsonb_array_elements(assignment_config->'scenarios') LOOP
    IF jsonb_typeof(scenario->'tasks') = 'array' THEN
      FOR task IN SELECT value FROM jsonb_array_elements(scenario->'tasks') LOOP
        IF task->>'type' = 'excel_review'
           AND NOT public.valid_excel_review_sheet_names(task->'reviewSheetNames') THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

ALTER TABLE public.assignments
  DROP CONSTRAINT IF EXISTS assignments_excel_review_sheet_names_valid;
ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_excel_review_sheet_names_valid
  CHECK (public.assignment_excel_review_sheets_valid(type, config)) NOT VALID;
