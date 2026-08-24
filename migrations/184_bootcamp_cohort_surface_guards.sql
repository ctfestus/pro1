-- 184: cohort-only student surfaces must require a real bootcamp cohort.
--
-- Public signups and subscription learners may have no cohort or may be attached to a
-- subscription_plan cohort for content access. Those cohorts must not unlock operational
-- bootcamp surfaces such as activities, assignments, schedules, recordings, events or
-- communities. Fail closed: only a known cohort_kind='bootcamp' grants these policies.

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

REVOKE EXECUTE ON FUNCTION public.is_bootcamp_cohort_member_for_student(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_bootcamp_cohort_member(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_bootcamp_cohort_member_for_student(uuid, uuid[]) TO service_role;
GRANT  EXECUTE ON FUNCTION public.is_bootcamp_cohort_member(uuid[]) TO authenticated;

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

DROP POLICY IF EXISTS "events: participants select" ON public.events;
CREATE POLICY "events: participants select"
  ON public.events FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

DROP POLICY IF EXISTS "assignments: select" ON public.assignments;
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

DROP POLICY IF EXISTS "assignment_resources: select" ON public.assignment_resources;
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

DROP POLICY IF EXISTS "assignment_submissions: student insert" ON public.assignment_submissions;
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

DROP POLICY IF EXISTS "communities: select" ON public.communities;
CREATE POLICY "communities: select"
  ON public.communities FOR SELECT
  USING (
    created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

DROP POLICY IF EXISTS "schedules: select" ON public.schedules;
CREATE POLICY "schedules: select"
  ON public.schedules FOR SELECT
  USING (
    created_by = (SELECT auth.uid()) OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

DROP POLICY IF EXISTS "schedule_topics: select" ON public.schedule_topics;
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

DROP POLICY IF EXISTS "schedule_resources: select" ON public.schedule_resources;
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

DROP POLICY IF EXISTS "event_registrations: student insert" ON public.event_registrations;
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

DROP POLICY IF EXISTS "recordings: select" ON public.recordings;
CREATE POLICY "recordings: select"
  ON public.recordings FOR SELECT
  USING (
    created_by = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR public.is_bootcamp_cohort_member(cohort_ids)
  );

DROP POLICY IF EXISTS "recording_entries: select" ON public.recording_entries;
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
