-- A payment request means someone asked a learner to pay. Choosing a plan is not that.
--
-- Buying online used to raise a formal payment request before the learner ever reached Paystack.
-- That request carried a deadline, an overdue banner, a chasing email, and a place in the admin's
-- receivables -- and a database rule allows only one open request per learner, so abandoning the
-- checkout left them unable to pick any other plan, with no way to clear it themselves.
--
-- Online checkout now creates only a Paystack transaction. A request is raised only when someone
-- is genuinely being asked to pay: an instructor issuing one, or a learner choosing to pay by
-- bank transfer or mobile money, which is the flow that needs somewhere to attach a receipt.

-- Credit a transaction that has no payment request attached.
--
-- The distinction this draws is the whole change, and it is easy to get backwards. A transaction
-- with no request_id was a direct checkout and is fine to credit. A transaction that HAS a
-- request_id whose request is missing or no longer open is the dangerous case -- the learner paid
-- against something that has since been settled or cancelled -- and must still raise an incident
-- rather than credit. Treating those the same either blocks every direct checkout or loses the
-- protection entirely.
CREATE OR REPLACE FUNCTION public.finalize_paystack_subscription_transaction(
  p_reference text,p_payment_method text DEFAULT NULL,p_notes text DEFAULT NULL,p_enforce_incidents boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_transaction public.paystack_subscription_transactions%ROWTYPE;
  v_request public.subscription_payment_requests%ROWTYPE;
  v_payment public.subscription_payments%ROWTYPE;
  v_result jsonb;
  v_error_state text;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'status','ignored','reason','unknown_reference'); END IF;
  IF v_transaction.processed_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'status','success','paymentId',v_transaction.processed_payment_id,'alreadyProcessed',true);
  END IF;

  SELECT * INTO v_payment FROM public.subscription_payments WHERE idempotency_key='paystack:'||p_reference;
  IF v_payment.id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests SET status='paid',subscription_id=v_payment.subscription_id,paid_at=COALESCE(paid_at,now())
    WHERE id=v_transaction.request_id;
    UPDATE public.paystack_subscription_transactions
    SET status='success',processed_payment_id=v_payment.id,processed_at=COALESCE(processed_at,now()),processing_error=NULL
    WHERE id=v_transaction.id;
    RETURN jsonb_build_object('ok',true,'status','success','subscriptionId',v_payment.subscription_id,'paymentId',v_payment.id,'alreadyProcessed',true);
  END IF;

  IF p_enforce_incidents AND EXISTS(
    SELECT 1 FROM public.paystack_review_incidents
    WHERE transaction_id=v_transaction.id AND status='open' AND blocks_credit=true
  ) THEN
    RETURN jsonb_build_object('ok',true,'status','needs_review','reason','open_review_incident');
  END IF;
  IF v_transaction.status<>'success' THEN RAISE EXCEPTION 'Paystack transaction has not been verified successfully'; END IF;

  IF v_transaction.request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.subscription_payment_requests WHERE id=v_transaction.request_id FOR UPDATE;
    IF v_request.id IS NULL OR v_request.status<>'pending' THEN
      PERFORM public.open_paystack_transaction_incident(p_reference,'payment_request_not_open','payment_request_not_open',true);
      RETURN jsonb_build_object('ok',true,'status','needs_review','reason','payment_request_not_open');
    END IF;
  END IF;

  BEGIN
    v_result:=public.purchase_or_renew_individual_subscription(
      v_transaction.student_id,v_transaction.plan_id,v_transaction.duration_months,v_transaction.amount,v_transaction.currency,
      'paystack:'||p_reference,p_payment_method,p_reference,p_notes,v_transaction.student_id
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_state=RETURNED_SQLSTATE;
    PERFORM public.open_paystack_transaction_incident(p_reference,'crediting_failed','crediting_failed:'||v_error_state,true);
    RETURN jsonb_build_object('ok',true,'status','needs_review','reason','crediting_failed');
  END;

  IF v_request.id IS NOT NULL THEN
    UPDATE public.subscription_payment_requests
    SET status='paid',subscription_id=(v_result->>'subscriptionId')::uuid,paid_at=now() WHERE id=v_request.id;
  END IF;
  UPDATE public.paystack_subscription_transactions
  SET status='success',processed_payment_id=(v_result->>'paymentId')::uuid,processed_at=now(),processing_error=NULL
  WHERE id=v_transaction.id;
  RETURN v_result||jsonb_build_object('status','success');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) TO service_role;

