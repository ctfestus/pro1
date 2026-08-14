-- Three gaps in the subscription email delivery loop, closed together because they are the
-- same concern: a send either lands and is recorded exactly once, or it is retried a
-- bounded number of times and then stops.
--
-- 1. PARTIAL STAMPS. A combined welcome covers two records -- the learner's account setup
--    and the payment (or request) it announces. Those were stamped by two separate
--    statements, so a failure between them left the pair inconsistent and the sweep sent
--    the whole welcome again. One function now stamps both in a single transaction.
--
-- 2. UNBOUNDED RETRIES. Rows that can never succeed stayed unstamped forever, and because
--    both queues take the oldest rows first, enough of them permanently starve every newer
--    learner. email_attempts gives the sweep a terminal state to stop at, and
--    email_last_error records why for whoever looks.
--
-- 3. SILENT EXPIRY. A subscription lapses automatically and the learner loses access with
--    no notice at all. expiry_warning_for_period_end records which period a warning was
--    sent for, so a renewal that moves the period end becomes eligible again while a
--    repeated sweep over the same period does not.

BEGIN;

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_error text;

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_error text;

ALTER TABLE public.individual_subscriptions
  ADD COLUMN IF NOT EXISTS expiry_warning_for_period_end timestamptz;

COMMENT ON COLUMN public.subscription_payments.email_attempts IS
  'Failed delivery attempts for the activation email. The sweep stops retrying past a cap so one permanently broken row cannot starve newer learners.';
COMMENT ON COLUMN public.subscription_payment_requests.email_attempts IS
  'Failed delivery attempts for the payment-request email. See subscription_payments.email_attempts.';
COMMENT ON COLUMN public.individual_subscriptions.expiry_warning_for_period_end IS
  'The current_period_end a pre-expiry warning was last sent for. A renewal moves the period end, which makes the subscription eligible for a fresh warning.';

-- Both queues order by created_at, so index that rather than id: the old indexes forced a
-- full sort of the partial index on every run.
DROP INDEX IF EXISTS public.idx_subscription_payments_activation_email_pending;
CREATE INDEX IF NOT EXISTS idx_subscription_payments_activation_email_pending
  ON public.subscription_payments(created_at)
  WHERE activation_email_sent_at IS NULL;

DROP INDEX IF EXISTS public.idx_subscription_payment_requests_email_pending;
CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_email_pending
  ON public.subscription_payment_requests(created_at)
  WHERE request_email_sent_at IS NULL;

-- One transaction, so a welcome can never mark the payment delivered without also marking
-- the learner's setup email, or the reverse. Every stamp is conditional: re-running is a
-- no-op rather than an overwrite, which keeps the original delivery time honest.
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
  SET expiry_warning_for_period_end = p_period_end
  WHERE id = p_subscription_id
    AND current_period_end = p_period_end;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_subscription_expiry_warned(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_expiry_warned(uuid, timestamptz)
  TO service_role;

COMMIT;
