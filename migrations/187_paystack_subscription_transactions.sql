-- Paystack one-time payments for fixed-duration subscriptions.
--
-- Three records have three jobs:
--   transactions: checkout, provider verification, and exactly-once crediting
--   webhook events: signed delivery deduplication and bounded processing retries
--   review incidents: the single durable queue for anything requiring a person

CREATE TABLE IF NOT EXISTS public.paystack_subscription_transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference               text NOT NULL UNIQUE CHECK (length(btrim(reference)) > 0),
  authorization_url       text,
  student_id              uuid REFERENCES public.students(id) ON DELETE SET NULL,
  request_id              uuid REFERENCES public.subscription_payment_requests(id) ON DELETE SET NULL,
  plan_id                 uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name               text NOT NULL,
  duration_months         integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  amount                  numeric(10,2) NOT NULL CHECK (amount > 0),
  currency                text NOT NULL DEFAULT 'GHS',
  status                  text NOT NULL DEFAULT 'initialized' CHECK (status IN (
                            'initialized','pending','ongoing','processing','queued',
                            'success','failed','abandoned','reversed','needs_review'
                          )),
  paystack_transaction_id bigint,
  channel                 text,
  gateway_response        text,
  processed_payment_id    uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  verified_at             timestamptz,
  processed_at            timestamptz,
  processing_error        text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_paystack_subscription_transactions_student
  ON public.paystack_subscription_transactions(student_id,created_at DESC);
CREATE INDEX idx_paystack_subscription_transactions_request
  ON public.paystack_subscription_transactions(request_id);
CREATE INDEX idx_paystack_subscription_transactions_status
  ON public.paystack_subscription_transactions(status,created_at DESC);
CREATE UNIQUE INDEX idx_paystack_subscription_transactions_paystack_id
  ON public.paystack_subscription_transactions(paystack_transaction_id)
  WHERE paystack_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX idx_paystack_subscription_transactions_open_request
  ON public.paystack_subscription_transactions(request_id)
  WHERE request_id IS NOT NULL AND status IN (
    'initialized','pending','ongoing','processing','queued','success','needs_review'
  );

ALTER TABLE public.paystack_subscription_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_subscription_transactions: student read own"
  ON public.paystack_subscription_transactions FOR SELECT
  USING (student_id=(SELECT auth.uid()));
CREATE POLICY "paystack_subscription_transactions: owner or admin read"
  ON public.paystack_subscription_transactions FOR SELECT
  USING (
    (SELECT public.is_admin()) OR (
      (SELECT public.is_instructor_or_admin()) AND EXISTS (
        SELECT 1 FROM public.subscription_plans plan
        WHERE plan.id=paystack_subscription_transactions.plan_id
          AND plan.created_by=(SELECT auth.uid())
      )
    )
  );
CREATE TRIGGER trg_paystack_subscription_transactions_updated_at
  BEFORE UPDATE ON public.paystack_subscription_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.paystack_webhook_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_hash                 text NOT NULL UNIQUE,
  event_name                 text,
  reference                  text,
  transaction_id             bigint,
  event_status               text,
  event_amount_minor         bigint,
  event_occurred_at          timestamptz,
  received_at                timestamptz NOT NULL DEFAULT now(),
  processed_at               timestamptz,
  processing_attempts        integer NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  last_processing_attempt_at timestamptz,
  processing_error           text,
  dead_lettered_at           timestamptz
);

CREATE INDEX idx_paystack_webhook_events_retry
  ON public.paystack_webhook_events(processing_attempts,received_at)
  WHERE processed_at IS NULL;
ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_webhook_events: admin read"
  ON public.paystack_webhook_events FOR SELECT
  USING ((SELECT public.is_admin()));