-- Release the learners already stuck behind a request they raised themselves by choosing a plan.
--
-- Nothing here turns on elapsed time, in either direction. This migration runs once and nothing
-- revisits what it skips, so a grace period on the request would strand those learners
-- permanently -- the very state being fixed -- and a grace period on the checkout would be
-- guesswork about money. Only a settled provider outcome decides it.
--
-- A learner's own id on the request is NOT enough to identify an abandoned checkout, and assuming
-- it was is how this nearly cancelled real money. The old code raised a request on both paths: it
-- called for one unconditionally, and only then decided whether to send the learner to Paystack.
-- So when Paystack was unconfigured, choosing a plan produced a genuine bank-transfer request --
-- possibly one where the learner has already sent the money and simply not submitted the receipt.
--
-- What actually distinguishes the two is a Paystack transaction. The online path always created
-- one; the manual path never did. So this only cancels a request that HAS a checkout attached and
-- every checkout on it is already recorded as failed or abandoned. A request with no transaction
-- is a manual payment and is left alone.
--
-- An 'initialized' checkout is deliberately NOT treated as settled, however old. Age is not
-- evidence: Paystack may hold a payable link, or the payment may have gone through with the
-- webhook still to arrive. Cancelling on a guess turns a payment that should grant access
-- instantly into a manual review. Those rows are left for provider verification when the learner
-- next tries, or for Remove on the cart -- both of which ask Paystack rather than assume.
--
-- Cancelling also stops the chasing email: the sender skips any request that is no longer open
-- and stamps it as nothing-to-do, so these leave the pending-email queue for good.
UPDATE public.subscription_payment_requests r
SET status='cancelled',cancelled_at=COALESCE(r.cancelled_at,now())
WHERE r.status='pending'
  AND r.student_id IS NOT NULL
  AND r.created_by=r.student_id
  AND NOT EXISTS(
    SELECT 1 FROM public.subscription_payment_confirmations c
    WHERE c.request_id=r.id AND c.status='pending'
  )
  AND EXISTS(
    SELECT 1 FROM public.paystack_subscription_transactions t
    WHERE t.request_id=r.id AND t.status IN('failed','abandoned')
  )
  AND NOT EXISTS(
    SELECT 1 FROM public.paystack_subscription_transactions t
    WHERE t.request_id=r.id AND t.status<>'failed' AND t.status<>'abandoned'
  );

