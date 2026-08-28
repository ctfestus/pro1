-- Say what is actually open, and show it to the people most likely to be blocked by it.
--
-- Two faults, both on the renewal path, and they compounded: a learner with an active plan who
-- started a renewal and abandoned it had the cart card hidden from them (it was gated on not
-- having access, which is exactly wrong for a renewal), and clicking a different length of their
-- own plan was then refused with a message about "another plan" -- a plan that did not exist.
-- Blocked, with no way out, and told something untrue about why.
--
-- The card fix is in the page. This adds what the message needs to name the real thing.

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
      -- Names what is actually open. Saying "another plan" was wrong and confusing: the most
      -- common way to reach this is a renewal, where the unfinished checkout is the same plan
      -- at a different length, so the learner was told about a plan that did not exist.
      RETURN jsonb_build_object(
        'status','payment_in_progress','blockingStatus','initialized',
        'openPlanName',v_live.plan_name,'openDurationMonths',v_live.duration_months
      );
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