CREATE TABLE IF NOT EXISTS public.paystack_review_incidents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key                text NOT NULL UNIQUE CHECK (length(btrim(incident_key)) > 0),
  transaction_id              uuid REFERENCES public.paystack_subscription_transactions(id) ON DELETE SET NULL,
  webhook_event_id            uuid REFERENCES public.paystack_webhook_events(id) ON DELETE SET NULL,
  student_id                  uuid REFERENCES public.students(id) ON DELETE SET NULL,
  plan_id                     uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  reference                   text,
  provider_transaction_id     bigint,
  kind                        text NOT NULL,
  reason                      text NOT NULL,
  event_name                  text,
  amount                      numeric(10,2),
  currency                    text,
  blocks_credit               boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  notification_attempts       integer NOT NULL DEFAULT 0 CHECK (notification_attempts >= 0),
  notification_last_attempt_at timestamptz,
  notification_sent_at        timestamptz,
  notification_error          text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  resolved_at                 timestamptz,
  resolved_by                 uuid REFERENCES public.students(id) ON DELETE SET NULL,
  resolution_note             text
);

CREATE INDEX idx_paystack_review_incidents_open
  ON public.paystack_review_incidents(created_at DESC) WHERE status='open';
CREATE INDEX idx_paystack_review_incidents_notify
  ON public.paystack_review_incidents(notification_attempts,created_at)
  WHERE status='open' AND notification_sent_at IS NULL;
CREATE INDEX idx_paystack_review_incidents_transaction
  ON public.paystack_review_incidents(transaction_id,status);
ALTER TABLE public.paystack_review_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paystack_review_incidents: owner or admin read"
  ON public.paystack_review_incidents FOR SELECT
  USING (
    (SELECT public.is_admin()) OR (
      (SELECT public.is_instructor_or_admin()) AND EXISTS (
        SELECT 1 FROM public.subscription_plans plan
        WHERE plan.id=paystack_review_incidents.plan_id
          AND plan.created_by=(SELECT auth.uid())
      )
    )
  );
CREATE TRIGGER trg_paystack_review_incidents_updated_at
  BEFORE UPDATE ON public.paystack_review_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.paystack_checkout_rate_limits (
  student_id       uuid NOT NULL,
  scope            text NOT NULL DEFAULT 'checkout',
  window_started_at timestamptz NOT NULL,
  attempts         integer NOT NULL DEFAULT 0,
  PRIMARY KEY(student_id,scope,window_started_at)
);
ALTER TABLE public.paystack_checkout_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job_name        text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now(),
  last_summary    jsonb
);
ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_heartbeats: admin read"
  ON public.cron_heartbeats FOR SELECT
  USING ((SELECT public.is_admin()));

