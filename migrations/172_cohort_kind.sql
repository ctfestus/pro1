-- cohorts.is_individual currently carries two unrelated meanings.
--
-- Migration 165 introduced it for a synthetic cohort created for ONE student, with
-- individual_student_id pointing at them. Migration 167 then reused the same flag for a
-- subscription plan's SHARED access cohort, which has many subscribers and a NULL
-- individual_student_id. Screens that branch on is_individual cannot tell the two apart,
-- so a plan with 300 paying subscribers is treated as a one-person cohort.
--
-- cohort_kind gives each cohort an unambiguous identity:
--   bootcamp           - a real cohort with an intake, schedule and fee structure
--   legacy_individual  - the per-student synthetic cohort from migration 165
--   subscription_plan  - a plan's shared access cohort from migration 167
--
-- This deliberately does NOT change how access works. Subscription content is still
-- granted by tagging the plan's cohort id into courses.cohort_ids, and students still
-- point at that cohort through students.cohort_id. The new column only lets a screen ask
-- what a cohort IS instead of inferring it from a boolean that means two things.
--
-- is_individual is kept and held in sync by trigger so existing consumers keep working
-- while they migrate. It is deprecated, not yet removed.

BEGIN;

ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS cohort_kind text;

-- Backfill. individual_student_id alone is not a reliable discriminator: migration 165
-- notes it is nulled when a student's account is deleted, which would make an orphaned
-- legacy cohort look like a plan cohort. Migration 167 gave every pre-existing
-- subscription a legacy plan whose id is the subscription's own id (see 167:30-40), so
-- that equality identifies the legacy rows precisely.
UPDATE public.cohorts c
SET cohort_kind = CASE
  WHEN NOT c.is_individual THEN 'bootcamp'
  WHEN c.individual_student_id IS NOT NULL THEN 'legacy_individual'
  WHEN EXISTS (
    SELECT 1
    FROM public.subscription_plans p
    JOIN public.individual_subscriptions s ON s.id = p.id
    WHERE p.cohort_id = c.id
  ) THEN 'legacy_individual'
  -- A real plan cohort always has a subscription_plans row: subscription_plans.cohort_id
  -- is NOT NULL UNIQUE ... ON DELETE RESTRICT (167:11) and migration 170 deletes the plan
  -- and its cohort together. So no plan row means this cannot be a plan cohort -- it is an
  -- orphaned migration 165 cohort whose student was deleted (165:11-15 nulls
  -- individual_student_id). Defaulting those to 'subscription_plan' would be
  -- unrecoverable once the backfill runs.
  WHEN EXISTS (
    SELECT 1 FROM public.subscription_plans p WHERE p.cohort_id = c.id
  ) THEN 'subscription_plan'
  ELSE 'legacy_individual'
END
WHERE c.cohort_kind IS NULL;

ALTER TABLE public.cohorts
  ALTER COLUMN cohort_kind SET DEFAULT 'bootcamp',
  ALTER COLUMN cohort_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cohorts_cohort_kind_check'
  ) THEN
    ALTER TABLE public.cohorts
      ADD CONSTRAINT cohorts_cohort_kind_check
      CHECK (cohort_kind IN ('bootcamp', 'legacy_individual', 'subscription_plan'));
  END IF;

  -- A shared plan cohort must never claim to belong to one student.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cohorts_subscription_plan_has_no_student_check'
  ) THEN
    ALTER TABLE public.cohorts
      ADD CONSTRAINT cohorts_subscription_plan_has_no_student_check
      CHECK (cohort_kind <> 'subscription_plan' OR individual_student_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cohorts_kind ON public.cohorts(cohort_kind);

-- Compatibility bridge. Consumers still filtering on is_individual keep seeing the right
-- value no matter which column a writer sets. Remove this trigger, and the column, once
-- every consumer reads cohort_kind.
CREATE OR REPLACE FUNCTION public.sync_cohort_is_individual()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.is_individual := (NEW.cohort_kind <> 'bootcamp');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cohorts_sync_is_individual ON public.cohorts;
CREATE TRIGGER trg_cohorts_sync_is_individual
  BEFORE INSERT OR UPDATE OF cohort_kind, is_individual ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.sync_cohort_is_individual();

-- The only writer that creates a non-bootcamp cohort. It must set cohort_kind explicitly:
-- with the trigger above, inserting is_individual alone would fall to the 'bootcamp'
-- default and be flipped straight back to false, silently revoking plan access.
-- The parameter defaults must match migration 167 exactly. CREATE OR REPLACE cannot
-- remove a default from an existing function (42P13), so dropping them here would abort
-- this migration and roll back the whole transaction.
CREATE OR REPLACE FUNCTION public.create_individual_subscription_plan(
  p_name text,
  p_description text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid := gen_random_uuid();
  v_cohort_id uuid;
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'plan name is required';
  END IF;

  INSERT INTO public.cohorts (name, status, cohort_kind, individual_student_id, start_date, created_by)
  VALUES ('Subscription - ' || btrim(p_name), 'active', 'subscription_plan', NULL, current_date, p_created_by)
  RETURNING id INTO v_cohort_id;

  INSERT INTO public.subscription_plans (id, name, description, cohort_id, created_by)
  VALUES (v_plan_id, btrim(p_name), NULLIF(btrim(p_description), ''), v_cohort_id, p_created_by);

  RETURN jsonb_build_object('ok', true, 'planId', v_plan_id, 'cohortId', v_cohort_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) TO service_role;

COMMIT;
