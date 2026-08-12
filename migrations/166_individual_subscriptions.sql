-- Duration-based subscriptions for students who are not part of a bootcamp.
-- Billing, curated content coverage, and the permanent bootcamp/individual
-- population discriminator are intentionally separate concerns.

BEGIN;

ALTER TABLE public.students
  ADD COLUMN enrollment_model text
  CHECK (enrollment_model IN ('bootcamp', 'individual'));

CREATE TEMP TABLE _enrollment_model_evidence AS
SELECT
  s.id AS student_id,
  (
    s.original_cohort_id IS NOT NULL
    OR (s.cohort_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cohorts c
      WHERE c.id = s.cohort_id AND COALESCE(c.is_individual, false) = false
    ))
    OR EXISTS (
      SELECT 1
      FROM public.bootcamp_enrollments be
      JOIN public.cohorts c ON c.id = be.cohort_id
      WHERE be.student_id = s.id AND COALESCE(c.is_individual, false) = false
    )
  ) AS has_bootcamp_evidence,
  (
    (s.cohort_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cohorts c
      WHERE c.id = s.cohort_id AND c.is_individual = true
    ))
    OR EXISTS (
      SELECT 1
      FROM public.bootcamp_enrollments be
      JOIN public.cohorts c ON c.id = be.cohort_id
      WHERE be.student_id = s.id AND c.is_individual = true
    )
  ) AS has_individual_evidence
FROM public.students s;

DO $$
DECLARE
  v_conflicted integer;
BEGIN
  SELECT count(*) INTO v_conflicted
  FROM _enrollment_model_evidence
  WHERE has_bootcamp_evidence AND has_individual_evidence;

  IF v_conflicted > 0 THEN
    RAISE EXCEPTION '% student(s) show evidence of both bootcamp and individual enrollment; resolve them before running this migration', v_conflicted;
  END IF;
END;
$$;

UPDATE public.students s
SET enrollment_model = 'bootcamp'
FROM _enrollment_model_evidence e
WHERE e.student_id = s.id AND e.has_bootcamp_evidence;

UPDATE public.students s
SET enrollment_model = 'individual'
FROM _enrollment_model_evidence e
WHERE e.student_id = s.id
  AND e.has_individual_evidence
  AND s.enrollment_model IS NULL;

DROP TABLE _enrollment_model_evidence;

CREATE TABLE public.individual_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid REFERENCES public.students(id) ON DELETE SET NULL,
  cohort_id            uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'expired', 'cancelled')),
  duration_months      integer NOT NULL CHECK (duration_months IN (1, 3, 6, 12)),
  amount               numeric(10,2) NOT NULL CHECK (amount > 0),
  currency             text NOT NULL DEFAULT 'GHS',
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_individual_subscriptions_student
  ON public.individual_subscriptions (student_id)
  WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX idx_individual_subscriptions_cohort
  ON public.individual_subscriptions (cohort_id);
CREATE INDEX idx_individual_subscriptions_sweep
  ON public.individual_subscriptions (status, current_period_end);

CREATE TABLE public.subscription_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   uuid REFERENCES public.individual_subscriptions(id) ON DELETE SET NULL,
  student_id        uuid REFERENCES public.students(id) ON DELETE SET NULL,
  idempotency_key   text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed')),
  is_activating     boolean NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('purchase', 'renewal')),
  duration_months   integer NOT NULL CHECK (duration_months IN (1, 3, 6, 12)),
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'GHS',
  period_start      timestamptz NOT NULL,
  period_end        timestamptz NOT NULL,
  paid_at           date NOT NULL DEFAULT current_date,
  payment_method    text,
  payment_reference text,
  notes             text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subscription_content (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES public.individual_subscriptions(id) ON DELETE CASCADE,
  content_table    text NOT NULL
                   CHECK (content_table IN ('courses', 'virtual_experiences', 'certifications', 'learning_paths')),
  content_id       uuid NOT NULL,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notified_at      timestamptz,
  UNIQUE (subscription_id, content_table, content_id)
);
-- Best-effort duplicate suppression only: once notified_at is persisted a retry
-- does not resend. An external email send and this timestamp cannot be atomic, so
-- a crash between them (or two concurrent admins) can still produce a duplicate.

ALTER TABLE public.individual_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "individual_subscriptions: instructor select"
  ON public.individual_subscriptions FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "individual_subscriptions: student read own"
  ON public.individual_subscriptions FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "subscription_payments: instructor select"
  ON public.subscription_payments FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_payments: student read own"
  ON public.subscription_payments FOR SELECT
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "subscription_content: instructor select"
  ON public.subscription_content FOR SELECT
  USING ((SELECT public.is_instructor_or_admin()));
CREATE POLICY "subscription_content: student read own"
  ON public.subscription_content FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.individual_subscriptions s
    WHERE s.id = subscription_content.subscription_id AND s.student_id = (SELECT auth.uid())
  ));

