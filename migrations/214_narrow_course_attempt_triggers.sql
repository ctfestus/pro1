-- Take XP recomputation and badge awarding off the course_attempts autosave path.
--
-- save-progress writes one course_attempts row per answered question, plus a flush when the tab
-- loses focus. Two AFTER ... FOR EACH ROW triggers were attached to that table with no event or
-- WHEN filter, so every one of those saves also ran:
--
--   recalc_student_xp()  aggregate over every attempt the student owns (MAX per course), plus a
--                        sum over linkedin_shares, then an upsert on their student_xp row
--   trg_check_badges()   a COUNT of the student's completed attempts and a read of their streak,
--                        then an INSERT ... ON CONFLICT DO NOTHING for every badge threshold those
--                        two values currently meet
--
-- Neither result can change unless points moved or the attempt just completed, so on a normal save
-- both triggers were extra reads and extra row writes that could not alter anything, each taking a
-- row lock on student_xp / student_badges that the student's next save then queued behind. The
-- badge cost also grows with the student: the further along they are, the more thresholds they
-- meet and the more no-op inserts each save attempts.
-- Production showed 4.7s ShareLock waits and statement timeouts clustered in teaching hours
-- (2026-09-20/21), with the badge COUNT as the statement in flight when the 8s timeout fired.
--
-- Student-visible behaviour is unchanged. XP still updates mid-course whenever points actually
-- move, and badges are still awarded the moment an attempt completes.
--
-- Each trigger is split by event because one trigger cannot carry a WHEN clause referencing both
-- OLD (invalid for INSERT) and NEW (invalid for DELETE).
--
-- Two paths deliberately left alone:
--   * linkedin_shares keeps its own trg_recalc_student_xp_shares (migration 160), so VE share
--     bonuses still land immediately. Course share bonuses are already inside
--     course_attempts.points, so the points condition below covers them.
--   * trg_check_badges_on_streak (on student_streaks) fires about once per login, not once per
--     answer, and it is what awards the streak_* badges. Those are unaffected by this change.

-- XP: recompute on insert and delete, and on update only when points actually changed.
DROP TRIGGER IF EXISTS trg_recalc_student_xp        ON public.course_attempts;
DROP TRIGGER IF EXISTS trg_recalc_student_xp_insert ON public.course_attempts;
DROP TRIGGER IF EXISTS trg_recalc_student_xp_update ON public.course_attempts;
DROP TRIGGER IF EXISTS trg_recalc_student_xp_delete ON public.course_attempts;

CREATE TRIGGER trg_recalc_student_xp_insert
  AFTER INSERT ON public.course_attempts
  FOR EACH ROW EXECUTE FUNCTION public.recalc_student_xp();

CREATE TRIGGER trg_recalc_student_xp_update
  AFTER UPDATE ON public.course_attempts
  FOR EACH ROW
  WHEN (NEW.points IS DISTINCT FROM OLD.points)
  EXECUTE FUNCTION public.recalc_student_xp();

CREATE TRIGGER trg_recalc_student_xp_delete
  AFTER DELETE ON public.course_attempts
  FOR EACH ROW EXECUTE FUNCTION public.recalc_student_xp();

-- Badges: only on the transition into completion. Re-stamping an already-completed attempt is
-- deliberately excluded: the badge thresholds read a COUNT of completed attempts, which a second
-- timestamp on the same row cannot move, and complete-attempt's final update filters by id alone,
-- so two concurrent completion requests can each re-stamp the row. Matching those would repeat the
-- exact work and lock contention this migration removes. Autosaves never write completed_at.
DROP TRIGGER IF EXISTS trg_check_badges_on_attempt        ON public.course_attempts;
DROP TRIGGER IF EXISTS trg_check_badges_on_attempt_insert ON public.course_attempts;
DROP TRIGGER IF EXISTS trg_check_badges_on_attempt_update ON public.course_attempts;

CREATE TRIGGER trg_check_badges_on_attempt_insert
  AFTER INSERT ON public.course_attempts
  FOR EACH ROW
  WHEN (NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION public.trg_check_badges();

CREATE TRIGGER trg_check_badges_on_attempt_update
  AFTER UPDATE ON public.course_attempts
  FOR EACH ROW
  WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION public.trg_check_badges();
