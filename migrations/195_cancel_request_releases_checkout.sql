-- Cancelling an invoice should let the learner go, not leave the payment page jammed.
--
-- A learner sent a payment request can pay it online, and that opens a Paystack checkout carrying
-- the request's id. Cancelling the request closed the invoice and left that checkout open, which
-- put the learner in a state nothing on screen could reach: still blocked from starting anything
-- new, and never shown as their cart, because a cart is a checkout with no request attached. The
-- only way out was the database.
--
-- Only 'initialized' checkouts are released here, and that guard is doing real work rather than
-- being cautious for its own sake. The caller asks Paystack first, and anything Paystack reports
-- as paid or in flight is moved out of 'initialized' by that check -- so by the time this runs,
-- a row still sitting at 'initialized' is one the provider has confirmed collected nothing. If
-- the caller is ever changed to skip that step, this stops releasing paid checkouts by accident.
CREATE OR REPLACE FUNCTION public.cancel_subscription_payment_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_released integer := 0;
BEGIN
  UPDATE public.subscription_payment_requests SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now())
  WHERE id=p_request_id AND status IN ('pending','confirmation_submitted');
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription payment request is not open'; END IF;
  UPDATE public.subscription_payment_confirmations SET status='rejected',reviewed_at=now(),admin_notes='Payment request cancelled by administrator'
  WHERE request_id=p_request_id AND status='pending';

  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',processing_error='released_with_cancelled_request'
  WHERE request_id=p_request_id AND status='initialized';
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object('ok',true,'requestId',p_request_id,'releasedCheckouts',v_released);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_payment_request(uuid) TO service_role;

-- No backfill for the learners already in this state, deliberately.
--
-- 'initialized' is our status, not Paystack's. It is what a paid checkout reads as until the
-- webhook lands, and a lost webhook is exactly how one of these rows gets left behind. Releasing
-- them in bulk here would be this file asserting the one thing the whole flow refuses to assume,
-- with no provider anywhere in the loop -- and it would take them out of reach of the reminder
-- pass, the last thing that would ever have asked Paystack about them.
--
-- They are listed for staff instead, on the payments screen beside the requests, and cleared
-- through the action that verifies with Paystack first. Slower, and it cannot silently discard a
-- payment somebody made.

-- The staff equivalent of the learner's Remove button.
--
-- dismiss_paystack_cart deliberately refuses anything with a request attached: for a learner, a
-- checkout against their open invoice is not a basket item to throw away. But a checkout left
-- behind by an invoice that has since been cancelled or paid is attached to nothing that matters,
-- and it goes on blocking the learner from paying at all. That is the row staff need to clear and
-- the learner cannot, so it gets its own function rather than loosening theirs.
--
-- Still only 'initialized', and the caller asks Paystack before it gets here.
CREATE OR REPLACE FUNCTION public.clear_paystack_checkout_for_staff(p_reference text, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_request_status text;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF v_transaction.status<>'initialized' THEN
    RETURN jsonb_build_object('ok',false,'status','not_dismissable','transactionStatus',v_transaction.status);
  END IF;
  IF v_transaction.request_id IS NOT NULL THEN
    SELECT status INTO v_request_status FROM public.subscription_payment_requests WHERE id=v_transaction.request_id;
    -- An open invoice still owns its checkout. Clearing that would pull a live payment out from
    -- under a bill the learner is in the middle of settling.
    IF v_request_status IS NULL OR v_request_status NOT IN ('cancelled','paid') THEN
      RETURN jsonb_build_object('ok',false,'status','request_still_open');
    END IF;
  END IF;

  -- Who cleared it, on the column that already records why a row was closed. A staff member
  -- closing somebody else's checkout is worth being able to trace back later.
  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',cart_dismissed_at=now(),processing_error='cleared_by_staff:'||COALESCE(p_actor_id::text,'unknown')
  WHERE id=v_transaction.id;
  RETURN jsonb_build_object('ok',true,'status','dismissed');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_paystack_checkout_for_staff(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_paystack_checkout_for_staff(text,uuid) TO service_role;
