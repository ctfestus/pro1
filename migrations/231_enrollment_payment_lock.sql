-- Migration 231: write payments under the same enrollment row lock as a cohort move.
--
-- Migration 230 moves an enrollment (rebuilding its installments from paid_total) under a lock on
-- the bootcamp_enrollments row. Payments did not take that lock: recording one inserted the row,
-- filled installments and raised paid_total as separate requests, and editing or deleting one
-- changed the row and then re-applied every payment separately. Interleavings lost or doubled
-- money: a move between the fill and the paid_total update left the payment off the rebuilt
-- schedule, and a re-apply between a new payment's insert and its fill counted it twice.
--
-- Every payment write now happens here, the payment row included, each in one transaction that
-- locks the enrollment row first. Payments and moves on one enrollment therefore run one after
-- the other. Installments are filled oldest due date first, the order the app and 230 use.
--
-- Called by the service role only (lib/db-payments.ts). No table changes, so no RLS changes.
-- Requires nothing from 230 and can run before or after it. Safe to re-run: it drops the
-- functions an earlier draft of this migration created.

BEGIN;

DROP FUNCTION IF EXISTS public.apply_enrollment_payment(uuid, numeric);
DROP FUNCTION IF EXISTS public.reapply_enrollment_payments(uuid);

-- Fills unpaid and partial installments oldest due date first. Internal: only the functions
-- below call it, and they hold the enrollment row lock.
CREATE OR REPLACE FUNCTION public.fill_enrollment_installments(p_enrollment_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_remaining numeric := p_amount;
  v_inst      record;
  v_apply     numeric;
BEGIN
  FOR v_inst IN
    SELECT id, amount_due, amount_paid FROM public.payment_installments
    WHERE enrollment_id = p_enrollment_id AND status IN ('unpaid', 'partial')
    ORDER BY due_date, created_at
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_inst.amount_due - v_inst.amount_paid);
    UPDATE public.payment_installments
      SET amount_paid = v_inst.amount_paid + v_apply,
          status      = CASE WHEN v_inst.amount_paid + v_apply >= v_inst.amount_due THEN 'paid' ELSE 'partial' END,
          updated_at  = now()
      WHERE id = v_inst.id;
    v_remaining := v_remaining - v_apply;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fill_enrollment_installments(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- A new payment: insert it, fill installments with it and add it to paid_total.
-- p_payment holds the payments columns: enrollment_id, student_id, payer_email, cohort_id,
-- amount, paid_at, method, reference, notes, confirmation_id.
CREATE OR REPLACE FUNCTION public.record_enrollment_payment(p_payment jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pay public.payments;
BEGIN
  v_pay := jsonb_populate_record(NULL::public.payments, p_payment);

  PERFORM 1 FROM public.bootcamp_enrollments WHERE id = v_pay.enrollment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found'; END IF;

  INSERT INTO public.payments
    (enrollment_id, student_id, payer_email, cohort_id, amount, paid_at, method, reference, notes, confirmation_id)
  VALUES
    (v_pay.enrollment_id, v_pay.student_id, v_pay.payer_email, v_pay.cohort_id, v_pay.amount,
     COALESCE(v_pay.paid_at, current_date), v_pay.method, v_pay.reference, v_pay.notes, v_pay.confirmation_id);

  PERFORM public.fill_enrollment_installments(v_pay.enrollment_id, v_pay.amount);

  UPDATE public.bootcamp_enrollments
    SET paid_total = paid_total + v_pay.amount, updated_at = now()
    WHERE id = v_pay.enrollment_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_enrollment_payment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_enrollment_payment(jsonb) TO service_role;

-- Edit (p_updates holds the changed columns: amount, paid_at, method, reference, notes) or, with
-- p_updates NULL, delete a payment. Then reset every installment, re-apply all payments and set
-- paid_total to their sum. Returns the enrollment id.
CREATE OR REPLACE FUNCTION public.change_enrollment_payment(p_payment_id uuid, p_updates jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_enrollment_id uuid;
  v_total         numeric;
BEGIN
  SELECT enrollment_id INTO v_enrollment_id FROM public.payments WHERE id = p_payment_id;
  IF v_enrollment_id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  PERFORM 1 FROM public.bootcamp_enrollments WHERE id = v_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found'; END IF;

  IF p_updates IS NULL THEN
    DELETE FROM public.payments WHERE id = p_payment_id;
  ELSE
    UPDATE public.payments SET
      amount    = CASE WHEN p_updates ? 'amount'    THEN (p_updates->>'amount')::numeric ELSE amount END,
      paid_at   = CASE WHEN p_updates ? 'paid_at'   THEN (p_updates->>'paid_at')::date   ELSE paid_at END,
      method    = CASE WHEN p_updates ? 'method'    THEN p_updates->>'method'            ELSE method END,
      reference = CASE WHEN p_updates ? 'reference' THEN p_updates->>'reference'         ELSE reference END,
      notes     = CASE WHEN p_updates ? 'notes'     THEN p_updates->>'notes'             ELSE notes END
    WHERE id = p_payment_id;
  END IF;
  -- Deleted by a concurrent request between the lookup and the lock.
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  UPDATE public.payment_installments
    SET amount_paid = 0, status = 'unpaid', updated_at = now()
    WHERE enrollment_id = v_enrollment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM public.payments WHERE enrollment_id = v_enrollment_id;

  PERFORM public.fill_enrollment_installments(v_enrollment_id, v_total);

  UPDATE public.bootcamp_enrollments
    SET paid_total = v_total, updated_at = now()
    WHERE id = v_enrollment_id;

  RETURN v_enrollment_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.change_enrollment_payment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_enrollment_payment(uuid, jsonb) TO service_role;

COMMIT;
