-- Record the last access state successfully written to both students and the cached
-- auth claim. A row can move before an auth request fails, so access_state alone cannot
-- distinguish a completed release from a retryable partial transition.

BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS access_state_confirmed text;

-- Existing accounts predate this marker. Their current state was already established by
-- migration 159 and the shared account-state writer, so preserve it as the confirmed state.
UPDATE public.students
   SET access_state_confirmed = access_state
 WHERE access_state_confirmed IS NULL;

ALTER TABLE public.students
  ALTER COLUMN access_state_confirmed SET NOT NULL,
  ALTER COLUMN access_state_confirmed SET DEFAULT 'pending';

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_access_state_confirmed_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_access_state_confirmed_check
  CHECK (access_state_confirmed IN ('pending', 'active', 'denied'));

COMMIT;
