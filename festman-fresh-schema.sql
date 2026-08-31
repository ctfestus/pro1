-- ============================================================
--  Festman Learn — Fresh Database Schema
--  Single consolidated script. Run once on a brand new
--  Supabase project. No migrations needed.
--
--  This is the FINAL state of the AI Skills Africa schema
--  after all migrations (001–046) have been applied.
--  Legacy tables (projects, enrollments, cohort_members, etc.)
--  are NOT included — they were dropped in production.
--
--  Execution order:
--    1. Extensions
--    2. Shared trigger function (set_updated_at — no table deps)
--    3. Tables (dependency order — parents before children)
--    4. Security helper functions (AFTER students — SQL funcs validate at create time)
--    5. Enable RLS on every table
--    6. Auth trigger (handle_new_user)
--    7. updated_at triggers
--    8. Security triggers (cohort + status protection)
--    9. RLS policies (all tables + helpers exist by this point)
--   10. Indexes
--   11. Storage buckets + policies
-- ============================================================


-- ─────────────────────────────────────────────────────────────
--  1. EXTENSIONS
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─────────────────────────────────────────────────────────────
--  2. SHARED TRIGGER FUNCTION (no table deps — safe to define early)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────
--  3. TABLES
-- ─────────────────────────────────────────────────────────────