CREATE TRIGGER trg_individual_subscriptions_updated_at
  BEFORE UPDATE ON public.individual_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_enrollment_model_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'permission denied: enrollment_model may only be changed by an enrollment-model claim'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_prevent_enrollment_model_change
  BEFORE UPDATE OF enrollment_model ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.prevent_enrollment_model_change();

CREATE OR REPLACE FUNCTION public.claim_student_enrollment_model(
  p_student_id uuid,
  p_requested_model text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  IF p_requested_model NOT IN ('bootcamp', 'individual') THEN
    RAISE EXCEPTION 'invalid enrollment model: %', p_requested_model;
  END IF;

  SELECT enrollment_model INTO v_current
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student % not found', p_student_id;
  END IF;

  IF v_current IS NULL THEN
    UPDATE public.students
    SET enrollment_model = p_requested_model
    WHERE id = p_student_id;
  ELSIF v_current <> p_requested_model THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', p_student_id, v_current
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_enrollment_model(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_student_cohort_model_claim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_is_individual boolean;
  v_requested text;
BEGIN
  IF NEW.cohort_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cohort_id IS NOT DISTINCT FROM OLD.cohort_id THEN
    RETURN NEW;
  END IF;

  SELECT is_individual INTO v_is_individual
  FROM public.cohorts
  WHERE id = NEW.cohort_id;

  v_requested := CASE WHEN COALESCE(v_is_individual, false) THEN 'individual' ELSE 'bootcamp' END;

  IF TG_OP = 'INSERT' OR OLD.enrollment_model IS NULL THEN
    NEW.enrollment_model := v_requested;
  ELSIF OLD.enrollment_model <> v_requested THEN
    RAISE EXCEPTION 'student % already belongs to the % enrollment model', NEW.id, OLD.enrollment_model
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_student_cohort_model_claim
  BEFORE INSERT OR UPDATE OF cohort_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_cohort_model_claim();

CREATE OR REPLACE FUNCTION public.add_months_clamped(
  base timestamptz,
  months integer
) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_utc timestamp;
  v_target_month date;
  v_last_day date;
  v_day integer;
BEGIN
  v_utc := base AT TIME ZONE 'UTC';
  v_target_month := (date_trunc('month', v_utc) + make_interval(months => months))::date;
  v_last_day := (v_target_month + interval '1 month - 1 day')::date;
  v_day := LEAST(EXTRACT(day FROM v_utc)::integer, EXTRACT(day FROM v_last_day)::integer);
  RETURN (v_target_month + (v_day - 1) + v_utc::time) AT TIME ZONE 'UTC';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_months_clamped(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_months_clamped(timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.purchase_or_renew_individual_subscription(
  p_student_id uuid,
  p_duration_months integer,
  p_amount numeric,
  p_currency text,
  p_idempotency_key text,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_currency text;
  v_payment public.subscription_payments%ROWTYPE;
  v_subscription public.individual_subscriptions%ROWTYPE;
  v_cohort_id uuid;
  v_cohort_is_individual boolean;
  v_cohort_student_id uuid;
  v_student_name text;
  v_base timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_is_activating boolean;
  v_kind text;
  v_subscription_id uuid;
  v_payment_id uuid;
BEGIN
  IF p_duration_months NOT IN (1, 3, 6, 12) THEN
    RAISE EXCEPTION 'durationMonths must be one of 1, 3, 6, or 12';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than 0';
  END IF;
  v_currency := upper(btrim(COALESCE(p_currency, '')));
  IF v_currency = '' THEN
    RAISE EXCEPTION 'currency is required';
  END IF;
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'idempotencyKey is required';
  END IF;

  PERFORM public.claim_student_enrollment_model(p_student_id, 'individual');

  SELECT * INTO v_payment
  FROM public.subscription_payments
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_payment.student_id IS DISTINCT FROM p_student_id
       OR v_payment.amount IS DISTINCT FROM p_amount
       OR v_payment.currency IS DISTINCT FROM v_currency
       OR v_payment.duration_months IS DISTINCT FROM p_duration_months THEN
      RAISE EXCEPTION 'idempotency key was already used for a different subscription payment'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'subscriptionId', v_payment.subscription_id,
      'paymentId', v_payment.id,
      'alreadyProcessed', true
    );
  END IF;

  SELECT id, is_individual, individual_student_id
  INTO v_cohort_id, v_cohort_is_individual, v_cohort_student_id
  FROM public.cohorts
  WHERE individual_student_id = p_student_id;

  IF FOUND THEN
    IF NOT COALESCE(v_cohort_is_individual, false) OR v_cohort_student_id <> p_student_id THEN
      RAISE EXCEPTION 'the student individual cohort is invalid';
    END IF;
  ELSE
    SELECT COALESCE(NULLIF(full_name, ''), email, left(p_student_id::text, 8))
    INTO v_student_name
    FROM public.students WHERE id = p_student_id;
    INSERT INTO public.cohorts (name, status, is_individual, individual_student_id, start_date, created_by)
    VALUES ('Individual - ' || v_student_name, 'active', true, p_student_id, current_date, p_created_by)
    RETURNING id INTO v_cohort_id;
  END IF;

  SELECT * INTO v_subscription
  FROM public.individual_subscriptions
  WHERE student_id = p_student_id;

  v_is_activating := NOT (
    FOUND
    AND v_subscription.status = 'active'
    AND v_subscription.current_period_end > now()
  );
  v_base := CASE WHEN v_is_activating THEN now() ELSE v_subscription.current_period_end END;
  v_period_start := v_base;
  v_period_end := public.add_months_clamped(v_base, p_duration_months);
  v_kind := CASE WHEN v_subscription.id IS NULL THEN 'purchase' ELSE 'renewal' END;

  IF v_subscription.id IS NULL THEN
    INSERT INTO public.individual_subscriptions (
      student_id, cohort_id, status, duration_months, amount, currency,
      current_period_start, current_period_end, cancelled_at
    ) VALUES (
      p_student_id, v_cohort_id, 'active', p_duration_months, p_amount, v_currency,
      v_period_start, v_period_end, NULL
    ) RETURNING id INTO v_subscription_id;
  ELSE
    UPDATE public.individual_subscriptions
    SET status = 'active',
        duration_months = p_duration_months,
        amount = p_amount,
        currency = v_currency,
        current_period_start = CASE WHEN v_is_activating THEN v_period_start ELSE current_period_start END,
        current_period_end = v_period_end,
        cancelled_at = NULL
    WHERE id = v_subscription.id
    RETURNING id INTO v_subscription_id;
  END IF;

  INSERT INTO public.subscription_payments (
    subscription_id, student_id, idempotency_key, status, is_activating, kind,
    duration_months, amount, currency, period_start, period_end,
    payment_method, payment_reference, notes, created_by
  ) VALUES (
    v_subscription_id, p_student_id, p_idempotency_key, 'completed', v_is_activating, v_kind,
    p_duration_months, p_amount, v_currency, v_period_start, v_period_end,
    NULLIF(btrim(p_payment_method), ''), NULLIF(btrim(p_payment_reference), ''), NULLIF(btrim(p_notes), ''), p_created_by
  ) RETURNING id INTO v_payment_id;

  UPDATE public.students SET cohort_id = v_cohort_id WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'ok', true,
    'subscriptionId', v_subscription_id,
    'paymentId', v_payment_id,
    'alreadyProcessed', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid, integer, numeric, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_or_renew_individual_subscription(uuid, integer, numeric, text, text, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.close_individual_subscription(
  p_subscription_id uuid,
  p_new_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_student_id uuid;
  v_cohort_id uuid;
  v_status text;
  v_period_end timestamptz;
BEGIN
  IF p_new_status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'invalid target status: %', p_new_status;
  END IF;

  SELECT student_id, cohort_id
  INTO v_student_id, v_cohort_id
  FROM public.individual_subscriptions
  WHERE id = p_subscription_id;

  IF NOT FOUND OR v_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_found');
  END IF;

  PERFORM public.claim_student_enrollment_model(v_student_id, 'individual');

  SELECT status, current_period_end
  INTO v_status, v_period_end
  FROM public.individual_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF p_new_status = 'expired'
     AND (v_status <> 'active' OR v_period_end >= now()) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_longer_applicable');
  END IF;

  UPDATE public.individual_subscriptions
  SET status = p_new_status,
      cancelled_at = CASE
        WHEN p_new_status = 'cancelled' THEN COALESCE(cancelled_at, now())
        ELSE cancelled_at
      END
  WHERE id = p_subscription_id;

  UPDATE public.students
  SET cohort_id = NULL
  WHERE id = v_student_id AND cohort_id = v_cohort_id;

  RETURN jsonb_build_object('ok', true, 'skipped', false, 'status', p_new_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_individual_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_individual_subscription(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_content_cohort_tag(
  p_content_table text,
  p_content_id uuid,
  p_cohort_id uuid,
  p_add boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_content_table NOT IN ('courses', 'virtual_experiences', 'certifications', 'learning_paths') THEN
    RAISE EXCEPTION 'invalid content table: %', p_content_table;
  END IF;

  IF p_add THEN
    EXECUTE format(
      'UPDATE public.%I SET cohort_ids = array_append(cohort_ids, $1) WHERE id = $2 AND NOT ($1 = ANY(cohort_ids))',
      p_content_table
    ) USING p_cohort_id, p_content_id;
  ELSE
    EXECUTE format(
      'UPDATE public.%I SET cohort_ids = array_remove(cohort_ids, $1) WHERE id = $2',
      p_content_table
    ) USING p_cohort_id, p_content_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text, uuid, uuid, boolean) TO service_role;

COMMIT;
