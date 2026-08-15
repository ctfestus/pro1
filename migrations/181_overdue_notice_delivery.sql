-- Overdue notices repeated forever, and duplicated whenever a send was not recorded.
--
-- The sweep chose who to email from sent_nudges: overdue, and no overdue_alert row in the last
-- fourteen days. That is a fact about time, not about the debt, which produced two faults.
--
-- 1. A STUDENT WHO STAYS OVERDUE WAS RE-MAILED EVERY FORTNIGHT. The lookup expires, the unpaid
--    installment does not, so one debt generated notices indefinitely.
-- 2. A NOTICE THAT FAILED TO RECORD WAS SENT AGAIN THE NEXT MORNING. The row is written after
--    Resend accepts the send, so a failed write left the student eligible and they were mailed
--    a second time. Two workers running together duplicated it the same way, because nothing
--    was decided before the send.
--
-- Both are fixed by making "already told" a fact about the episode. An overdue episode is
-- identified by the due date of the installment that caused it: settle that one and fall behind
-- on the next, and the date differs, which is what lets a genuinely new episode be notified
-- without any reset -- while the same unpaid installment never is. This mirrors migration 180,
-- where a warning is held against current_period_end and only a renewal makes the subscription
-- eligible again.
--
-- DELIVERY POLICY: AT MOST ONCE.
--
-- A payment demand sent twice is worse than one not sent, because the student is also shown the
-- restriction banner in the app and is not relying on the email alone. Everything below is built
-- to that rule.
--
-- Four states, so that a worker which dies mid-send cannot cause either fault:
--
--   claimed        overdue_notice_claimed_at + overdue_notice_claim_token are set. One worker
--                  owns this episode. A claim expires so a dead worker does not strand it.
--   send begun     overdue_notice_send_started_for_due_date matches the episode. Written BEFORE
--                  Resend is contacted, so an outcome that never gets recorded is still visible.
--   released       the claim is cleared and an error recorded. The send is known not to have
--                  happened, so the episode stays retryable and the begun-marker is cleared.
--   delivered      overdue_notice_for_due_date matches the episode. Permanent; this student is
--                  never mailed about this debt again.
--
-- A later worker that finds an expired claim whose send was begun but never resolved cannot know
-- whether Resend accepted it. Under the at-most-once rule it finalizes the episode WITHOUT
-- sending. If the earlier worker died before Resend was reached, that student is never emailed
-- about this episode; they still see the banner. Resend's own idempotency keys last 24 hours and
-- daily sweeps land either side of that, so they cannot be leaned on here -- as in migration 177
-- they are a crash-window safeguard, never the guard.
--
-- The claim carries a token because time alone cannot establish ownership. A worker that stalls
-- past the TTL, has its episode taken over, and then wakes up would otherwise release or complete
-- a claim that is no longer its own. Every function that changes claim state requires the token
-- it was issued, so a stale worker's writes are rejected rather than applied to a newer claim.

BEGIN;

-- The backfill must run only when the columns are first introduced. Re-running this migration
-- later would stamp episodes whose notice is still pending, suppressing the retries this exists
-- to enable.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bootcamp_enrollments'::regclass
      AND attname = 'overdue_notice_for_due_date'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE public.bootcamp_enrollments
      ADD COLUMN overdue_notice_for_due_date date,
      ADD COLUMN overdue_notice_claimed_at timestamptz,
      ADD COLUMN overdue_notice_claim_token uuid,
      ADD COLUMN overdue_notice_send_started_for_due_date date,
      ADD COLUMN overdue_notice_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN overdue_notice_attempted_for_due_date date,
      ADD COLUMN overdue_notice_last_error text;

    -- ROLLOUT TRADEOFF, ACCEPTED DELIBERATELY.
    --
    -- Anyone the old fortnight-based path told recently is stamped as already told, so the first
    -- sweep does not repeat it. The window is 14 days because that is the only span in which a
    -- sent_nudges row is reliable evidence about the debt the student is behind on now.
    --
    -- sent_nudges records the enrollment and the date, never which installment the notice was
    -- about, so an older row cannot be tied to the current episode. Honouring those older rows
    -- would suppress notices for debts the student was genuinely never told about, which is the
    -- worse of the two errors. The accepted cost: a student last told more than 14 days ago about
    -- an installment they still have not paid receives one final notice after this migration --
    -- fewer than the fortnightly repeats they were getting before it, and the last one ever for
    -- that debt.
    UPDATE public.bootcamp_enrollments e
    SET overdue_notice_for_due_date = (
      SELECT MIN(i.due_date)
      FROM public.payment_installments i
      WHERE i.enrollment_id = e.id
        AND i.status IN ('unpaid', 'partial')
        AND i.due_date < CURRENT_DATE
    )
    WHERE EXISTS (
      SELECT 1 FROM public.sent_nudges n
      WHERE n.form_id = e.id
        AND n.nudge_type = 'overdue_alert'
        AND n.sent_at >= now() - interval '14 days'
    );
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.bootcamp_enrollments.overdue_notice_for_due_date IS
  'Due date of the installment whose overdue notice was delivered. Equal to the current episode means the student has been told and never will be again for that debt; a different date is a new episode and is notifiable.';
