-- An unfinished checkout is a cart, not a problem.
--
-- Nothing new is introduced to hold one. A learner who chose a plan and did not pay already has a
-- transaction sitting at 'initialized', and the reservation function allows only one of those at a
-- time, so that row is the cart. All it was missing was somewhere to record that the learner
-- dismissed it and how many times they have been reminded.

ALTER TABLE public.paystack_subscription_transactions
  ADD COLUMN IF NOT EXISTS cart_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- Reminders are capped at three and stop for good. The index carries the same conditions as the
-- query that reads it so a cart leaves it the moment it is paid, dismissed, or fully reminded,
-- rather than being scanned past forever.
CREATE INDEX IF NOT EXISTS idx_paystack_subscription_transactions_cart_reminders
  ON public.paystack_subscription_transactions(last_reminder_at NULLS FIRST, created_at)
  WHERE status='initialized' AND request_id IS NULL
    AND cart_dismissed_at IS NULL AND reminder_count < 3;

-- Dismissing a cart.
--
-- Only ever the learner's own, and only while nothing has been collected: the moment a checkout
-- reaches any state where Paystack may hold money, this refuses, because clearing it would let
-- them start a second payment for something they might already have bought. The row itself is
-- kept -- 'abandoned' rather than deleted -- since it is the record of a real Paystack checkout
-- and a late payment against it still has to be matched.
CREATE OR REPLACE FUNCTION public.dismiss_paystack_cart(p_student_id uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference AND student_id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF v_transaction.status<>'initialized' OR v_transaction.request_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'status','not_dismissable','transactionStatus',v_transaction.status);
  END IF;

  UPDATE public.paystack_subscription_transactions
  SET status='abandoned',cart_dismissed_at=now(),processing_error='cart_dismissed_by_learner'
  WHERE id=v_transaction.id;
  RETURN jsonb_build_object('ok',true,'status','dismissed');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dismiss_paystack_cart(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_paystack_cart(uuid,text) TO service_role;

-- Claiming a reminder to send.
--
-- Taken under a lock and stamped before the mail goes out, so a second worker cannot send the same
-- nudge and a crash costs one reminder rather than repeating it. The schedule is deliberately
-- short and finite: roughly an hour, a day, then three days, and never again.
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

  -- A learner who has since bought access, by any route, is not chased about a cart.
  IF EXISTS(
    SELECT 1 FROM public.individual_subscriptions s
    WHERE s.student_id=v_transaction.student_id AND s.status='active' AND s.current_period_end>now()
  ) THEN
    UPDATE public.paystack_subscription_transactions
    SET cart_dismissed_at=now(),processing_error='cart_superseded_by_active_subscription'
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
