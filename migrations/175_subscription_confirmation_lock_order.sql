-- Standardize financial-review row locking as request -> confirmation.
-- Migration 169 used the inverse order for approval/rejection versus cancellation,
-- allowing concurrent admin actions to deadlock. CREATE OR REPLACE makes this safe
-- for databases where migration 169 has already been applied.
BEGIN;

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
  v_result jsonb;
  v_subscription_id uuid;
BEGIN
  SELECT request_id INTO v_request_id
  FROM public.subscription_payment_confirmations
  WHERE id = p_confirmation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment confirmation not found'; END IF;

  SELECT * INTO v_request
  FROM public.subscription_payment_requests
  WHERE id = v_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'confirmation_submitted' THEN
    RAISE EXCEPTION 'subscription payment request is not awaiting confirmation';
  END IF;

  SELECT * INTO v_confirmation
  FROM public.subscription_payment_confirmations
  WHERE id = p_confirmation_id
  FOR UPDATE;
  IF NOT FOUND OR v_confirmation.status <> 'pending' THEN
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
    'subscription-confirmation:' || v_confirmation.id::text,
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

CREATE OR REPLACE FUNCTION public.reject_subscription_payment_confirmation(
  p_confirmation_id uuid,
  p_reviewed_by uuid DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request_id uuid;
  v_request public.subscription_payment_requests%ROWTYPE;
  v_confirmation public.subscription_payment_confirmations%ROWTYPE;
BEGIN
  SELECT request_id INTO v_request_id
  FROM public.subscription_payment_confirmations
  WHERE id = p_confirmation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription payment confirmation not found or already processed'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT * INTO v_request
  FROM public.subscription_payment_requests
  WHERE id = v_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'confirmation_submitted' THEN
    RAISE EXCEPTION 'subscription payment request is not awaiting confirmation';
  END IF;

  SELECT * INTO v_confirmation
  FROM public.subscription_payment_confirmations
  WHERE id = p_confirmation_id
  FOR UPDATE;
  IF NOT FOUND OR v_confirmation.status <> 'pending' OR v_confirmation.request_id IS DISTINCT FROM v_request.id THEN
    RAISE EXCEPTION 'subscription payment confirmation not found or already processed'
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE public.subscription_payment_requests SET status = 'pending' WHERE id = v_request.id;
  UPDATE public.subscription_payment_confirmations
  SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(),
      admin_notes = NULLIF(btrim(p_admin_notes), '')
  WHERE id = p_confirmation_id;

  RETURN jsonb_build_object('ok', true, 'requestId', v_request.id, 'confirmationId', p_confirmation_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid, uuid, text)
  TO service_role;

COMMIT;