COMMENT ON COLUMN public.bootcamp_enrollments.overdue_notice_claimed_at IS
  'Short-lived claim held while a worker sends the overdue notice. Decided before the send so two workers cannot both mail; expires so a crashed worker does not strand the notice.';
COMMENT ON COLUMN public.bootcamp_enrollments.overdue_notice_claim_token IS
  'Identifies the worker that owns the current claim. Required by the release and completion functions, so a stalled worker whose claim was taken over cannot act on the newer one.';
COMMENT ON COLUMN public.bootcamp_enrollments.overdue_notice_send_started_for_due_date IS
  'The episode a send was begun for, written before Resend is contacted. Still set on a later claim means the outcome was never recorded; under the at-most-once policy that episode is finalized without sending again.';
COMMENT ON COLUMN public.bootcamp_enrollments.overdue_notice_attempted_for_due_date IS
  'The episode the recorded attempts belong to. Attempts only bar further tries while this matches the current episode, so a new one starts a fresh allowance.';

-- Return types and signatures change from the first draft of this migration, and CREATE OR
-- REPLACE cannot alter either, so any earlier form is dropped rather than left as an overload
-- that could be called without a token.
DROP FUNCTION IF EXISTS public.claim_overdue_notice(uuid, date, integer, integer);
DROP FUNCTION IF EXISTS public.release_overdue_notice_claim(uuid, date, text);
DROP FUNCTION IF EXISTS public.mark_overdue_notice_sent(uuid, date);

-- Wins the right to send this episode's notice and returns the token that proves it, or returns
-- no row because it is already delivered, another worker holds it, or this episode has failed too
-- many times. The UPDATE is the claim: a single statement, so two callers cannot both match.
--
-- resume_ambiguous reports that the previous holder began a send for this same episode and never
-- recorded the outcome. The caller must finalize without sending in that case. It is read from
-- the row as it was before this claim, since the UPDATE does not touch that column.
--
-- Attempts bar only the episode they were spent on, so a corrected address gets a fresh allowance
-- at the next episode instead of being barred for the life of the enrollment.
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

-- Records that a send is about to be attempted, before Resend is contacted. Without this an
-- outcome that is never recorded is indistinguishable from a worker that died before sending, and
-- the at-most-once rule would have to be applied to both. Returns false if the claim has since
-- been taken over, which tells the caller to stop rather than send under a lost claim.
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

-- Released when the send is known to have failed, so the next sweep retries without waiting out
-- the TTL. Clearing the begun-marker is what keeps the episode retryable: a recorded failure is
-- proof no mail went out, which is precisely the case the at-most-once rule must not swallow.
--
-- Attempts are counted per episode: a failure against an episode the counter does not already
-- belong to restarts the allowance rather than adding to a stale total.
--
-- Returns false when the token no longer matches, so a stalled worker cannot record its failure
-- against the claim that replaced it.
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

-- Completes the episode: delivered, claim cleared, begun-marker cleared, failure state reset so
-- one that succeeded after four stumbles does not carry those attempts into the next episode.
-- Clearing the claim in the same statement as the stamp means a delivered notice never leaves a
-- stale claim behind.
--
-- Also used to finalize an ambiguous episode without sending. That caller holds a fresh claim of
-- its own, so it presents its own token like any other completion.
--
-- Returns false when the token no longer matches, so a stalled worker cannot mark an episode
-- delivered on behalf of the claim that replaced it.
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

COMMIT;
