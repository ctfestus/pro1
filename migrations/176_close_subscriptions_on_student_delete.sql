BEGIN;

-- A subscription is mutable access state, while subscription_payments is the
-- immutable financial ledger. Close access state before the student FK is set
-- to NULL so deleted accounts cannot remain active subscribers.
CREATE OR REPLACE FUNCTION public.close_subscription_before_student_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- DELETE already holds the student row. Lock each open request next so this
  -- follows the same student -> request -> confirmation order as approval.
  PERFORM id
  FROM public.subscription_payment_requests
  WHERE student_id = OLD.id
    AND status IN ('pending', 'confirmation_submitted')
  ORDER BY id
  FOR UPDATE;

  UPDATE public.subscription_payment_confirmations AS confirmation
  SET status = 'rejected',
      reviewed_at = COALESCE(reviewed_at, now()),
      admin_notes = COALESCE(admin_notes, 'Student account deleted')
  FROM public.subscription_payment_requests AS request
  WHERE confirmation.request_id = request.id
    AND request.student_id = OLD.id
    AND request.status IN ('pending', 'confirmation_submitted')
    AND confirmation.status = 'pending';

  UPDATE public.subscription_payment_requests
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now())
  WHERE student_id = OLD.id
    AND status IN ('pending', 'confirmation_submitted');

  UPDATE public.individual_subscriptions
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now())
  WHERE student_id = OLD.id
    AND status = 'active';

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_subscription_before_student_delete ON public.students;
CREATE TRIGGER trg_close_subscription_before_student_delete
  BEFORE DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.close_subscription_before_student_delete();

REVOKE ALL ON FUNCTION public.close_subscription_before_student_delete() FROM PUBLIC, anon, authenticated;

-- Approval eventually locks the student inside the billing function. Acquire
-- that row first here so concurrent deletion cannot form student/request cycles.
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
BEGIN
  SELECT confirmation.request_id, request.student_id
  INTO v_request_id, v_student_id
  FROM public.subscription_payment_confirmations AS confirmation
  JOIN public.subscription_payment_requests AS request ON request.id = confirmation.request_id
  WHERE confirmation.id = p_confirmation_id;
  IF NOT FOUND OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'subscription payment confirmation not found';
  END IF;

  PERFORM 1 FROM public.students WHERE id = v_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription student no longer exists'; END IF;

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
  IF v_request.student_id IS DISTINCT FROM v_student_id
     OR v_confirmation.student_id IS DISTINCT FROM v_request.student_id THEN
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

-- Repair accounts deleted before the trigger existed. Their payment ledger is
-- intentionally retained, but they must no longer represent live access.
UPDATE public.individual_subscriptions
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, now())
WHERE student_id IS NULL
  AND status = 'active';

-- Today, an open request can have a NULL student_id only through ON DELETE SET
-- NULL. Process these deterministically, request first then confirmation. If a
-- future workflow intentionally creates anonymous requests, this rule must be
-- revisited before re-running this migration.
DO $$
DECLARE
  v_request record;
BEGIN
  FOR v_request IN
    SELECT id
    FROM public.subscription_payment_requests
    WHERE student_id IS NULL
      AND status IN ('pending', 'confirmation_submitted')
    ORDER BY id
    FOR UPDATE
  LOOP
    UPDATE public.subscription_payment_confirmations
    SET status = 'rejected',
        reviewed_at = COALESCE(reviewed_at, now()),
        admin_notes = COALESCE(admin_notes, 'Student account deleted')
    WHERE request_id = v_request.id
      AND status = 'pending';

    UPDATE public.subscription_payment_requests
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now())
    WHERE id = v_request.id;
  END LOOP;
END;
$$;

COMMIT;
