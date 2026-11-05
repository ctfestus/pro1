-- Migration 231: apply payments to an enrollment under the same row lock as a cohort move.
--
-- Migration 230 moves an enrollment (rebuilding its installments from paid_total) under a lock on
-- the bootcamp_enrollments row. Recording a payment did not take that lock: it applied the money
-- to the installments and then raised paid_total as separate requests. A move landing between the
-- two passed 230's paid_total check, replaced the schedule, and the payment then raised paid_total
-- without ever reaching the new installments. Editing or deleting a payment (which resets and
-- re-applies every payment) had the same gap.
--
-- Both now run here, each in one transaction that locks the enrollment row first, so a payment
-- and a move on the same enrollment run one after the other. Installments are filled oldest due
-- date first, the order the app and migration 230 use.
--
-- Called by the service role only (lib/db-payments.ts). No table changes, so no RLS changes.
-- Requires nothing from 230 and can run before or after it.

BEGIN;

-- Fills unpaid and partial installments oldest due date first. Internal: only the two functions
-- below call it, and both hold the enrollment row lock.
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

-- A new payment: fill installments with it and add it to paid_total.
CREATE OR REPLACE FUNCTION public.apply_enrollment_payment(p_enrollment_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.bootcamp_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found'; END IF;

  PERFORM public.fill_enrollment_installments(p_enrollment_id, p_amount);

  UPDATE public.bootcamp_enrollments
    SET paid_total = paid_total + p_amount, updated_at = now()
    WHERE id = p_enrollment_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_enrollment_payment(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_enrollment_payment(uuid, numeric) TO service_role;

-- After a payment is edited or deleted: reset every installment, re-apply all payments, and set
-- paid_total to their sum.
CREATE OR REPLACE FUNCTION public.reapply_enrollment_payments(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_total numeric;
BEGIN
  PERFORM 1 FROM public.bootcamp_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found'; END IF;

  UPDATE public.payment_installments
    SET amount_paid = 0, status = 'unpaid', updated_at = now()
    WHERE enrollment_id = p_enrollment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM public.payments WHERE enrollment_id = p_enrollment_id;

  PERFORM public.fill_enrollment_installments(p_enrollment_id, v_total);

  UPDATE public.bootcamp_enrollments
    SET paid_total = v_total, updated_at = now()
    WHERE id = p_enrollment_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reapply_enrollment_payments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reapply_enrollment_payments(uuid) TO service_role;

COMMIT;