CREATE OR REPLACE FUNCTION public.claim_paystack_checkout_attempt(
  p_student_id uuid,p_limit integer DEFAULT 5,p_window_seconds integer DEFAULT 600,p_scope text DEFAULT 'checkout'
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window timestamptz; v_attempts integer; v_scope text;
BEGIN
  IF p_limit<1 OR p_window_seconds<1 THEN RAISE EXCEPTION 'invalid rate limit configuration'; END IF;
  v_scope:=COALESCE(NULLIF(btrim(p_scope),''),'checkout');
  v_window:=to_timestamp(floor(extract(epoch FROM now())/p_window_seconds)*p_window_seconds);
  INSERT INTO public.paystack_checkout_rate_limits(student_id,scope,window_started_at,attempts)
  VALUES(p_student_id,v_scope,v_window,1)
  ON CONFLICT(student_id,scope,window_started_at)
  DO UPDATE SET attempts=public.paystack_checkout_rate_limits.attempts+1
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts<=p_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_checkout_attempt(uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_checkout_attempt(uuid,integer,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_paystack_webhook_event(
  p_event_hash text,p_stale_after_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event public.paystack_webhook_events%ROWTYPE;
BEGIN
  UPDATE public.paystack_webhook_events
  SET processing_attempts=processing_attempts+1,last_processing_attempt_at=now()
  WHERE event_hash=p_event_hash AND processed_at IS NULL
    AND(last_processing_attempt_at IS NULL OR last_processing_attempt_at<now()-make_interval(secs=>GREATEST(p_stale_after_seconds,1)))
  RETURNING * INTO v_event;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'event_hash',v_event.event_hash,'event_name',v_event.event_name,'reference',v_event.reference,
    'transaction_id',v_event.transaction_id,'event_status',v_event.event_status,
    'event_amount_minor',v_event.event_amount_minor,'event_occurred_at',v_event.event_occurred_at,
    'processing_attempts',v_event.processing_attempts
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_paystack_webhook_event(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_webhook_event(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.open_paystack_transaction_incident(
  p_reference text,p_kind text,p_reason text,p_blocks_credit boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_transaction public.paystack_subscription_transactions%ROWTYPE; v_incident public.paystack_review_incidents%ROWTYPE;
BEGIN
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.paystack_review_incidents AS existing(
    incident_key,transaction_id,student_id,plan_id,reference,provider_transaction_id,
    kind,reason,amount,currency,blocks_credit
  ) VALUES(
    'transaction:'||v_transaction.id::text||':'||p_kind,v_transaction.id,v_transaction.student_id,
    v_transaction.plan_id,v_transaction.reference,v_transaction.paystack_transaction_id,
    p_kind,p_reason,v_transaction.amount,v_transaction.currency,COALESCE(p_blocks_credit,true)
  ) ON CONFLICT(incident_key) DO UPDATE SET
    reason=EXCLUDED.reason,
    blocks_credit=EXCLUDED.blocks_credit,
    status=CASE WHEN existing.status='resolved' THEN 'open' ELSE existing.status END,
    resolved_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolved_at END,
    resolved_by=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolved_by END,
    resolution_note=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.resolution_note END,
    notification_attempts=CASE WHEN existing.status='resolved' THEN 0 ELSE existing.notification_attempts END,
    notification_last_attempt_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_last_attempt_at END,
    notification_sent_at=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_sent_at END,
    notification_error=CASE WHEN existing.status='resolved' THEN NULL ELSE existing.notification_error END,
    updated_at=now()
  RETURNING * INTO v_incident;
  UPDATE public.paystack_subscription_transactions
  SET status='needs_review',processing_error=p_reason WHERE id=v_transaction.id AND processed_payment_id IS NULL;
  RETURN jsonb_build_object('id',v_incident.id,'reference',v_transaction.reference,'status','needs_review');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_paystack_transaction_incident(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_transaction_incident(text,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.record_paystack_webhook_incident(
  p_event_hash text,p_kind text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_event public.paystack_webhook_events%ROWTYPE;
  v_transaction public.paystack_subscription_transactions%ROWTYPE;
  v_incident public.paystack_review_incidents%ROWTYPE;
  v_key text;
  v_blocks boolean;
BEGIN
  SELECT * INTO v_event FROM public.paystack_webhook_events WHERE event_hash=p_event_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_transaction FROM public.paystack_subscription_transactions
  WHERE(v_event.reference IS NOT NULL AND reference=v_event.reference)
     OR(v_event.transaction_id IS NOT NULL AND paystack_transaction_id=v_event.transaction_id)
  ORDER BY CASE WHEN reference=v_event.reference THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE;

  IF v_transaction.id IS NULL AND COALESCE(v_event.reference,'') NOT LIKE 'sub-%' THEN
    RETURN jsonb_build_object('status','ignored','reason','not_platform_payment');
  END IF;

  IF v_event.event_name='charge.dispute.remind' AND v_transaction.id IS NOT NULL THEN
    SELECT * INTO v_incident FROM public.paystack_review_incidents
    WHERE transaction_id=v_transaction.id AND status='open'
      AND event_name IN('charge.dispute.create','charge.dispute.remind')
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id',v_incident.id,'status','already_open','reference',v_incident.reference);
    END IF;
  END IF;
  v_key:='event:'||v_event.event_hash;
  v_blocks:=v_transaction.id IS NOT NULL AND v_transaction.processed_payment_id IS NULL;

  INSERT INTO public.paystack_review_incidents(
    incident_key,transaction_id,webhook_event_id,student_id,plan_id,reference,provider_transaction_id,
    kind,reason,event_name,amount,currency,blocks_credit
  ) VALUES(
    v_key,v_transaction.id,v_event.id,v_transaction.student_id,v_transaction.plan_id,
    COALESCE(v_transaction.reference,v_event.reference),COALESCE(v_transaction.paystack_transaction_id,v_event.transaction_id),
    p_kind,p_reason,v_event.event_name,
    CASE WHEN v_event.event_amount_minor IS NULL THEN NULL ELSE v_event.event_amount_minor::numeric/100 END,
    v_transaction.currency,v_blocks
  ) ON CONFLICT(incident_key) DO NOTHING RETURNING * INTO v_incident;

  IF v_incident.id IS NULL THEN
    SELECT * INTO v_incident FROM public.paystack_review_incidents WHERE incident_key=v_key;
    RETURN jsonb_build_object('id',v_incident.id,'status','already_open','reference',v_incident.reference);
  END IF;
  IF v_blocks THEN
    UPDATE public.paystack_subscription_transactions
    SET status='needs_review',processing_error=p_reason WHERE id=v_transaction.id;
  END IF;
  RETURN jsonb_build_object('id',v_incident.id,'status','needs_review','reference',v_incident.reference);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_paystack_webhook_incident(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_webhook_incident(text,text,text) TO service_role;

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

  SELECT * INTO v_request FROM public.subscription_payment_requests WHERE id=v_transaction.request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.status<>'pending' THEN
    PERFORM public.open_paystack_transaction_incident(p_reference,'payment_request_not_open','payment_request_not_open',true);
    RETURN jsonb_build_object('ok',true,'status','needs_review','reason','payment_request_not_open');
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

  UPDATE public.subscription_payment_requests
  SET status='paid',subscription_id=(v_result->>'subscriptionId')::uuid,paid_at=now() WHERE id=v_request.id;
  UPDATE public.paystack_subscription_transactions
  SET status='success',processed_payment_id=(v_result->>'paymentId')::uuid,processed_at=now(),processing_error=NULL
  WHERE id=v_transaction.id;
  RETURN v_result||jsonb_build_object('status','success');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paystack_subscription_transaction(text,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_paystack_review_incident(
  p_incident_id uuid,p_actor_id uuid,p_resolution_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_incident public.paystack_review_incidents%ROWTYPE;
  v_role text;
  v_owner uuid;
BEGIN
  SELECT * INTO v_incident FROM public.paystack_review_incidents WHERE id=p_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment incident not found'; END IF;
  SELECT role INTO v_role FROM public.students WHERE id=p_actor_id;
  IF v_incident.plan_id IS NOT NULL THEN
    SELECT created_by INTO v_owner FROM public.subscription_plans WHERE id=v_incident.plan_id;
  END IF;
  IF v_role<>'admin' AND(v_role<>'instructor' OR v_owner IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='insufficient_privilege';
  END IF;
  IF v_incident.status='resolved' THEN
    RETURN jsonb_build_object('ok',true,'alreadyResolved',true);
  END IF;
  UPDATE public.paystack_review_incidents SET
    status='resolved',resolved_at=now(),resolved_by=p_actor_id,
    resolution_note=NULLIF(btrim(COALESCE(p_resolution_note,'')),'')
  WHERE id=v_incident.id;
  IF v_incident.blocks_credit AND v_incident.transaction_id IS NOT NULL THEN
    UPDATE public.paystack_subscription_transactions SET status='pending',processing_error=NULL
    WHERE id=v_incident.transaction_id AND status='needs_review' AND processed_payment_id IS NULL;
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_paystack_review_incident(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_paystack_review_incident(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_paystack_operational_data(p_before timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.paystack_webhook_events event
  WHERE event.processed_at IS NOT NULL AND event.received_at<p_before
    AND NOT EXISTS(
      SELECT 1 FROM public.paystack_review_incidents incident
      WHERE incident.webhook_event_id=event.id AND incident.status='open'
    );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  DELETE FROM public.paystack_review_incidents WHERE status='resolved' AND resolved_at<p_before;
  DELETE FROM public.paystack_checkout_rate_limits WHERE window_started_at<LEAST(p_before,now()-interval '1 day');
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_paystack_operational_data(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_paystack_operational_data(timestamptz) TO service_role;