-- ── cohorts ───────────────────────────────────────────────────
CREATE TABLE public.cohorts (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL,
  description text,
  start_date  date,
  end_date    date,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','archived')),
  -- migration 172: what this cohort actually is. bootcamp = a real intake with a schedule
  -- and fee structure; legacy_individual = the per-student synthetic cohort from migration
  -- 165; subscription_plan = a plan's shared access cohort from migration 167. Access is
  -- unchanged either way -- content is still granted through cohort_ids tagging.
  cohort_kind text NOT NULL DEFAULT 'bootcamp'
                            CHECK (cohort_kind IN ('bootcamp','legacy_individual','subscription_plan')),
  -- migration 165, deprecated by migration 172: kept in sync from cohort_kind by
  -- trg_cohorts_sync_is_individual so consumers still filtering on it stay correct.
  -- individual_student_id is added further down via ALTER TABLE, once public.students
  -- exists -- it references students, which is created after cohorts in this file.
  is_individual          boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohorts_dates_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_cohorts_is_individual ON public.cohorts (is_individual);
CREATE INDEX idx_cohorts_kind ON public.cohorts (cohort_kind);

CREATE OR REPLACE FUNCTION public.sync_cohort_is_individual()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.is_individual := (NEW.cohort_kind <> 'bootcamp');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cohorts_sync_is_individual
  BEFORE INSERT OR UPDATE OF cohort_kind, is_individual ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.sync_cohort_is_individual();

-- ── students ──────────────────────────────────────────────────
CREATE TABLE public.students (
  id                 uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              text        NOT NULL,
  full_name          text,
  avatar_url         text,
  country            text,
  city               text,
  bio                text,
  social_links       jsonb       DEFAULT '{}'::jsonb,
  role               text        NOT NULL DEFAULT 'student'
                                   CHECK (role IN ('student','instructor','admin','staff')),
  status             text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','inactive','graduated','suspended')),
  cohort_id          uuid        REFERENCES public.cohorts(id) ON DELETE SET NULL,
  original_cohort_id uuid        REFERENCES public.cohorts(id) ON DELETE SET NULL,
  enrollment_model   text        CHECK (enrollment_model IN ('bootcamp','individual')),
  onboarding_done    boolean     NOT NULL DEFAULT false,
  onboarding_responses jsonb     NOT NULL DEFAULT '{}'::jsonb,
  payment_exempt     boolean     NOT NULL DEFAULT false,
  username           text,
  education          jsonb       DEFAULT '[]'::jsonb,
  work_experience    jsonb       DEFAULT '[]'::jsonb,
  skills             jsonb       DEFAULT '[]'::jsonb,
  portfolio_items    jsonb       DEFAULT '[]'::jsonb,
  account_provisioned_at      timestamptz,
  setup_email_sent_at         timestamptz,
  -- migration 180: short-lived claim held while a worker sends the combined welcome, so the
  -- admin route and the hourly sweep cannot both send one. Expires so a crashed worker does
  -- not strand the learner.
  setup_email_claimed_at      timestamptz,
  password_setup_started_at   timestamptz,
  password_set_at             timestamptz,
  onboarding_completed_at     timestamptz,
  -- migration 159: recorded, never inferred. New rows start 'pending' and must be
  -- admitted explicitly; 'unknown' origin is a real answer for pre-migration accounts.
  account_origin     text        NOT NULL DEFAULT 'unknown'
                                   CHECK (account_origin IN ('self_signup','admissions','unknown')),
  access_state       text        NOT NULL DEFAULT 'pending'
                                   CHECK (access_state IN ('pending','active','denied')),
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_students_username_ci ON public.students (lower(username)) WHERE username IS NOT NULL;

-- migration 165: reverse lookup from a synthetic individual-enrollment cohort back to
-- its owning student. Added here (after students) rather than inline on cohorts above,
-- since cohorts is created before students in this file and can't forward-reference it.
ALTER TABLE public.cohorts
  ADD COLUMN individual_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;
ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_individual_student_consistency
  CHECK (individual_student_id IS NULL OR is_individual);
-- migration 172: a shared plan cohort must never claim to belong to one student.
ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_subscription_plan_has_no_student_check
  CHECK (cohort_kind <> 'subscription_plan' OR individual_student_id IS NULL);
-- One live synthetic cohort per student.
CREATE UNIQUE INDEX idx_cohorts_individual_student
  ON public.cohorts (individual_student_id)
  WHERE individual_student_id IS NOT NULL;

-- Reusable public-facing professionals for Virtual Experiences (migration 162)
CREATE TABLE public.experience_guides (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type          text        NOT NULL DEFAULT 'external'
                                   CHECK (source_type IN ('external', 'instructor')),
  full_name            text        NOT NULL,
  profile_photo_url    text,
  professional_title   text,
  company              text,
  bio                  text,
  linkedin_url         text,
  expertise            text[]      NOT NULL DEFAULT '{}',
  consent_status       text        NOT NULL DEFAULT 'pending'
                                   CHECK (consent_status IN ('pending', 'confirmed', 'not_required')),
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('draft', 'active', 'archived')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, linked_user_id)
);
CREATE INDEX experience_guides_owner_idx ON public.experience_guides (owner_id, status);

-- ── forms (registration forms only — courses/events/VEs have own tables) ──
CREATE TABLE public.forms (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT 'Untitled',
  description text,
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  slug        text        NOT NULL UNIQUE,
  cohort_ids  uuid[]      NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'published'
                            CHECK (status IN ('draft','published','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── responses (event registrations and pure form submissions) ──
CREATE TABLE public.responses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    uuid        NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Learning partners (migration 141)
CREATE TABLE public.partners (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  logo_url    text,
  website_url text,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── courses (purpose-built — migrated out of forms in migration 030) ──
CREATE TABLE public.courses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Untitled',
  description     text,
  slug            text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'published'
                                CHECK (status IN ('draft','published','archived')),
  cohort_ids      uuid[]      NOT NULL DEFAULT '{}',
  -- migration 174: present for parity with certifications, not yet consulted by the
  -- course access checks. See that migration for why the switch is a separate decision.
  available_to_everyone boolean NOT NULL DEFAULT false
    CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0),
  cover_image     text,
  deadline_days   integer,
  theme           text,
  mode            text        CHECK (mode IN ('light','dark','auto')),
  font            text,
  custom_accent   text,
  questions       jsonb       NOT NULL DEFAULT '[]',
  fields          jsonb       NOT NULL DEFAULT '[]',
  passmark        integer     NOT NULL DEFAULT 50,
  course_timer    integer,
  learn_outcomes  text[]      DEFAULT '{}',
  points_enabled  boolean     NOT NULL DEFAULT false,
  points_base     integer     NOT NULL DEFAULT 100,
  points_system   jsonb       NOT NULL DEFAULT '{"enabled":false,"basePoints":100,"timeBonusEnabled":true,"timeBonusSeconds":10,"timeBonusMultiplier":1.5,"streakEnabled":true,"streakCount":3,"streakBonus":0,"hintPenalty":20,"solutionPenalty":30,"milestones":[]}'::jsonb,
  post_submission jsonb,
  category        text,
  badge_image_url text,
  lesson_timing   text        CHECK (lesson_timing IN ('before', 'after')),
  show_answers    text        NOT NULL DEFAULT 'per_question'
                              CHECK (show_answers IN ('per_question', 'after_quiz', 'none')),
  partner_id      uuid        REFERENCES public.partners(id) ON DELETE SET NULL,
  max_attempts    integer     CHECK (max_attempts IS NULL OR max_attempts > 0),
  -- migration 182: per-course opt-in for the lesson AI tutor. Off by default --
  -- /api/lesson-tutor refuses every request for a course where this is false.
  ai_tutor_enabled boolean    NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Lightweight id/type/slide-kind projection so save-progress never loads the whole questions JSONB
-- (migration 136, widened in 154). The flags and share bonus let save-progress clamp the client's
-- reported points total to what the course could actually award. Values pass through as raw jsonb --
-- no casts -- because a cast failure on one hand-edited course would break saves for that course.
CREATE OR REPLACE FUNCTION public.question_types(c public.courses)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id',                  q->>'id',
      'type',                COALESCE(q->>'type', 'multiple_choice'),
      'lessonOnly',          COALESCE(q->'lessonOnly',      'false'::jsonb),
      'isSection',           COALESCE(q->'isSection',       'false'::jsonb),
      'isDownloads',         COALESCE(q->'isDownloads',     'false'::jsonb),
      'isLinkedInShare',     COALESCE(q->'isLinkedInShare', 'false'::jsonb),
      'linkedInSharePoints', COALESCE(q->'linkedInSharePoints', 'null'::jsonb)
    )),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(c.questions) = 'array' THEN c.questions
      ELSE '[]'::jsonb
    END
  ) AS q
$$;

-- ── events (purpose-built — migrated out of forms in migration 030) ──
CREATE TABLE public.events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Untitled',
  description     text,
  slug            text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'published'
                                CHECK (status IN ('draft','published','archived')),
  cohort_ids      uuid[]      NOT NULL DEFAULT '{}',
  cover_image     text,
  deadline_days   integer,
  theme           text,
  mode            text        CHECK (mode IN ('light','dark','auto')),
  font            text,
  custom_accent   text,
  fields          jsonb       NOT NULL DEFAULT '[]',
  event_date      date,
  event_time      time,
  timezone        text,
  location        text,
  event_type      text        DEFAULT 'in-person'
                                CHECK (event_type IN ('in-person','virtual')),
  capacity        integer,
  meeting_link         text,
  speakers             jsonb       DEFAULT '[]',
  is_private           boolean     NOT NULL DEFAULT false,
  recurrence           text        DEFAULT 'once',
  recurrence_end_date  date,
  recurrence_days      int[],
  post_submission      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── virtual_experiences ───────────────────────────────────────
CREATE TABLE public.virtual_experiences (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Untitled',
  description     text,
  slug            text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'published'
                                CHECK (status IN ('draft','published','archived')),
  cohort_ids      uuid[]      NOT NULL DEFAULT '{}',
  -- migration 186: offered to everyone, including accounts with no cohort. Mutually exclusive
  -- with cohort targeting, so "everyone" can never quietly mean "everyone plus these cohorts".
  available_to_everyone boolean NOT NULL DEFAULT false
    CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0),
  cover_image     text,
  deadline_days   integer,
  theme           text,
  mode            text        CHECK (mode IN ('light','dark')),
  font            text,
  custom_accent   text,
  modules         jsonb       NOT NULL DEFAULT '[]',
  industry        text,
  difficulty      text        CHECK (difficulty IN ('beginner','intermediate','advanced')),
  role            text,
  company         text,
  duration        text,
  tools           text[]      DEFAULT '{}',
  tool_logos      jsonb       DEFAULT '{}',
  tagline         text,
  background      text,
  learn_outcomes  text[]      DEFAULT '{}',
  manager_name    text,
  manager_title   text        DEFAULT 'Manager',
  guide_id        uuid        REFERENCES public.experience_guides(id) ON DELETE SET NULL,
  guide_snapshot  jsonb,
  dataset         jsonb,
  is_short_course boolean     NOT NULL DEFAULT false,
  badge_image_url text,
  group_ids       uuid[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ve_group_ids ON public.virtual_experiences USING GIN (group_ids);

-- ── certifications (migration 123) ────────────────────────────
-- Timed, anti-copy-protected exams. Own content type (not a course flag): own player,
-- own attempts table, own overview pages. Reuses the CourseQuestion shape in `questions`.
CREATE TABLE public.certifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT 'Untitled',
  description     text,
  slug            text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'published'
                                CHECK (status IN ('draft','published','archived')),
  -- Career vs Technology (migration 130); the certifications page groups by this.
  cert_type       text        NOT NULL DEFAULT 'technology'
                                CHECK (cert_type IN ('career','technology')),
  cohort_ids      uuid[]      NOT NULL DEFAULT '{}',
  -- migration 174: explicit open access. When false, access is limited to cohort_ids,
  -- and an empty cohort_ids then means nobody rather than everyone.
  available_to_everyone boolean NOT NULL DEFAULT false
    CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0),
  cover_image     text,
  badge_image_url text,
  questions       jsonb       NOT NULL DEFAULT '[]',
  -- Separate practice-only bank (migration 133); practice mode reveals feedback, never the exam bank.
  practice_questions jsonb    NOT NULL DEFAULT '[]',
  passmark        integer     NOT NULL DEFAULT 70 CHECK (passmark BETWEEN 0 AND 100),
  time_limit      integer     CHECK (time_limit IS NULL OR time_limit > 0), -- minutes; null = untimed
  max_attempts    integer     NOT NULL DEFAULT 1 CHECK (max_attempts >= 0),  -- 0 = unlimited
  retake_cooldown_hours integer NOT NULL DEFAULT 24 CHECK (retake_cooldown_hours >= 0), -- min wait after a fail; 0 = none (migration 126)
  exam_protection boolean     NOT NULL DEFAULT true,
  deadline_days   integer,
  learn_outcomes  text[]      DEFAULT '{}',
  theme           text,
  mode            text        CHECK (mode IN ('light','dark')),
  font            text,
  custom_accent   text,
  -- Foundation assets (migration 124): skill areas + study guide PDF + poster + practice-test link.
  skill_areas           jsonb   NOT NULL DEFAULT '[]',  -- [{id,name}]; questions map via CourseQuestion.skillAreaId
  -- Case studies (migration 134): [{id,title,content}]; questions reference one via CourseQuestion.scenarioId
  scenarios             jsonb   NOT NULL DEFAULT '[]',
  study_guide_url       text,
  study_guide_name      text,
  study_guide_published boolean NOT NULL DEFAULT false,
  poster_url            text,
  poster_published      boolean NOT NULL DEFAULT false,
  practice_test_url     text,
  -- Courses / learning paths to complete before the exam (migration 129): [{id, type:'course'|'path'}]
  prep_items            jsonb   NOT NULL DEFAULT '[]',
  -- Shared runnable-playground data reused across question playgrounds (migration 131):
  -- { sqlTables:[...], pythonDatasets:[...], setupSql, setupPython }
  playground_data       jsonb   NOT NULL DEFAULT '{}',
  -- Exam integrity (migration 132): randomize order / shuffle options / draw N from the bank.
  randomize_questions   boolean NOT NULL DEFAULT false,
  shuffle_options       boolean NOT NULL DEFAULT false,
  question_pool_size    integer CHECK (question_pool_size IS NULL OR question_pool_size > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_certifications_updated_at
  BEFORE UPDATE ON public.certifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── data_center_datasets (migration 106) ──────────────────────
CREATE TABLE IF NOT EXISTS public.data_center_datasets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  description      text,
  cover_image_url  text,
  cover_image_alt  text,
  tags             text[]      NOT NULL DEFAULT '{}',
  category         text,
  sample_questions text[]      NOT NULL DEFAULT '{}',
  file_url         text,
  file_name        text,
  row_count        int,
  column_info      jsonb       NOT NULL DEFAULT '[]',
  source           text,
  source_url       text,
  scenario         text,
  disclaimer       text,
  table_type       text CHECK (table_type IN ('single', 'multiple')),
  is_published     boolean     NOT NULL DEFAULT false,
  created_by       uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── assignments ───────────────────────────────────────────────
CREATE TABLE public.assignments (
  id                      uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                   text        NOT NULL,
  scenario                text,
  brief                   text,
  tasks                   text,
  requirements            text,
  submission_instructions text,
  related_course          uuid        REFERENCES public.courses(id) ON DELETE SET NULL,
  created_by              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cohort_ids              uuid[]      NOT NULL DEFAULT '{}',
  group_ids               uuid[]      NOT NULL DEFAULT '{}',
  cover_image             text,
  status                  text        NOT NULL DEFAULT 'draft'
                                        CHECK (status IN ('draft','published','closed')),
  type                    text        NOT NULL DEFAULT 'standard'
                                        CHECK (type IN ('standard','code_review','excel_review','dashboard_critique','virtual_experience','document_review')),
  config                  jsonb,
  deadline_date           date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── assignment_resources ──────────────────────────────────────
CREATE TABLE public.assignment_resources (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  url           text        NOT NULL,
  resource_type text        NOT NULL DEFAULT 'link' CHECK (resource_type IN ('link','file')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── groups ────────────────────────────────────────────────────
CREATE TABLE public.groups (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL,
  cohort_id   uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  description text,
  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── group_members ─────────────────────────────────────────────
CREATE TABLE public.group_members (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id   uuid        NOT NULL REFERENCES public.groups(id)   ON DELETE CASCADE,
  student_id uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  is_leader  boolean     NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id)
);

-- ── assignment_solutions (migration 144) ──────────────────────
-- Instructor model answers, released to a student only after their submission is graded.
-- Files live in the PRIVATE 'assignment-solutions' bucket and are served as short-lived signed
-- URLs by /api/assignments/solution-file; RLS below hides the metadata until release.
CREATE TABLE public.assignment_solutions (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  kind          text        NOT NULL DEFAULT 'file' CHECK (kind IN ('file','link')),
  storage_path  text,
  url           text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_solutions_target CHECK (
    (kind = 'file' AND storage_path IS NOT NULL) OR (kind = 'link' AND url IS NOT NULL)
  )
);

-- ── assignment_submissions ────────────────────────────────────
CREATE TABLE public.assignment_submissions (
  id            uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    uuid         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  assignment_id uuid         NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  group_id      uuid         REFERENCES public.groups(id)   ON DELETE SET NULL,
  submitted_by  uuid         REFERENCES public.students(id) ON DELETE SET NULL,
  participants  uuid[]       NOT NULL DEFAULT '{}',
  response_text text,
  status        text         NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','submitted','graded')),
  submitted_at  timestamptz,
  score         numeric(5,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  feedback      text,
  -- Migration 143: per-task grading for scenario assignments.
  -- { "<taskId>": { "score": 0-100, "feedback": "..." } }, grader-only.
  task_grades   jsonb,
  graded_by     uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  graded_at     timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- Partial unique indexes replace the blanket UNIQUE (student_id, assignment_id)
CREATE UNIQUE INDEX submissions_individual_unique
  ON public.assignment_submissions (student_id, assignment_id)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX submissions_group_unique
  ON public.assignment_submissions (group_id, assignment_id)
  WHERE group_id IS NOT NULL;

-- ── assignment_submission_files ───────────────────────────────
CREATE TABLE public.assignment_submission_files (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id uuid        NOT NULL REFERENCES public.assignment_submissions(id) ON DELETE CASCADE,
  file_name     text,
  file_url      text        NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assignment_group_workspaces (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  group_id      uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  notes         text,
  links         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  files         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_by    uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, group_id)
);

-- ── assignment_answer_keys (migration 142) ────────────────────
-- Server-only MCQ correct answers, kept out of the student-readable assignments.config.
CREATE TABLE public.assignment_answer_keys (
  assignment_id uuid        PRIMARY KEY REFERENCES public.assignments(id) ON DELETE CASCADE,
  keys          jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- { "<taskId>": "<correct option text>" }
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── communities ───────────────────────────────────────────────
CREATE TABLE public.communities (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text        NOT NULL,
  whatsapp_link text,
  description   text,
  cover_image   text,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cohort_ids    uuid[]      NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── announcements ─────────────────────────────────────────────
CREATE TABLE public.announcements (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        text        NOT NULL,
  subtitle     text,
  content      text        NOT NULL,
  cover_image  text,
  youtube_url  text,
  author_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cohort_ids   uuid[]      NOT NULL DEFAULT '{}',
  is_pinned    boolean     NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_expiry_valid CHECK (expires_at IS NULL OR expires_at > published_at)
);

-- ── recordings ────────────────────────────────────────────────
CREATE TABLE public.recordings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  description text,
  cover_image text,
  cohort_ids  uuid[]      NOT NULL DEFAULT '{}',
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status      text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','published')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── recording_entries ──────────────────────────────────────────
CREATE TABLE public.recording_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid        NOT NULL REFERENCES public.recordings(id) ON DELETE CASCADE,
  week         integer     NOT NULL CHECK (week >= 1),
  topic        text        NOT NULL,
  url          text        NOT NULL,
  order_index  integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── schedules ─────────────────────────────────────────────────
CREATE TABLE public.schedules (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       text        NOT NULL,
  course_id   uuid        REFERENCES public.courses(id) ON DELETE CASCADE,
  description text,
  cover_image text,
  start_date  date,
  end_date    date,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cohort_ids  uuid[]      NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','published','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_dates_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- ── schedule_topics ───────────────────────────────────────────
CREATE TABLE public.schedule_topics (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id uuid        NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  order_index integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── schedule_resources ────────────────────────────────────────
CREATE TABLE public.schedule_resources (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id uuid        NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  url         text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── cohort_assignments (polymorphic: tracks content-to-cohort assignments) ──
-- content_type is 'course' | 'event' | 'virtual_experience' | 'form'
-- content_id references the corresponding table's primary key
CREATE TABLE public.cohort_assignments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id    uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  content_type text        NOT NULL CHECK (content_type IN ('course','event','virtual_experience','form','certification')),
  content_id   uuid        NOT NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, cohort_id)
);

-- ── learning_paths ────────────────────────────────────────────
CREATE TABLE public.learning_paths (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  cover_image   text,
  instructor_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_ids      uuid[]      NOT NULL DEFAULT '{}',
  cohort_ids    uuid[]      NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','published')),
  next_path_id    uuid        REFERENCES public.learning_paths(id) ON DELETE SET NULL,
  badge_image_url text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- migration 186, as for virtual_experiences above.
  available_to_everyone boolean NOT NULL DEFAULT false
    CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0),
  -- A public path names no cohort, so open access satisfies the same intent the cohort list did:
  -- a published path reaches somebody. Without this branch, publishing one fails on a constraint
  -- the author cannot see.
  CONSTRAINT check_published_requires_cohort CHECK (
    status = 'draft'
    OR available_to_everyone
    OR (status = 'published' AND array_length(cohort_ids, 1) > 0)
  )
);

-- ── course_attempts ───────────────────────────────────────────
CREATE TABLE public.course_attempts (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id              uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  attempt_number         integer     NOT NULL DEFAULT 1,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  passed                 boolean,
  score                  integer     NOT NULL DEFAULT 0,
  points                 integer     NOT NULL DEFAULT 0,
  current_question_index integer     NOT NULL DEFAULT 0,
  answers                jsonb       NOT NULL DEFAULT '{}',
  streak                 integer     NOT NULL DEFAULT 0,
  hints_used             text[]      NOT NULL DEFAULT '{}',
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ── guided_project_attempts ───────────────────────────────────
CREATE TABLE public.guided_project_attempts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  ve_id             uuid        NOT NULL REFERENCES public.virtual_experiences(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  progress          jsonb       NOT NULL DEFAULT '{}',
  current_module_id text,
  current_lesson_id text,
  review            jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, ve_id)
);

-- ── certification_attempts (migration 123) ────────────────────
-- One row per exam attempt. proctor holds Standard-protection counters
-- (tab-switch / blur / fullscreen-exit). No XP trigger: exams are not gamified.
CREATE TABLE public.certification_attempts (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  certification_id       uuid        NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  attempt_number         integer     NOT NULL DEFAULT 1,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  passed                 boolean,
  score                  integer     NOT NULL DEFAULT 0,
  current_question_index integer     NOT NULL DEFAULT 0,
  answers                jsonb       NOT NULL DEFAULT '{}',
  proctor                jsonb       NOT NULL DEFAULT '{}',
  -- Ordered ids of the questions delivered to THIS attempt (migration 132); empty = all, authored order.
  question_ids           jsonb       NOT NULL DEFAULT '[]',
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cert_attempts_student      ON public.certification_attempts(student_id);
CREATE INDEX idx_cert_attempts_cert         ON public.certification_attempts(certification_id);
CREATE INDEX idx_cert_attempts_student_cert ON public.certification_attempts(student_id, certification_id);
-- At most one active (in-progress) attempt per student across ALL certifications -- enforces
-- "one certification in progress at a time" atomically.
CREATE UNIQUE INDEX idx_cert_attempts_one_active_per_student
  ON public.certification_attempts (student_id)
  WHERE completed_at IS NULL;

-- ── student_xp ────────────────────────────────────────────────
CREATE TABLE public.student_xp (
  student_id uuid        PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  total_xp   integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── certificates ──────────────────────────────────────────────
CREATE TABLE public.certificates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid,        -- no FK: certificate must outlive its course
  ve_id            uuid,        -- no FK: certificate must outlive its virtual experience
  learning_path_id uuid,        -- no FK: certificate must outlive its learning path
  certification_id uuid,        -- no FK: certificate must outlive its certification (migration 123)
  student_id       uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name     text        NOT NULL,
  revoked          boolean     NOT NULL DEFAULT false,
  revoked_at       timestamptz,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_cert_has_content CHECK (course_id IS NOT NULL OR ve_id IS NOT NULL OR learning_path_id IS NOT NULL OR certification_id IS NOT NULL)
);
CREATE UNIQUE INDEX certificates_unique_active_student
  ON public.certificates (course_id, student_id)
  WHERE revoked = false AND course_id IS NOT NULL;
CREATE UNIQUE INDEX certificates_unique_active_student_ve
  ON public.certificates (ve_id, student_id)
  WHERE revoked = false AND ve_id IS NOT NULL;
CREATE UNIQUE INDEX certificates_unique_active_student_certification
  ON public.certificates (certification_id, student_id)
  WHERE revoked = false AND certification_id IS NOT NULL;
CREATE UNIQUE INDEX certificates_unique_active_student_learning_path
  ON public.certificates (learning_path_id, student_id)
  WHERE revoked = false AND learning_path_id IS NOT NULL;

-- ── certificate_defaults ──────────────────────────────────────
CREATE TABLE public.certificate_defaults (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type         text        NOT NULL DEFAULT 'default',  -- 'default' (course/VE/path) or 'certification' (migration 127)
  alignment            text        NOT NULL DEFAULT 'left',      -- 'left' or 'center' (DataCamp-style) (migration 127)
  header_text          text        NOT NULL DEFAULT 'Certificate of Completion',  -- editable header line (migration 128)
  institution_name     text        NOT NULL DEFAULT '',
  primary_color        text        NOT NULL DEFAULT '#00bf63',
  accent_color         text        NOT NULL DEFAULT '#ADEE66',
  background_image_url text,
  logo_url             text,
  signature_url        text,
  signatory_name       text        NOT NULL DEFAULT '',
  signatory_title      text        NOT NULL DEFAULT '',
  certify_text         text        NOT NULL DEFAULT 'This is to certify that',
  completion_text      text        NOT NULL DEFAULT 'has successfully completed',
  font_family          text        NOT NULL DEFAULT 'serif',
  heading_size         text        NOT NULL DEFAULT 'md',
  padding_top          integer     NOT NULL DEFAULT 280,
  padding_left         integer     NOT NULL DEFAULT 182,
  line_spacing         text        NOT NULL DEFAULT 'normal',
  text_positions       jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, content_type)
);

-- ── event_registrations ───────────────────────────────────────
-- Final state after migration 039 + 054 + 091: student_id NOT NULL, responses jsonb, join_token for attendance tracking
CREATE TABLE public.event_registrations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_id      uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  responses     jsonb       NOT NULL DEFAULT '{}',
  join_token    text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  UNIQUE (student_id, event_id)
);

-- ── live_attendance ───────────────────────────────────────────
-- Records a row each time a student clicks the tracked join link for a live session.
-- session_date is the calendar date of the click, enabling per-session tracking for recurring events.
CREATE TABLE public.live_attendance (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  student_id   uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_date date        NOT NULL DEFAULT CURRENT_DATE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, student_id, session_date)
);

-- ── sent_nudges ───────────────────────────────────────────────
CREATE TABLE public.sent_nudges (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  form_id    uuid,
  nudge_type text        NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

-- ── email_dedup ───────────────────────────────────────────────
-- Generic exactly-once send lock. dedupe_key is any stable identifier
-- (e.g. cert UUID); type names the email. No FK -- not tied to responses.
CREATE TABLE IF NOT EXISTS public.email_dedup (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key  text        NOT NULL,
  type        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key, type)
);
ALTER TABLE public.email_dedup ENABLE ROW LEVEL SECURITY;

-- ── learning_path_progress ────────────────────────────────────
CREATE TABLE public.learning_path_progress (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_path_id   uuid        NOT NULL REFERENCES public.learning_paths(id) ON DELETE CASCADE,
  completed_item_ids uuid[]      NOT NULL DEFAULT '{}',
  completed_at       timestamptz,
  cert_id            uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, learning_path_id),
  CONSTRAINT check_cert_requires_completion CHECK (cert_id IS NULL OR completed_at IS NOT NULL)
);

-- ── meeting_integrations ──────────────────────────────────────
CREATE TABLE public.meeting_integrations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text        NOT NULL CHECK (provider IN ('google_meet','zoom','teams')),
  access_token  text,
  refresh_token text,
  token_expiry  timestamptz,
  email         text,
  connected     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);


-- ── site_settings (landing page template + config) ────────────
-- Student Mode sessions are server-issued, revocable capabilities. The raw
-- selected student id is never sufficient to impersonate an account.
CREATE TABLE public.student_mode_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  user_agent text,
  CONSTRAINT student_mode_distinct_accounts CHECK (actor_id <> student_id)
);

CREATE TABLE public.student_mode_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.student_mode_sessions(id) ON DELETE CASCADE,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_mode_sessions_actor_active
  ON public.student_mode_sessions(actor_id, expires_at DESC)
  WHERE ended_at IS NULL;
CREATE INDEX idx_student_mode_audit_actor_created
  ON public.student_mode_audit_log(actor_id, created_at DESC);
CREATE INDEX idx_student_mode_audit_student_created
  ON public.student_mode_audit_log(student_id, created_at DESC);

CREATE TABLE public.site_settings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton   boolean     UNIQUE DEFAULT true CHECK (singleton = true),
  template    text        NOT NULL DEFAULT 'momentum',
  config      jsonb       NOT NULL DEFAULT '{}',
  updated_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── tool_icons (instructor-managed tool logos, migration 185) ──
--
-- `name` is stored already normalized (trimmed, lower-cased): the lookup is an exact match on
-- typed text (a course's category, a learner's skill), so one row per tool name and an upsert
-- replaces a logo instead of accumulating duplicates. `image` holds a Cloudinary public_id,
-- resolved at render -- never a baked URL, which is what broke every cover when the Cloudinary
-- account changed. The code defaults in lib/tool-icons.ts still cover the built-in thirteen.
CREATE TABLE public.tool_icons (
  name        text        PRIMARY KEY CHECK (name = lower(btrim(name)) AND length(name) BETWEEN 1 AND 80),
  image       text        NOT NULL CHECK (length(btrim(image)) > 0),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────
--  4. SECURITY HELPER FUNCTIONS
--  Defined AFTER students table so SQL-language functions can
--  validate the referenced table at creation time.
--  SECURITY DEFINER + set search_path prevents RLS recursion
--  and schema-injection attacks.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM public.students WHERE id = (SELECT auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_instructor_or_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role IN ('instructor','admin') FROM public.students WHERE id = (SELECT auth.uid())),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.students WHERE id = (SELECT auth.uid())),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role = 'staff' FROM public.students WHERE id = (SELECT auth.uid())),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.my_group_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT ARRAY(SELECT group_id FROM public.group_members WHERE student_id = (SELECT auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.is_bootcamp_cohort_member_for_student(
  p_student_id uuid,
  p_cohort_ids uuid[]
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.cohorts c ON c.id = s.cohort_id
      WHERE s.id = p_student_id
        AND c.cohort_kind = 'bootcamp'
        AND s.cohort_id = ANY(p_cohort_ids)
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_bootcamp_cohort_member(p_cohort_ids uuid[])
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_bootcamp_cohort_member_for_student((SELECT auth.uid()), p_cohort_ids)
$$;

CREATE OR REPLACE FUNCTION public.valid_group_participants(
  p_group_id uuid,
  p_participants uuid[]
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    p_group_id IS NULL
    OR COALESCE(p_participants, '{}'::uuid[]) <@ COALESCE(
      ARRAY(
        SELECT gm.student_id
        FROM public.group_members gm
        WHERE gm.group_id = p_group_id
      ),
      '{}'::uuid[]
    )
$$;

-- Restrict helper functions to authenticated users only.
-- Prevents anon callers from probing role state via direct RPC calls.
REVOKE EXECUTE ON FUNCTION public.get_my_role()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_instructor_or_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_staff()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_group_ids()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_bootcamp_cohort_member_for_student(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_bootcamp_cohort_member(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.valid_group_participants(uuid, uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_role()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_instructor_or_admin() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_staff()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.my_group_ids()           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_bootcamp_cohort_member_for_student(uuid, uuid[]) TO service_role;
GRANT  EXECUTE ON FUNCTION public.is_bootcamp_cohort_member(uuid[]) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.valid_group_participants(uuid, uuid[]) TO authenticated;

-- Returns only public profile fields (name + avatar) for staff — safe for students to call.
CREATE OR REPLACE FUNCTION public.get_staff_profiles(p_ids uuid[])
RETURNS TABLE(id uuid, full_name text, avatar_url text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id, full_name, avatar_url FROM students
  WHERE id = ANY(p_ids) AND role IN ('admin', 'instructor');
$$;
REVOKE EXECUTE ON FUNCTION public.get_staff_profiles(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_staff_profiles(uuid[]) TO authenticated;


-- ─────────────────────────────────────────────────────────────
--  5. ENABLE RLS ON EVERY TABLE
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.students                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohorts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_experiences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_guides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_center_datasets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_resources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_solutions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_group_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_answer_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_topics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_resources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_assignments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_paths             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_attempts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guided_project_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certification_attempts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_xp                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_defaults       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_nudges                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_path_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_integrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_icons                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_mode_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_mode_audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student mode sessions: admins read"
  ON public.student_mode_sessions FOR SELECT
  USING ((SELECT public.is_admin()));
CREATE POLICY "student mode audit: admins read"
  ON public.student_mode_audit_log FOR SELECT
  USING ((SELECT public.is_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.student_mode_sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_mode_audit_log FROM authenticated;


-- ─────────────────────────────────────────────────────────────
--  6. AUTH TRIGGER — auto-create student row on signup
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.students (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    'student'
  )
  ON CONFLICT (id) DO NOTHING;

  -- migration 159: mirror the students.access_state default into the app_metadata claim
  -- the middleware / api-auth gate reads. Absent claims are treated as active (every
  -- pre-migration account has none), so a new signup must carry an explicit 'pending'
  -- from the instant it exists or it would pass the gate unresolved.
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || '{"access_state": "pending"}'::jsonb
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ─────────────────────────────────────────────────────────────
--  7. UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────────────────────────

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_cohorts_updated_at
  BEFORE UPDATE ON public.cohorts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_forms_updated_at
  BEFORE UPDATE ON public.forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_partners_updated_at
  BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_courses_updated_at
  BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_virtual_experiences_updated_at
  BEFORE UPDATE ON public.virtual_experiences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_experience_guides_updated_at
  BEFORE UPDATE ON public.experience_guides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_data_center_datasets_updated_at
  BEFORE UPDATE ON public.data_center_datasets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignment_submissions_updated_at
  BEFORE UPDATE ON public.assignment_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignment_answer_keys_updated_at
  BEFORE UPDATE ON public.assignment_answer_keys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignment_group_workspaces_updated_at
  BEFORE UPDATE ON public.assignment_group_workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Prevents students from modifying graded fields (replaces the recursive RLS WITH CHECK).
-- NOTE: Do NOT put a subquery in the trigger WHEN clause — Postgres forbids it.
--       The role check lives inside the function body instead.
DROP TRIGGER IF EXISTS trg_protect_submission_graded_fields ON public.assignment_submissions;

-- Hardened by migration 142: guards INSERT + UPDATE. A student may never write score, feedback,
-- status='graded', or grading metadata (a direct insert could otherwise self-grade or forge a
-- score). score/feedback are grader-only; the AI-review auto-submit no longer writes a client
-- score; the scenario endpoint runs as the service role (auth.uid() null) so this check skips it.
-- Migration 143 added task_grades (per-task scores/comments), compared against OLD on UPDATE so a
-- student editing a reset draft is not blocked by a value the grader left behind.
-- Migration 146 also makes the identity columns immutable on UPDATE.
CREATE OR REPLACE FUNCTION public.protect_submission_graded_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Identity columns never change after insert. Service-role endpoints (auth.uid() null) are exempt;
  -- they only re-save the same ids. This stops a client repointing a submission at another
  -- assignment, student, or group.
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
       OR NEW.student_id  IS DISTINCT FROM OLD.student_id
       OR NEW.group_id    IS DISTINCT FROM OLD.group_id THEN
      RAISE EXCEPTION 'assignment_id, student_id and group_id cannot be changed';
    END IF;
  END IF;

  IF (SELECT role FROM public.students WHERE id = auth.uid()) = 'student' THEN
    IF NEW.status = 'graded'
       OR NEW.graded_by IS NOT NULL
       OR NEW.graded_at IS NOT NULL
       OR NEW.score IS NOT NULL
       OR NEW.feedback IS NOT NULL
       OR (TG_OP = 'INSERT' AND NEW.task_grades IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.task_grades IS DISTINCT FROM OLD.task_grades) THEN
      RAISE EXCEPTION 'Students cannot set graded fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_submission_graded_fields
  BEFORE INSERT OR UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_submission_graded_fields();

-- task_grades shape constraint (migration 147): object of { <taskId>: { score 0-100?, feedback? } }.
CREATE OR REPLACE FUNCTION public.valid_task_grades(tg jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT tg IS NULL OR (
    jsonb_typeof(tg) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(tg) AS e(k, val)
      WHERE jsonb_typeof(val) <> 'object'
        OR CASE
             WHEN jsonb_typeof(val->'score') = 'number'
               THEN (val->>'score')::numeric < 0 OR (val->>'score')::numeric > 100
             WHEN val ? 'score' AND jsonb_typeof(val->'score') <> 'null'
               THEN true
             ELSE false
           END
        OR CASE
             WHEN jsonb_typeof(val->'feedback') = 'string'
               THEN length(val->>'feedback') > 8000
             WHEN val ? 'feedback' AND jsonb_typeof(val->'feedback') <> 'null'
               THEN true
             ELSE false
           END
    )
  );
$$;

ALTER TABLE public.assignment_submissions
  DROP CONSTRAINT IF EXISTS assignment_submissions_task_grades_valid;
ALTER TABLE public.assignment_submissions
  ADD  CONSTRAINT assignment_submissions_task_grades_valid
  CHECK (public.valid_task_grades(task_grades));

-- Submission passing grade from config.passingScore (migration 150), validated exactly like
-- passMarkOf() in lib/assignment-scenarios.ts: a JSON number in [1,100] is used, anything else -> 85.
-- The nested CASE guarantees the ::numeric cast only runs on a JSON number, so it can never throw.
CREATE OR REPLACE FUNCTION public.assignment_pass_mark(config jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(config->'passingScore') = 'number' THEN
      CASE WHEN (config->>'passingScore')::numeric BETWEEN 1 AND 100
           THEN (config->>'passingScore')::numeric
           ELSE 85 END
    ELSE 85
  END;
$$;
CREATE TRIGGER trg_communities_updated_at
  BEFORE UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_learning_paths_updated_at
  BEFORE UPDATE ON public.learning_paths FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tool_icons_updated_at
  BEFORE UPDATE ON public.tool_icons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_guided_project_attempts_updated_at
  BEFORE UPDATE ON public.guided_project_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_certificate_defaults_updated_at
  BEFORE UPDATE ON public.certificate_defaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_meeting_integrations_updated_at
  BEFORE UPDATE ON public.meeting_integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_learning_path_progress_updated_at
  BEFORE UPDATE ON public.learning_path_progress FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.trg_site_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_set_site_settings_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_site_settings_updated_at();


-- ─────────────────────────────────────────────────────────────
--  8. SECURITY TRIGGERS
-- ─────────────────────────────────────────────────────────────

-- Prevent students from changing their own cohort via REST API.
-- Service role (server-side API routes) and instructors/admins are allowed.
-- (Migration 043 fix: checks the REQUESTER's role, not the row's role.)
CREATE OR REPLACE FUNCTION public.prevent_student_cohort_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only act when a value is actually changing (fixes false denials from ORM
  -- updates that include cohort_id/original_cohort_id with unchanged values).
  IF NEW.cohort_id IS NOT DISTINCT FROM OLD.cohort_id
     AND NEW.original_cohort_id IS NOT DISTINCT FROM OLD.original_cohort_id THEN
    RETURN NEW;
  END IF;

  -- Service-role calls (payment processor, server-side) have auth.uid() = NULL — allow
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Instructors and admins may move students between cohorts
  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'permission denied: students may not change their own cohort'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_student_cohort_change ON public.students;
CREATE TRIGGER trg_prevent_student_cohort_change
  BEFORE UPDATE OF cohort_id, original_cohort_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.prevent_student_cohort_change();

-- Prevent students from changing their own status via REST API.
CREATE OR REPLACE FUNCTION public.prevent_student_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> OLD.status AND (SELECT auth.uid()) = OLD.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')
    ) THEN
      RAISE EXCEPTION 'permission denied: students may not change their own status'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_student_status_change ON public.students;
CREATE TRIGGER trg_prevent_student_status_change
  BEFORE UPDATE OF status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.prevent_student_status_change();

-- Prevent students from promoting their own role via REST API (CWE-269 / CWE-862).
CREATE OR REPLACE FUNCTION public.prevent_student_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role <> OLD.role AND (SELECT auth.uid()) = OLD.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')
    ) THEN
      RAISE EXCEPTION 'permission denied: students may not change their own role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prevent_student_role_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_student_role_change ON public.students;
CREATE TRIGGER trg_prevent_student_role_change
  BEFORE UPDATE OF role ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.prevent_student_role_change();

-- XP recalculation after each course attempt (migration 157).
-- Per course, the BEST attempt: a retake can only improve the total, never reduce it, and newly
-- earned points land immediately rather than waiting for completion. Maxed rather than summed, so
-- repeat attempts cannot farm XP.
-- Counting in-progress attempts is only safe because save-progress computes points server-side from
-- the stored answers via lib/attempt-points.ts rather than accepting the browser's running total. If
-- that ever changes back, this trigger must stop counting unfinished attempts.
CREATE OR REPLACE FUNCTION public.recalc_student_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := COALESCE(NEW.student_id, OLD.student_id);

  -- Student row is already gone (cascade delete in progress) -- nothing to update
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = v_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.student_xp (student_id, total_xp, updated_at)
  SELECT
    v_id,
    COALESCE((
      SELECT SUM(best_points) FROM (
        SELECT MAX(points) AS best_points
        FROM   public.course_attempts ca
        WHERE  ca.student_id = v_id
        GROUP  BY ca.course_id
      ) sub
    ), 0)
    -- VE LinkedIn shares (migration 160). The content_type filter is load-bearing: a COURSE share's
    -- bonus is already inside course_attempts.points, so summing the whole table would pay it twice.
    -- SUM is safe rather than MAX because the slot/post_key uniqueness constraints make a share
    -- claimable exactly once, so retaking a VE cannot farm it.
    + COALESCE((
      SELECT SUM(ls.points)
      FROM   public.linkedin_shares ls
      WHERE  ls.student_id = v_id
        AND  ls.content_type = 'virtual_experience'
    ), 0),
    now()
  ON CONFLICT (student_id) DO UPDATE
    SET total_xp   = EXCLUDED.total_xp,
        updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_student_xp ON public.course_attempts;
CREATE TRIGGER trg_recalc_student_xp
  AFTER INSERT OR UPDATE OR DELETE ON public.course_attempts
  FOR EACH ROW EXECUTE FUNCTION public.recalc_student_xp();

-- Prevent direct PostgREST writes to outcome fields (CWE-345 / CWE-863).
-- Service-role callers have auth.uid() = NULL and are always allowed.
CREATE OR REPLACE FUNCTION public.prevent_attempt_outcome_tampering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.passed IS NOT NULL
       OR NEW.score <> 0
       OR NEW.points <> 0
       OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'permission denied: outcome fields may not be set on insert'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.passed IS DISTINCT FROM OLD.passed
       OR NEW.score IS DISTINCT FROM OLD.score
       OR NEW.points IS DISTINCT FROM OLD.points
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'permission denied: outcome fields may not be changed directly'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prevent_attempt_outcome_tampering() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_attempt_outcome_tampering ON public.course_attempts;
CREATE TRIGGER trg_prevent_attempt_outcome_tampering
  BEFORE INSERT OR UPDATE ON public.course_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_attempt_outcome_tampering();

-- Prevent direct PostgREST writes to outcome fields on guided_project_attempts (CWE-345 / CWE-863).
-- progress, current_module_id, current_lesson_id remain student-writable.
-- completed_at and review are blocked for non-service-role callers.
CREATE OR REPLACE FUNCTION public.prevent_guided_project_outcome_tampering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.review IS NOT NULL THEN
      RAISE EXCEPTION 'permission denied: outcome fields may not be set on insert'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.review IS DISTINCT FROM OLD.review THEN
      RAISE EXCEPTION 'permission denied: outcome fields may not be changed directly'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prevent_guided_project_outcome_tampering() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_guided_project_outcome_tampering ON public.guided_project_attempts;
CREATE TRIGGER trg_prevent_guided_project_outcome_tampering
  BEFORE INSERT OR UPDATE ON public.guided_project_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_guided_project_outcome_tampering();

-- Event registration RPC (security definer so it can bypass RLS for the insert)
CREATE OR REPLACE FUNCTION public.register_event_attendee(
  p_event_id   uuid,
  p_student_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.event_registrations (event_id, student_id)
  VALUES (p_event_id, p_student_id)
  ON CONFLICT (student_id, event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'already_registered');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.register_event_attendee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_event_attendee(uuid, uuid) TO service_role;

-- Atomic VE assignment completion (migration 088).
-- [P0] REVOKE/GRANT: service_role only.
-- [P1] Validates assignment-VE linkage and student cohort access inside the transaction.
-- [P3] WHERE clause on ON CONFLICT DO UPDATE skips graded rows entirely.
CREATE OR REPLACE FUNCTION public.complete_ve_assignment(
  p_ve_id              uuid,
  p_assignment_id      uuid,
  p_student_id         uuid,
  p_progress           jsonb,
  p_current_module_id  text,
  p_current_lesson_id  text,
  p_group_id           uuid    DEFAULT NULL,
  p_participants       uuid[]  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        timestamptz := now();
  v_submission jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM assignments
    WHERE id     = p_assignment_id
      AND type   = 'virtual_experience'
      AND status = 'published'
      AND (config->>'ve_form_id')::uuid = p_ve_id
  ) THEN
    RAISE EXCEPTION 'invalid_assignment_ve_linkage';
  END IF;

  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM group_members gm
      JOIN   assignments a ON a.id = p_assignment_id
      WHERE  gm.student_id = p_student_id
        AND  gm.group_id   = p_group_id
        AND  gm.is_leader  = true
        AND  p_group_id    = ANY(a.group_ids)
        AND  public.is_bootcamp_cohort_member_for_student(p_student_id, a.cohort_ids)
    ) THEN
      RAISE EXCEPTION 'student_access_denied';
    END IF;

    IF cardinality(COALESCE(p_participants, '{}'::uuid[])) = 0 THEN
      RAISE EXCEPTION 'participants_required';
    END IF;

    IF NOT public.valid_group_participants(p_group_id, p_participants) THEN
      RAISE EXCEPTION 'invalid_participants';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM assignments a
      WHERE  a.id = p_assignment_id
        AND  public.is_bootcamp_cohort_member_for_student(p_student_id, a.cohort_ids)
    ) THEN
      RAISE EXCEPTION 'student_access_denied';
    END IF;
  END IF;

  INSERT INTO guided_project_attempts (
    ve_id, student_id, progress, current_module_id, current_lesson_id, completed_at
  ) VALUES (
    p_ve_id, p_student_id, p_progress, p_current_module_id, p_current_lesson_id, v_now
  )
  ON CONFLICT (student_id, ve_id) DO UPDATE SET
    progress          = EXCLUDED.progress,
    current_module_id = EXCLUDED.current_module_id,
    current_lesson_id = EXCLUDED.current_lesson_id,
    completed_at      = v_now,
    updated_at        = v_now;

  IF p_group_id IS NOT NULL THEN
    INSERT INTO assignment_submissions (
      assignment_id, student_id, group_id, submitted_by, participants,
      response_text, status, submitted_at
    ) VALUES (
      p_assignment_id, p_student_id, p_group_id, p_student_id,
      p_participants,
      'Virtual experience completed.', 'submitted', v_now
    )
    ON CONFLICT (group_id, assignment_id) WHERE group_id IS NOT NULL DO UPDATE SET
      submitted_by  = p_student_id,
      participants  = p_participants,
      response_text = 'Virtual experience completed.',
      status        = 'submitted',
      submitted_at  = v_now,
      updated_at    = v_now
    WHERE assignment_submissions.status != 'graded';

    SELECT to_jsonb(s) INTO v_submission
    FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id AND s.group_id = p_group_id;
  ELSE
    INSERT INTO assignment_submissions (
      assignment_id, student_id, response_text, status, submitted_at
    ) VALUES (
      p_assignment_id, p_student_id, 'Virtual experience completed.', 'submitted', v_now
    )
    ON CONFLICT (student_id, assignment_id) WHERE group_id IS NULL DO UPDATE SET
      response_text = 'Virtual experience completed.',
      status        = 'submitted',
      submitted_at  = v_now,
      updated_at    = v_now
    WHERE assignment_submissions.status != 'graded';

    SELECT to_jsonb(s) INTO v_submission
    FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id AND s.student_id = p_student_id AND s.group_id IS NULL;
  END IF;

  RETURN jsonb_build_object('submission', v_submission);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_ve_assignment(
  uuid, uuid, uuid, jsonb, text, text, uuid, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ve_assignment(
  uuid, uuid, uuid, jsonb, text, text, uuid, uuid[]
) TO service_role;


-- ─────────────────────────────────────────────────────────────
--  9. RLS POLICIES
--  All tables exist by this point so forward-references are safe.
--  These are the FINAL policy versions after all migrations.
-- ─────────────────────────────────────────────────────────────

-- ── students (migration 043: instructor = admin) ───────────────
-- Students see only themselves; instructors and admins see everyone.
CREATE POLICY "students: select"
  ON public.students FOR SELECT
  USING (
    (SELECT auth.uid()) = id
    OR (SELECT public.is_instructor_or_admin())
  );

-- Students update their own non-privileged fields.
-- role, status, cohort_id, and original_cohort_id are protected by triggers above.
CREATE POLICY "students: own update"
  ON public.students FOR UPDATE
  USING  ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Instructors and admins can create, update, and delete any student record.
CREATE POLICY "students: instructor insert"
  ON public.students FOR INSERT
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "students: instructor update"
  ON public.students FOR UPDATE
  USING  ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "students: instructor delete"
  ON public.students FOR DELETE
  USING ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "students: staff select"
  ON public.students FOR SELECT
  USING ((SELECT public.is_staff()));

-- ── cohorts (migration 033: require is_instructor_or_admin on writes) ──
CREATE POLICY "cohorts: select"
  ON public.cohorts FOR SELECT
  USING (
    (SELECT public.is_admin())
    OR created_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = cohorts.id
    )
  );

CREATE POLICY "cohorts: instructor insert"
  ON public.cohorts FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "cohorts: instructor update"
  ON public.cohorts FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "cohorts: instructor delete"
  ON public.cohorts FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "cohorts: staff select"
  ON public.cohorts FOR SELECT
  USING ((SELECT public.is_staff()));

-- ── forms (migration 032: owner or admin select; 033: role check on writes) ──
CREATE POLICY "forms: owner select"
  ON public.forms FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );

CREATE POLICY "forms: own insert"
  ON public.forms FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "forms: instructor update"
  ON public.forms FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "forms: instructor delete"
  ON public.forms FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- ── responses ─────────────────────────────────────────────────
CREATE POLICY "responses: enrolled student insert"
  ON public.responses FOR INSERT
  TO authenticated
  WITH CHECK (
    pg_column_size(data) <= 65536
    AND EXISTS (
      SELECT 1 FROM public.forms f
      JOIN  public.students s ON s.cohort_id = ANY(f.cohort_ids)
      WHERE f.id = form_id
        AND s.id = (SELECT auth.uid())
        AND f.status = 'published'
    )
  );

CREATE POLICY "responses: owner select"
  ON public.responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.forms f
      WHERE f.id = form_id AND f.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "responses: staff select"
  ON public.responses FOR SELECT
  USING ((SELECT public.is_staff()));

-- ── courses (migration 046: includes learning_path membership access) ──
CREATE POLICY "courses: participants select"
  ON public.courses FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (status = 'published' AND available_to_everyone)
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND courses.id = ANY(lp.item_ids)
        AND (
          lp.available_to_everyone
          OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
        )
    )
  );

CREATE POLICY "courses: instructor insert"
  ON public.courses FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "courses: instructor update"
  ON public.courses FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "courses: instructor delete"
  ON public.courses FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "courses: staff published select"
  ON public.courses FOR SELECT
  USING ((SELECT public.is_staff()) AND status = 'published');

-- ── events (migration 030) ─────────────────────────────────────
CREATE POLICY "events: participants select"
  ON public.events FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

CREATE POLICY "events: instructor insert"
  ON public.events FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "events: instructor update"
  ON public.events FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "events: instructor delete"
  ON public.events FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "events: staff select"
  ON public.events FOR SELECT
  USING ((SELECT public.is_staff()));

CREATE POLICY "events: staff insert"
  ON public.events FOR INSERT
  WITH CHECK ((SELECT public.is_staff()) AND user_id = (SELECT auth.uid()));

CREATE POLICY "events: staff update"
  ON public.events FOR UPDATE
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

-- ── data_center_datasets (migration 106) ──────────────────────
CREATE POLICY "Students read published data center datasets"
  ON public.data_center_datasets FOR SELECT
  TO authenticated
  USING (is_published = true);

CREATE POLICY "Instructors manage data center datasets"
  ON public.data_center_datasets FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE id = auth.uid() AND role IN ('admin', 'instructor')
    )
  );

CREATE INDEX IF NOT EXISTS idx_data_center_datasets_published_at
  ON public.data_center_datasets (is_published, created_at DESC)
  WHERE is_published = true;

-- partners (migration 141)
CREATE POLICY "Students read active partners"
  ON public.partners FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Instructors manage partners"
  ON public.partners FOR ALL TO authenticated
  USING ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

CREATE INDEX IF NOT EXISTS idx_courses_partner_id
  ON public.courses (partner_id)
  WHERE partner_id IS NOT NULL;

-- ── virtual_experiences (migration 100: remove group_ids check; standalone VEs are cohort-only) ──
-- experience_guides (migrations 162-163)
CREATE POLICY "Guide owners can read"
  ON public.experience_guides FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

CREATE POLICY "Guide owners can insert"
  ON public.experience_guides FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

CREATE POLICY "Guide owners can update"
  ON public.experience_guides FOR UPDATE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

CREATE POLICY "Guide owners can delete"
  ON public.experience_guides FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid()));

CREATE POLICY "virtual_experiences: participants select"
  ON public.virtual_experiences FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (status = 'published' AND available_to_everyone)
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND virtual_experiences.id = ANY(lp.item_ids)
        AND (
          lp.available_to_everyone
          OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
        )
    )
  );

CREATE POLICY "virtual_experiences: instructor insert"
  ON public.virtual_experiences FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "virtual_experiences: instructor update"
  ON public.virtual_experiences FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "virtual_experiences: instructor delete"
  ON public.virtual_experiences FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "virtual_experiences: staff published select"
  ON public.virtual_experiences FOR SELECT
  USING ((SELECT public.is_staff()) AND status = 'published');

-- ── certifications (migration 123) ─────────────────────────────
-- Students do NOT get direct SELECT: `questions` holds answer keys. Student-facing reads go through
-- the service-role API (app/api/certification-attempt). Only owner / admin / staff (published) read here.
CREATE POLICY "certifications: owner admin select"
  ON public.certifications FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

CREATE POLICY "certifications: instructor insert"
  ON public.certifications FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "certifications: instructor update"
  ON public.certifications FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "certifications: instructor delete"
  ON public.certifications FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "certifications: staff published select"
  ON public.certifications FOR SELECT
  USING ((SELECT public.is_staff()) AND status = 'published');

-- ── assignments (migration 097: my_group_ids() helper; 146: students see only published) ──
CREATE POLICY "assignments: select"
  ON public.assignments FOR SELECT
  USING (
    (SELECT public.is_instructor_or_admin())
    OR created_by = (SELECT auth.uid())
    OR (
      status = 'published'
      AND (
        public.is_bootcamp_cohort_member(cohort_ids)
        OR (group_ids && public.my_group_ids())
      )
    )
  );

CREATE POLICY "assignments: instructor insert"
  ON public.assignments FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "assignments: instructor update"
  ON public.assignments FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "assignments: instructor delete"
  ON public.assignments FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "assignments: staff published select"
  ON public.assignments FOR SELECT
  USING ((SELECT public.is_staff()) AND status = 'published');

-- ── assignment_resources ──────────────────────────────────────
-- Students see resources only for a PUBLISHED assignment (migration 148); owner/admin see drafts too.
CREATE POLICY "assignment_resources: select"
  ON public.assignment_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = assignment_id AND (
        a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
        OR (
          a.status = 'published'
          AND public.is_bootcamp_cohort_member(a.cohort_ids)
        )
      )
    )
  );

CREATE POLICY "assignment_resources: instructor manage"
  ON public.assignment_resources FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())))
  );

