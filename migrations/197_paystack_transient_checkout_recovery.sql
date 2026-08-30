-- A verify-first staff clear can release an in-flight row before this function runs.
--
-- The shared guard asks Paystack first. If an old pending or ongoing row has since failed or been
-- abandoned, the guard records that terminal verdict immediately, which already removes the
-- account block. The staff closer used to report that successful release as "not dismissable"
-- because it only accepted initialized. Treat a verified terminal no-payment row as an
-- idempotent success while continuing to refuse every state in which money may still settle.
CREATE INDEX IF NOT EXISTS idx_paystack_subscription_transactions_in_flight_reconcile
  ON public.paystack_subscription_transactions(updated_at)
  WHERE status IN ('pending','ongoing','processing','queued') AND processed_payment_id IS NULL;

-- Once a stored checkout link is 30 minutes old, the reservation asks Paystack before reusing it.
-- Return that same link with the recovery payload: if Paystack says the customer session is still
-- ongoing, reusing one reference is safe and avoids turning recovery into a permanent blocker.
--
-- Serialized on the learner's own row, so concurrent calls queue rather than race. The partial
-- unique index from migration 189 remains the backstop for inserts outside this function.
--
-- "Money may already have moved" deliberately excludes a success that has been credited. A
-- credited payment is finished history, not an in-flight checkout that should block renewal.
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
      -- Name the checkout that is actually open. This is often a renewal of the same plan at a
      -- different duration, so calling it "another plan" would point the learner at a fiction.
      RETURN jsonb_build_object(
        'status','payment_in_progress','blockingStatus','initialized',
        'openPlanName',v_live.plan_name,'openDurationMonths',v_live.duration_months
      );
    END IF;
    -- A row with no link yet may be another tab still initializing at Paystack. Do not verify it
    -- during that grace window: a premature 404 could release a reference that is about to become
    -- payable and allow two live checkout links for the same learner.
    IF v_live.authorization_url IS NULL AND v_live.updated_at > now()-p_initializing_grace THEN
      RETURN jsonb_build_object('status','payment_in_progress','blockingStatus','initializing');
    END IF;

    -- No usable link, and old enough that Paystack is now the only authority on its outcome.
    RETURN jsonb_build_object(
      'status','unverified','reference',v_live.reference,'authorizationUrl',v_live.authorization_url
    );
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

CREATE OR REPLACE FUNCTION public.clear_paystack_checkout_for_staff(p_reference text, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_request_status text;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;

  IF v_transaction.request_id IS NOT NULL THEN
    SELECT status INTO v_request_status FROM public.subscription_payment_requests WHERE id=v_transaction.request_id;
    -- An open invoice still owns its checkout. Clearing that would pull a live checkout out from
    -- under a bill the learner is in the middle of settling.
    IF v_request_status IS NULL OR v_request_status NOT IN ('cancelled','paid') THEN
      RETURN jsonb_build_object('ok',false,'status','request_still_open');
    END IF;
  END IF;

  -- The verify-first guard may just have written this verdict. The learner is already free, so
  -- report the operation accurately instead of turning a successful release into a false error.
  IF v_transaction.status IN ('failed','abandoned','reversed') THEN
    RETURN jsonb_build_object('ok',true,'status','already_released');
  END IF;
  IF v_transaction.status<>'initialized' THEN
    RETURN jsonb_build_object('ok',false,'status','not_dismissable','transactionStatus',v_transaction.status);
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
