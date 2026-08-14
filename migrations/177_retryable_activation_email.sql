-- Activation emails could not be retried after a delivery failure.
--
-- The routes only sent the email when the payment RPC reported a fresh write. If the
-- payment committed and Resend then failed, retrying returned alreadyProcessed = true and
-- the email was skipped -- permanently, with no path that would ever send it. The learner
-- has access and was never told.
--
-- Two things are needed. This migration supplies both.
--
-- 1. A durable record of delivery, so "already sent" is a fact about the payment rather
--    than an inference from whether this particular request created it. This mirrors
--    students.setup_email_sent_at, which tracks the account setup email the same way.
--    Resend's own idempotency keys are kept for 24 hours only, so they are a crash-window
--    safeguard, never the permanent guard.
--
-- 2. An idempotent approval. Adding the column alone does not help the approval path:
--    approving an already-approved confirmation raised before the route reached the email
--    at all. A replay now returns the payment that the original approval created, so the
--    route can retry delivery against it.

BEGIN;

-- The backfill must run only when the column is first introduced. Re-running this
-- migration later would otherwise stamp payments whose email is still pending, silently
-- suppressing exactly the retries this change exists to enable.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.subscription_payments'::regclass
      AND attname = 'activation_email_sent_at'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD COLUMN activation_email_sent_at timestamptz;
    -- Existing payments were emailed under the old behavior. Treat them as delivered so
    -- this change does not re-mail every past subscriber.
    UPDATE public.subscription_payments
    SET activation_email_sent_at = created_at;
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.subscription_payments.activation_email_sent_at IS
  'Set once the subscription activation email is accepted by the mail provider. NULL means it still needs sending, which is what makes a failed delivery retryable.';

-- Finding the outstanding ones stays cheap as the ledger grows.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_activation_email_pending
  ON public.subscription_payments(id)
  WHERE activation_email_sent_at IS NULL;

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
REVOKE EXECUTE ON FUNCTION public.approve_subscription_payment_confirmation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_subscription_payment_confirmation(uuid, uuid, text)
  TO service_role;

COMMIT;