-- Reserving a direct checkout, atomically.
--
-- The payment request used to make this safe as a side effect: one open request per learner was a
-- unique index, so a second checkout could not exist. Removing the request removed that, and a
-- check-then-insert in application code does not replace it -- two tabs both pass the check, both
-- insert, and the learner ends up holding two payable Paystack links.
--
-- One live checkout per learner, full stop. An existing one is returned rather than replaced.
--
-- Retiring the old row and inserting a new one looked equivalent and is not: the lock is released
-- once this returns, and the caller then goes off to Paystack. A second tab arriving in between
-- would retire the first row -- taking it out of the unique index -- insert its own, and both
-- callers would come back holding a payable link. Worse, paying the first one turns it into an
-- uncredited success, which collides with the live second row and strands a real charge in webhook
-- retries.
--
-- So 'initialized' blocks like every other live state, and a learner who already has a checkout
-- gets that same checkout back. Changing to a different plan means clearing the current one first,
-- which is what Remove on the cart is for.
--
-- "Money may already have moved" deliberately excludes a success that has been credited. A
-- credited payment is finished history, and treating it as in-flight blocked every renewal a
-- learner would ever make after their first payment.
-- Every condition on starting a checkout lives here, in this order, and nowhere else. They were
-- previously spread across the browser, the route, this function and the cleanup below, which is
-- how fixing one kept opening another:
--
--   1. a genuine payment request is open      -> the learner already owes this money somewhere
--   2. money may already have moved           -> anything unresolved at the provider
--   3. an unfinished checkout, same terms     -> hand back the same link; this is the cart
--   4. a checkout reserved moments ago       -> another tab is mid-initialization; wait
--   5. an older checkout, no usable link     -> the caller verifies with Paystack and recovers
--   6. otherwise                              -> reserve a new one
--
-- Rule 1 is not the browser's job. Disabling a button stops nobody with a stale tab, a second
-- device, or a direct API call, and starting Paystack while a bank transfer is outstanding is how
-- a learner pays twice.
--
-- Rule 4 exists because a provider timeout deliberately leaves the row 'initialized' with no link:
-- we cannot know whether Paystack created the checkout. Treating that as live locked the learner
-- out permanently -- no link to continue, and no way to choose anything else.
CREATE OR REPLACE FUNCTION public.open_paystack_direct_checkout(
  p_student_id uuid,p_reference text,p_plan_id uuid,p_plan_name text,
  p_duration_months integer,p_amount numeric,p_currency text,
  p_link_stale_after interval DEFAULT interval '30 minutes',
  p_initializing_grace interval DEFAULT interval '5 minutes'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_live public.paystack_subscription_transactions%ROWTYPE;
  v_request_status text;
BEGIN
  PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;

  SELECT status INTO v_request_status FROM public.subscription_payment_requests
  WHERE student_id=p_student_id AND status IN('pending','confirmation_submitted') LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','open_request','requestStatus',v_request_status);
  END IF;

  SELECT * INTO v_live FROM public.paystack_subscription_transactions
  WHERE student_id=p_student_id
    AND (status IN('initialized','pending','ongoing','processing','queued','needs_review')
         OR (status='success' AND processed_payment_id IS NULL))
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_live.status<>'initialized' OR v_live.request_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus',v_live.status);
    END IF;
    IF v_live.authorization_url IS NOT NULL AND v_live.updated_at > now()-p_link_stale_after THEN
      IF v_live.plan_id=p_plan_id AND v_live.duration_months=p_duration_months
         AND v_live.amount=p_amount AND v_live.currency=upper(btrim(COALESCE(p_currency,'GHS'))) THEN
        RETURN jsonb_build_object(
          'status','existing','reference',v_live.reference,'authorizationUrl',v_live.authorization_url
        );
      END IF;
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus','initialized');
    END IF;
    -- A row with no link yet, reserved moments ago, is another tab still talking to Paystack. The
    -- lock is released as soon as this returns, so that gap is real and lasts as long as the
    -- provider call. Handing it out as 'unverified' let the second tab ask Paystack, get a 404
    -- purely because the first had not finished, release the first tab's row and start its own --
    -- and both tabs would come back holding a payable link.
    IF v_live.authorization_url IS NULL AND v_live.updated_at > now()-p_initializing_grace THEN
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus','initializing');
    END IF;

    -- No usable link, and old enough that Paystack is the only authority on it.
    RETURN jsonb_build_object('status','unverified','reference',v_live.reference);
  END IF;

  INSERT INTO public.paystack_subscription_transactions(
    reference,student_id,request_id,plan_id,plan_name,duration_months,amount,currency,status
  ) VALUES(
    p_reference,p_student_id,NULL,p_plan_id,p_plan_name,p_duration_months,p_amount,
    upper(btrim(COALESCE(p_currency,'GHS'))),'initialized'
  );
  RETURN jsonb_build_object('status','created','reference',p_reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_paystack_direct_checkout(uuid,text,uuid,text,integer,numeric,text,interval,interval) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_direct_checkout(uuid,text,uuid,text,integer,numeric,text,interval,interval) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paystack_direct_checkout_one_live
  ON public.paystack_subscription_transactions(student_id)
  WHERE request_id IS NULL
    AND (status IN('initialized','pending','ongoing','processing','queued','needs_review')
         OR (status='success' AND processed_payment_id IS NULL));