-- ── assignment_solutions (migration 144) ──────────────────────
CREATE POLICY "assignment_solutions: instructor manage"
  ON public.assignment_solutions FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

-- Any grader (non-owning instructor / staff) may read the model answer while marking.
CREATE POLICY "assignment_solutions: staff read"
  ON public.assignment_solutions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.students
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor','staff')
  ));

-- Students see solutions only once their work is FINAL: graded AND at/above the assignment's passing
-- score (assignment_pass_mark validates config.passingScore -> [1,100] else 85, matching passMarkOf so
-- a failing grade that can still be reset to draft never releases the answer). Group release is limited
-- to the submitter or a member in participants[], never every group member. (migrations 145, 149, 150)
CREATE POLICY "assignment_solutions: released select"
  ON public.assignment_solutions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id
    WHERE s.assignment_id = assignment_solutions.assignment_id
      AND s.status = 'graded'
      AND s.score IS NOT NULL
      AND s.score >= public.assignment_pass_mark(a.config)
      AND (
        s.student_id = (SELECT auth.uid())
        OR (
          s.group_id IS NOT NULL
          AND s.group_id = ANY(public.my_group_ids())
          AND (SELECT auth.uid()) = ANY(s.participants)
        )
      )
  ));

-- ── assignment_answer_keys (migration 142) ────────────────────
-- Owning instructor / admin only. No student policy -> RLS denies students all access.
CREATE POLICY "assignment_answer_keys: instructor manage"
  ON public.assignment_answer_keys FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND (a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

-- ── groups (migration 093) ────────────────────────────────────
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups: staff all"
  ON public.groups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')));

CREATE POLICY "groups: student select own"
  ON public.groups FOR SELECT TO authenticated
  USING (id IN (SELECT group_id FROM public.group_members WHERE student_id = (SELECT auth.uid())));

-- ── group_members (migration 093) ────────────────────────────
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_members: staff all"
  ON public.group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')));

CREATE POLICY "group_members: student select own group"
  ON public.group_members FOR SELECT TO authenticated
  USING (group_id = ANY(public.my_group_ids()));

-- ── assignment_submissions (migration 015 + 093) ──────────────
CREATE POLICY "assignment_submissions: select"
  ON public.assignment_submissions FOR SELECT
  USING (
    student_id = (SELECT auth.uid())
    OR group_id IN (SELECT group_id FROM public.group_members WHERE student_id = (SELECT auth.uid()))
    OR (SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role = 'instructor')
    OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.created_by = (SELECT auth.uid()))
  );

CREATE POLICY "assignment_submissions: student insert"
  ON public.assignment_submissions FOR INSERT
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_submissions.assignment_id
          AND a.status = 'published'
          AND public.is_bootcamp_cohort_member(a.cohort_ids)
          AND assignment_submissions.group_id IS NULL
      )
      OR
      EXISTS (
        SELECT 1 FROM public.group_members gm
        JOIN public.assignments a ON a.id = assignment_submissions.assignment_id
        WHERE gm.student_id = (SELECT auth.uid())
          AND a.status = 'published'
          AND gm.group_id = assignment_submissions.group_id
          AND gm.group_id = ANY(a.group_ids)
          AND gm.is_leader = true
          AND public.valid_group_participants(
            assignment_submissions.group_id,
            assignment_submissions.participants
          )
          AND (
            assignment_submissions.status = 'draft'
            OR cardinality(assignment_submissions.participants) > 0
          )
      )
    )
  );

-- NOTE: Self-referencing subqueries in WITH CHECK cause infinite recursion in Postgres RLS.
-- Protection of graded fields (score, feedback, graded_by, graded_at) is enforced by
-- trg_protect_submission_graded_fields instead.
DROP POLICY IF EXISTS "assignment_submissions: student update" ON public.assignment_submissions;
-- migration 148: student may update only while the assignment is published.
CREATE POLICY "assignment_submissions: student update"
  ON public.assignment_submissions FOR UPDATE
  USING (
    status IN ('draft','submitted')
    AND EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_submissions.assignment_id AND a.status = 'published')
    AND (
      (group_id IS NULL AND student_id = (SELECT auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = assignment_submissions.group_id
          AND student_id = (SELECT auth.uid())
          AND is_leader = true
      )
    )
  )
  WITH CHECK (
    status IN ('draft','submitted')
    AND EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_submissions.assignment_id AND a.status = 'published')
    AND (
      (group_id IS NULL AND student_id = (SELECT auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = assignment_submissions.group_id
          AND student_id = (SELECT auth.uid())
          AND is_leader = true
          AND public.valid_group_participants(
            assignment_submissions.group_id,
            assignment_submissions.participants
          )
          AND (
            assignment_submissions.status = 'draft'
            OR cardinality(assignment_submissions.participants) > 0
          )
      )
    )
  );

CREATE POLICY "assignment_submissions: instructor grade"
  ON public.assignment_submissions FOR UPDATE
  USING (
    (SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role = 'instructor')
    OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.created_by = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role = 'instructor')
    OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.created_by = (SELECT auth.uid()))
  );

-- ── assignment_submission_files ───────────────────────────────
CREATE POLICY "assignment_submission_files: select"
  ON public.assignment_submission_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.assignment_submissions s
      WHERE s.id = submission_id AND (
        s.student_id = (SELECT auth.uid())
        OR (SELECT public.is_admin())
        OR EXISTS (SELECT 1 FROM public.students WHERE id = (SELECT auth.uid()) AND role = 'instructor')
        OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = s.assignment_id AND a.created_by = (SELECT auth.uid()))
      )
    )
  );

CREATE POLICY "assignment_submission_files: student upload"
  ON public.assignment_submission_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assignment_submissions s
      WHERE s.id = submission_id AND s.student_id = (SELECT auth.uid()) AND s.status != 'graded'
    )
  );

CREATE POLICY "assignment_submission_files: student delete own"
  ON public.assignment_submission_files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.assignment_submissions s
      WHERE s.id = submission_id AND s.student_id = (SELECT auth.uid()) AND s.status = 'draft'
    )
  );

-- ── communities (migration 033) ───────────────────────────────
CREATE POLICY "assignment_group_workspaces: staff all"
  ON public.assignment_group_workspaces FOR ALL TO authenticated
  USING ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "assignment_group_workspaces: group members select"
  ON public.assignment_group_workspaces FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = assignment_group_workspaces.group_id
        AND gm.student_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "communities: select"
  ON public.communities FOR SELECT
  USING (
    created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

CREATE POLICY "communities: instructor insert"
  ON public.communities FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "communities: instructor update"
  ON public.communities FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "communities: instructor delete"
  ON public.communities FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- ── announcements (migration 033) ─────────────────────────────
CREATE POLICY "announcements: select"
  ON public.announcements FOR SELECT
  USING (
    author_id = (SELECT auth.uid()) OR (SELECT public.is_admin())
    OR (
      published_at <= now()
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        array_length(cohort_ids, 1) IS NULL OR cohort_ids = '{}'
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
        )
      )
    )
  );

CREATE POLICY "announcements: instructor insert"
  ON public.announcements FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "announcements: instructor update"
  ON public.announcements FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "announcements: instructor delete"
  ON public.announcements FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (author_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- ── schedules (migration 033) ─────────────────────────────────
CREATE POLICY "schedules: select"
  ON public.schedules FOR SELECT
  USING (
    created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

CREATE POLICY "schedules: instructor insert"
  ON public.schedules FOR INSERT
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "schedules: instructor update"
  ON public.schedules FOR UPDATE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

CREATE POLICY "schedules: instructor delete"
  ON public.schedules FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- ── schedule_topics ───────────────────────────────────────────
CREATE POLICY "schedule_topics: select"
  ON public.schedule_topics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_id AND (
        s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
        OR public.is_bootcamp_cohort_member(s.cohort_ids)
      )
    )
  );

CREATE POLICY "schedule_topics: instructor manage"
  ON public.schedule_topics FOR ALL
  USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

-- ── schedule_resources ────────────────────────────────────────
CREATE POLICY "schedule_resources: select"
  ON public.schedule_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_id AND (
        s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
        OR public.is_bootcamp_cohort_member(s.cohort_ids)
      )
    )
  );

CREATE POLICY "schedule_resources: instructor manage"
  ON public.schedule_resources FOR ALL
  USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND (s.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

-- ── cohort_assignments (polymorphic) ──────────────────────────
CREATE POLICY "cohort_assignments: select"
  ON public.cohort_assignments FOR SELECT
  USING (
    (SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND c.created_by = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = cohort_assignments.cohort_id)
  );

CREATE POLICY "cohort_assignments: instructor manage"
  ON public.cohort_assignments FOR ALL
  USING (
    (SELECT public.is_instructor_or_admin())
    AND (
      (SELECT public.is_admin())
      OR EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND c.created_by = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND (
      (SELECT public.is_admin())
      OR EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = cohort_id AND c.created_by = (SELECT auth.uid()))
    )
  );

-- ── learning_paths ────────────────────────────────────────────
CREATE POLICY "instructors_manage_own_paths"
  ON public.learning_paths FOR ALL
  USING (instructor_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  WITH CHECK (instructor_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

CREATE POLICY "students_read_published_paths"
  ON public.learning_paths FOR SELECT
  USING (
    status = 'published'
    AND (
      available_to_everyone
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
      )
    )
  );

CREATE POLICY "learning_paths: staff published select"
  ON public.learning_paths FOR SELECT
  USING ((SELECT public.is_staff()) AND status = 'published');

-- ── course_attempts ───────────────────────────────────────────
CREATE POLICY "students_read_own_attempts"
  ON public.course_attempts FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "course_attempts: instructor read"
  ON public.course_attempts FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "course_attempts: staff select"
  ON public.course_attempts FOR SELECT
  USING ((SELECT public.is_staff()));

CREATE POLICY "course_attempts: student insert"
  ON public.course_attempts FOR INSERT
  WITH CHECK (student_id = (SELECT auth.uid()));

CREATE POLICY "course_attempts: student update"
  ON public.course_attempts FOR UPDATE
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ── certification_attempts (migration 123) ────────────────────
-- Students READ their own rows only. NO student INSERT/UPDATE: all attempt writes go through the
-- service-role API (app/api/certification-attempt), so passed/score/completed_at cannot be tampered.
-- Read of answers/proctor is scoped to the certification's OWNER (and admin), not every instructor.
CREATE POLICY "certification_attempts: owner read"
  ON public.certification_attempts FOR SELECT
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.certifications c
      WHERE c.id = certification_attempts.certification_id AND c.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "certification_attempts: student read"
  ON public.certification_attempts FOR SELECT
  USING (student_id = (SELECT auth.uid()));

-- ── guided_project_attempts ───────────────────────────────────
CREATE POLICY "student_own"
  ON public.guided_project_attempts FOR ALL
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "guided_project_attempts: instructor read"
  ON public.guided_project_attempts FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "guided_project_attempts: staff select"
  ON public.guided_project_attempts FOR SELECT
  USING ((SELECT public.is_staff()));

-- ── student_xp ────────────────────────────────────────────────
CREATE POLICY "students_read_own_xp"
  ON public.student_xp FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "student_xp: instructor read"
  ON public.student_xp FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "student_xp: staff select"
  ON public.student_xp FOR SELECT
  USING ((SELECT public.is_staff()));

-- ── certificates ──────────────────────────────────────────────
CREATE POLICY "certificates: public select"
  ON public.certificates FOR SELECT
  USING (true);

CREATE POLICY "certificates_owner_write"
  ON public.certificates FOR ALL
  USING (
    course_id IN (SELECT id FROM public.courses WHERE user_id = (SELECT auth.uid()))
    OR learning_path_id IN (SELECT id FROM public.learning_paths WHERE instructor_id = (SELECT auth.uid()))
  );

CREATE POLICY "certificates_student_read"
  ON public.certificates FOR SELECT
  USING (student_id = (SELECT auth.uid()));

-- ── certificate_defaults ──────────────────────────────────────
CREATE POLICY "certificate_defaults: own"
  ON public.certificate_defaults FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── event_registrations (migration 043) ───────────────────────
CREATE POLICY "event_registrations: select"
  ON public.event_registrations FOR SELECT
  USING (
    student_id = (SELECT auth.uid())
    OR (SELECT public.is_instructor_or_admin())
  );

CREATE POLICY "event_registrations: student insert"
  ON public.event_registrations FOR INSERT
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
        AND public.is_bootcamp_cohort_member(e.cohort_ids)
        AND (
          e.capacity IS NULL
          OR (SELECT COUNT(*) FROM public.event_registrations er WHERE er.event_id = e.id) < e.capacity
        )
    )
  );

CREATE POLICY "event_registrations: instructor manage"
  ON public.event_registrations FOR ALL
  USING  ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "event_registrations: staff select"
  ON public.event_registrations FOR SELECT
  USING ((SELECT public.is_staff()));

CREATE POLICY "live_attendance: student select"
  ON public.live_attendance FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "live_attendance: instructor select"
  ON public.live_attendance FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));

CREATE POLICY "live_attendance: staff select"
  ON public.live_attendance FOR SELECT
  USING ((SELECT public.is_staff()));

-- recordings
CREATE POLICY "recordings: select"
  ON public.recordings FOR SELECT
  USING (
    created_by = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

CREATE POLICY "recordings: instructor insert"
  ON public.recordings FOR INSERT
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())));

CREATE POLICY "recordings: instructor update"
  ON public.recordings FOR UPDATE
  USING ((SELECT public.is_instructor_or_admin()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())));

CREATE POLICY "recordings: instructor delete"
  ON public.recordings FOR DELETE
  USING ((SELECT public.is_instructor_or_admin()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())));

CREATE POLICY "recordings: staff select"
  ON public.recordings FOR SELECT
  USING ((SELECT public.is_staff()));

CREATE POLICY "recordings: staff insert"
  ON public.recordings FOR INSERT
  WITH CHECK ((SELECT public.is_staff()) AND created_by = (SELECT auth.uid()));

CREATE POLICY "recordings: staff update"
  ON public.recordings FOR UPDATE
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

CREATE POLICY "recording_entries: select"
  ON public.recording_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.recordings r
      WHERE r.id = recording_id
        AND (
          r.created_by = (SELECT auth.uid())
          OR (SELECT public.is_admin())
          OR public.is_bootcamp_cohort_member(r.cohort_ids)
        )
    )
  );

CREATE POLICY "recording_entries: instructor manage"
  ON public.recording_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.recordings r WHERE r.id = recording_id AND (r.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recordings r WHERE r.id = recording_id AND (r.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

CREATE POLICY "recording_entries: staff select"
  ON public.recording_entries FOR SELECT
  USING ((SELECT public.is_staff()));

CREATE POLICY "recording_entries: staff manage"
  ON public.recording_entries FOR ALL
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

-- ── sent_nudges ───────────────────────────────────────────────
-- No client read access — server-side only (service role)
-- No RLS policies needed for client; service role bypasses RLS

-- ── learning_path_progress ────────────────────────────────────
CREATE POLICY "students_read_own_progress"
  ON public.learning_path_progress FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "students_insert_own_progress"
  ON public.learning_path_progress FOR INSERT
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.learning_paths lp
      JOIN  public.students s ON s.id = (SELECT auth.uid())
      WHERE lp.id = learning_path_id
        AND lp.status = 'published'
        AND s.cohort_id = ANY(lp.cohort_ids)
    )
  );

CREATE POLICY "instructors_read_path_progress"
  ON public.learning_path_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.id = learning_path_id AND lp.instructor_id = (SELECT auth.uid())
    )
  );

-- ── meeting_integrations ──────────────────────────────────────
CREATE POLICY "meeting_integrations: own"
  ON public.meeting_integrations FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));


-- ── site_settings ─────────────────────────────────────────────
CREATE POLICY "public_read_site_settings"
  ON public.site_settings FOR SELECT
  USING (true);

CREATE POLICY "admin_write_site_settings"
  ON public.site_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = auth.uid()
        AND students.role IN ('admin', 'instructor')
    )
  );

-- ── tool_icons ─────────────────────────────────────
-- Readable signed in or not: these logos render on the public landing page and on public
-- profile pages, and a logo attached to a tool name reveals nothing about a learner, a cohort
-- or unpublished content.
CREATE POLICY "tool_icons: public select"
  ON public.tool_icons FOR SELECT
  USING (true);

CREATE POLICY "tool_icons: staff write"
  ON public.tool_icons FOR ALL
  USING ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

GRANT SELECT ON public.tool_icons TO anon, authenticated;

INSERT INTO public.site_settings (singleton, template, config)
VALUES (true, 'momentum', '{}')
ON CONFLICT (singleton) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
--  10. INDEXES
-- ─────────────────────────────────────────────────────────────

-- students
CREATE INDEX idx_students_email      ON public.students(email);
CREATE INDEX idx_students_role       ON public.students(role);
CREATE INDEX idx_students_status     ON public.students(status);
CREATE INDEX idx_students_cohort     ON public.students(cohort_id);
-- Leaderboard composite (migration 045)
CREATE INDEX idx_students_cohort_role ON public.students(cohort_id, role) WHERE role = 'student';

-- cohorts
CREATE INDEX idx_cohorts_created_by  ON public.cohorts(created_by);
CREATE INDEX idx_cohorts_status      ON public.cohorts(status);

-- forms
CREATE INDEX idx_forms_user_id   ON public.forms(user_id);
CREATE INDEX idx_forms_slug      ON public.forms(slug);
CREATE INDEX idx_forms_cohort_ids ON public.forms USING GIN (cohort_ids);

-- responses
CREATE INDEX idx_responses_form_id ON public.responses(form_id);

-- courses
CREATE INDEX idx_courses_user_id   ON public.courses(user_id);
CREATE INDEX idx_courses_slug      ON public.courses(slug);
CREATE INDEX idx_courses_status    ON public.courses(status);
CREATE INDEX idx_courses_cohort_ids ON public.courses USING GIN (cohort_ids);

-- events
CREATE INDEX idx_events_user_id    ON public.events(user_id);
CREATE INDEX idx_events_slug       ON public.events(slug);
CREATE INDEX idx_events_status     ON public.events(status);
CREATE INDEX idx_events_event_date ON public.events(event_date);
CREATE INDEX idx_events_cohort_ids ON public.events USING GIN (cohort_ids);

-- virtual_experiences
CREATE INDEX idx_ve_user_id    ON public.virtual_experiences(user_id);
CREATE INDEX idx_ve_slug       ON public.virtual_experiences(slug);
CREATE INDEX idx_ve_status     ON public.virtual_experiences(status);
CREATE INDEX idx_ve_cohort_ids ON public.virtual_experiences USING GIN (cohort_ids);

-- assignments
CREATE INDEX idx_assignments_created_by     ON public.assignments(created_by);
CREATE INDEX idx_assignments_related_course ON public.assignments(related_course);
CREATE INDEX idx_assignments_status         ON public.assignments(status);
CREATE INDEX idx_assignments_cohort_ids     ON public.assignments USING GIN (cohort_ids);

-- groups / group_members
CREATE INDEX idx_groups_cohort_id         ON public.groups(cohort_id);
CREATE INDEX idx_group_members_group_id   ON public.group_members(group_id);

-- assignment_resources / solutions / submissions
CREATE INDEX idx_assignment_resources_assignment ON public.assignment_resources(assignment_id);
CREATE INDEX idx_assignment_solutions_assignment ON public.assignment_solutions(assignment_id);
CREATE INDEX idx_assignment_submissions_student    ON public.assignment_submissions(student_id);
CREATE INDEX idx_assignment_submissions_assignment ON public.assignment_submissions(assignment_id);
CREATE INDEX idx_assignment_submissions_status     ON public.assignment_submissions(status);
CREATE INDEX idx_assignment_submissions_group      ON public.assignment_submissions(group_id);
CREATE INDEX idx_asub_files_submission ON public.assignment_submission_files(submission_id);
CREATE INDEX idx_assignment_group_workspaces_lookup ON public.assignment_group_workspaces(assignment_id, group_id);

-- communities / announcements
CREATE INDEX idx_communities_created_by ON public.communities(created_by);
CREATE INDEX idx_communities_cohort_ids ON public.communities USING GIN (cohort_ids);
CREATE INDEX idx_announcements_author   ON public.announcements(author_id);
CREATE INDEX idx_announcements_pinned   ON public.announcements(is_pinned);
CREATE INDEX idx_announcements_expires  ON public.announcements(expires_at);
CREATE INDEX idx_announcements_cohort_ids ON public.announcements USING GIN (cohort_ids);

-- schedules
CREATE INDEX idx_schedules_course      ON public.schedules(course_id);
CREATE INDEX idx_schedules_created_by  ON public.schedules(created_by);
CREATE INDEX idx_schedules_cohort_ids  ON public.schedules USING GIN (cohort_ids);
CREATE INDEX idx_schedule_topics_schedule ON public.schedule_topics(schedule_id, order_index);
CREATE INDEX idx_schedule_resources_schedule ON public.schedule_resources(schedule_id);

-- cohort_assignments
CREATE INDEX idx_cohort_assignments_cohort  ON public.cohort_assignments(cohort_id);
CREATE INDEX idx_cohort_assignments_content ON public.cohort_assignments(content_type, content_id);

-- learning_paths (migrations 023 + 046)
CREATE INDEX idx_lp_instructor ON public.learning_paths(instructor_id);
CREATE INDEX idx_lp_status     ON public.learning_paths(status);
CREATE INDEX idx_lp_item_ids   ON public.learning_paths USING GIN(item_ids);
CREATE INDEX idx_lp_cohort_ids ON public.learning_paths USING GIN(cohort_ids);
CREATE INDEX idx_lp_published  ON public.learning_paths(status) WHERE status = 'published';

-- course_attempts (migrations 016 + 031 + 045)
CREATE INDEX idx_ca_course         ON public.course_attempts(course_id);
CREATE INDEX idx_ca_student        ON public.course_attempts(student_id);
CREATE INDEX idx_ca_active         ON public.course_attempts(student_id, course_id, completed_at);
CREATE INDEX idx_ca_student_course ON public.course_attempts(student_id, course_id);
-- Leaderboard (migration 045)
CREATE INDEX idx_ca_completions    ON public.course_attempts(student_id, passed, completed_at)
  WHERE passed = true AND completed_at IS NOT NULL;
