-- Two holes left by migration 179.
--
-- 1. THE EXPIRY WARNING QUEUE NEVER ADVANCES. The sweep takes the 25 subscriptions closest
--    to expiring and asks the sender to warn each. The sender correctly skips one already
--    warned for its current period, but the query does not exclude them, so the same 25 are
--    re-selected every hour and learner 26 is never reached until the earlier ones expire.
--    The predicate needs to compare two columns
--    (expiry_warning_for_period_end IS DISTINCT FROM current_period_end), which PostgREST
--    cannot express, so the queue is served by a function instead. Warnings also need
--    bounded attempts for the same reason the email queues do: one permanently invalid
--    address must not hold a slot forever.
--
-- 2. TWO WORKERS CAN BOTH SEND THE WELCOME. Picking one welcome per learner inside a single
--    batch does not help when the admin route and the hourly sweep run at once: both read
--    setup_email_sent_at IS NULL, both send, both stamp afterwards. Stamping atomically
--    after the fact cannot undo two emails. A short-lived claim moves the decision before
--    the send: one worker wins, the other stands down, and a crashed worker's claim expires
--    so the work is not stranded.

BEGIN;

ALTER TABLE public.individual_subscriptions
  ADD COLUMN IF NOT EXISTS expiry_warning_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_warning_last_error text,
  -- Which period the attempts above were spent on. Without this the counter is a lifetime
  -- total: five failures would bar the learner from every future warning, even after the
  -- address is corrected and the subscription renews into a new period.
  ADD COLUMN IF NOT EXISTS expiry_warning_attempted_for_period_end timestamptz;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS setup_email_claimed_at timestamptz;

COMMENT ON COLUMN public.individual_subscriptions.expiry_warning_attempted_for_period_end IS
  'The period the recorded warning attempts belong to. Attempts only bar further tries while this matches current_period_end, so a renewal starts a fresh allowance.';
COMMENT ON COLUMN public.students.setup_email_claimed_at IS
  'Short-lived claim held while a worker sends the combined welcome. Prevents the admin route and the hourly sweep both sending one; expires so a crashed worker does not strand the learner.';

CREATE INDEX IF NOT EXISTS idx_individual_subscriptions_expiry_warning
  ON public.individual_subscriptions(current_period_end)
  WHERE status = 'active';

-- Only subscriptions not yet warned for the period they are currently in. A renewal moves
-- current_period_end, which makes the row eligible again without any reset.
--
-- Returns the period it selected on, and the sender must match it: between selection and
-- the send the subscription can renew, and without that check the sender would warn about a
-- newly extended period that may be months away.
--
-- Attempts only bar a row while they were spent on the period it is currently in, so a
-- corrected address gets a fresh allowance at the next renewal instead of being barred for
-- the life of the subscription.
--
-- Dropped first: the return type gains a column, and CREATE OR REPLACE cannot change a
-- function's return type.
DROP FUNCTION IF EXISTS public.list_subscriptions_needing_expiry_warning(timestamptz, integer, integer);
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

-- Attempts are counted per period. A failure against a period the counter does not already
-- belong to restarts the allowance rather than adding to a stale total, so five failures
-- bar this period only -- not every future one.
--
-- The earlier two-argument form is dropped rather than left as an overload, so no caller
-- can record a failure without saying which period it was for.
DROP FUNCTION IF EXISTS public.record_expiry_warning_failure(uuid, text);
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

-- A delivered warning clears the failure state, so a period that succeeded after four
-- stumbles does not carry those attempts into its renewal.
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

COMMIT;
