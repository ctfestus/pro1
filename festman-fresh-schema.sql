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
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohorts_dates_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

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
  onboarding_done    boolean     NOT NULL DEFAULT false,
  payment_exempt     boolean     NOT NULL DEFAULT false,
  username           text,
  education          jsonb       DEFAULT '[]'::jsonb,
  work_experience    jsonb       DEFAULT '[]'::jsonb,
  skills             jsonb       DEFAULT '[]'::jsonb,
  portfolio_items    jsonb       DEFAULT '[]'::jsonb,
  account_provisioned_at      timestamptz,
  setup_email_sent_at         timestamptz,
  password_setup_started_at   timestamptz,
  password_set_at             timestamptz,
  onboarding_completed_at     timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_students_username_ci ON public.students (lower(username)) WHERE username IS NOT NULL;

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
  max_attempts    integer     CHECK (max_attempts IS NULL OR max_attempts > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.question_types(c public.courses)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id',   q->>'id',
      'type', COALESCE(q->>'type', 'multiple_choice')
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
  score         numeric(5,2) CHECK (score IS NULL OR score >= 0),
  feedback      text,
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
  assigned_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
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
  CONSTRAINT check_published_requires_cohort CHECK (
    status = 'draft'
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
REVOKE EXECUTE ON FUNCTION public.valid_group_participants(uuid, uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_role()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_instructor_or_admin() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_staff()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.my_group_ids()           TO authenticated;
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
ALTER TABLE public.courses                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_experiences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_center_datasets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_resources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_group_workspaces ENABLE ROW LEVEL SECURITY;
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
CREATE TRIGGER trg_courses_updated_at
  BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_virtual_experiences_updated_at
  BEFORE UPDATE ON public.virtual_experiences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_data_center_datasets_updated_at
  BEFORE UPDATE ON public.data_center_datasets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignment_submissions_updated_at
  BEFORE UPDATE ON public.assignment_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assignment_group_workspaces_updated_at
  BEFORE UPDATE ON public.assignment_group_workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Prevents students from modifying graded fields (replaces the recursive RLS WITH CHECK).
-- NOTE: Do NOT put a subquery in the trigger WHEN clause — Postgres forbids it.
--       The role check lives inside the function body instead.
DROP TRIGGER IF EXISTS trg_protect_submission_graded_fields ON public.assignment_submissions;

CREATE OR REPLACE FUNCTION public.protect_submission_graded_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.students WHERE id = auth.uid()) = 'student' THEN
    IF NEW.score     IS DISTINCT FROM OLD.score     OR
       NEW.feedback  IS DISTINCT FROM OLD.feedback  OR
       NEW.graded_by IS DISTINCT FROM OLD.graded_by OR
       NEW.graded_at IS DISTINCT FROM OLD.graded_at THEN
      RAISE EXCEPTION 'Students cannot modify graded fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_submission_graded_fields
  BEFORE UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_submission_graded_fields();
CREATE TRIGGER trg_communities_updated_at
  BEFORE UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_learning_paths_updated_at
  BEFORE UPDATE ON public.learning_paths FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
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

-- XP recalculation after each course attempt.
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
      SELECT SUM(course_xp) FROM (
        SELECT
          course_id,
          CASE
            WHEN MAX(CASE WHEN passed = true THEN 1 ELSE 0 END) = 1
              THEN MAX(CASE WHEN passed = true THEN points ELSE 0 END)
            ELSE (
              SELECT points FROM public.course_attempts ca2
              WHERE  ca2.student_id = v_id AND ca2.course_id = ca.course_id
              ORDER  BY started_at DESC LIMIT 1
            )
          END AS course_xp
        FROM   public.course_attempts ca
        WHERE  ca.student_id = v_id
        GROUP  BY course_id
      ) sub
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
      JOIN   students s ON s.cohort_id = ANY(a.cohort_ids)
      WHERE  a.id = p_assignment_id AND s.id = p_student_id
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
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND courses.id = ANY(lp.item_ids)
        AND (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
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
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
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

-- ── virtual_experiences (migration 100: remove group_ids check; standalone VEs are cohort-only) ──
CREATE POLICY "virtual_experiences: participants select"
  ON public.virtual_experiences FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(cohort_ids)
    OR EXISTS (
      SELECT 1 FROM public.learning_paths lp
      WHERE lp.status = 'published'
        AND virtual_experiences.id = ANY(lp.item_ids)
        AND (SELECT cohort_id FROM public.students WHERE id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
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

-- ── assignments (migration 097: use my_group_ids() helper for group check) ──
CREATE POLICY "assignments: select"
  ON public.assignments FOR SELECT
  USING (
    (SELECT public.is_instructor_or_admin())
    OR created_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
    )
    OR (group_ids && public.my_group_ids())
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
CREATE POLICY "assignment_resources: select"
  ON public.assignment_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = assignment_id AND (
        a.created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(a.cohort_ids)
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
        JOIN public.students s ON s.id = (SELECT auth.uid())
        WHERE a.id = assignment_submissions.assignment_id
          AND s.cohort_id = ANY(a.cohort_ids)
          AND assignment_submissions.group_id IS NULL
      )
      OR
      EXISTS (
        SELECT 1 FROM public.group_members gm
        JOIN public.assignments a ON a.id = assignment_submissions.assignment_id
        WHERE gm.student_id = (SELECT auth.uid())
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
CREATE POLICY "assignment_submissions: student update"
  ON public.assignment_submissions FOR UPDATE
  USING (
    status IN ('draft','submitted')
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
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
    )
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
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
    )
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
        OR EXISTS (
          SELECT 1 FROM public.students st
          WHERE st.id = (SELECT auth.uid()) AND st.cohort_id = ANY(s.cohort_ids)
        )
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
        OR EXISTS (
          SELECT 1 FROM public.students st
          WHERE st.id = (SELECT auth.uid()) AND st.cohort_id = ANY(s.cohort_ids)
        )
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
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
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
      JOIN  public.students s ON s.id = (SELECT auth.uid())
      WHERE e.id = event_id
        AND e.status = 'published'
        AND s.cohort_id = ANY(e.cohort_ids)
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
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(cohort_ids)
    )
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
          OR EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = (SELECT auth.uid()) AND s.cohort_id = ANY(r.cohort_ids)
          )
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

-- assignment_resources / submissions
CREATE INDEX idx_assignment_resources_assignment ON public.assignment_resources(assignment_id);
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
--  11. STORAGE BUCKETS + POLICIES (migration 008 + 044)
-- ─────────────────────────────────────────────────────────────

-- Create buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('form-assets', 'form-assets', true),
  ('cert-assets', 'cert-assets', true),
  ('datasets',    'datasets',    true)
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
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "instructor_or_admin" ON public.platform_settings FOR ALL
  USING (EXISTS (
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
  SELECT id, title, description, cover_image, slug, category
  FROM   public.courses
  WHERE  status = 'published';

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
-- ─────────────────────────────────────────────────────────────