-- One active attempt per student per course (migration 063)
-- Fresh schema has no duplicates so no cleanup needed here (cleanup is in the migration).
CREATE UNIQUE INDEX idx_ca_one_active_per_student ON public.course_attempts(student_id, course_id)
  WHERE completed_at IS NULL;

-- guided_project_attempts (migration 031)
CREATE UNIQUE INDEX guided_project_attempts_uniq ON public.guided_project_attempts(student_id, ve_id);
CREATE INDEX guided_project_attempts_ve_id_idx   ON public.guided_project_attempts(ve_id);

-- certificates
CREATE INDEX idx_certificates_student   ON public.certificates(student_id);
CREATE INDEX idx_certificates_course_id ON public.certificates(course_id);

-- event_registrations
CREATE INDEX idx_event_registrations_student ON public.event_registrations(student_id);
CREATE INDEX idx_event_registrations_event   ON public.event_registrations(event_id);

-- live_attendance (migration 112)
CREATE INDEX idx_live_attendance_event_id   ON public.live_attendance(event_id);
CREATE INDEX idx_live_attendance_student_id ON public.live_attendance(student_id);

-- recording_entries (migration 112)
CREATE INDEX idx_recording_entries_recording_id ON public.recording_entries(recording_id);

-- recordings (migration 112)
CREATE INDEX idx_recordings_status     ON public.recordings(status);
CREATE INDEX idx_recordings_cohort_ids ON public.recordings USING GIN (cohort_ids);

-- certificates (migration 112)
CREATE INDEX idx_certificates_ve_id            ON public.certificates(ve_id);
CREATE INDEX idx_certificates_learning_path_id ON public.certificates(learning_path_id);

-- announcements (migration 112)
CREATE INDEX idx_announcements_published_at ON public.announcements(published_at);

-- sent_nudges (migration 016)
CREATE INDEX sent_nudges_lookup ON public.sent_nudges(student_id, nudge_type, sent_at);

-- learning_path_progress
CREATE INDEX idx_lpp_student ON public.learning_path_progress(student_id);
CREATE INDEX idx_lpp_path    ON public.learning_path_progress(learning_path_id);

-- meeting_integrations
CREATE INDEX idx_meeting_integrations_user ON public.meeting_integrations(user_id);


-- site_settings (no additional indexes needed — singleton table)


-- ─────────────────────────────────────────────────────────────
--  11. STORAGE BUCKETS + POLICIES (migration 008 + 044 + 144)
-- ─────────────────────────────────────────────────────────────

-- Create buckets. 'assignment-solutions' is PRIVATE (migration 144) and deliberately has no
-- storage.objects policy: instructor uploads and released-student downloads both go through API
-- routes on the service role, so no authenticated client can reach a model answer directly.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('form-assets',          'form-assets',          true),
  ('cert-assets',          'cert-assets',          true),
  ('datasets',             'datasets',             true),
  ('assignment-solutions', 'assignment-solutions', false)
ON CONFLICT (id) DO NOTHING;

-- ── form-assets ───────────────────────────────────────────────
CREATE POLICY "Public read form-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'form-assets');

-- Executable lesson-html namespace is instructor/admin-only (migration 137).
-- Role check inlined -- function calls in storage policies can be unreliable.
CREATE POLICY "Auth users upload form-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'form-assets'
    AND (
      name NOT LIKE 'lesson-html/%'
      OR EXISTS (
        SELECT 1 FROM public.students
        WHERE id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor')
      )
    )
  );

-- Only file owner can update/delete (migration 008 security fix)
CREATE POLICY "Auth users update form-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'form-assets' AND owner = (SELECT auth.uid()))
  WITH CHECK (
    bucket_id = 'form-assets'
    AND owner = (SELECT auth.uid())
    AND (
      name NOT LIKE 'lesson-html/%'
      OR EXISTS (
        SELECT 1 FROM public.students
        WHERE id = (SELECT auth.uid())
          AND role IN ('admin', 'instructor')
      )
    )
  );

CREATE POLICY "Auth users delete form-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'form-assets' AND owner = (SELECT auth.uid()));

-- ── cert-assets ───────────────────────────────────────────────
CREATE POLICY "Public read cert-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cert-assets');

-- Only instructors and admins may upload certificate assets (backgrounds, logos, signatures)
CREATE POLICY "Instructors upload cert-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cert-assets'
    AND EXISTS (
      SELECT 1 FROM public.students
      WHERE id = auth.uid() AND role IN ('admin','instructor')
    )
  );

CREATE POLICY "Instructors update cert-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cert-assets' AND owner = auth.uid());

CREATE POLICY "Instructors delete cert-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cert-assets' AND owner = auth.uid());

-- ── datasets (migration 044) ──────────────────────────────────
-- Inline role checks (custom function calls in storage policies can be unreliable)
CREATE POLICY "Instructors upload datasets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'datasets'
    AND EXISTS (
      SELECT 1 FROM public.students
      WHERE id = auth.uid() AND role IN ('admin','instructor')
    )
  );

CREATE POLICY "Owners read datasets"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'datasets' AND owner = auth.uid());

CREATE POLICY "Instructors update datasets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'datasets' AND owner = auth.uid());

CREATE POLICY "Instructors delete datasets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'datasets' AND owner = auth.uid());


-- ── platform_settings (branding customization) ───────────────
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id              text PRIMARY KEY DEFAULT 'default',
  app_name        text,
  org_name        text,
  app_url         text,
  logo_url        text,
  logo_dark_url   text,
  brand_color     text,
  sender_name     text,
  team_name       text,
  support_email   text,
  app_description text,
  favicon_url       text,
  email_banner_url  text,
  whatsapp_community_url text,
  -- migration 183. Off by default: deploying the column opens nothing, and turning it back off
  -- closes public signups again with no deploy. app/auth/callback reads it per request.
  public_signup_enabled boolean NOT NULL DEFAULT false,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- migration 052 split the original single "instructor_or_admin" ALL policy in two. Branding
-- (logo, colours, app name) has to be readable by an unauthenticated visitor or the login page
-- renders with the wrong identity, so SELECT is public while writes stay restricted. The fresh
-- schema carried the pre-052 version, which made a new deploy behave differently from every
-- migrated one.
CREATE POLICY "platform_settings: public select"
  ON public.platform_settings FOR SELECT
  USING (true);

CREATE POLICY "platform_settings: instructor or admin write"
  ON public.platform_settings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.students
    WHERE students.id = auth.uid()
    AND students.role IN ('admin', 'instructor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.students
    WHERE students.id = auth.uid()
    AND students.role IN ('admin', 'instructor')
  ));

-- ── payment_config (global payment behaviour settings) ────────
CREATE TABLE IF NOT EXISTS public.payment_config (
  id                    text PRIMARY KEY DEFAULT 'default',
  outstanding_cohort_id uuid REFERENCES public.cohorts(id),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "instructor_or_admin" ON public.payment_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.students
    WHERE students.id = auth.uid()
    AND students.role IN ('admin', 'instructor')
  ));

INSERT INTO public.payment_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
--  Cohort email allowlist
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.cohort_allowed_emails (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id  uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  added_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_allowed_emails_email_lower CHECK (email = lower(email)),
  UNIQUE (email)
);

ALTER TABLE public.cohort_allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cohort_allowed_emails: instructor manage"
  ON public.cohort_allowed_emails FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.students
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.students
    WHERE id = (SELECT auth.uid()) AND role IN ('admin','instructor')
  ));

CREATE INDEX idx_cohort_allowed_emails_cohort ON public.cohort_allowed_emails(cohort_id);
CREATE INDEX idx_cohort_allowed_emails_email  ON public.cohort_allowed_emails(email);

