-- 206: group membership follows cohort membership.
--
-- groups belong to a cohort, and members are picked from that cohort (see the available-students
-- route), but group_members rows were written once and never revisited. A student moved to another
-- cohort or onto a subscription therefore stayed a member of their old cohort's group for good:
-- still mailed its assignments, still able to open its forum, still listed as a member to
-- everybody else. Leaving a cohort now means leaving that cohort's groups.
--
-- What is deliberately NOT touched: assignment_submissions.group_id keeps pointing at the group
-- that produced the work, and the participants recorded on a submitted or graded row are the
-- record of who did it. Only unsubmitted drafts are tidied, because the submission policies
-- validate participants against current membership -- a draft still naming somebody the group no
-- longer has could not be submitted at all, which would strand the group rather than free it.
--
-- A group that loses its leader this way is given the longest-standing remaining member, the same
-- rule the members API applies when a group is left without one.

CREATE OR REPLACE FUNCTION public.prune_group_memberships_on_cohort_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_groups uuid[];
  v_group  uuid;
BEGIN
  -- A student parked in the outstanding-payments cohort has not left their cohort. original_cohort_id
  -- remembers where they belong and restoreAccess puts them back the moment they pay, so the move is
  -- a temporary hold, not a departure. The outstanding sweep performs it automatically whenever an
  -- installment falls due, and pruning on it would quietly cost a student who is merely late their
  -- group -- with nothing to give it back when the payment lands.
  IF NEW.original_cohort_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(array_agg(gm.group_id), '{}'::uuid[]) INTO v_groups
    FROM public.group_members gm
    JOIN public.groups g ON g.id = gm.group_id
   WHERE gm.student_id = NEW.id
     AND g.cohort_id IS DISTINCT FROM NEW.cohort_id;

  IF cardinality(v_groups) = 0 THEN RETURN NULL; END IF;

  DELETE FROM public.group_members
   WHERE student_id = NEW.id
     AND group_id = ANY(v_groups);

  UPDATE public.assignment_submissions
     SET participants = array_remove(participants, NEW.id),
         updated_at   = now()
   WHERE status = 'draft'
     AND group_id = ANY(v_groups)
     AND NEW.id = ANY(participants);

  -- Leave no group leaderless.
  FOREACH v_group IN ARRAY v_groups LOOP
    IF EXISTS (SELECT 1 FROM public.group_members WHERE group_id = v_group)
       AND NOT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = v_group AND is_leader) THEN
      UPDATE public.group_members
         SET is_leader = true
       WHERE id = (
         SELECT id FROM public.group_members
          WHERE group_id = v_group
          ORDER BY joined_at, id
          LIMIT 1
       );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_group_memberships_on_cohort_change ON public.students;
CREATE TRIGGER trg_prune_group_memberships_on_cohort_change
  AFTER UPDATE OF cohort_id ON public.students
  FOR EACH ROW
  WHEN (NEW.cohort_id IS DISTINCT FROM OLD.cohort_id)
  EXECUTE FUNCTION public.prune_group_memberships_on_cohort_change();

-- ── one-time cleanup of memberships that already outlived their cohort ──
--
-- To see what this will remove before running the migration:
--
--   SELECT st.full_name, st.email, g.name AS group_name, c.name AS group_cohort
--     FROM public.group_members gm
--     JOIN public.groups   g  ON g.id = gm.group_id
--     JOIN public.students st ON st.id = gm.student_id
--     LEFT JOIN public.cohorts c ON c.id = g.cohort_id
--    WHERE st.original_cohort_id IS NULL
--      AND g.cohort_id IS DISTINCT FROM st.cohort_id;
DELETE FROM public.group_members gm
 USING public.groups g, public.students st
 WHERE gm.group_id    = g.id
   AND gm.student_id  = st.id
   AND st.original_cohort_id IS NULL   -- parked over a payment, not gone
   AND g.cohort_id IS DISTINCT FROM st.cohort_id;

-- Drafts left naming somebody who is no longer a member of the group they belong to.
UPDATE public.assignment_submissions s
   SET participants = (
         SELECT COALESCE(array_agg(p ORDER BY p), '{}'::uuid[])
           FROM unnest(s.participants) AS p
          WHERE EXISTS (
            SELECT 1 FROM public.group_members gm
             WHERE gm.group_id = s.group_id AND gm.student_id = p
          )
       ),
       updated_at = now()
 WHERE s.status = 'draft'
   AND s.group_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM unnest(s.participants) AS p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.group_members gm
         WHERE gm.group_id = s.group_id AND gm.student_id = p
      )
   );

-- Groups the cleanup left without a leader.
UPDATE public.group_members
   SET is_leader = true
 WHERE id IN (
   SELECT DISTINCT ON (gm.group_id) gm.id
     FROM public.group_members gm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.group_members l
       WHERE l.group_id = gm.group_id AND l.is_leader
    )
    ORDER BY gm.group_id, gm.joined_at, gm.id
 );
