-- Migration 229: learners can no longer write their own learning path progress.
--
-- students_insert_own_progress (migration 023) let a signed-in student insert their own
-- learning_path_progress row with any track_id, completed_item_ids or completed_at. With tracks
-- that means skipping the specialization rules (for example track_id '__core_only__' on a path
-- that does not allow it) or claiming items as completed, which the dashboard trusts and then
-- reconciles into a certificate.
--
-- Every legitimate write now goes through the service role: completion
-- (lib/learning-path-progress.ts and complete_learning_path_progress), the track choice
-- (app/api/learning-paths choose-track) and reconciliation. Nothing in the browser inserts here,
-- so the policy is dropped rather than narrowed. Students keep reading their own rows
-- (students_read_own_progress) and instructors keep reading their paths' rows.

DROP POLICY IF EXISTS "students_insert_own_progress" ON public.learning_path_progress;