CREATE OR REPLACE FUNCTION public.check_email_allowlist(p_email text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT cohort_id FROM public.cohort_allowed_emails
  WHERE email = lower(p_email)
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.check_email_allowlist(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_email_allowlist(text) TO service_role;



-- ─────────────────────────────────────────────────────────────
--  Migration 069: Enrollment + Payments tables (hardened)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.cohort_payment_settings (
  cohort_id                   uuid          PRIMARY KEY REFERENCES public.cohorts(id) ON DELETE CASCADE,
  total_fee                   numeric(10,2) NOT NULL CHECK (total_fee > 0),
  currency                    text          NOT NULL DEFAULT 'GHS',
  deposit_percent             numeric(5,2)  NOT NULL DEFAULT 50
                                            CHECK (deposit_percent BETWEEN 0 AND 100),
  payment_plan                text          NOT NULL DEFAULT 'flexible'
                                            CHECK (payment_plan IN ('full','flexible','sponsored','waived')),
  installment_count           integer       NOT NULL DEFAULT 3 CHECK (installment_count >= 3),
  post_bootcamp_access_months integer       NOT NULL DEFAULT 3 CHECK (post_bootcamp_access_months >= 0),
  grace_period_days           integer       DEFAULT NULL CHECK (grace_period_days IS NULL OR (grace_period_days >= 0 AND grace_period_days <= 365)),
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.cohort_payment_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cohort_payment_settings: instructor read"
  ON public.cohort_payment_settings FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "cohort_payment_settings: instructor write"
  ON public.cohort_payment_settings FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE TRIGGER trg_cohort_payment_settings_updated_at
  BEFORE UPDATE ON public.cohort_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.bootcamp_enrollments (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL until student signs up; set by auth/callback via activateEnrollment
  student_id           uuid          REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id            uuid          NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  email                text          NOT NULL CHECK (email = lower(email)),
  full_name            text,
  total_fee            numeric(10,2) NOT NULL CHECK (total_fee > 0),
  currency             text          NOT NULL DEFAULT 'GHS',
  payment_plan         text          NOT NULL
                                     CHECK (payment_plan IN ('full','flexible','sponsored','waived')),
  deposit_required     numeric(10,2) NOT NULL CHECK (deposit_required >= 0),
  amount_paid_initial  numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid_initial >= 0),
  paid_at              date,
  payment_method       text,
  payment_reference    text,
  notes                text,
  paid_total           numeric(10,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  access_status        text          NOT NULL DEFAULT 'pending_deposit'
                                     CHECK (access_status IN
                                       ('pending_deposit','active','overdue','completed','expired','waived')),
  access_until         date,
  bootcamp_starts_at   date,
  bootcamp_ends_at     date,
  -- Set when a student is explicitly removed from their cohort. The row is kept as
  -- financial history with student_id intact; payment enforcement skips released rows.
  released_at          timestamptz,
  -- Overdue notice delivery, per episode, at most once (migration 181). An episode is the due
  -- date of the installment that caused it: matching for_due_date means this student has been
  -- told and never will be again for that debt, while a later installment falling due is a new
  -- episode and notifiable. The claim is taken before the send so two workers cannot both mail,
  -- and carries a token so a stalled worker cannot act on the claim that replaced it.
  -- send_started_for_due_date is written before Resend is contacted: still set when a later
  -- worker claims, the outcome was never recorded, and that episode is finalized without sending.
  overdue_notice_for_due_date              date,
  overdue_notice_claimed_at                timestamptz,
  overdue_notice_claim_token               uuid,
  overdue_notice_send_started_for_due_date date,
  overdue_notice_attempts                  integer     NOT NULL DEFAULT 0,
  overdue_notice_attempted_for_due_date    date,
  overdue_notice_last_error                text,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.bootcamp_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bootcamp_enrollments: instructor all"
  ON public.bootcamp_enrollments FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "bootcamp_enrollments: student read own"
  ON public.bootcamp_enrollments FOR SELECT
  USING (student_id = (SELECT auth.uid()));
-- One enrollment per student per cohort (post-signup)
CREATE UNIQUE INDEX idx_bootcamp_enrollments_student_cohort
  ON public.bootcamp_enrollments(student_id, cohort_id)
  WHERE student_id IS NOT NULL;
-- One admission record per email per cohort
CREATE UNIQUE INDEX idx_bootcamp_enrollments_email_cohort
  ON public.bootcamp_enrollments(lower(email), cohort_id);
CREATE INDEX idx_bootcamp_enrollments_email   ON public.bootcamp_enrollments(lower(email));
CREATE INDEX idx_bootcamp_enrollments_student ON public.bootcamp_enrollments(student_id);
CREATE INDEX idx_bootcamp_enrollments_cohort  ON public.bootcamp_enrollments(cohort_id);
CREATE INDEX idx_bootcamp_enrollments_status  ON public.bootcamp_enrollments(access_status);
CREATE INDEX idx_bootcamp_enrollments_released ON public.bootcamp_enrollments(released_at)
  WHERE released_at IS NULL;
CREATE TRIGGER trg_bootcamp_enrollments_updated_at
  BEFORE UPDATE ON public.bootcamp_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payment_installments (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid          NOT NULL REFERENCES public.bootcamp_enrollments(id) ON DELETE CASCADE,
  due_date      date          NOT NULL,
  amount_due    numeric(10,2) NOT NULL CHECK (amount_due > 0),
  amount_paid   numeric(10,2) NOT NULL DEFAULT 0
                              CHECK (amount_paid >= 0 AND amount_paid <= amount_due),
  status        text          NOT NULL DEFAULT 'unpaid'
                              CHECK (status IN ('unpaid','partial','paid','waived')),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_installments: instructor all"
  ON public.payment_installments FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "payment_installments: student read own"
  ON public.payment_installments FOR SELECT
  USING (
    enrollment_id IN (
      SELECT id FROM public.bootcamp_enrollments WHERE student_id = (SELECT auth.uid())
    )
  );
CREATE INDEX idx_payment_installments_enrollment ON public.payment_installments(enrollment_id);
CREATE INDEX idx_payment_installments_due_date   ON public.payment_installments(due_date);
CREATE TRIGGER trg_payment_installments_updated_at
  BEFORE UPDATE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payments (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   uuid          REFERENCES public.bootcamp_enrollments(id)        ON DELETE SET NULL,
  student_id      uuid          REFERENCES public.students(id)                    ON DELETE SET NULL,
  payer_email     text          NOT NULL,
  cohort_id       uuid          NOT NULL REFERENCES public.cohorts(id)            ON DELETE RESTRICT,
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  paid_at         date          NOT NULL DEFAULT current_date,
  method          text,
  reference       text,
  notes           text,
  confirmation_id uuid,
  created_at      timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments: instructor all"
  ON public.payments FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "payments: student read own"
  ON public.payments FOR SELECT
  USING (student_id = (SELECT auth.uid()));
CREATE INDEX idx_payments_enrollment_id ON public.payments(enrollment_id);
CREATE INDEX idx_payments_student_id    ON public.payments(student_id);
CREATE INDEX idx_payments_payer_email   ON public.payments(lower(payer_email));
CREATE INDEX idx_payments_cohort_id     ON public.payments(cohort_id);

-- ─────────────────────────────────────────────────────────────
--  Migration 072: payment_options + student_payment_confirmations
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.payment_options (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text        NOT NULL,
  type                text        NOT NULL DEFAULT 'bank_transfer'
                                    CHECK (type IN ('bank_transfer', 'mobile_money', 'online')),
  instructions        text,
  -- bank_transfer fields
  bank_name           text,
  account_name        text,
  account_number      text,
  branch              text,
  country             text,
  -- mobile_money fields
  mobile_money_number text,
  network             text,
  -- online fields
  payment_link        text,
  platform            text,
  -- shared
  logo_url            text,
  is_active           boolean     NOT NULL DEFAULT true,
  sort_order          integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_options: student read active"
  ON public.payment_options FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.students WHERE id = auth.uid()
    )
  );
CREATE POLICY "payment_options: instructor all"
  ON public.payment_options FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE TRIGGER trg_payment_options_updated_at
  BEFORE UPDATE ON public.payment_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.student_payment_confirmations (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid          NOT NULL REFERENCES public.bootcamp_enrollments(id) ON DELETE CASCADE,
  student_id    uuid          NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id     uuid          NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  paid_at       date          NOT NULL,
  method        text,
  reference     text,
  notes         text,
  receipt_url   text,
  status        text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   uuid          REFERENCES public.students(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  admin_notes   text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.student_payment_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_payment_confirmations: student insert own"
  ON public.student_payment_confirmations FOR INSERT
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND enrollment_id IN (
      SELECT id FROM public.bootcamp_enrollments
      WHERE student_id = (SELECT auth.uid())
    )
    AND cohort_id = (
      SELECT cohort_id FROM public.bootcamp_enrollments
      WHERE id = enrollment_id
        AND student_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "student_payment_confirmations: student read own"
  ON public.student_payment_confirmations FOR SELECT
  USING (student_id = (SELECT auth.uid()));
CREATE POLICY "student_payment_confirmations: instructor all"
  ON public.student_payment_confirmations FOR ALL
  USING ((SELECT public.is_instructor_or_admin()));
CREATE TRIGGER trg_student_payment_confirmations_updated_at
  BEFORE UPDATE ON public.student_payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_spc_enrollment ON public.student_payment_confirmations(enrollment_id);
CREATE INDEX idx_spc_student    ON public.student_payment_confirmations(student_id);
CREATE INDEX idx_spc_status     ON public.student_payment_confirmations(status);

-- Deferred FK: payments.confirmation_id -> student_payment_confirmations
-- Must come after student_payment_confirmations is created.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_confirmation_id_fk
  FOREIGN KEY (confirmation_id)
  REFERENCES public.student_payment_confirmations(id)
  ON DELETE SET NULL;
CREATE UNIQUE INDEX payments_confirmation_id_unique
  ON public.payments (confirmation_id)
  WHERE confirmation_id IS NOT NULL;
CREATE INDEX idx_spc_cohort     ON public.student_payment_confirmations(cohort_id);

-- ─────────────────────────────────────────────────────────────
--  DONE — this is the only SQL file you need to run.
--
-- ── 083_badges ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badges (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  description text        NOT NULL,
  icon        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#6366f1'
);

INSERT INTO public.badges (id, name, description, icon, color) VALUES
  ('course_5',   '5 Course Milestone',    'Earned after completing 5 courses on the platform',          '🥉', '#3b82f6'),
  ('course_10',  '10 Course Milestone',   'Earned after completing 10 courses',                         '🥈', '#f59e0b'),
  ('course_25',  '25 Course Milestone',   'Earned after completing 25 courses on the platform',         '🥇', '#ef4444'),
  ('streak_7',   '7-Day Learning Streak', 'Awarded for a 7-day consecutive learning streak',            '🔥', '#f97316'),
  ('streak_14',  '14-Day Learning Streak','Awarded for a 14-day continuous learning streak',            '⚡', '#eab308'),
  ('streak_30',  '30-Day Learning Streak','Awarded for maintaining a 30-day continuous learning streak','🌟', '#8b5cf6'),
  ('streak_90',  '90-Day Learning Streak','Awarded for maintaining a 90-day learning streak',           '💎', '#6366f1'),
  ('streak_180', '180-Day Learning Streak','Awarded for maintaining a 180-day learning streak',         '👑', '#10b981'),
  ('streak_365', '365-Day Learning Streak','Awarded for maintaining a full-year learning streak',       '🏆', '#7c3aed')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.student_badges (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  badge_id   text        NOT NULL REFERENCES public.badges(id),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, badge_id)
);

CREATE TABLE IF NOT EXISTS public.student_streaks (
  student_id         uuid    PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  current_streak     integer NOT NULL DEFAULT 0,
  longest_streak     integer NOT NULL DEFAULT 0,
  last_activity_date date,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.badges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_badges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_public_read"              ON public.badges          FOR SELECT USING (true);
CREATE POLICY "student_badges_own_read"         ON public.student_badges  FOR SELECT USING (student_id = (SELECT auth.uid()));
CREATE POLICY "student_badges_instructor_read"  ON public.student_badges  FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "student_streaks_own_read"        ON public.student_streaks FOR SELECT USING (student_id = (SELECT auth.uid()));
CREATE POLICY "student_streaks_instructor_read" ON public.student_streaks FOR SELECT USING ((SELECT public.is_instructor_or_admin()));

CREATE OR REPLACE FUNCTION public.update_student_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last_date date; v_today date := CURRENT_DATE; v_current integer; v_longest integer;
BEGIN
  IF NEW.last_login_at IS NOT DISTINCT FROM OLD.last_login_at THEN RETURN NEW; END IF;
  SELECT last_activity_date, current_streak, longest_streak INTO v_last_date, v_current, v_longest
    FROM public.student_streaks WHERE student_id = NEW.id;
  IF NOT FOUND THEN
    INSERT INTO public.student_streaks (student_id, current_streak, longest_streak, last_activity_date) VALUES (NEW.id, 1, 1, v_today);
    RETURN NEW;
  END IF;
  IF v_last_date = v_today THEN RETURN NEW;
  ELSIF v_last_date = v_today - 1 THEN v_current := v_current + 1; v_longest := GREATEST(v_longest, v_current);
  ELSE v_current := 1;
  END IF;
  UPDATE public.student_streaks SET current_streak = v_current, longest_streak = v_longest, last_activity_date = v_today, updated_at = now() WHERE student_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_student_streak ON public.students;
CREATE TRIGGER trg_update_student_streak AFTER UPDATE OF last_login_at ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_student_streak();

CREATE OR REPLACE FUNCTION public.check_and_award_badges(p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_completed integer; v_streak integer;
BEGIN
  SELECT COUNT(*) INTO v_completed FROM public.course_attempts WHERE student_id = p_student_id AND completed_at IS NOT NULL;
  SELECT COALESCE(current_streak, 0) INTO v_streak FROM public.student_streaks WHERE student_id = p_student_id;
  IF v_completed >= 5   THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'course_5')    ON CONFLICT DO NOTHING; END IF;
  IF v_completed >= 10  THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'course_10')   ON CONFLICT DO NOTHING; END IF;
  IF v_completed >= 25  THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'course_25')   ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 7   THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_7')   ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 14  THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_14')  ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 30  THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_30')  ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 90  THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_90')  ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 180 THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_180') ON CONFLICT DO NOTHING; END IF;
  IF v_streak >= 365 THEN INSERT INTO public.student_badges (student_id, badge_id) VALUES (p_student_id, 'streak_365') ON CONFLICT DO NOTHING; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_check_badges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.check_and_award_badges(COALESCE(NEW.student_id, OLD.student_id)); RETURN COALESCE(NEW, OLD); END;
$$;

DROP TRIGGER IF EXISTS trg_check_badges_on_attempt ON public.course_attempts;
CREATE TRIGGER trg_check_badges_on_attempt AFTER INSERT OR UPDATE ON public.course_attempts FOR EACH ROW EXECUTE FUNCTION public.trg_check_badges();

CREATE OR REPLACE FUNCTION public.trg_check_badges_on_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.check_and_award_badges(NEW.student_id); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_check_badges_on_streak ON public.student_streaks;
CREATE TRIGGER trg_check_badges_on_streak AFTER INSERT OR UPDATE ON public.student_streaks FOR EACH ROW EXECUTE FUNCTION public.trg_check_badges_on_streak();

-- ── 084_badges_image_url ────────────────────────────────────────────────────
ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS image_url text;

CREATE POLICY "badges_instructor_update"
  ON public.badges FOR UPDATE
  USING ((SELECT public.is_instructor_or_admin()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()));

-- ── 085_badges_category ─────────────────────────────────────────────────────
ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'achievement';
UPDATE public.badges SET category = 'achievement'
  WHERE id IN ('course_5','course_10','course_25','streak_7','streak_14','streak_30','streak_90','streak_180','streak_365');

-- ── 089_open_certificates ───────────────────────────────────────────────────
-- Tables: programs, open_certificates

CREATE TABLE IF NOT EXISTS public.programs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  description     text,
  skills          text[]      NOT NULL DEFAULT '{}',
  badge_image_url text,
  issue_mode      text        NOT NULL DEFAULT 'certificate_only'
                              CHECK (issue_mode IN ('certificate_only', 'badge_only', 'both')),
  completion_text text,
  issued_by       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.open_certificates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       uuid        REFERENCES public.programs(id) ON DELETE SET NULL,
  program_name     text        NOT NULL,
  recipient_name   text        NOT NULL,
  recipient_email  text,
  issued_date      date        NOT NULL,
  issued_by        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked          boolean     NOT NULL DEFAULT false,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS open_certificates_program_id_idx ON public.open_certificates (program_id);
CREATE INDEX IF NOT EXISTS open_certificates_issued_by_idx  ON public.open_certificates (issued_by);
CREATE INDEX IF NOT EXISTS programs_issued_by_idx            ON public.programs (issued_by);

-- Prevent issuing the same active credential twice to the same email for the
-- same program. Revoked credentials can be reissued.
CREATE UNIQUE INDEX IF NOT EXISTS open_certificates_unique_active_email
  ON public.open_certificates (
    issued_by,
    COALESCE(program_id::text, lower(program_name)),
    lower(recipient_email)
  )
  WHERE recipient_email IS NOT NULL AND revoked = false;

ALTER TABLE public.programs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_certificates  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programs: public read" ON public.programs;
CREATE POLICY "programs: public read"
  ON public.programs FOR SELECT USING (true);

DROP POLICY IF EXISTS "programs: instructor insert" ON public.programs;
CREATE POLICY "programs: instructor insert"
  ON public.programs FOR INSERT
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "programs: instructor update" ON public.programs;
CREATE POLICY "programs: instructor update"
  ON public.programs FOR UPDATE
  USING  ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "programs: instructor delete" ON public.programs;
CREATE POLICY "programs: instructor delete"
  ON public.programs FOR DELETE
  USING  ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "open_certificates: public read" ON public.open_certificates;
CREATE POLICY "open_certificates: public read"
  ON public.open_certificates FOR SELECT USING (true);

DROP POLICY IF EXISTS "open_certificates: instructor insert" ON public.open_certificates;
CREATE POLICY "open_certificates: instructor insert"
  ON public.open_certificates FOR INSERT
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "open_certificates: instructor update" ON public.open_certificates;
CREATE POLICY "open_certificates: instructor update"
  ON public.open_certificates FOR UPDATE
  USING  ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "open_certificates: instructor delete" ON public.open_certificates;
CREATE POLICY "open_certificates: instructor delete"
  ON public.open_certificates FOR DELETE
  USING  ((SELECT public.is_instructor_or_admin()) AND issued_by = (SELECT auth.uid()));

-- ── Public landing page views (migration 121) ─────────────────────────────
-- Expose a safe subset of published content to anon and authenticated roles.
-- Base-table RLS policies are unchanged; views are the security boundary.

DROP VIEW IF EXISTS public.published_path_items;
DROP VIEW IF EXISTS public.published_path_courses;
DROP VIEW IF EXISTS public.published_courses;
DROP VIEW IF EXISTS public.published_virtual_experiences;
DROP VIEW IF EXISTS public.published_learning_paths;

CREATE VIEW public.published_courses
WITH (security_barrier = true)
AS
  SELECT c.id, c.title, c.description, c.cover_image, c.slug, c.category,
         p.name AS partner_name, p.logo_url AS partner_logo_url
  FROM public.courses c
  LEFT JOIN public.partners p ON p.id = c.partner_id AND p.is_active = true
  WHERE c.status = 'published';

GRANT SELECT ON public.published_courses TO anon, authenticated;

CREATE VIEW public.published_virtual_experiences
WITH (security_barrier = true)
AS
  SELECT id, title, tagline, cover_image, slug, industry, difficulty
  FROM   public.virtual_experiences
  WHERE  status = 'published';

GRANT SELECT ON public.published_virtual_experiences TO anon, authenticated;

CREATE VIEW public.published_learning_paths
WITH (security_barrier = true)
AS
  SELECT id, title, description, cover_image
  FROM   public.learning_paths
  WHERE  status = 'published';

GRANT SELECT ON public.published_learning_paths TO anon, authenticated;

CREATE VIEW public.published_path_items
WITH (security_barrier = true)
AS
  WITH published_items AS (
    SELECT id, title, cover_image, slug, 'course'::text AS type
    FROM   public.courses
    WHERE  status = 'published'
    UNION ALL
    SELECT id, title, cover_image, slug, 've'::text AS type
    FROM   public.virtual_experiences
    WHERE  status = 'published'
    UNION ALL
    SELECT id, title, cover_image, slug, 'certification'::text AS type
    FROM   public.certifications
    WHERE  status = 'published'
  )
  SELECT lp.id           AS path_id,
         pi.id,
         pi.title,
         pi.cover_image,
         pi.slug,
         pi.type,
         u.pos            AS position
  FROM   public.learning_paths lp
  CROSS JOIN LATERAL unnest(lp.item_ids) WITH ORDINALITY AS u(item_id, pos)
  JOIN   published_items pi ON pi.id = u.item_id
  WHERE  lp.status = 'published';

GRANT SELECT ON public.published_path_items TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
--  After running this script:
--  1. Auth → Settings: set Site URL + redirect URL to your app domain
--  2. Create first admin user via Supabase Auth dashboard, then run:
--       UPDATE public.students SET role = 'admin' WHERE id = '<user-id>';
--  3. Set up QStash scheduled jobs (Upstash dashboard) pointing to:
--       /api/cron/deadline-reminders  — daily 08:00
--       /api/cron/progress-nudges     — daily 08:00
--       /api/cron/weekly-digest       — every Monday 08:00
--       /api/cron/at-risk-digest      — every Monday 07:00
--       /api/cron/reindex-courses     — daily 02:00
--       /api/cron/subscription-expiry-sweep — hourly (0 * * * *)
-- ─────────────────────────────────────────────────────────────


-- ============================================================
-- Group discussion forum for group assignments (migration 151)
-- ============================================================
-- ============================== Tables ==============================
CREATE TABLE IF NOT EXISTS public.assignment_group_threads (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid        NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  group_id      uuid        NOT NULL REFERENCES public.groups(id)      ON DELETE CASCADE,
  author_id     uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_post_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS public.assignment_group_posts (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id  uuid        NOT NULL REFERENCES public.assignment_group_threads(id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  is_opening boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Admin abuse backstop: forum rows are members-only in RLS, so an admin read goes through a
-- service-role route that records the access here (and fails closed if the log write fails).
CREATE TABLE IF NOT EXISTS public.assignment_group_forum_access_log (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id      uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  assignment_id uuid        NOT NULL,
  group_id      uuid        NOT NULL,
  accessed_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================== Indexes ==============================
CREATE INDEX IF NOT EXISTS idx_agt_group_activity ON public.assignment_group_threads (assignment_id, group_id, last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_agt_author         ON public.assignment_group_threads (author_id);
CREATE INDEX IF NOT EXISTS idx_agp_thread_created ON public.assignment_group_posts (thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_agp_thread_updated ON public.assignment_group_posts (thread_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_agp_author         ON public.assignment_group_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_agfal_group        ON public.assignment_group_forum_access_log (assignment_id, group_id, accessed_at DESC);
-- A thread has exactly one opening post; this backstops the RPC so no path can add a second.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agp_one_opening ON public.assignment_group_posts (thread_id) WHERE is_opening;

-- ============================== Access helper (RLS) ==============================
-- Caller is a group member AND the assignment is published AND that group is one of its group_ids.
-- SECURITY DEFINER + my_group_ids() (itself SECURITY DEFINER) sidesteps group_members RLS recursion.
CREATE OR REPLACE FUNCTION public.can_access_group_forum(p_assignment_id uuid, p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_group_id = ANY(public.my_group_ids())
     AND EXISTS (
       SELECT 1 FROM public.assignments a
       WHERE a.id = p_assignment_id
         AND a.status = 'published'
         AND p_group_id = ANY(a.group_ids)
     );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_group_forum(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.can_access_group_forum(uuid, uuid) TO authenticated;

-- ============================== Atomic thread creation ==============================
-- Called by the server route (service role) with the authenticated user's id as p_author_id. Inserts
-- the thread + opening post in ONE transaction (the ONLY way to create a thread), re-deriving the
-- ancestry check from the DB (published + group in group_ids + membership). Does not use auth.uid()
-- because the route runs under the service role.
CREATE OR REPLACE FUNCTION public.create_group_thread(
  p_assignment_id uuid,
  p_group_id      uuid,
  p_author_id     uuid,
  p_title         text,
  p_body          text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_thread public.assignment_group_threads;
  v_post   public.assignment_group_posts;
BEGIN
  IF char_length(v_title) = 0 OR char_length(v_body) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = p_assignment_id AND a.status = 'published' AND p_group_id = ANY(a.group_ids)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_group_id AND gm.student_id = p_author_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.assignment_group_threads (assignment_id, group_id, author_id, title)
  VALUES (p_assignment_id, p_group_id, p_author_id, left(v_title, 200))
  RETURNING * INTO v_thread;

  INSERT INTO public.assignment_group_posts (thread_id, author_id, body, is_opening)
  VALUES (v_thread.id, p_author_id, left(v_body, 4000), true)
  RETURNING * INTO v_post;

  RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'post', to_jsonb(v_post));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text) TO service_role;

-- ============================== Atomic thread deletion ==============================
-- Soft-deletes a thread AND all its posts in one transaction (the ONLY way to delete a thread).
-- Refuses if anyone other than the author has a surviving reply; idempotent if already deleted.
CREATE OR REPLACE FUNCTION public.delete_group_thread(p_thread_id uuid, p_author_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thread public.assignment_group_threads;
BEGIN
  SELECT * INTO v_thread FROM public.assignment_group_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_thread.deleted_at IS NOT NULL THEN RETURN; END IF; -- idempotent
  IF v_thread.author_id IS DISTINCT FROM p_author_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.assignment_group_posts p
    WHERE p.thread_id = p_thread_id AND p.deleted_at IS NULL
      AND p.author_id IS DISTINCT FROM v_thread.author_id
  ) THEN
    RAISE EXCEPTION 'thread_has_replies';
  END IF;
  UPDATE public.assignment_group_posts   SET deleted_at = now() WHERE thread_id = p_thread_id AND deleted_at IS NULL;
  UPDATE public.assignment_group_threads SET deleted_at = now() WHERE id = p_thread_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_group_thread(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_group_thread(uuid, uuid) TO service_role;

-- ============================== Triggers ==============================
-- Posts: stamp updated_at; keep identity immutable; forbid ANY change to an already-deleted post
-- (no resurrection, no editing a tombstone). author_id may only be cleared to NULL by the FK cascade.
CREATE OR REPLACE FUNCTION public.agp_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();   -- server-controlled: a client-supplied created_at is ignored, so a
                               -- far-future value cannot pin a thread to the top via last_post_at.
  ELSE
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'post_deleted';
    END IF;
    IF NEW.thread_id  IS DISTINCT FROM OLD.thread_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.is_opening IS DISTINCT FROM OLD.is_opening
       OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
      RAISE EXCEPTION 'immutable_columns';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_agp_before_write ON public.assignment_group_posts;
CREATE TRIGGER trg_agp_before_write BEFORE INSERT OR UPDATE ON public.assignment_group_posts
  FOR EACH ROW EXECUTE FUNCTION public.agp_before_write();

-- Posts: after any write, recompute the parent thread's last_post_at from surviving posts. SECURITY
-- DEFINER so it can maintain the thread even though members have NO direct UPDATE on threads.
CREATE OR REPLACE FUNCTION public.agp_after_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.assignment_group_threads t
  SET last_post_at = COALESCE(
        (SELECT max(p.created_at) FROM public.assignment_group_posts p
          WHERE p.thread_id = t.id AND p.deleted_at IS NULL),
        t.created_at)
  WHERE t.id = NEW.thread_id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_agp_after_write ON public.assignment_group_posts;
CREATE TRIGGER trg_agp_after_write AFTER INSERT OR UPDATE ON public.assignment_group_posts
  FOR EACH ROW EXECUTE FUNCTION public.agp_after_write();

-- Threads: identity + title immutable; deleted_at is write-once (no resurrection); a thread may be
-- soft-deleted only while no OTHER member has a surviving reply.
CREATE OR REPLACE FUNCTION public.agt_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.group_id   IS DISTINCT FROM OLD.group_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.title      IS DISTINCT FROM OLD.title
     OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
    RAISE EXCEPTION 'immutable_columns';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'thread_deleted'; -- write-once: never un-delete or re-stamp
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.assignment_group_posts p
      WHERE p.thread_id = OLD.id AND p.deleted_at IS NULL
        AND p.author_id IS DISTINCT FROM OLD.author_id
    ) THEN
      RAISE EXCEPTION 'thread_has_replies';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_agt_before_update ON public.assignment_group_threads;
CREATE TRIGGER trg_agt_before_update BEFORE UPDATE ON public.assignment_group_threads
  FOR EACH ROW EXECUTE FUNCTION public.agt_before_update();

-- ============================== RLS ==============================
ALTER TABLE public.assignment_group_threads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_group_posts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_group_forum_access_log ENABLE ROW LEVEL SECURITY; -- no policy => service-role only

-- Threads: members read NON-deleted rows only. Creation/deletion are RPC-only (SECURITY DEFINER), so
-- there is deliberately NO thread INSERT or UPDATE policy -> a direct client can neither make an
-- orphan topic nor resurrect / re-order one.
DROP POLICY IF EXISTS "agt: member select" ON public.assignment_group_threads;
DROP POLICY IF EXISTS "agt: member insert" ON public.assignment_group_threads;
DROP POLICY IF EXISTS "agt: author update" ON public.assignment_group_threads;
CREATE POLICY "agt: member select" ON public.assignment_group_threads FOR SELECT
  USING (deleted_at IS NULL AND public.can_access_group_forum(assignment_id, group_id));

-- Posts: members read NON-deleted rows; post as themselves into a live thread; edit/soft-delete own
-- (the trigger enforces valid transitions, incl. no touching a deleted post).
DROP POLICY IF EXISTS "agp: member select" ON public.assignment_group_posts;
CREATE POLICY "agp: member select" ON public.assignment_group_posts FOR SELECT
  USING (deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM public.assignment_group_threads t
                     WHERE t.id = thread_id AND public.can_access_group_forum(t.assignment_id, t.group_id)));
DROP POLICY IF EXISTS "agp: member insert" ON public.assignment_group_posts;
CREATE POLICY "agp: member insert" ON public.assignment_group_posts FOR INSERT
  WITH CHECK (author_id = (SELECT auth.uid())
              AND is_opening = false     -- the opening post is created ONLY by create_group_thread()
              AND deleted_at IS NULL     -- cannot insert an already-tombstoned row
              AND EXISTS (SELECT 1 FROM public.assignment_group_threads t
                          WHERE t.id = thread_id AND t.deleted_at IS NULL
                            AND public.can_access_group_forum(t.assignment_id, t.group_id)));
DROP POLICY IF EXISTS "agp: author update" ON public.assignment_group_posts;
CREATE POLICY "agp: author update" ON public.assignment_group_posts FOR UPDATE
  USING      (author_id = (SELECT auth.uid())
              AND EXISTS (SELECT 1 FROM public.assignment_group_threads t
                          WHERE t.id = thread_id AND public.can_access_group_forum(t.assignment_id, t.group_id)))
  WITH CHECK (author_id = (SELECT auth.uid())
              AND EXISTS (SELECT 1 FROM public.assignment_group_threads t
                          WHERE t.id = thread_id AND public.can_access_group_forum(t.assignment_id, t.group_id)));
-- No DELETE policy on either table: hard deletes are denied for everyone; removal is soft (deleted_at).


-- ============================================================
-- Group discussion polls (migration 152)
-- ============================================================
-- ---- posts: kind + poll ----
ALTER TABLE public.assignment_group_posts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','poll'));
ALTER TABLE public.assignment_group_posts
  ADD COLUMN IF NOT EXISTS poll jsonb;

-- Poll shape: null (a text post) OR an object with an options array of 2..6 non-empty strings (<=200).
CREATE OR REPLACE FUNCTION public.valid_group_poll(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL OR (
    jsonb_typeof(p) = 'object'
    AND jsonb_typeof(p->'options') = 'array'
    AND jsonb_array_length(p->'options') BETWEEN 2 AND 6
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p->'options') AS o
      WHERE jsonb_typeof(o) <> 'string' OR length(btrim(o #>> '{}')) = 0 OR length(o #>> '{}') > 200
    )
  );
$$;

ALTER TABLE public.assignment_group_posts DROP CONSTRAINT IF EXISTS agp_poll_kind_match;
ALTER TABLE public.assignment_group_posts ADD  CONSTRAINT agp_poll_kind_match CHECK ((kind = 'poll') = (poll IS NOT NULL));
ALTER TABLE public.assignment_group_posts DROP CONSTRAINT IF EXISTS agp_poll_valid;
ALTER TABLE public.assignment_group_posts ADD  CONSTRAINT agp_poll_valid CHECK (public.valid_group_poll(poll));

-- ---- votes: one per member per poll ----
CREATE TABLE IF NOT EXISTS public.assignment_group_poll_votes (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id    uuid        NOT NULL REFERENCES public.assignment_group_posts(id) ON DELETE CASCADE,
  voter_id   uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  option_idx int         NOT NULL CHECK (option_idx >= 0 AND option_idx < 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_agpv_post ON public.assignment_group_poll_votes (post_id);

CREATE OR REPLACE FUNCTION public.agpv_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.voter_id IS DISTINCT FROM OLD.voter_id) THEN
    RAISE EXCEPTION 'immutable_columns';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_agpv_before_write ON public.assignment_group_poll_votes;
CREATE TRIGGER trg_agpv_before_write BEFORE INSERT OR UPDATE ON public.assignment_group_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.agpv_before_write();

-- ---- posts immutability: kind/poll cannot change after creation ----
-- (Votes bump the poll post's updated_at for live tallies, which only touches updated_at.)
CREATE OR REPLACE FUNCTION public.agp_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'post_deleted';
    END IF;
    IF NEW.thread_id  IS DISTINCT FROM OLD.thread_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.is_opening IS DISTINCT FROM OLD.is_opening
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.poll IS DISTINCT FROM OLD.poll
       OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
      RAISE EXCEPTION 'immutable_columns';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---- extend create_group_thread so a conversation can open with a poll ----
-- (DROP + CREATE rather than OR REPLACE because the argument list changes.)
DROP FUNCTION IF EXISTS public.create_group_thread(uuid, uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION public.create_group_thread(
  p_assignment_id uuid,
  p_group_id      uuid,
  p_author_id     uuid,
  p_title         text,
  p_body          text,
  p_kind          text  DEFAULT 'text',
  p_poll          jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_thread public.assignment_group_threads;
  v_post   public.assignment_group_posts;
BEGIN
  IF char_length(v_title) = 0 OR char_length(v_body) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = p_assignment_id AND a.status = 'published' AND p_group_id = ANY(a.group_ids)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_group_id AND gm.student_id = p_author_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.assignment_group_threads (assignment_id, group_id, author_id, title)
  VALUES (p_assignment_id, p_group_id, p_author_id, left(v_title, 200))
  RETURNING * INTO v_thread;

  INSERT INTO public.assignment_group_posts (thread_id, author_id, body, is_opening, kind, poll)
  VALUES (v_thread.id, p_author_id, left(v_body, 4000), true, coalesce(p_kind, 'text'), p_poll)
  RETURNING * INTO v_post;

  RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'post', to_jsonb(v_post));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text, text, jsonb) TO service_role;

-- ---- votes RLS: members cast/see only their OWN vote; tallies come from the service-role route as
-- counts, so who-voted-what is never exposed to other members. ----
ALTER TABLE public.assignment_group_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agpv: own select" ON public.assignment_group_poll_votes;
CREATE POLICY "agpv: own select" ON public.assignment_group_poll_votes FOR SELECT
  USING (voter_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "agpv: member insert" ON public.assignment_group_poll_votes;
CREATE POLICY "agpv: member insert" ON public.assignment_group_poll_votes FOR INSERT
  WITH CHECK (voter_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.assignment_group_posts p
                JOIN public.assignment_group_threads t ON t.id = p.thread_id
                WHERE p.id = post_id AND p.kind = 'poll' AND p.deleted_at IS NULL
                  AND public.can_access_group_forum(t.assignment_id, t.group_id)));

DROP POLICY IF EXISTS "agpv: own update" ON public.assignment_group_poll_votes;
CREATE POLICY "agpv: own update" ON public.assignment_group_poll_votes FOR UPDATE
  USING (voter_id = (SELECT auth.uid()))
  WITH CHECK (voter_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.assignment_group_posts p
                JOIN public.assignment_group_threads t ON t.id = p.thread_id
                WHERE p.id = post_id AND p.kind = 'poll' AND p.deleted_at IS NULL
                  AND public.can_access_group_forum(t.assignment_id, t.group_id)));
-- No DELETE policy: no "unvote" in v1 (you can change your choice via update/upsert).

-- ============================================================================
-- LinkedIn post share claims (migrations 153, 155, 156)
-- ============================================================================
-- Students paste the URL of the LinkedIn post where they shared their work. A course share slide
-- awards bonus XP; a VE linkedin_share deliverable is a plain completion requirement.
--
-- There is no human review. A row in this table carries exactly one meaning, all of it decided at
-- claim time, which is why no status column exists:
--
--   the URL was a LinkedIn post, it names this student as its author, and nobody had claimed it
--   before.
--
--   * post_key is the post's IDENTITY, not the pasted URL: every URL form pointing at one post
--     (/posts/ share link, regional host, utm_ params, differing profile slug) collapses to one key,
--     so UNIQUE(post_key) actually stops a cohort passing one link around.
--   * UNIQUE(student_id, content_id, item_id) makes one row per share slot, so a student fixing a
--     mistyped link UPDATEs in place (freeing their old post_key) instead of stacking claims.
--   * author_vanity is the vanity read out of the post URL, which must equal the student's own
--     (students.social_links->>'linkedin') or the claim is refused and never written. Kept as the
--     evidence the check ran, and as a record of what matched if the student later renames.
--     URL forms carrying no author -- /feed/update/ permalinks, /pulse/ articles -- are rejected,
--     because with no reviewer an unchecked claim is indistinguishable from a checked one.
--   * points is an informational snapshot of the configured bonus. It is NOT the XP source --
--     course XP stays in course_attempts.points, which recalc_student_xp() already sums.
--   * content_id has no FK: a claim must outlive a deleted course/VE.
--   * NO client write policy: writes go only through the service-role claim actions.

CREATE TABLE IF NOT EXISTS public.linkedin_shares (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  content_type  text        NOT NULL CHECK (content_type IN ('course', 'virtual_experience')),
  content_id    uuid        NOT NULL,
  item_id       text        NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 200),
  post_url      text        NOT NULL CHECK (char_length(post_url) BETWEEN 1 AND 2048),
  post_key      text        NOT NULL CHECK (char_length(post_key) BETWEEN 1 AND 512),
  points        integer     NOT NULL DEFAULT 0 CHECK (points >= 0),
  author_vanity text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_shares_post_key_unique UNIQUE (post_key),
  CONSTRAINT linkedin_shares_slot_unique     UNIQUE (student_id, content_id, item_id)
);

CREATE INDEX IF NOT EXISTS linkedin_shares_content_idx
  ON public.linkedin_shares (content_id, student_id);

-- The claim registry feeds XP too (migration 160), so it needs its own trigger -- otherwise a share
-- would not reach student_xp until some unrelated course write fired the other one. All three
-- operations: UPDATE covers a student correcting their link, DELETE covers a claim being removed or
-- cascading with the student.
DROP TRIGGER IF EXISTS trg_recalc_student_xp_shares ON public.linkedin_shares;
CREATE TRIGGER trg_recalc_student_xp_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.linkedin_shares
  FOR EACH ROW EXECUTE FUNCTION public.recalc_student_xp();


ALTER TABLE public.linkedin_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "linkedin_shares: student read own" ON public.linkedin_shares;
CREATE POLICY "linkedin_shares: student read own"
  ON public.linkedin_shares FOR SELECT
  USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "linkedin_shares: instructor read" ON public.linkedin_shares;
CREATE POLICY "linkedin_shares: instructor read"
  ON public.linkedin_shares FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));

DROP POLICY IF EXISTS "linkedin_shares: staff select" ON public.linkedin_shares;
CREATE POLICY "linkedin_shares: staff select"
  ON public.linkedin_shares FOR SELECT
  USING ((SELECT public.is_staff()));

-- No INSERT / UPDATE / DELETE policy by design.

-- ── migration 159: account_origin and access_state ─────────────────
-- Both columns are declared inline on public.students above.
--
-- Migration 159 splits the access_state default: the column is added with DEFAULT
-- 'active' so existing rows backfill without a lockout window, then the default is
-- switched to 'pending' for new rows. A fresh database has no rows to backfill, so the
-- table above simply declares the final default of 'pending'.
--
-- Enforcement lives in lib/account-state.ts (pure predicates, safe for edge middleware)
-- and lib/account-state-server.ts (the only writers). The auth user's app_metadata
-- carries a cached copy of both facts so middleware can gate a request without a
-- database read; the columns here remain the source of truth.
--
-- There is no migration 158. It was drafted as a claim backfill, found to match
-- long-standing accounts, and removed before release. Its review queries now live in
-- scripts/preview-password-setup-backfill.sql and are run by hand.

-- Migration 166: duration-based individual subscriptions
CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  cohort_id uuid NOT NULL UNIQUE REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  -- migration 198: a plan carrying history cannot be deleted, so this is where a finished one
  -- goes. Separate from status: inactive means off for now and still worth seeing, archived
  -- means done with. Archiving requires the plan to be inactive; unarchiving leaves it inactive.
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, cohort_id),
  -- migration 198: an archived plan switched back on would be on sale while hidden from the
  -- list that shows what is on sale. The application refuses it; this is why it cannot happen.
  CONSTRAINT subscription_plans_archived_is_inactive
    CHECK (archived_at IS NULL OR status = 'inactive')
);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_not_archived
  ON public.subscription_plans (created_at DESC)
  WHERE archived_at IS NULL;
CREATE TABLE public.individual_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  duration_months integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GHS',
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancelled_at timestamptz,
  -- migration 179: the current_period_end a pre-expiry warning was last sent for. A renewal
  -- moves the period end, which makes the subscription eligible for a fresh warning.
  expiry_warning_for_period_end timestamptz,
  -- migration 180: bounded warning attempts, so one permanently invalid address cannot hold
  -- a slot in the warning window forever.
  expiry_warning_attempts integer NOT NULL DEFAULT 0,
  expiry_warning_last_error text,
  -- migration 180: which period those attempts were spent on. Without it the counter is a
  -- lifetime total and five failures bar the learner from every future warning.
  expiry_warning_attempted_for_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT individual_subscriptions_plan_cohort_fkey
    FOREIGN KEY (plan_id, cohort_id) REFERENCES public.subscription_plans(id, cohort_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_individual_subscriptions_student ON public.individual_subscriptions(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_individual_subscriptions_expiry_warning
  ON public.individual_subscriptions(current_period_end)
  WHERE status = 'active';
CREATE INDEX idx_individual_subscriptions_sweep ON public.individual_subscriptions(status, current_period_end);
CREATE INDEX idx_individual_subscriptions_plan ON public.individual_subscriptions(plan_id);

CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name text NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  -- Migration 192: refunds and disputes are recorded on the Paystack transaction and acted on by
  -- a person, so a payment row is never moved out of these two states by the platform.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  is_activating boolean NOT NULL,
  kind text NOT NULL CHECK (kind IN ('purchase','renewal')),
  duration_months integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GHS',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  paid_at date NOT NULL DEFAULT current_date,
  payment_method text,
  payment_reference text,
  notes text,
  -- migration 177: set once the activation email is accepted by the mail provider. NULL
  -- means it still needs sending, which is what makes a failed delivery retryable.
  activation_email_sent_at timestamptz,
  -- migration 179: bounded retries. The sweep stops past a cap so one permanently broken
  -- row cannot starve every newer learner behind it in the queue.
  email_attempts integer NOT NULL DEFAULT 0,
  email_last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscription_payments_activation_email_pending
  ON public.subscription_payments(created_at)
  WHERE activation_email_sent_at IS NULL;

CREATE TABLE public.subscription_plan_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  content_table text NOT NULL CHECK (content_table IN ('courses','virtual_experiences','certifications','learning_paths')),
  content_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notified_at timestamptz,
  UNIQUE (plan_id, content_table, content_id)
);
CREATE INDEX idx_subscription_plan_content_plan ON public.subscription_plan_content(plan_id);
CREATE INDEX idx_subscription_payments_plan ON public.subscription_payments(plan_id);

CREATE TABLE public.subscription_plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  old_plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  new_plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_plan_id <> new_plan_id)
);
CREATE INDEX idx_subscription_plan_changes_subscription ON public.subscription_plan_changes(subscription_id,changed_at DESC);
-- Best-effort duplicate suppression only. External email delivery and notified_at
-- cannot be committed atomically, so a narrow duplicate-send window is accepted.

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscription_plans: instructor select" ON public.subscription_plans FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_plans: student read assigned" ON public.subscription_plans FOR SELECT USING (EXISTS (SELECT 1 FROM public.individual_subscriptions s WHERE s.plan_id=subscription_plans.id AND s.student_id=(SELECT auth.uid())));
CREATE POLICY "individual_subscriptions: instructor select" ON public.individual_subscriptions FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "individual_subscriptions: student read own" ON public.individual_subscriptions FOR SELECT USING (student_id = (SELECT auth.uid()));
CREATE POLICY "subscription_payments: instructor select" ON public.subscription_payments FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payments: student read own" ON public.subscription_payments FOR SELECT USING (student_id = (SELECT auth.uid()));
CREATE POLICY "subscription_plan_content: instructor select" ON public.subscription_plan_content FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_plan_content: student read assigned" ON public.subscription_plan_content FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.individual_subscriptions s WHERE s.plan_id = subscription_plan_content.plan_id AND s.student_id = (SELECT auth.uid()))
);
CREATE POLICY "subscription_plan_changes: instructor select" ON public.subscription_plan_changes FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_plan_changes: student read own" ON public.subscription_plan_changes FOR SELECT USING (student_id=(SELECT auth.uid()));
CREATE TRIGGER trg_subscription_plans_updated_at BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_individual_subscriptions_updated_at BEFORE UPDATE ON public.individual_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_enrollment_model_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'permission denied: enrollment_model may only be changed by an enrollment-model claim'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_prevent_enrollment_model_change BEFORE UPDATE OF enrollment_model ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.prevent_enrollment_model_change();

CREATE OR REPLACE FUNCTION public.claim_student_enrollment_model(p_student_id uuid, p_requested_model text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_current text; v_cohort_id uuid; v_original_cohort_id uuid;
BEGIN
  IF p_requested_model NOT IN ('bootcamp','individual') THEN RAISE EXCEPTION 'invalid enrollment model: %', p_requested_model; END IF;
  SELECT enrollment_model,cohort_id,original_cohort_id INTO v_current,v_cohort_id,v_original_cohort_id
  FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student % not found', p_student_id; END IF;
  IF v_current IS NULL THEN
    UPDATE public.students SET enrollment_model = p_requested_model WHERE id = p_student_id;
  ELSIF v_current='bootcamp' AND p_requested_model='individual'
        AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL THEN
    UPDATE public.bootcamp_enrollments SET released_at=COALESCE(released_at,now()),updated_at=now()
      WHERE student_id=p_student_id AND released_at IS NULL;
    UPDATE public.students SET enrollment_model='individual' WHERE id=p_student_id;
  ELSIF v_current <> p_requested_model THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', p_student_id, v_current USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_student_from_bootcamp(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_model text;
BEGIN
  SELECT enrollment_model INTO v_model FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student % not found',p_student_id; END IF;
  IF v_model='individual' THEN
    RAISE EXCEPTION 'an individual subscriber cannot be unassigned through the bootcamp workflow' USING ERRCODE='unique_violation';
  END IF;
  -- Keep student_id so paid_total, installments and receipts stay attached to the person
  -- who paid them. payment_exempt records a sponsorship decision, not cohort membership,
  -- so it is deliberately left alone. See migration 171.
  UPDATE public.bootcamp_enrollments SET released_at=now(),updated_at=now()
    WHERE student_id=p_student_id AND released_at IS NULL;
  UPDATE public.students SET cohort_id=NULL,original_cohort_id=NULL,enrollment_model=NULL WHERE id=p_student_id;
  RETURN jsonb_build_object('ok',true,'released',true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_student_from_bootcamp(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reattach_released_enrollment(p_enrollment_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.bootcamp_enrollments SET released_at=NULL,updated_at=now()
  WHERE id=p_enrollment_id AND released_at IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.reattach_released_enrollment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reattach_released_enrollment(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_student_cohort_model_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_is_individual boolean; v_requested text;
BEGIN
  IF NEW.cohort_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.cohort_id IS NOT DISTINCT FROM OLD.cohort_id THEN RETURN NEW; END IF;
  SELECT is_individual INTO v_is_individual FROM public.cohorts WHERE id = NEW.cohort_id;
  v_requested := CASE WHEN COALESCE(v_is_individual, false) THEN 'individual' ELSE 'bootcamp' END;
  IF TG_OP = 'INSERT' OR OLD.enrollment_model IS NULL THEN
    NEW.enrollment_model := v_requested;
  ELSIF OLD.enrollment_model <> v_requested THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', NEW.id, OLD.enrollment_model USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_student_cohort_model_claim BEFORE INSERT OR UPDATE OF cohort_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_cohort_model_claim();

CREATE OR REPLACE FUNCTION public.add_months_clamped(base timestamptz, months integer)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_utc timestamp; v_target_month date; v_last_day date; v_day integer;
BEGIN
  v_utc := base AT TIME ZONE 'UTC';
  v_target_month := (date_trunc('month', v_utc) + make_interval(months => months))::date;
  v_last_day := (v_target_month + interval '1 month - 1 day')::date;
  v_day := LEAST(EXTRACT(day FROM v_utc)::integer, EXTRACT(day FROM v_last_day)::integer);
  RETURN (v_target_month + (v_day - 1) + v_utc::time) AT TIME ZONE 'UTC';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_months_clamped(timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_months_clamped(timestamptz,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.create_individual_subscription_plan(p_name text,p_description text,p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan_id uuid:=gen_random_uuid(); v_cohort_id uuid;
BEGIN
  IF btrim(COALESCE(p_name,''))='' THEN RAISE EXCEPTION 'plan name is required'; END IF;
  -- cohort_kind must be set explicitly. Inserting is_individual alone would fall to the
  -- 'bootcamp' default and trg_cohorts_sync_is_individual would flip it straight back to
  -- false, silently revoking access for every subscriber on the plan. See migration 172.
  INSERT INTO public.cohorts(name,status,cohort_kind,individual_student_id,start_date,created_by)
  VALUES ('Subscription - '||btrim(p_name),'active','subscription_plan',NULL,current_date,p_created_by) RETURNING id INTO v_cohort_id;
  INSERT INTO public.subscription_plans(id,name,description,cohort_id,created_by)
  VALUES (v_plan_id,btrim(p_name),NULLIF(btrim(p_description),''),v_cohort_id,p_created_by);
  RETURN jsonb_build_object('ok',true,'planId',v_plan_id,'cohortId',v_cohort_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_plan(text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.purchase_or_renew_individual_subscription(
  p_student_id uuid, p_plan_id uuid, p_duration_months integer, p_amount numeric, p_currency text,
  p_idempotency_key text, p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_currency text;
  v_payment public.subscription_payments%ROWTYPE;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE; v_plan_cohort_is_individual boolean;
  v_base timestamptz; v_period_start timestamptz; v_period_end timestamptz;
  v_is_activating boolean; v_kind text; v_subscription_id uuid; v_payment_id uuid;
BEGIN
  IF p_duration_months NOT IN (1,3,6,12) THEN RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  v_currency := upper(btrim(COALESCE(p_currency, '')));
  IF v_currency = '' THEN RAISE EXCEPTION 'currency is required'; END IF;
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN RAISE EXCEPTION 'idempotencyKey is required'; END IF;

  PERFORM public.claim_student_enrollment_model(p_student_id, 'individual');
  SELECT * INTO v_payment FROM public.subscription_payments WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_payment.student_id IS DISTINCT FROM p_student_id
       OR v_payment.plan_id IS DISTINCT FROM p_plan_id
       OR v_payment.amount IS DISTINCT FROM p_amount
       OR v_payment.currency IS DISTINCT FROM v_currency
       OR v_payment.duration_months IS DISTINCT FROM p_duration_months THEN
      RAISE EXCEPTION 'idempotency key was already used for a different subscription payment' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('ok',true,'subscriptionId',v_payment.subscription_id,'paymentId',v_payment.id,'alreadyProcessed',true);
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT is_individual INTO v_plan_cohort_is_individual FROM public.cohorts WHERE id=v_plan.cohort_id;
  IF v_plan.status<>'active' OR NOT COALESCE(v_plan_cohort_is_individual,false) THEN RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort'; END IF;

  SELECT * INTO v_subscription FROM public.individual_subscriptions WHERE student_id = p_student_id;
  v_is_activating := NOT (FOUND AND v_subscription.status = 'active' AND v_subscription.current_period_end > now());
  v_base := CASE WHEN v_is_activating THEN now() ELSE v_subscription.current_period_end END;
  v_period_start := v_base;
  v_period_end := public.add_months_clamped(v_base, p_duration_months);
  v_kind := CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END;
  IF v_subscription.id IS NOT NULL AND v_subscription.plan_id<>p_plan_id THEN
    RAISE EXCEPTION 'this student is already assigned to a different subscription plan' USING ERRCODE='unique_violation';
  END IF;

  IF v_subscription.id IS NULL THEN
    INSERT INTO public.individual_subscriptions(student_id,plan_id,cohort_id,status,duration_months,amount,currency,current_period_start,current_period_end,cancelled_at)
    VALUES (p_student_id,p_plan_id,v_plan.cohort_id,'active',p_duration_months,p_amount,v_currency,v_period_start,v_period_end,NULL)
    RETURNING id INTO v_subscription_id;
  ELSE
    UPDATE public.individual_subscriptions SET
      status='active', duration_months=p_duration_months, amount=p_amount, currency=v_currency,
      current_period_start=CASE WHEN v_is_activating THEN v_period_start ELSE current_period_start END,
      current_period_end=v_period_end, cancelled_at=NULL
    WHERE id=v_subscription.id RETURNING id INTO v_subscription_id;
  END IF;

  INSERT INTO public.subscription_payments(
    subscription_id,student_id,plan_id,plan_name,idempotency_key,status,is_activating,kind,duration_months,
    amount,currency,period_start,period_end,payment_method,payment_reference,notes,created_by
  ) VALUES (
    v_subscription_id,p_student_id,p_plan_id,v_plan.name,p_idempotency_key,'completed',v_is_activating,v_kind,p_duration_months,
    p_amount,v_currency,v_period_start,v_period_end,NULLIF(btrim(p_payment_method),''),
    NULLIF(btrim(p_payment_reference),''),NULLIF(btrim(p_notes),''),p_created_by
  ) RETURNING id INTO v_payment_id;
  UPDATE public.students SET cohort_id=v_plan.cohort_id WHERE id=p_student_id;
  RETURN jsonb_build_object('ok',true,'subscriptionId',v_subscription_id,'paymentId',v_payment_id,'alreadyProcessed',false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid,uuid,integer,numeric,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid,uuid,integer,numeric,text,text,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.change_individual_subscription_plan(
  p_subscription_id uuid,p_new_plan_id uuid,p_changed_by uuid DEFAULT NULL,p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_student_id uuid; v_old_plan_id uuid; v_old_cohort_id uuid; v_new_cohort_id uuid;
  v_new_plan_status text; v_new_cohort_is_individual boolean;
  v_subscription_status text; v_period_end timestamptz;
BEGIN
  SELECT student_id INTO v_student_id FROM public.individual_subscriptions WHERE id=p_subscription_id;
  IF NOT FOUND OR v_student_id IS NULL THEN RAISE EXCEPTION 'subscription not found'; END IF;
  PERFORM public.claim_student_enrollment_model(v_student_id,'individual');
  SELECT plan_id,cohort_id,status,current_period_end
  INTO v_old_plan_id,v_old_cohort_id,v_subscription_status,v_period_end
  FROM public.individual_subscriptions WHERE id=p_subscription_id FOR UPDATE;
  SELECT cohort_id,status INTO v_new_cohort_id,v_new_plan_status FROM public.subscription_plans WHERE id=p_new_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT is_individual INTO v_new_cohort_is_individual FROM public.cohorts WHERE id=v_new_cohort_id;
  IF v_new_plan_status<>'active' OR NOT COALESCE(v_new_cohort_is_individual,false) THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;
  IF v_old_plan_id=p_new_plan_id THEN
    RETURN jsonb_build_object('ok',true,'alreadyAssigned',true,'subscriptionId',p_subscription_id);
  END IF;
  UPDATE public.individual_subscriptions SET plan_id=p_new_plan_id,cohort_id=v_new_cohort_id WHERE id=p_subscription_id;
  IF v_subscription_status='active' AND v_period_end>now() THEN
    UPDATE public.students SET cohort_id=v_new_cohort_id WHERE id=v_student_id;
  ELSE
    UPDATE public.students SET cohort_id=NULL WHERE id=v_student_id AND cohort_id=v_old_cohort_id;
  END IF;
  INSERT INTO public.subscription_plan_changes(subscription_id,student_id,old_plan_id,new_plan_id,changed_by,notes)
  VALUES(p_subscription_id,v_student_id,v_old_plan_id,p_new_plan_id,p_changed_by,NULLIF(btrim(p_notes),''));
  RETURN jsonb_build_object('ok',true,'alreadyAssigned',false,'subscriptionId',p_subscription_id,'planId',p_new_plan_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.change_individual_subscription_plan(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_individual_subscription_plan(uuid,uuid,uuid,text) TO service_role;

CREATE TABLE public.subscription_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('purchase','renewal')),
  duration_months integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GHS',
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmation_submitted','paid','cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz, cancelled_at timestamptz,
  -- migration 178: set once the payment-request email is accepted by the mail provider.
  -- NULL means it still needs sending, which is what makes a failed delivery retryable.
  request_email_sent_at timestamptz,
  -- migration 179: see subscription_payments.email_attempts.
  email_attempts integer NOT NULL DEFAULT 0,
  email_last_error text
);
CREATE INDEX idx_subscription_payment_requests_email_pending
  ON public.subscription_payment_requests(created_at)
  WHERE request_email_sent_at IS NULL;
CREATE UNIQUE INDEX idx_subscription_payment_requests_open_student ON public.subscription_payment_requests(student_id)
  WHERE student_id IS NOT NULL AND status IN ('pending','confirmation_submitted');
CREATE INDEX idx_subscription_payment_requests_review ON public.subscription_payment_requests(status,due_date);

CREATE TABLE public.subscription_payment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.subscription_payment_requests(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0), paid_at date NOT NULL,
  method text, reference text, notes text, receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz, admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_subscription_payment_confirmations_pending_request
  ON public.subscription_payment_confirmations(request_id) WHERE status='pending';
CREATE INDEX idx_subscription_payment_confirmations_student ON public.subscription_payment_confirmations(student_id,created_at DESC);
CREATE INDEX idx_subscription_payment_confirmations_review ON public.subscription_payment_confirmations(status,created_at DESC);
ALTER TABLE public.subscription_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payment_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscription_payment_requests: instructor select" ON public.subscription_payment_requests FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payment_requests: student read own" ON public.subscription_payment_requests FOR SELECT USING (student_id=(SELECT auth.uid()));
CREATE POLICY "subscription_payment_confirmations: instructor select" ON public.subscription_payment_confirmations FOR SELECT USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payment_confirmations: student read own" ON public.subscription_payment_confirmations FOR SELECT USING (student_id=(SELECT auth.uid()));
CREATE TRIGGER trg_subscription_payment_requests_updated_at BEFORE UPDATE ON public.subscription_payment_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_subscription_payment_confirmations_updated_at BEFORE UPDATE ON public.subscription_payment_confirmations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Subscription access state and open payment work must not survive deletion of
-- the student account. Completed financial ledger rows remain via SET NULL FKs.
CREATE OR REPLACE FUNCTION public.close_subscription_before_student_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.subscription_payment_requests
  WHERE student_id = OLD.id AND status IN ('pending', 'confirmation_submitted')
  ORDER BY id FOR UPDATE;
  UPDATE public.subscription_payment_confirmations AS confirmation
  SET status = 'rejected', reviewed_at = COALESCE(reviewed_at, now()),
      admin_notes = COALESCE(admin_notes, 'Student account deleted')
  FROM public.subscription_payment_requests AS request
  WHERE confirmation.request_id = request.id
    AND request.student_id = OLD.id
    AND request.status IN ('pending', 'confirmation_submitted')
    AND confirmation.status = 'pending';
  UPDATE public.subscription_payment_requests
  SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now())
  WHERE student_id = OLD.id AND status IN ('pending', 'confirmation_submitted');
  UPDATE public.individual_subscriptions
  SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now())
  WHERE student_id = OLD.id AND status = 'active';
  RETURN OLD;
END;
$$;
CREATE TRIGGER trg_close_subscription_before_student_delete BEFORE DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.close_subscription_before_student_delete();
REVOKE ALL ON FUNCTION public.close_subscription_before_student_delete() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_subscriptions_needing_expiry_warning(
  p_horizon timestamptz,
  p_limit integer DEFAULT 25,
  p_max_attempts integer DEFAULT 5
) RETURNS TABLE (id uuid, current_period_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.id, s.current_period_end
  FROM public.individual_subscriptions s
  WHERE s.status = 'active'
    AND s.current_period_end > now()
    AND s.current_period_end <= p_horizon
    AND s.expiry_warning_for_period_end IS DISTINCT FROM s.current_period_end
    AND (
      s.expiry_warning_attempted_for_period_end IS DISTINCT FROM s.current_period_end
      OR s.expiry_warning_attempts < p_max_attempts
    )
  ORDER BY s.current_period_end
  LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.list_subscriptions_needing_expiry_warning(timestamptz, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_subscriptions_needing_expiry_warning(timestamptz, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_expiry_warning_failure(
  p_subscription_id uuid,
  p_period_end timestamptz,
  p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.individual_subscriptions
  SET expiry_warning_attempts = CASE
        WHEN expiry_warning_attempted_for_period_end IS DISTINCT FROM p_period_end THEN 1
        ELSE expiry_warning_attempts + 1
      END,
      expiry_warning_attempted_for_period_end = p_period_end,
      expiry_warning_last_error = left(COALESCE(p_error, 'Unknown error'), 500)
  WHERE id = p_subscription_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_expiry_warning_failure(uuid, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expiry_warning_failure(uuid, timestamptz, text) TO service_role;

-- Wins the right to send this learner's welcome, or returns false because another worker
-- already holds it. The UPDATE is the claim: a single statement, so two callers cannot both
-- match the WHERE clause.
CREATE OR REPLACE FUNCTION public.claim_learner_welcome_email(
  p_student_id uuid,
  p_ttl_seconds integer DEFAULT 300
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claimed uuid;
BEGIN
  UPDATE public.students
  SET setup_email_claimed_at = now()
  WHERE id = p_student_id
    AND setup_email_sent_at IS NULL
    AND (
      setup_email_claimed_at IS NULL
      OR setup_email_claimed_at < now() - make_interval(secs => p_ttl_seconds)
    )
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_learner_welcome_email(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_learner_welcome_email(uuid, integer) TO service_role;

-- Released on failure so the next attempt does not wait out the whole TTL.
CREATE OR REPLACE FUNCTION public.release_learner_welcome_claim(p_student_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.students
  SET setup_email_claimed_at = NULL
  WHERE id = p_student_id
    AND setup_email_sent_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.release_learner_welcome_claim(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_learner_welcome_claim(uuid) TO service_role;

-- Clearing the claim belongs in the same transaction as the stamps, so a delivered welcome
-- never leaves a stale claim behind.
CREATE OR REPLACE FUNCTION public.mark_subscription_email_delivered(
  p_student_id uuid DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_mark_setup boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_payment_id IS NOT NULL THEN
    UPDATE public.subscription_payments
    SET activation_email_sent_at = now(), email_last_error = NULL
    WHERE id = p_payment_id
      AND activation_email_sent_at IS NULL;
  END IF;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests
    SET request_email_sent_at = now(), email_last_error = NULL
    WHERE id = p_request_id
      AND request_email_sent_at IS NULL;
  END IF;

  IF p_mark_setup AND p_student_id IS NOT NULL THEN
    UPDATE public.students
    SET setup_email_sent_at = COALESCE(setup_email_sent_at, now()),
        setup_email_claimed_at = NULL,
        updated_at = now()
    WHERE id = p_student_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_subscription_email_delivered(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_email_delivered(uuid, uuid, uuid, boolean)
  TO service_role;


-- Counted server-side so concurrent sweeps cannot lose an increment to a read-modify-write
-- race, which would keep a dead row in the queue indefinitely.
CREATE OR REPLACE FUNCTION public.record_subscription_email_failure(
  p_payment_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_payment_id IS NOT NULL THEN
    UPDATE public.subscription_payments
    SET email_attempts = email_attempts + 1,
        email_last_error = left(COALESCE(p_error, 'Unknown error'), 500)
    WHERE id = p_payment_id
      AND activation_email_sent_at IS NULL;
  END IF;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests
    SET email_attempts = email_attempts + 1,
        email_last_error = left(COALESCE(p_error, 'Unknown error'), 500)
    WHERE id = p_request_id
      AND request_email_sent_at IS NULL;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_subscription_email_failure(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_email_failure(uuid, uuid, text)
  TO service_role;

-- Records that a warning went out for the period it was actually about, so a renewal that
-- extends current_period_end makes the subscription eligible again.
CREATE OR REPLACE FUNCTION public.mark_subscription_expiry_warned(
  p_subscription_id uuid,
  p_period_end timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.individual_subscriptions
  SET expiry_warning_for_period_end = p_period_end,
      expiry_warning_attempts = 0,
      expiry_warning_attempted_for_period_end = NULL,
      expiry_warning_last_error = NULL
  WHERE id = p_subscription_id
    AND current_period_end = p_period_end;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_subscription_expiry_warned(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_expiry_warned(uuid, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_subscription_payment_confirmation(
  p_confirmation_id uuid,
  p_reviewed_by uuid DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_confirmation public.subscription_payment_confirmations%ROWTYPE;
  v_request public.subscription_payment_requests%ROWTYPE;
  v_request_id uuid;
  v_student_id uuid;
  v_result jsonb;
  v_subscription_id uuid;
  v_payment_id uuid;
  v_idempotency_key text := 'subscription-confirmation:' || p_confirmation_id::text;
BEGIN
  SELECT confirmation.request_id, request.student_id
  INTO v_request_id, v_student_id
  FROM public.subscription_payment_confirmations AS confirmation
  JOIN public.subscription_payment_requests AS request ON request.id = confirmation.request_id
  WHERE confirmation.id = p_confirmation_id;
  IF NOT FOUND OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'subscription payment confirmation not found';
  END IF;

  -- student, then request, then confirmation. Migration 176's delete trigger already holds
  -- the student row when it reaches the request, so approval must take the same order or
  -- a deletion and an approval of the same learner can deadlock.
  PERFORM 1 FROM public.students WHERE id = v_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription student no longer exists'; END IF;

  SELECT * INTO v_request
  FROM public.subscription_payment_requests
  WHERE id = v_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment request not found'; END IF;

  SELECT * INTO v_confirmation
  FROM public.subscription_payment_confirmations
  WHERE id = p_confirmation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment confirmation not found'; END IF;

  -- Replay of an approval that already succeeded. Return the payment it created so the
  -- caller can retry a failed activation email against it. Deliberately narrow: only an
  -- approved confirmation replays, and only when its payment still exists. A rejected or
  -- otherwise non-pending confirmation still raises, as before.
  IF v_confirmation.status = 'approved' THEN
    SELECT id, subscription_id INTO v_payment_id, v_subscription_id
    FROM public.subscription_payments
    WHERE idempotency_key = v_idempotency_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'subscription payment confirmation has already been processed'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'subscriptionId', v_subscription_id,
      'paymentId', v_payment_id,
      'alreadyProcessed', true,
      'requestId', v_request.id,
      'confirmationId', p_confirmation_id
    );
  END IF;

  IF v_request.status <> 'confirmation_submitted' THEN
    RAISE EXCEPTION 'subscription payment request is not awaiting confirmation';
  END IF;
  IF v_confirmation.status <> 'pending' THEN
    RAISE EXCEPTION 'subscription payment confirmation has already been processed'
      USING ERRCODE = 'unique_violation';
  END IF;
  IF v_confirmation.request_id IS DISTINCT FROM v_request.id THEN
    RAISE EXCEPTION 'subscription payment confirmation request changed unexpectedly';
  END IF;
  IF v_request.student_id IS NULL OR v_confirmation.student_id IS DISTINCT FROM v_request.student_id THEN
    RAISE EXCEPTION 'subscription payment confirmation does not belong to this request';
  END IF;
  IF v_confirmation.amount IS DISTINCT FROM v_request.amount THEN
    RAISE EXCEPTION 'confirmed amount must equal the assigned subscription amount';
  END IF;

  v_result := public.purchase_or_renew_individual_subscription(
    v_request.student_id, v_request.plan_id, v_request.duration_months,
    v_request.amount, v_request.currency,
    v_idempotency_key,
    v_confirmation.method, v_confirmation.reference, v_confirmation.notes,
    p_reviewed_by
  );
  v_subscription_id := (v_result->>'subscriptionId')::uuid;

  UPDATE public.subscription_payments
  SET paid_at = v_confirmation.paid_at
  WHERE id = (v_result->>'paymentId')::uuid;
  UPDATE public.subscription_payment_confirmations
  SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now(),
      admin_notes = NULLIF(btrim(p_admin_notes), '')
  WHERE id = p_confirmation_id;
  UPDATE public.subscription_payment_requests
  SET status = 'paid', subscription_id = v_subscription_id, paid_at = now()
  WHERE id = v_request.id;

  RETURN v_result || jsonb_build_object('requestId', v_request.id, 'confirmationId', p_confirmation_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_subscription_payment_confirmation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_subscription_payment_confirmation(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_subscription_payment_confirmation(
  p_request_id uuid,p_student_id uuid,p_amount numeric,p_paid_at date,p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,p_notes text DEFAULT NULL,p_receipt_url text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_request public.subscription_payment_requests%ROWTYPE; v_confirmation_id uuid;
BEGIN
  SELECT * INTO v_request FROM public.subscription_payment_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.student_id IS DISTINCT FROM p_student_id THEN RAISE EXCEPTION 'subscription payment request not found'; END IF;
  IF v_request.status<>'pending' THEN RAISE EXCEPTION 'subscription payment request is not open'; END IF;
  IF p_amount IS DISTINCT FROM v_request.amount THEN RAISE EXCEPTION 'confirmed amount must equal the assigned subscription amount'; END IF;
  IF p_paid_at IS NULL OR p_paid_at>current_date THEN RAISE EXCEPTION 'paid date must be today or earlier'; END IF;
  INSERT INTO public.subscription_payment_confirmations(request_id,student_id,amount,paid_at,method,reference,notes,receipt_url)
  VALUES(p_request_id,p_student_id,p_amount,p_paid_at,NULLIF(btrim(p_method),''),NULLIF(btrim(p_reference),''),NULLIF(btrim(p_notes),''),NULLIF(btrim(p_receipt_url),''))
  RETURNING id INTO v_confirmation_id;
  UPDATE public.subscription_payment_requests SET status='confirmation_submitted' WHERE id=p_request_id;
  RETURN jsonb_build_object('ok',true,'confirmationId',v_confirmation_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_subscription_payment_confirmation(uuid,uuid,numeric,date,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_subscription_payment_confirmation(uuid,uuid,numeric,date,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_subscription_payment_confirmation(
  p_confirmation_id uuid,p_reviewed_by uuid DEFAULT NULL,p_admin_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_request_id uuid; v_request public.subscription_payment_requests%ROWTYPE; v_confirmation public.subscription_payment_confirmations%ROWTYPE;
BEGIN
  SELECT request_id INTO v_request_id FROM public.subscription_payment_confirmations WHERE id=p_confirmation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment confirmation not found or already processed' USING ERRCODE='unique_violation'; END IF;
  SELECT * INTO v_request FROM public.subscription_payment_requests WHERE id=v_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'confirmation_submitted' THEN RAISE EXCEPTION 'subscription payment request is not awaiting confirmation'; END IF;
  SELECT * INTO v_confirmation FROM public.subscription_payment_confirmations WHERE id=p_confirmation_id FOR UPDATE;
  IF NOT FOUND OR v_confirmation.status<>'pending' OR v_confirmation.request_id IS DISTINCT FROM v_request.id THEN RAISE EXCEPTION 'subscription payment confirmation not found or already processed' USING ERRCODE='unique_violation'; END IF;
  UPDATE public.subscription_payment_requests SET status='pending' WHERE id=v_request.id;
  UPDATE public.subscription_payment_confirmations SET status='rejected',reviewed_by=p_reviewed_by,reviewed_at=now(),admin_notes=NULLIF(btrim(p_admin_notes),'') WHERE id=p_confirmation_id;
  RETURN jsonb_build_object('ok',true,'requestId',v_request_id,'confirmationId',p_confirmation_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_subscription_payment_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_released integer := 0;
BEGIN
  UPDATE public.subscription_payment_requests SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now())
  WHERE id=p_request_id AND status IN ('pending','confirmation_submitted');
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment request is not open'; END IF;
  UPDATE public.subscription_payment_confirmations SET status='rejected',reviewed_at=now(),admin_notes='Payment request cancelled by administrator'
  WHERE request_id=p_request_id AND status='pending';

  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',processing_error='released_with_cancelled_request'
  WHERE request_id=p_request_id AND status='initialized';
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object('ok',true,'requestId',p_request_id,'releasedCheckouts',v_released);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) TO service_role;

-- The staff equivalent of the learner's Remove button.
--
-- dismiss_paystack_cart deliberately refuses anything with a request attached: for a learner, a
-- checkout against their open invoice is not a basket item to throw away. But a checkout left
-- behind by an invoice that has since been cancelled or paid is attached to nothing that matters,
-- and it goes on blocking the learner from paying at all. That is the row staff need to clear and
-- the learner cannot, so it gets its own function rather than loosening theirs.
--
-- The caller asks Paystack before this runs. A terminal failure may therefore already have been
-- written by the guard; accepting that as an idempotent success keeps the report aligned with the
-- release that already happened, while every state in which money may settle remains refused.
CREATE OR REPLACE FUNCTION public.clear_paystack_checkout_for_staff(p_reference text, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_request_status text;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF v_transaction.request_id IS NOT NULL THEN
    SELECT status INTO v_request_status FROM public.subscription_payment_requests WHERE id=v_transaction.request_id;
    -- An open invoice still owns its checkout. Clearing that would pull a live payment out from
    -- under a bill the learner is in the middle of settling.
    IF v_request_status IS NULL OR v_request_status NOT IN ('cancelled','paid') THEN
      RETURN jsonb_build_object('ok',false,'status','request_still_open');
    END IF;
  END IF;

  IF v_transaction.status IN ('failed','abandoned','reversed') THEN
    RETURN jsonb_build_object('ok',true,'status','already_released');
  END IF;
  IF v_transaction.status<>'initialized' THEN
    RETURN jsonb_build_object('ok',false,'status','not_dismissable','transactionStatus',v_transaction.status);
  END IF;

  -- Who cleared it, on the column that already records why a row was closed. A staff member
  -- closing somebody else's checkout is worth being able to trace back later.
  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',cart_dismissed_at=now(),processing_error='cleared_by_staff:'||COALESCE(p_actor_id::text,'unknown')
  WHERE id=v_transaction.id;
  RETURN jsonb_build_object('ok',true,'status','dismissed');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_paystack_checkout_for_staff(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_paystack_checkout_for_staff(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_unused_subscription_plan(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_cohort_id uuid; v_content record;
BEGIN
  SELECT cohort_id INTO v_cohort_id FROM public.subscription_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.individual_subscriptions WHERE plan_id=p_plan_id) THEN RAISE EXCEPTION 'This plan has subscriber history and cannot be deleted. Deactivate it instead.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE plan_id=p_plan_id) THEN RAISE EXCEPTION 'This plan has payment history and cannot be deleted. Deactivate it instead.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payment_requests WHERE plan_id=p_plan_id) THEN RAISE EXCEPTION 'This plan has payment-request history and cannot be deleted. Deactivate it instead.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_plan_changes WHERE old_plan_id=p_plan_id OR new_plan_id=p_plan_id) THEN RAISE EXCEPTION 'This plan has plan-change history and cannot be deleted. Deactivate it instead.'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE cohort_id=v_cohort_id OR original_cohort_id=v_cohort_id) THEN RAISE EXCEPTION 'This plan access cohort is still assigned to a student and cannot be deleted.'; END IF;
  FOR v_content IN SELECT content_table,content_id FROM public.subscription_plan_content WHERE plan_id=p_plan_id LOOP
    PERFORM public.toggle_content_cohort_tag(v_content.content_table,v_content.content_id,v_cohort_id,false);
  END LOOP;
  DELETE FROM public.cohort_assignments WHERE cohort_id=v_cohort_id;
  DELETE FROM public.subscription_plans WHERE id=p_plan_id;
  DELETE FROM public.cohorts WHERE id=v_cohort_id;
  RETURN jsonb_build_object('ok',true,'planId',p_plan_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_unused_subscription_plan(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unused_subscription_plan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.close_individual_subscription(p_subscription_id uuid, p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student_id uuid; v_cohort_id uuid; v_status text; v_period_end timestamptz;
BEGIN
  IF p_new_status NOT IN ('cancelled','expired') THEN RAISE EXCEPTION 'invalid target status: %', p_new_status; END IF;
  SELECT student_id,cohort_id INTO v_student_id,v_cohort_id FROM public.individual_subscriptions WHERE id=p_subscription_id;
  IF NOT FOUND OR v_student_id IS NULL THEN RETURN jsonb_build_object('ok',true,'skipped',true,'reason','not_found'); END IF;
  PERFORM public.claim_student_enrollment_model(v_student_id,'individual');
  SELECT status,current_period_end INTO v_status,v_period_end FROM public.individual_subscriptions WHERE id=p_subscription_id FOR UPDATE;
  IF p_new_status='expired' AND (v_status <> 'active' OR v_period_end >= now()) THEN
    RETURN jsonb_build_object('ok',true,'skipped',true,'reason','no_longer_applicable');
  END IF;
  UPDATE public.individual_subscriptions SET status=p_new_status,
    cancelled_at=CASE WHEN p_new_status='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END
  WHERE id=p_subscription_id;
  UPDATE public.students SET cohort_id=NULL WHERE id=v_student_id AND cohort_id=v_cohort_id;
  RETURN jsonb_build_object('ok',true,'skipped',false,'status',p_new_status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.close_individual_subscription(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_individual_subscription(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_subscription_plan_content(
  p_plan_id uuid,
  p_content_table text,
  p_content_id uuid,
  p_actor_id uuid,
  p_add boolean,
  p_clear_public boolean DEFAULT false,
  p_ca_content_type text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cohort_id uuid;
BEGIN
  IF p_content_table NOT IN ('courses','virtual_experiences','certifications','learning_paths') THEN
    RAISE EXCEPTION 'invalid content table: %', p_content_table;
  END IF;

  SELECT cohort_id INTO v_cohort_id FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  -- Only ever on request, and only while adding. The caller has already shown the author who
  -- loses access; this is the point where that answer is acted on.
  IF p_add AND p_clear_public THEN
    EXECUTE format('UPDATE public.%I SET available_to_everyone = false WHERE id = $1', p_content_table)
      USING p_content_id;
  END IF;

  IF p_add THEN
    INSERT INTO public.subscription_plan_content (plan_id, content_table, content_id, added_by)
    VALUES (p_plan_id, p_content_table, p_content_id, p_actor_id)
    ON CONFLICT (plan_id, content_table, content_id) DO NOTHING;
  ELSE
    DELETE FROM public.subscription_plan_content
    WHERE plan_id = p_plan_id
      AND content_table = p_content_table
      AND content_id = p_content_id;
  END IF;

  -- The tag is what actually grants access. If it fails, nothing above it may stand.
  PERFORM public.toggle_content_cohort_tag(p_content_table, p_content_id, v_cohort_id, p_add);

  IF p_ca_content_type IS NOT NULL THEN
    IF p_add THEN
      INSERT INTO public.cohort_assignments (content_id, content_type, cohort_id)
      VALUES (p_content_id, p_ca_content_type, v_cohort_id)
      ON CONFLICT (content_id, cohort_id) DO NOTHING;
    ELSE
      DELETE FROM public.cohort_assignments
      WHERE content_id = p_content_id AND cohort_id = v_cohort_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'planId', p_plan_id, 'contentId', p_content_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_content_cohort_tag(p_content_table text,p_content_id uuid,p_cohort_id uuid,p_add boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_content_table NOT IN ('courses','virtual_experiences','certifications','learning_paths') THEN RAISE EXCEPTION 'invalid content table: %', p_content_table; END IF;
  IF p_add THEN
    EXECUTE format('UPDATE public.%I SET cohort_ids=array_append(cohort_ids,$1) WHERE id=$2 AND NOT ($1=ANY(cohort_ids))',p_content_table) USING p_cohort_id,p_content_id;
  ELSE
    EXECUTE format('UPDATE public.%I SET cohort_ids=array_remove(cohort_ids,$1) WHERE id=$2',p_content_table) USING p_cohort_id,p_content_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text,uuid,uuid,boolean) TO service_role;

-- Migration 173: final reversible enrollment-model transition rules. This override is
-- intentionally after subscription_payment_requests exists because it checks open requests.
CREATE OR REPLACE FUNCTION public.claim_student_enrollment_model(p_student_id uuid,p_requested_model text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_current text; v_cohort_id uuid; v_original_cohort_id uuid;
BEGIN
  IF p_requested_model NOT IN ('bootcamp','individual') THEN RAISE EXCEPTION 'invalid enrollment model: %',p_requested_model; END IF;
  SELECT enrollment_model,cohort_id,original_cohort_id INTO v_current,v_cohort_id,v_original_cohort_id
  FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student % not found',p_student_id; END IF;
  IF v_current=p_requested_model THEN RETURN; END IF;
  IF v_current IS NULL THEN
    IF p_requested_model='individual' AND (v_cohort_id IS NOT NULL OR v_original_cohort_id IS NOT NULL) THEN
      RAISE EXCEPTION 'remove this student from their bootcamp cohort before assigning an individual subscription' USING ERRCODE='unique_violation';
    END IF;
    UPDATE public.students SET enrollment_model=p_requested_model WHERE id=p_student_id;
    RETURN;
  END IF;
  IF v_current='bootcamp' AND p_requested_model='individual' AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL THEN
    UPDATE public.bootcamp_enrollments SET released_at=COALESCE(released_at,now()),updated_at=now()
    WHERE student_id=p_student_id AND released_at IS NULL;
    UPDATE public.students SET enrollment_model='individual' WHERE id=p_student_id;
    RETURN;
  END IF;
  IF v_current='individual' AND p_requested_model='bootcamp' AND v_cohort_id IS NULL AND v_original_cohort_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.individual_subscriptions WHERE student_id=p_student_id AND status='active')
     AND NOT EXISTS (SELECT 1 FROM public.subscription_payment_requests WHERE student_id=p_student_id AND status IN ('pending','confirmation_submitted')) THEN
    UPDATE public.students SET enrollment_model='bootcamp' WHERE id=p_student_id;
    RETURN;
  END IF;
  RAISE EXCEPTION 'student % already belongs to the % enrollment model',p_student_id,v_current USING ERRCODE='unique_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid,text) TO service_role;

-- ── overdue notice delivery (migration 181) ───────────────────
-- Delivery policy: AT MOST ONCE. A payment demand sent twice is worse than one not sent, because
-- the student is also shown the restriction banner in the app. "Already told" is a fact about the
-- episode rather than about time, so a standing debt is never re-mailed while a later installment
-- falling due still is.
--
-- The claim is taken before the send and carries a token, so neither a concurrent worker nor a
-- stalled one that has been taken over can mail or finalize the same episode. The send is marked
-- as begun before Resend is contacted: a later worker finding that marker still set knows the
-- outcome was never recorded, and finalizes without sending rather than risk a second demand.

CREATE FUNCTION public.claim_overdue_notice(
  p_enrollment_id uuid,
  p_due_date date,
  p_ttl_seconds integer DEFAULT 300,
  p_max_attempts integer DEFAULT 5
) RETURNS TABLE (claim_token uuid, resume_ambiguous boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  UPDATE public.bootcamp_enrollments e
  SET overdue_notice_claimed_at = now(),
      overdue_notice_claim_token = v_token
  WHERE e.id = p_enrollment_id
    AND e.overdue_notice_for_due_date IS DISTINCT FROM p_due_date
    AND (
      e.overdue_notice_claimed_at IS NULL
      OR e.overdue_notice_claimed_at < now() - make_interval(secs => p_ttl_seconds)
    )
    AND (
      e.overdue_notice_attempted_for_due_date IS DISTINCT FROM p_due_date
      OR e.overdue_notice_attempts < p_max_attempts
    )
  RETURNING v_token,
            e.overdue_notice_send_started_for_due_date IS NOT DISTINCT FROM p_due_date;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_overdue_notice(uuid, date, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_overdue_notice(uuid, date, integer, integer) TO service_role;

CREATE FUNCTION public.begin_overdue_notice_send(
  p_enrollment_id uuid,
  p_due_date date,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
BEGIN
  UPDATE public.bootcamp_enrollments
  SET overdue_notice_send_started_for_due_date = p_due_date
  WHERE id = p_enrollment_id
    AND overdue_notice_claim_token = p_claim_token
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.begin_overdue_notice_send(uuid, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_overdue_notice_send(uuid, date, uuid) TO service_role;

CREATE FUNCTION public.release_overdue_notice_claim(
  p_enrollment_id uuid,
  p_due_date date,
  p_claim_token uuid,
  p_error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
BEGIN
  UPDATE public.bootcamp_enrollments
  SET overdue_notice_claimed_at = NULL,
      overdue_notice_claim_token = NULL,
      overdue_notice_send_started_for_due_date = NULL,
      overdue_notice_attempts = CASE
        WHEN overdue_notice_attempted_for_due_date IS DISTINCT FROM p_due_date THEN 1
        ELSE overdue_notice_attempts + 1
      END,
      overdue_notice_attempted_for_due_date = p_due_date,
      overdue_notice_last_error = left(COALESCE(p_error, 'Unknown error'), 500)
  WHERE id = p_enrollment_id
    AND overdue_notice_claim_token = p_claim_token
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_overdue_notice_claim(uuid, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_overdue_notice_claim(uuid, date, uuid, text) TO service_role;

CREATE FUNCTION public.mark_overdue_notice_sent(
  p_enrollment_id uuid,
  p_due_date date,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
BEGIN
  UPDATE public.bootcamp_enrollments
  SET overdue_notice_for_due_date = p_due_date,
      overdue_notice_claimed_at = NULL,
      overdue_notice_claim_token = NULL,
      overdue_notice_send_started_for_due_date = NULL,
      overdue_notice_attempts = 0,
      overdue_notice_attempted_for_due_date = NULL,
      overdue_notice_last_error = NULL
  WHERE id = p_enrollment_id
    AND overdue_notice_claim_token = p_claim_token
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_notice_sent(uuid, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_overdue_notice_sent(uuid, date, uuid) TO service_role;

-- ------------------------------------------------------------
-- ============================================================================
--  Migration 187: Paystack transactions, webhook delivery, and review incidents
-- ============================================================================

-- Paystack one-time payments for fixed-duration subscriptions.
--
-- Three records have three jobs:
--   transactions: checkout, provider verification, and exactly-once crediting
--   webhook events: signed delivery deduplication and bounded processing retries
--   review incidents: the single durable queue for anything requiring a person

CREATE TABLE IF NOT EXISTS public.paystack_subscription_transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference               text NOT NULL UNIQUE CHECK (length(btrim(reference)) > 0),
  authorization_url       text,
  student_id              uuid REFERENCES public.students(id) ON DELETE SET NULL,
  request_id              uuid REFERENCES public.subscription_payment_requests(id) ON DELETE SET NULL,
  plan_id                 uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name               text NOT NULL,
  duration_months         integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount                  numeric(10,2) NOT NULL CHECK (amount > 0),
  currency                text NOT NULL DEFAULT 'GHS',
  status                  text NOT NULL DEFAULT 'initialized' CHECK (status IN (
                            'initialized','pending','ongoing','processing','queued',
                            'success','failed','abandoned','reversed','needs_review'
                          )),
  paystack_transaction_id bigint,
  channel                 text,
  gateway_response        text,
  processed_payment_id    uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  verified_at             timestamptz,
  processed_at            timestamptz,
  processing_error        text,
  -- Migration 190: an unfinished checkout is a cart. Nothing new holds one; these record
  -- that the learner cleared it and how many of the three reminders have gone out.
  cart_dismissed_at       timestamptz,
  reminder_count          integer NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  last_reminder_at        timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_paystack_subscription_transactions_student
  ON public.paystack_subscription_transactions(student_id,created_at DESC);
CREATE INDEX idx_paystack_subscription_transactions_request
  ON public.paystack_subscription_transactions(request_id);
CREATE INDEX idx_paystack_subscription_transactions_status
  ON public.paystack_subscription_transactions(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paystack_subscription_transactions_in_flight_reconcile
  ON public.paystack_subscription_transactions(updated_at)
  WHERE status IN ('pending','ongoing','processing','queued') AND processed_payment_id IS NULL;
CREATE UNIQUE INDEX idx_paystack_subscription_transactions_paystack_id
  ON public.paystack_subscription_transactions(paystack_transaction_id)
  WHERE paystack_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX idx_paystack_subscription_transactions_open_request
  ON public.paystack_subscription_transactions(request_id)
  WHERE request_id IS NOT NULL AND status IN (
    'initialized','pending','ongoing','processing','queued','success','needs_review'
  );

ALTER TABLE public.paystack_subscription_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_subscription_transactions: student read own"
  ON public.paystack_subscription_transactions FOR SELECT
  USING (student_id=(SELECT auth.uid()));
CREATE POLICY "paystack_subscription_transactions: owner or admin read"
  ON public.paystack_subscription_transactions FOR SELECT
  USING (
    (SELECT public.is_admin()) OR (
      (SELECT public.is_instructor_or_admin()) AND EXISTS (
        SELECT 1 FROM public.subscription_plans plan
        WHERE plan.id=paystack_subscription_transactions.plan_id
          AND plan.created_by=(SELECT auth.uid())
      )
    )
  );
CREATE TRIGGER trg_paystack_subscription_transactions_updated_at
  BEFORE UPDATE ON public.paystack_subscription_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.paystack_webhook_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_hash                 text NOT NULL UNIQUE,
  event_name                 text,
  reference                  text,
  transaction_id             bigint,
  event_status               text,
  event_amount_minor         bigint,
  event_occurred_at          timestamptz,
  received_at                timestamptz NOT NULL DEFAULT now(),
  processed_at               timestamptz,
  processing_attempts        integer NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  last_processing_attempt_at timestamptz,
  processing_error           text,
  dead_lettered_at           timestamptz
);

CREATE INDEX idx_paystack_webhook_events_retry
  ON public.paystack_webhook_events(processing_attempts,received_at)
  WHERE processed_at IS NULL;
ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_webhook_events: admin read"
  ON public.paystack_webhook_events FOR SELECT
  USING ((SELECT public.is_admin()));

CREATE TABLE IF NOT EXISTS public.paystack_review_incidents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key                text NOT NULL UNIQUE CHECK (length(btrim(incident_key)) > 0),
  transaction_id              uuid REFERENCES public.paystack_subscription_transactions(id) ON DELETE SET NULL,
  webhook_event_id            uuid REFERENCES public.paystack_webhook_events(id) ON DELETE SET NULL,
  student_id                  uuid REFERENCES public.students(id) ON DELETE SET NULL,
  plan_id                     uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  reference                   text,
  provider_transaction_id     bigint,
  kind                        text NOT NULL,
  reason                      text NOT NULL,
  event_name                  text,
  amount                      numeric(10,2),
  currency                    text,
  blocks_credit               boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  notification_attempts       integer NOT NULL DEFAULT 0 CHECK (notification_attempts >= 0),
  notification_last_attempt_at timestamptz,
  notification_sent_at        timestamptz,
  notification_error          text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  resolved_at                 timestamptz,
  resolved_by                 uuid REFERENCES public.students(id) ON DELETE SET NULL,
  resolution_note             text
);

CREATE INDEX idx_paystack_review_incidents_open
  ON public.paystack_review_incidents(created_at DESC) WHERE status='open';
CREATE INDEX idx_paystack_review_incidents_notify
  ON public.paystack_review_incidents(notification_attempts,created_at)
  WHERE status='open' AND notification_sent_at IS NULL;
CREATE INDEX idx_paystack_review_incidents_transaction
  ON public.paystack_review_incidents(transaction_id,status);
ALTER TABLE public.paystack_review_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_review_incidents: owner or admin read"
  ON public.paystack_review_incidents FOR SELECT
  USING (
    (SELECT public.is_admin()) OR (
      (SELECT public.is_instructor_or_admin()) AND EXISTS (
        SELECT 1 FROM public.subscription_plans plan
        WHERE plan.id=paystack_review_incidents.plan_id
          AND plan.created_by=(SELECT auth.uid())
      )
    )
  );
CREATE TRIGGER trg_paystack_review_incidents_updated_at
  BEFORE UPDATE ON public.paystack_review_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.paystack_checkout_rate_limits (
  student_id       uuid NOT NULL,
  scope            text NOT NULL DEFAULT 'checkout',
  window_started_at timestamptz NOT NULL,
  attempts         integer NOT NULL DEFAULT 0,
  PRIMARY KEY(student_id,scope,window_started_at)
);
ALTER TABLE public.paystack_checkout_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job_name        text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now(),
  last_summary    jsonb
);
ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_heartbeats: admin read"
  ON public.cron_heartbeats FOR SELECT
  USING ((SELECT public.is_admin()));

CREATE OR REPLACE FUNCTION public.claim_paystack_checkout_attempt(
  p_student_id uuid,p_limit integer DEFAULT 5,p_window_seconds integer DEFAULT 600,p_scope text DEFAULT 'checkout'
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window timestamptz; v_attempts integer; v_scope text;
BEGIN
  IF p_limit<1 OR p_window_seconds<1 THEN RAISE EXCEPTION 'invalid rate limit configuration'; END IF;
  v_scope:=COALESCE(NULLIF(btrim(p_scope),''),'checkout');
  v_window:=to_timestamp(floor(extract(epoch FROM now())/p_window_seconds)*p_window_seconds);
  INSERT INTO public.paystack_checkout_rate_limits(student_id,scope,window_started_at,attempts)
  VALUES(p_student_id,v_scope,v_window,1)
  ON CONFLICT(student_id,scope,window_started_at)
  DO UPDATE SET attempts=public.paystack_checkout_rate_limits.attempts+1
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts<=p_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_checkout_attempt(uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_checkout_attempt(uuid,integer,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_paystack_webhook_event(
  p_event_hash text,p_stale_after_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event public.paystack_webhook_events%ROWTYPE;
BEGIN
  UPDATE public.paystack_webhook_events
  SET processing_attempts=processing_attempts+1,last_processing_attempt_at=now()
  WHERE event_hash=p_event_hash AND processed_at IS NULL
    AND(last_processing_attempt_at IS NULL OR last_processing_attempt_at<now()-make_interval(secs=>GREATEST(p_stale_after_seconds,1)))
  RETURNING * INTO v_event;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'event_hash',v_event.event_hash,'event_name',v_event.event_name,'reference',v_event.reference,
    'transaction_id',v_event.transaction_id,'event_status',v_event.event_status,
    'event_amount_minor',v_event.event_amount_minor,'event_occurred_at',v_event.event_occurred_at,
    'processing_attempts',v_event.processing_attempts
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_webhook_event(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_webhook_event(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.open_paystack_transaction_incident(
  p_reference text,p_kind text,p_reason text,p_blocks_credit boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_incident public.paystack_review_incidents%ROWTYPE;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.paystack_review_incidents AS existing(
    incident_key,transaction_id,student_id,plan_id,reference,provider_transaction_id,
    kind,reason,amount,currency,blocks_credit
  ) VALUES(
    'transaction:'||v_transaction.id::text||':'||p_kind,v_transaction.id,v_transaction.student_id,
    v_transaction.plan_id,v_transaction.reference,v_transaction.paystack_transaction_id,
    p_kind,p_reason,v_transaction.amount,v_transaction.currency,COALESCE(p_blocks_credit,true)
  ) ON CONFLICT(incident_key) DO UPDATE SET
    reason=EXCLUDED.reason,
    blocks_credit=EXCLUDED.blocks_credit,
    status=CASE WHEN existing.status='resolved' THEN 'open' ELSE existing.status END,
    resolved_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolved_at END,
    resolved_by=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolved_by END,
    resolution_note=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolution_note END,
    notification_attempts=CASE WHEN existing.status='resolved' THEN 0 ELSE existing.notification_attempts END,
    notification_last_attempt_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_last_attempt_at END,
    notification_sent_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_sent_at END,
    notification_error=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_error END,
    updated_at=now()
  RETURNING * INTO v_incident;
  UPDATE public.paystack_subscription_transactions
  SET status='needs_review',processing_error=p_reason WHERE id=v_transaction.id AND processed_payment_id IS NULL;
  RETURN jsonb_build_object('id',v_incident.id,'reference',v_transaction.reference,'status','needs_review');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_paystack_transaction_incident(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_transaction_incident(text,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.record_paystack_webhook_incident(
  p_event_hash text,p_kind text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_event public.paystack_webhook_events%ROWTYPE;
  v_transaction public.paystack_subscription_transactions%ROWTYPE;
  v_incident public.paystack_review_incidents%ROWTYPE;
  v_key text;
  v_blocks boolean;
BEGIN
  SELECT * INTO v_event FROM public.paystack_webhook_events WHERE event_hash=p_event_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE(v_event.reference IS NOT NULL AND reference=v_event.reference)
     OR(v_event.transaction_id IS NOT NULL AND paystack_transaction_id=v_event.transaction_id)
  ORDER BY CASE WHEN reference=v_event.reference THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE;

  IF v_transaction.id IS NULL AND COALESCE(v_event.reference,'') NOT LIKE 'sub-%' THEN
    RETURN jsonb_build_object('status','ignored','reason','not_platform_payment');
  END IF;

  IF v_event.event_name='charge.dispute.remind' AND v_transaction.id IS NOT NULL THEN
    SELECT * INTO v_incident FROM public.paystack_review_incidents
    WHERE transaction_id=v_transaction.id AND status='open'
      AND event_name IN('charge.dispute.create','charge.dispute.remind')
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id',v_incident.id,'status','already_open','reference',v_incident.reference);
    END IF;
  END IF;
  v_key:='event:'||v_event.event_hash;
  v_blocks:=v_transaction.id IS NOT NULL AND v_transaction.processed_payment_id IS NULL;

  INSERT INTO public.paystack_review_incidents(
    incident_key,transaction_id,webhook_event_id,student_id,plan_id,reference,provider_transaction_id,
    kind,reason,event_name,amount,currency,blocks_credit
  ) VALUES(
    v_key,v_transaction.id,v_event.id,v_transaction.student_id,v_transaction.plan_id,
    COALESCE(v_transaction.reference,v_event.reference),COALESCE(v_transaction.paystack_transaction_id,v_event.transaction_id),
    p_kind,p_reason,v_event.event_name,
    CASE WHEN v_event.event_amount_minor IS NULL THEN NULL ELSE v_event.event_amount_minor::numeric/100 END,
    v_transaction.currency,v_blocks
  ) ON CONFLICT(incident_key) DO NOTHING RETURNING * INTO v_incident;

  IF v_incident.id IS NULL THEN
    SELECT * INTO v_incident FROM public.paystack_review_incidents WHERE incident_key=v_key;
    RETURN jsonb_build_object('id',v_incident.id,'status','already_open','reference',v_incident.reference);
  END IF;
  IF v_blocks THEN
    UPDATE public.paystack_subscription_transactions
    SET status='needs_review',processing_error=p_reason WHERE id=v_transaction.id;
  END IF;
  RETURN jsonb_build_object('id',v_incident.id,'status','needs_review','reference',v_incident.reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_paystack_webhook_incident(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_webhook_incident(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_paystack_subscription_transaction(
  p_reference text,p_payment_method text DEFAULT NULL,p_notes text DEFAULT NULL,p_enforce_incidents boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_transaction public.paystack_subscription_transactions%ROWTYPE;
  v_request public.subscription_payment_requests%ROWTYPE;
  v_payment public.subscription_payments%ROWTYPE;
  v_result jsonb;
  v_error_state text;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'status','ignored','reason','unknown_reference'); END IF;
  IF v_transaction.processed_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'status','success','paymentId',v_transaction.processed_payment_id,'alreadyProcessed',true);
  END IF;

  SELECT * INTO v_payment FROM public.subscription_payments WHERE idempotency_key='paystack:'||p_reference;
  IF v_payment.id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests SET status='paid',subscription_id=v_payment.subscription_id,paid_at=COALESCE(paid_at,now())
    WHERE id=v_transaction.request_id;
    UPDATE public.paystack_subscription_transactions
    SET status='success',processed_payment_id=v_payment.id,processed_at=COALESCE(processed_at,now()),processing_error=NULL
    WHERE id=v_transaction.id;
    RETURN jsonb_build_object('ok',true,'status','success','subscriptionId',v_payment.subscription_id,'paymentId',v_payment.id,'alreadyProcessed',true);
  END IF;

  IF p_enforce_incidents AND EXISTS(
    SELECT 1 FROM public.paystack_review_incidents
    WHERE transaction_id=v_transaction.id AND status='open' AND blocks_credit=true
  ) THEN
    RETURN jsonb_build_object('ok',true,'status','needs_review','reason','open_review_incident');
  END IF;
  IF v_transaction.status<>'success' THEN RAISE EXCEPTION 'Paystack transaction has not been verified successfully'; END IF;

  IF v_transaction.request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.subscription_payment_requests WHERE id=v_transaction.request_id FOR UPDATE;
    IF v_request.id IS NULL OR v_request.status<>'pending' THEN
      PERFORM public.open_paystack_transaction_incident(p_reference,'payment_request_not_open','payment_request_not_open',true);
      RETURN jsonb_build_object('ok',true,'status','needs_review','reason','payment_request_not_open');
    END IF;
  END IF;

  BEGIN
    v_result:=public.purchase_or_renew_individual_subscription(
      v_transaction.student_id,v_transaction.plan_id,v_transaction.duration_months,v_transaction.amount,v_transaction.currency,
      'paystack:'||p_reference,p_payment_method,p_reference,p_notes,v_transaction.student_id
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state=RETURNED_SQLSTATE;
    PERFORM public.open_paystack_transaction_incident(p_reference,'crediting_failed','crediting_failed:'||v_error_state,true);
    RETURN jsonb_build_object('ok',true,'status','needs_review','reason','crediting_failed');
  END;

  IF v_request.id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests
    SET status='paid',subscription_id=(v_result->>'subscriptionId')::uuid,paid_at=now() WHERE id=v_request.id;
  END IF;
  UPDATE public.paystack_subscription_transactions
  SET status='success',processed_payment_id=(v_result->>'paymentId')::uuid,processed_at=now(),processing_error=NULL
  WHERE id=v_transaction.id;
  RETURN v_result||jsonb_build_object('status','success');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) TO service_role;

-- Reserving a direct checkout, atomically.
--
-- The payment request used to make this safe as a side effect: one open request per learner was a
-- unique index, so a second checkout could not exist. Removing the request removed that, and a
-- check-then-insert in application code does not replace it -- two tabs both pass the check, both
-- insert, and the learner ends up holding two payable Paystack links.
--
-- Serialized on the learner's own row, so concurrent calls queue rather than race. The partial
-- unique index below is the backstop if anything ever inserts without going through here.
--
-- "Money may already have moved" deliberately excludes a success that has been credited. A
-- credited payment is finished history, and treating it as in-flight blocked every renewal a
-- learner would ever make after their first payment.
CREATE OR REPLACE FUNCTION public.open_paystack_direct_checkout(
  p_student_id uuid,p_reference text,p_plan_id uuid,p_plan_name text,
  p_duration_months integer,p_amount numeric,p_currency text,
  p_link_stale_after interval DEFAULT interval '30 minutes',
  p_initializing_grace interval DEFAULT interval '5 minutes'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_live public.paystack_subscription_transactions%ROWTYPE;
  v_request_status text;
BEGIN
  PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;

  SELECT status INTO v_request_status FROM public.subscription_payment_requests
  WHERE student_id=p_student_id AND status IN('pending','confirmation_submitted') LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','open_request','requestStatus',v_request_status);
  END IF;

  SELECT * INTO v_live FROM public.paystack_subscription_transactions
  WHERE student_id=p_student_id
    AND (status IN('initialized','pending','ongoing','processing','queued','needs_review')
         OR (status='success' AND processed_payment_id IS NULL))
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_live.status<>'initialized' OR v_live.request_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus',v_live.status);
    END IF;
    IF v_live.authorization_url IS NOT NULL AND v_live.updated_at > now()-p_link_stale_after THEN
      IF v_live.plan_id=p_plan_id AND v_live.duration_months=p_duration_months
         AND v_live.amount=p_amount AND v_live.currency=upper(btrim(COALESCE(p_currency,'GHS'))) THEN
        RETURN jsonb_build_object(
          'status','existing','reference',v_live.reference,'authorizationUrl',v_live.authorization_url
        );
      END IF;
      -- Names what is actually open. Saying "another plan" was wrong and confusing: the most
      -- common way to reach this is a renewal, where the unfinished checkout is the same plan
      -- at a different length, so the learner was told about a plan that did not exist.
      RETURN jsonb_build_object(
        'status','payment_in_progress','blockingStatus','initialized',
        'openPlanName',v_live.plan_name,'openDurationMonths',v_live.duration_months
      );
    END IF;
    -- A row with no link yet, reserved moments ago, is another tab still talking to Paystack. The
    -- lock is released as soon as this returns, so that gap is real and lasts as long as the
    -- provider call. Handing it out as 'unverified' let the second tab ask Paystack, get a 404
    -- purely because the first had not finished, release the first tab's row and start its own --
    -- and both tabs would come back holding a payable link.
    IF v_live.authorization_url IS NULL AND v_live.updated_at > now()-p_initializing_grace THEN
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus','initializing');
    END IF;

    -- No usable link, and old enough that Paystack is the only authority on it.
    RETURN jsonb_build_object(
      'status','unverified','reference',v_live.reference,'authorizationUrl',v_live.authorization_url
    );
  END IF;

  INSERT INTO public.paystack_subscription_transactions(
    reference,student_id,request_id,plan_id,plan_name,duration_months,amount,currency,status
  ) VALUES(
    p_reference,p_student_id,NULL,p_plan_id,p_plan_name,p_duration_months,p_amount,
    upper(btrim(COALESCE(p_currency,'GHS'))),'initialized'
  );
  RETURN jsonb_build_object('status','created','reference',p_reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_paystack_direct_checkout(uuid,text,uuid,text,integer,numeric,text,interval,interval) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_direct_checkout(uuid,text,uuid,text,integer,numeric,text,interval,interval) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paystack_direct_checkout_one_live
  ON public.paystack_subscription_transactions(student_id)
  WHERE request_id IS NULL
    AND (status IN('initialized','pending','ongoing','processing','queued','needs_review')
         OR (status='success' AND processed_payment_id IS NULL));


CREATE OR REPLACE FUNCTION public.resolve_paystack_review_incident(
  p_incident_id uuid,p_actor_id uuid,p_resolution_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_incident public.paystack_review_incidents%ROWTYPE;
  v_role text;
  v_owner uuid;
BEGIN
  SELECT * INTO v_incident FROM public.paystack_review_incidents WHERE id=p_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment incident not found'; END IF;
  SELECT role INTO v_role FROM public.students WHERE id=p_actor_id;
  IF v_incident.plan_id IS NOT NULL THEN
    SELECT created_by INTO v_owner FROM public.subscription_plans WHERE id=v_incident.plan_id;
  END IF;
  IF v_role<>'admin' AND(v_role<>'instructor' OR v_owner IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
  END IF;
  IF v_incident.status='resolved' THEN
    RETURN jsonb_build_object('ok',true,'alreadyResolved',true);
  END IF;
  UPDATE public.paystack_review_incidents SET
    status='resolved',resolved_at=now(),resolved_by=p_actor_id,
    resolution_note=NULLIF(btrim(COALESCE(p_resolution_note,'')),'')
  WHERE id=v_incident.id;
  IF v_incident.blocks_credit AND v_incident.transaction_id IS NOT NULL THEN
    UPDATE public.paystack_subscription_transactions SET status='pending',processing_error=NULL
    WHERE id=v_incident.transaction_id AND status='needs_review' AND processed_payment_id IS NULL;
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_paystack_review_incident(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_paystack_review_incident(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_paystack_operational_data(p_before timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.paystack_webhook_events event
  WHERE event.processed_at IS NOT NULL AND event.received_at<p_before
    AND NOT EXISTS(
      SELECT 1 FROM public.paystack_review_incidents incident
      WHERE incident.webhook_event_id=event.id AND incident.status='open'
    );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  DELETE FROM public.paystack_review_incidents WHERE status='resolved' AND resolved_at<p_before;
  DELETE FROM public.paystack_checkout_rate_limits WHERE window_started_at<LEAST(p_before,now()-interval '1 day');
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_paystack_operational_data(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_paystack_operational_data(timestamptz) TO service_role;

-- ============================================================================
--  Migration 188: reusable subscription plan prices
-- ============================================================================

-- Public purchase prices for reusable subscription plans.
-- Admins own the pricing; students can only choose an active price row.

CREATE TABLE IF NOT EXISTS public.subscription_plan_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  duration_months integer NOT NULL CHECK (duration_months IN (1, 3, 6, 12)),
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  currency        text NOT NULL DEFAULT 'GHS',
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, duration_months, currency)
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan
  ON public.subscription_plan_prices(plan_id, sort_order, duration_months);

ALTER TABLE public.subscription_plan_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_plan_prices: instructor all"
  ON public.subscription_plan_prices FOR ALL
  USING (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND (p.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  )
  WITH CHECK (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND (p.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  );

CREATE POLICY "subscription_plan_prices: student read active"
  ON public.subscription_plan_prices FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.subscription_plans p
      WHERE p.id = subscription_plan_prices.plan_id
        AND p.status = 'active'
    )
  );

CREATE TRIGGER trg_subscription_plan_prices_updated_at
  BEFORE UPDATE ON public.subscription_plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_individual_subscription_payment_request(
  p_student_id uuid, p_plan_id uuid, p_duration_months integer, p_amount numeric,
  p_currency text, p_due_date date, p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_kind text;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_student_model text;
  v_request_id uuid;
  v_currency text;
BEGIN
  IF p_duration_months NOT IN (1,3,6,12) THEN RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  IF p_due_date IS NULL OR p_due_date < current_date THEN RAISE EXCEPTION 'payment deadline cannot be in the past'; END IF;
  v_currency := upper(btrim(COALESCE(p_currency,'')));
  IF v_currency='' THEN RAISE EXCEPTION 'currency is required'; END IF;

  SELECT enrollment_model INTO v_student_model FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found'; END IF;
  IF v_student_model='bootcamp' THEN
    RAISE EXCEPTION 'bootcamp learners cannot purchase an individual subscription' USING ERRCODE='unique_violation';
  END IF;

  -- Under the lock above, so a checkout cannot appear between this and the insert below.
  IF EXISTS(
    SELECT 1 FROM public.paystack_subscription_transactions t
    WHERE t.student_id=p_student_id AND t.request_id IS NULL
      AND (t.status IN('initialized','pending','ongoing','processing','queued','needs_review')
           OR (t.status='success' AND t.processed_payment_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'an online checkout is already open for this learner' USING ERRCODE='55006';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  SELECT cohort_kind INTO v_plan_kind FROM public.cohorts WHERE id=v_plan.cohort_id;
  IF v_plan.status<>'active' OR v_plan_kind NOT IN ('legacy_individual','subscription_plan') THEN
    RAISE EXCEPTION 'subscription plan is not active or has an invalid access cohort';
  END IF;
  SELECT * INTO v_subscription FROM public.individual_subscriptions WHERE student_id=p_student_id;
  IF FOUND AND v_subscription.plan_id<>p_plan_id THEN RAISE EXCEPTION 'change the student plan before assigning a renewal payment'; END IF;

  INSERT INTO public.subscription_payment_requests(
    student_id,subscription_id,plan_id,plan_name,kind,duration_months,amount,currency,due_date,created_by
  ) VALUES (
    p_student_id,CASE WHEN v_subscription.id IS NULL THEN NULL ELSE v_subscription.id END,
    p_plan_id,v_plan.name,CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END,
    p_duration_months,p_amount,v_currency,p_due_date,p_created_by
  ) RETURNING id INTO v_request_id;
  RETURN jsonb_build_object('ok',true,'requestId',v_request_id,'planName',v_plan.name);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_subscription_payment_request(uuid,uuid,integer,numeric,text,date,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_subscription_plan_prices(
  p_plan_id uuid,p_prices jsonb,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plan public.subscription_plans%ROWTYPE; v_role text;
BEGIN
  IF jsonb_typeof(p_prices)<>'array' THEN RAISE EXCEPTION 'prices must be an array'; END IF;
  SELECT role INTO v_role FROM public.students WHERE id=p_actor_id;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;
  IF v_role<>'admin' AND(v_role<>'instructor' OR v_plan.created_by IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_prices) AS x(duration_months integer,amount numeric,currency text,is_active boolean,sort_order integer)
    WHERE duration_months NOT IN(1,3,6,12) OR amount IS NULL OR amount<=0 OR btrim(COALESCE(currency,''))=''
  ) THEN RAISE EXCEPTION 'invalid subscription price'; END IF;
  IF EXISTS(
    SELECT duration_months FROM jsonb_to_recordset(p_prices) AS x(duration_months integer)
    GROUP BY duration_months HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'duplicate subscription price duration'; END IF;
  DELETE FROM public.subscription_plan_prices WHERE plan_id=p_plan_id;
  INSERT INTO public.subscription_plan_prices(plan_id,duration_months,amount,currency,is_active,sort_order)
  SELECT p_plan_id,x.duration_months,x.amount,upper(btrim(x.currency)),COALESCE(x.is_active,true),COALESCE(x.sort_order,x.duration_months)
  FROM jsonb_to_recordset(p_prices) AS x(duration_months integer,amount numeric,currency text,is_active boolean,sort_order integer);
  RETURN jsonb_build_object('ok',true,'count',jsonb_array_length(p_prices));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.replace_subscription_plan_prices(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_subscription_plan_prices(uuid,jsonb,uuid) TO service_role;

-- Migration 190: abandoned-checkout cart.
CREATE INDEX IF NOT EXISTS idx_paystack_subscription_transactions_cart_reminders
  ON public.paystack_subscription_transactions(last_reminder_at NULLS FIRST, created_at)
  WHERE status='initialized' AND request_id IS NULL
    AND cart_dismissed_at IS NULL AND reminder_count < 3;

-- Dismissing a cart.
--
-- Only ever the learner's own, and only while nothing has been collected: the moment a checkout
-- reaches any state where Paystack may hold money, this refuses, because clearing it would let
-- them start a second payment for something they might already have bought. The row itself is
-- kept -- 'abandoned' rather than deleted -- since it is the record of a real Paystack checkout
-- and a late payment against it still has to be matched.
CREATE OR REPLACE FUNCTION public.dismiss_paystack_cart(p_student_id uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference AND student_id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF v_transaction.status<>'initialized' OR v_transaction.request_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'status','not_dismissable','transactionStatus',v_transaction.status);
  END IF;

  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',cart_dismissed_at=now(),processing_error='cart_dismissed_by_learner'
  WHERE id=v_transaction.id;
  RETURN jsonb_build_object('ok',true,'status','dismissed');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dismiss_paystack_cart(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_paystack_cart(uuid,text) TO service_role;

-- Claiming a reminder to send.
--
-- Taken under a lock and stamped before the mail goes out, so a second worker cannot send the same
-- nudge and a crash costs one reminder rather than repeating it. The schedule is deliberately
-- short and finite: roughly an hour, a day, then three days, and never again.
CREATE OR REPLACE FUNCTION public.claim_paystack_cart_reminder(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_due interval;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','not_found'); END IF;
  IF v_transaction.status<>'initialized' OR v_transaction.request_id IS NOT NULL
     OR v_transaction.cart_dismissed_at IS NOT NULL OR v_transaction.reminder_count>=3 THEN
    RETURN jsonb_build_object('claimed',false,'reason','not_eligible');
  END IF;

  -- A learner who has access is not chased about a cart -- but the cart is not taken away from
  -- them either. Dismissing it here silently undid the fix that lets renewers see their own
  -- unfinished checkout: the card vanished on the next sweep while the transaction stayed open,
  -- so they were blocked from a different duration with nothing on screen to remove. Retiring the
  -- reminders instead stops the nudges and leaves the cart visible and clearable.
  IF EXISTS(
    SELECT 1 FROM public.individual_subscriptions s
    WHERE s.student_id=v_transaction.student_id AND s.status='active' AND s.current_period_end>now()
  ) THEN
    UPDATE public.paystack_subscription_transactions
    SET reminder_count=3,processing_error='cart_reminders_stopped_active_subscription'
    WHERE id=v_transaction.id;
    RETURN jsonb_build_object('claimed',false,'reason','already_subscribed');
  END IF;

  v_due:=CASE v_transaction.reminder_count
    WHEN 0 THEN interval '1 hour'
    WHEN 1 THEN interval '24 hours'
    ELSE interval '3 days' END;
  IF COALESCE(v_transaction.last_reminder_at,v_transaction.created_at) > now()-v_due THEN
    RETURN jsonb_build_object('claimed',false,'reason','not_due');
  END IF;

  UPDATE public.paystack_subscription_transactions
  SET reminder_count=reminder_count+1,last_reminder_at=now() WHERE id=v_transaction.id;
  RETURN jsonb_build_object(
    'claimed',true,'reference',v_transaction.reference,'studentId',v_transaction.student_id,
    'planName',v_transaction.plan_name,'durationMonths',v_transaction.duration_months,
    'amount',v_transaction.amount,'currency',v_transaction.currency,
    'authorizationUrl',v_transaction.authorization_url,'reminderNumber',v_transaction.reminder_count+1
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_cart_reminder(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_cart_reminder(text) TO service_role;

-- What a visitor with no account can actually obtain.
--
-- The landing page lists every published row, so it advertises bootcamp-cohort content that
-- nobody outside that cohort can ever get. Clicking one is a dead end, and it puts private
-- client delivery on a public marketing page.
--
-- The rule matches what the content detail page already enforces, so the two surfaces finally
-- agree: it is offered to everyone, or an active plan with a live price covers it -- directly,
-- or through a published learning path that plan includes.
--
-- This is a view rather than a filter in the app because the landing page reads with the
-- anonymous key, and anonymous callers cannot read plan coverage: the RLS policy on
-- subscription_plan_content requires a matching subscription. A view runs with its owner's
-- rights, which is how the existing published_* views already serve anonymous visitors.
--
-- The existing published_* views are deliberately left alone. They are also used by the
-- certification authoring and taking screens, where an instructor must still see bootcamp
-- content, and narrowing them would break that.

CREATE OR REPLACE VIEW public.publicly_offered_content
WITH (security_barrier = true)
AS
WITH sellable_plans AS (
  -- Active plan, an access cohort that really is an individual subscription, and at least one
  -- live price. A plan with no price is not something anyone can buy.
  SELECT p.id
  FROM public.subscription_plans p
  JOIN public.cohorts c ON c.id = p.cohort_id
  WHERE p.status = 'active'
    AND c.cohort_kind IN ('legacy_individual', 'subscription_plan')
    AND EXISTS (
      SELECT 1 FROM public.subscription_plan_prices pr
      WHERE pr.plan_id = p.id AND pr.is_active
    )
),
sold_direct AS (
  SELECT spc.content_table, spc.content_id
  FROM public.subscription_plan_content spc
  JOIN sellable_plans sp ON sp.id = spc.plan_id
),
sold_via_path AS (
  -- A plan can grant a course or experience by including a learning path rather than the item
  -- itself. Miss this and content someone can genuinely buy still reads as unavailable.
  SELECT unnest(lp.item_ids) AS content_id
  FROM public.learning_paths lp
  JOIN sold_direct sd ON sd.content_table = 'learning_paths' AND sd.content_id = lp.id
  WHERE lp.status = 'published'
)
SELECT 'courses'::text AS content_table, c.id AS content_id
FROM public.courses c
WHERE c.status = 'published'
  AND (
    c.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'courses' AND s.content_id = c.id)
    OR EXISTS (SELECT 1 FROM sold_via_path v WHERE v.content_id = c.id)
  )
UNION ALL
SELECT 'virtual_experiences'::text, v.id
FROM public.virtual_experiences v
WHERE v.status = 'published'
  AND (
    v.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'virtual_experiences' AND s.content_id = v.id)
    OR EXISTS (SELECT 1 FROM sold_via_path p WHERE p.content_id = v.id)
  )
UNION ALL
SELECT 'certifications'::text, ce.id
FROM public.certifications ce
WHERE ce.status = 'published'
  AND (
    ce.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'certifications' AND s.content_id = ce.id)
    OR EXISTS (SELECT 1 FROM sold_via_path p WHERE p.content_id = ce.id)
  )
UNION ALL
-- A path is obtainable in its own right; it is never reached "through" another path.
SELECT 'learning_paths'::text, lp.id
FROM public.learning_paths lp
WHERE lp.status = 'published'
  AND (
    lp.available_to_everyone
    OR EXISTS (SELECT 1 FROM sold_direct s WHERE s.content_table = 'learning_paths' AND s.content_id = lp.id)
  );

GRANT SELECT ON public.publicly_offered_content TO anon, authenticated;

-- What the public pricing page is allowed to read, defined in SQL rather than in a projection.
--
-- The page was reading with the service role. That is not a key leak from a server component,
-- but it is the wrong boundary for a public page: the contract lives in TypeScript, where the
-- next person widening a select silently widens what the world can see. These views put it in
-- one reviewable place and let the page read with the anonymous key, like the rest of the
-- public catalogue already does.
--
-- Views run with their owner's rights, which is how published_courses already serves anonymous
-- visitors past RLS.

-- ---------------------------------------------------------------------------
-- Everything an account with no plan can already open.
--
-- Not just rows flagged available_to_everyone. The access rule on each content table also opens
-- an item that sits inside a PUBLISHED, FREE learning path, and that clause carries no login
-- requirement either. Counting only the flag understates the free tier and makes the pricing
-- page promise less than a new learner actually gets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_free_content
WITH (security_barrier = true)
AS
WITH free_path_items AS (
  SELECT unnest(lp.item_ids) AS content_id
  FROM public.learning_paths lp
  WHERE lp.status = 'published' AND lp.available_to_everyone
)
SELECT 'courses'::text AS content_table, c.id AS content_id
FROM public.courses c
WHERE c.status = 'published'
  AND (c.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = c.id))
UNION
SELECT 'virtual_experiences'::text, v.id
FROM public.virtual_experiences v
WHERE v.status = 'published'
  AND (v.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = v.id))
UNION
SELECT 'certifications'::text, ce.id
FROM public.certifications ce
WHERE ce.status = 'published'
  AND (ce.available_to_everyone OR EXISTS (SELECT 1 FROM free_path_items f WHERE f.content_id = ce.id))
UNION
-- A path is free in its own right; it is never reached through another path.
SELECT 'learning_paths'::text, lp.id
FROM public.learning_paths lp
WHERE lp.status = 'published' AND lp.available_to_everyone;

GRANT SELECT ON public.public_free_content TO anon, authenticated;

CREATE OR REPLACE VIEW public.public_free_content_counts
WITH (security_barrier = true)
AS
SELECT content_table, count(*)::int AS content_count
FROM public.public_free_content
GROUP BY content_table;

GRANT SELECT ON public.public_free_content_counts TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plans a visitor could actually buy, with their live prices and how much of each kind of
-- content they grant.
--
-- Names and counts only. Nothing here reaches into what the content contains.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_pricing_plans
WITH (security_barrier = true)
AS
WITH published_content AS (
  SELECT 'courses'::text AS content_table, id FROM public.courses WHERE status = 'published'
  UNION ALL
  SELECT 'learning_paths'::text, id FROM public.learning_paths WHERE status = 'published'
  UNION ALL
  SELECT 'virtual_experiences'::text, id FROM public.virtual_experiences WHERE status = 'published'
  UNION ALL
  SELECT 'certifications'::text, id FROM public.certifications WHERE status = 'published'
),
sellable_plans AS (
  -- Active, an access cohort that really is an individual subscription, and at least one live
  -- price. A plan nobody can buy has no place on a pricing page.
  SELECT p.id, p.name, p.description
  FROM public.subscription_plans p
  JOIN public.cohorts c ON c.id = p.cohort_id
  WHERE p.status = 'active'
    AND p.archived_at IS NULL
    AND c.cohort_kind IN ('legacy_individual', 'subscription_plan')
    AND EXISTS (
      SELECT 1 FROM public.subscription_plan_prices pr
      WHERE pr.plan_id = p.id AND pr.is_active
    )
),
plan_coverage AS (
  -- Published only. Content withdrawn after it was attached to a plan is no longer something
  -- the plan effectively grants, so counting it would overstate the offer.
  SELECT spc.plan_id, spc.content_table, count(*)::int AS content_count
  FROM public.subscription_plan_content spc
  JOIN published_content pc
    ON pc.content_table = spc.content_table AND pc.id = spc.content_id
  GROUP BY spc.plan_id, spc.content_table
)
SELECT
  s.id   AS plan_id,
  s.name AS plan_name,
  s.description AS plan_description,
  COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', pr.id,
               'durationMonths', pr.duration_months,
               'amount', pr.amount,
               'currency', pr.currency
             ) ORDER BY pr.duration_months
           )
    FROM public.subscription_plan_prices pr
    WHERE pr.plan_id = s.id AND pr.is_active
  ), '[]'::jsonb) AS prices,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'courses'), 0)             AS courses,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'learning_paths'), 0)      AS learning_paths,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'virtual_experiences'), 0) AS virtual_experiences,
  COALESCE((SELECT content_count FROM plan_coverage pc WHERE pc.plan_id = s.id AND pc.content_table = 'certifications'), 0)      AS certifications
FROM sellable_plans s;

GRANT SELECT ON public.public_pricing_plans TO anon, authenticated;
