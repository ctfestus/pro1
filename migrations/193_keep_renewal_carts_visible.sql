-- Stop the reminder sweep taking a renewal cart away from the person holding it.
--
-- Showing the cart to renewing subscribers fixed one half of a trap. This was the other half,
-- an hour behind it: the reminder sweep marked any cart belonging to an active subscriber as
-- dismissed, which hid the card again while leaving the checkout open -- so the learner went back
-- to being blocked from another duration with nothing on screen to clear.
--
-- Suppressing the nudges was the intent, and that is all it does now. The cart stays visible and
-- removable; only the reminders stop.

CREATE OR REPLACE FUNCTION public.claim_paystack_cart_reminder(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_due interval;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','not_found'); END IF;
  IF v_transaction.status<>'initialized' OR v_transaction.request_id IS NOT NULL
     OR v_transaction.cart_dismissed_at IS NOT NULL OR v_transaction.reminder_count>=3 THEN
    RETURN jsonb_build_object('claimed',false,'reason','not_eligible');
  END IF;

  -- A learner who has access is not chased about a cart -- but the cart is not taken away from
  -- them either. Dismissing it here silently undid the fix that lets renewers see their own
  -- unfinished checkout: the card vanished on the next sweep while the transaction stayed open,
  -- so they were blocked from a different duration with nothing on screen to remove. Retiring the
  -- reminders instead stops the nudges and leaves the cart visible and clearable.
  IF EXISTS(
    SELECT 1 FROM public.individual_subscriptions s
    WHERE s.student_id=v_transaction.student_id AND s.status='active' AND s.current_period_end>now()
  ) THEN
    UPDATE public.paystack_subscription_transactions
    SET reminder_count=3,processing_error='cart_reminders_stopped_active_subscription'
    WHERE id=v_transaction.id;
    RETURN jsonb_build_object('claimed',false,'reason','already_subscribed');
  END IF;

  v_due:=CASE v_transaction.reminder_count
    WHEN 0 THEN interval '1 hour'
    WHEN 1 THEN interval '24 hours'
    ELSE interval '3 days' END;
  IF COALESCE(v_transaction.last_reminder_at,v_transaction.created_at) > now()-v_due THEN
    RETURN jsonb_build_object('claimed',false,'reason','not_due');
  END IF;

  UPDATE public.paystack_subscription_transactions
  SET reminder_count=reminder_count+1,last_reminder_at=now() WHERE id=v_transaction.id;
  RETURN jsonb_build_object(
    'claimed',true,'reference',v_transaction.reference,'studentId',v_transaction.student_id,
    'planName',v_transaction.plan_name,'durationMonths',v_transaction.duration_months,
    'amount',v_transaction.amount,'currency',v_transaction.currency,
    'authorizationUrl',v_transaction.authorization_url,'reminderNumber',v_transaction.reminder_count+1
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_cart_reminder(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_cart_reminder(text) TO service_role;

-- Restore carts the sweep already hid. Only the ones it hid for this reason, still unfinished,
-- so nothing a learner deliberately removed comes back.
UPDATE public.paystack_subscription_transactions
SET cart_dismissed_at=NULL,reminder_count=3,processing_error='cart_reminders_stopped_active_subscription'
WHERE status='initialized'
  AND request_id IS NULL
  AND cart_dismissed_at IS NOT NULL
  AND processing_error='cart_superseded_by_active_subscription';
