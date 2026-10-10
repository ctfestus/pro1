-- Migration 224: record when a learning path or an assignment is given to a cohort.
--
-- Courses, VEs, events and certifications already get a cohort_assignments row (with assigned_at)
-- when they are assigned. Learning paths and assignments only had cohort_ids, so nothing recorded
-- when a cohort received them. The student My Program view needs that date to place work that has
-- no deadline in the week it was given out (and carry it forward until it is done). For a course
-- or VE taught through a path, the path's date is used -- each item keeps its own pace; the path
-- date is NOT turned into a shared deadline.
--
-- The rows are kept by triggers rather than by each caller, because paths and assignments get
-- their cohorts from many places: the cohorts page, the path editor, the automatic next-path grant
-- (lib/learning-path-progress), the assignment editor (a direct client write) and content import.
--
-- Rules:
--   * A row is added when a PUBLISHED path/assignment gains a cohort, or is published with it.
--     ON CONFLICT DO NOTHING keeps the original date on later saves.
--   * A row is removed when the cohort is taken off cohort_ids, or the content is deleted.
--     Unpublishing keeps the date, so re-publishing does not reset it.
--   * Nothing is backfilled. cohort_dates_baseline holds the cohorts a published path/assignment
--     already had when this migration ran; those are never dated, however the content is later
--     saved. That matters because the assignment editor saves a published assignment by flipping
--     it to draft and back, which would otherwise look like a fresh assignment to every cohort.
--     Any other cohort is dated when it arrives, including one added to old content later.
--     Removing a cohort drops it from the baseline, so re-adding it later is a new assignment.
--     New rows (including duplicates) always start with an empty baseline, and callers cannot set
--     it: the BEFORE trigger derives it from the previous row.
--   * Stale cohort ids in cohort_ids are skipped, so the FK can never fail the content save.
--
-- No reader treats these new content types as courses/VEs/events: the deadline and event reminder
-- jobs filter by content_type, the weekly digest skips rows it cannot resolve, and the remaining
-- readers look up specific content ids.

ALTER TABLE public.cohort_assignments DROP CONSTRAINT IF EXISTS cohort_assignments_content_type_check;
ALTER TABLE public.cohort_assignments ADD CONSTRAINT cohort_assignments_content_type_check
  CHECK (content_type IN ('course','event','virtual_experience','form','certification','learning_path','assignment'));

-- The baseline is captured once, when the column is first added, so re-running this migration
-- never re-baselines content assigned since. It runs before the triggers exist, so it dates nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'learning_paths' AND column_name = 'cohort_dates_baseline') THEN
    ALTER TABLE public.learning_paths ADD COLUMN cohort_dates_baseline uuid[] NOT NULL DEFAULT '{}';
    UPDATE public.learning_paths SET cohort_dates_baseline = COALESCE(cohort_ids, '{}') WHERE status = 'published';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'assignments' AND column_name = 'cohort_dates_baseline') THEN
    ALTER TABLE public.assignments ADD COLUMN cohort_dates_baseline uuid[] NOT NULL DEFAULT '{}';
    UPDATE public.assignments SET cohort_dates_baseline = COALESCE(cohort_ids, '{}') WHERE status = 'published';
  END IF;
END $$;

-- Keeps the baseline honest: empty on insert, and only ever shrinks (to cohorts still assigned).
CREATE OR REPLACE FUNCTION public.prepare_cohort_dates_baseline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.cohort_dates_baseline := '{}';
  ELSE
    NEW.cohort_dates_baseline := ARRAY(
      SELECT b FROM unnest(COALESCE(OLD.cohort_dates_baseline, '{}')) AS b
       WHERE b = ANY (COALESCE(NEW.cohort_ids, '{}'))
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_cohort_assignment_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type text := CASE TG_TABLE_NAME WHEN 'learning_paths' THEN 'learning_path' ELSE 'assignment' END;
  v_prev uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cohort_assignments WHERE content_id = OLD.id AND content_type = v_type;
    RETURN OLD;
  END IF;

  -- Cohorts that are not newly assigned: those from before this migration, and those that already
  -- had the content while it was live.
  v_prev := COALESCE(NEW.cohort_dates_baseline, '{}');

  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.cohort_assignments
     WHERE content_id = NEW.id
       AND content_type = v_type
       AND NOT (cohort_id = ANY (COALESCE(NEW.cohort_ids, '{}')));
    IF OLD.status = 'published' THEN
      v_prev := v_prev || COALESCE(OLD.cohort_ids, '{}');
    END IF;
  END IF;

  IF NEW.status = 'published' THEN
    INSERT INTO public.cohort_assignments (cohort_id, content_type, content_id)
    SELECT c, v_type, NEW.id
      FROM unnest(COALESCE(NEW.cohort_ids, '{}')) AS c
     WHERE NOT (c = ANY (v_prev))
       AND EXISTS (SELECT 1 FROM public.cohorts WHERE id = c)
    ON CONFLICT (content_id, cohort_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_learning_paths_cohort_baseline ON public.learning_paths;
CREATE TRIGGER trg_learning_paths_cohort_baseline
  BEFORE INSERT OR UPDATE ON public.learning_paths
  FOR EACH ROW EXECUTE FUNCTION public.prepare_cohort_dates_baseline();
DROP TRIGGER IF EXISTS trg_learning_paths_cohort_dates ON public.learning_paths;
CREATE TRIGGER trg_learning_paths_cohort_dates
  AFTER INSERT OR DELETE OR UPDATE OF cohort_ids, status ON public.learning_paths
  FOR EACH ROW EXECUTE FUNCTION public.sync_cohort_assignment_dates();

DROP TRIGGER IF EXISTS trg_assignments_cohort_baseline ON public.assignments;
CREATE TRIGGER trg_assignments_cohort_baseline
  BEFORE INSERT OR UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.prepare_cohort_dates_baseline();
DROP TRIGGER IF EXISTS trg_assignments_cohort_dates ON public.assignments;
CREATE TRIGGER trg_assignments_cohort_dates
  AFTER INSERT OR DELETE OR UPDATE OF cohort_ids, status ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_cohort_assignment_dates();
