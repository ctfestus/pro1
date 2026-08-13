-- A brand-new learner received two emails moments apart: "set up your account" and, in the
-- paid flow, "your subscription is active", or in the request flow, "here is what you owe".
-- Whether an account and a plan are separate concepts is an implementation detail, not
-- something the learner should have to reconcile in their inbox. Both flows now send one
-- welcome message covering both.
--
-- That requires the payment-request email to be recoverable the way the activation email
-- already is. It has no delivery record today, so a failure is permanent and silent: the
-- learner never learns they have an account or that they owe anything. This adds the same
-- stamp subscription_payments.activation_email_sent_at provides, so the hourly sweep can
-- retry it.

BEGIN;

-- Guarded so re-running cannot stamp a request whose email is still pending, which would
-- suppress exactly the retries this exists to enable. Same shape as migration 177.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.subscription_payment_requests'::regclass
      AND attname = 'request_email_sent_at'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE public.subscription_payment_requests
      ADD COLUMN request_email_sent_at timestamptz;
    -- Existing requests were emailed under the old behavior. Treat them as delivered so
    -- this change does not re-mail every learner with an open request.
    UPDATE public.subscription_payment_requests
    SET request_email_sent_at = created_at;
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.subscription_payment_requests.request_email_sent_at IS
  'Set once the payment-request email is accepted by the mail provider. NULL means it still needs sending, which is what makes a failed delivery retryable.';

-- Only open requests are worth chasing, so the sweep never has to scan settled ones.
CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_email_pending
  ON public.subscription_payment_requests(id)
  WHERE request_email_sent_at IS NULL;

COMMIT;
