-- Subscription payment requests and student-submitted confirmations.
-- This remains separate from bootcamp_enrollments/student_payment_confirmations.

BEGIN;

CREATE TABLE public.subscription_payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subscription_id   uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  plan_id           uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name         text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('purchase','renewal')),
  duration_months   integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'GHS',
  due_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmation_submitted','paid','cancelled')),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  cancelled_at      timestamptz
);

-- A student can have only one unresolved subscription charge at a time.
CREATE UNIQUE INDEX idx_subscription_payment_requests_open_student
  ON public.subscription_payment_requests(student_id)
  WHERE student_id IS NOT NULL AND status IN ('pending','confirmation_submitted');
CREATE INDEX idx_subscription_payment_requests_review
  ON public.subscription_payment_requests(status, due_date);

CREATE TABLE public.subscription_payment_confirmations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES public.subscription_payment_requests(id) ON DELETE CASCADE,
  student_id        uuid REFERENCES public.students(id) ON DELETE SET NULL,
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  paid_at           date NOT NULL,
  method            text,
  reference         text,
  notes             text,
  receipt_url       text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_subscription_payment_confirmations_pending_request
  ON public.subscription_payment_confirmations(request_id)
  WHERE status = 'pending';
CREATE INDEX idx_subscription_payment_confirmations_student
  ON public.subscription_payment_confirmations(student_id, created_at DESC);
CREATE INDEX idx_subscription_payment_confirmations_review
  ON public.subscription_payment_confirmations(status, created_at DESC);

ALTER TABLE public.subscription_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payment_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payment_requests: instructor select"
  ON public.subscription_payment_requests FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payment_requests: student read own"
  ON public.subscription_payment_requests FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "subscription_payment_confirmations: instructor select"
  ON public.subscription_payment_confirmations FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payment_confirmations: student read own"
  ON public.subscription_payment_confirmations FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE TRIGGER trg_subscription_payment_requests_updated_at
  BEFORE UPDATE ON public.subscription_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_subscription_payment_confirmations_updated_at
  BEFORE UPDATE ON public.subscription_payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Financial approval is one transaction: lock the confirmation and request,
-- activate/renew through the existing idempotent billing function, then close
-- both pending records. A duplicate approval is rejected before billing.
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
  -- Resolve the parent without locking, then always lock request -> confirmation.
  -- Cancellation uses the same order, preventing a confirmation/request deadlock.
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
    v_request.student_id,
    v_request.plan_id,
    v_request.duration_months,
    v_request.amount,
    v_request.currency,
    'subscription-confirmation:' || v_confirmation.id::text,
    v_confirmation.method,
    v_confirmation.reference,
    v_confirmation.notes,
    p_reviewed_by
  );
  v_subscription_id := (v_result->>'subscriptionId')::uuid;

  -- The existing billing function defaults paid_at to the approval date. For a
  -- student confirmation, preserve the actual date the student reported paying.
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

CREATE OR REPLACE FUNCTION public.submit_subscription_payment_confirmation(
  p_request_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.subscription_payment_requests%ROWTYPE;
  v_confirmation_id uuid;
BEGIN
  SELECT * INTO v_request FROM public.subscription_payment_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.student_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'subscription payment request not found';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'subscription payment request is not open';
  END IF;
  IF p_amount IS DISTINCT FROM v_request.amount THEN
    RAISE EXCEPTION 'confirmed amount must equal the assigned subscription amount';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at > current_date THEN
    RAISE EXCEPTION 'paid date must be today or earlier';
  END IF;

  INSERT INTO public.subscription_payment_confirmations(
    request_id, student_id, amount, paid_at, method, reference, notes, receipt_url
  ) VALUES (
    p_request_id, p_student_id, p_amount, p_paid_at,
    NULLIF(btrim(p_method), ''), NULLIF(btrim(p_reference), ''),
    NULLIF(btrim(p_notes), ''), NULLIF(btrim(p_receipt_url), '')
  ) RETURNING id INTO v_confirmation_id;

  UPDATE public.subscription_payment_requests
  SET status = 'confirmation_submitted'
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'confirmationId', v_confirmation_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_subscription_payment_confirmation(uuid, uuid, numeric, date, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_subscription_payment_confirmation(uuid, uuid, numeric, date, text, text, text, text)
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
  -- Resolve the parent without locking, then lock request -> confirmation,
  -- matching approval and cancellation.
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
  RETURN jsonb_build_object('ok', true, 'requestId', v_request_id, 'confirmationId', p_confirmation_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_subscription_payment_confirmation(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_subscription_payment_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.subscription_payment_requests
  SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now())
  WHERE id = p_request_id AND status IN ('pending','confirmation_submitted');
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment request is not open'; END IF;

  UPDATE public.subscription_payment_confirmations
  SET status = 'rejected', reviewed_at = now(), admin_notes = 'Payment request cancelled by administrator'
  WHERE request_id = p_request_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true, 'requestId', p_request_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) TO service_role;

COMMIT;
