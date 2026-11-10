-- 238_book_guest_purchases.sql
--
-- Guest checkout: a digital product can be bought with only an email address. No account is
-- created and nothing is linked to one; the buyer downloads the file and that is the end.
--
-- A guest purchase is a book_purchases row with is_guest = true, the buyer's name and email, and no
-- student_id. When its payment is verified, fulfil_book_purchase marks it paid and starts its one
-- download allowance: guest_access_expires_at (paid_at + 7 days) and guest_downloads_used (at most
-- 5). The allowance lives on the purchase, so resending the email or confirming the payment again
-- can never reset it or grant more. No entitlement is created.
--
-- The links the buyer gets are HMAC-signed over the purchase id (lib/books/guest-access.ts), so
-- nothing about them is stored here: a retried or resent email carries the identical link. A link
-- only works while the purchase is paid (a refund ends it) and inside the allowance.
--
-- guest_return_hash is the SHA-256 of a random code only the browser that started the checkout
-- holds. The Paystack return page needs it to collect the download; the reference alone (in browser
-- history or a receipt) is not enough, and another browser using the same email never sees it.
--
-- Safe to run again: every statement is idempotent.
--
-- Mirrored into festman-fresh-schema.sql.

ALTER TABLE public.book_purchases
  ADD COLUMN IF NOT EXISTS is_guest                boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_email             text,
  ADD COLUMN IF NOT EXISTS guest_name              text,
  ADD COLUMN IF NOT EXISTS guest_return_hash       text,
  ADD COLUMN IF NOT EXISTS guest_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS guest_downloads_used    integer     NOT NULL DEFAULT 0;

-- guest_name was added after this migration first shipped: a database that already ran the earlier
-- version and holds guest rows gets a placeholder name, so re-running it cannot fail on the check.
UPDATE public.book_purchases SET guest_name = 'Guest' WHERE is_guest AND guest_name IS NULL;
ALTER TABLE public.book_purchases DROP CONSTRAINT IF EXISTS book_purchases_guest_check;
ALTER TABLE public.book_purchases ADD CONSTRAINT book_purchases_guest_check CHECK (
  (is_guest AND student_id IS NULL AND guest_email IS NOT NULL
     AND guest_email = lower(guest_email) AND length(guest_email) BETWEEN 3 AND 254
     AND guest_name IS NOT NULL AND length(btrim(guest_name)) BETWEEN 1 AND 120
     AND guest_return_hash ~ '^[0-9a-f]{64}$')
  OR (NOT is_guest AND guest_email IS NULL AND guest_name IS NULL AND guest_return_hash IS NULL AND guest_access_expires_at IS NULL)
);
ALTER TABLE public.book_purchases DROP CONSTRAINT IF EXISTS book_purchases_guest_downloads_check;
ALTER TABLE public.book_purchases ADD CONSTRAINT book_purchases_guest_downloads_check
  CHECK (guest_downloads_used >= 0 AND guest_downloads_used <= 5);

CREATE INDEX IF NOT EXISTS idx_book_purchases_guest_email
  ON public.book_purchases(guest_email) WHERE is_guest;

-- Fulfilment ----------------------------------------------------------------------------------
-- As in 235, with a guest branch: a guest purchase is paid without an entitlement and gets its
-- download allowance. A signed-in purchase whose account was deleted still goes to review.
CREATE OR REPLACE FUNCTION public.fulfil_book_purchase(
  p_reference      text,
  p_amount         numeric,
  p_currency       text,
  p_transaction_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v public.book_purchases%ROWTYPE;
  v_reason text;
BEGIN
  SELECT * INTO v FROM public.book_purchases WHERE paystack_reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;

  IF p_transaction_id IS NOT NULL AND v.paystack_transaction_id IS NULL THEN
    UPDATE public.book_purchases SET paystack_transaction_id = p_transaction_id WHERE id = v.id;
  END IF;

  IF v.status IN ('paid', 'refunded', 'needs_review') THEN
    RETURN jsonb_build_object('status', v.status, 'purchaseId', v.id, 'bookId', v.book_id, 'alreadyProcessed', true);
  END IF;

  IF round(p_amount * 100) <> round(v.amount * 100) OR upper(coalesce(p_currency, '')) <> v.currency THEN
    v_reason := 'amount_mismatch';
  ELSIF v.is_guest AND v.guest_access_expires_at IS NOT NULL THEN
    -- Paid before, then moved off 'paid' by hand (a refund recorded as failed, say): a webhook replay
    -- or the buyer's return page must not quietly restore access. Staff decide.
    v_reason := 'guest_previously_paid';
  ELSIF v.is_guest THEN
    v_reason := NULL;
  ELSIF v.student_id IS NULL THEN
    v_reason := 'account_deleted';
  ELSIF EXISTS (
    SELECT 1 FROM public.book_entitlements
    WHERE student_id = v.student_id AND book_id = v.book_id AND revoked_at IS NULL
  ) THEN
    v_reason := 'already_owned';
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.book_purchases
    SET status = 'needs_review', review_reason = v_reason, paid_at = now()
    WHERE id = v.id;
    RETURN jsonb_build_object('status', 'needs_review', 'reason', v_reason, 'purchaseId', v.id, 'bookId', v.book_id);
  END IF;

  IF v.is_guest THEN
    -- The one allowance this purchase ever gets, starting at verified payment. Set once: a row moved
    -- back to failed or pending by hand (record refunds as 'refunded', which stops here above) and
    -- then fulfilled again keeps its original seven days.
    UPDATE public.book_purchases
    SET status = 'paid', paid_at = coalesce(paid_at, now()),
        guest_access_expires_at = coalesce(guest_access_expires_at, now() + interval '7 days')
    WHERE id = v.id;
    RETURN jsonb_build_object('status', 'paid', 'purchaseId', v.id, 'bookId', v.book_id, 'alreadyProcessed', false);
  END IF;

  -- Two of the buyer's checkouts paid at the same moment both pass the check above (each locks only
  -- its own row); the unique index decides, and the loser goes to review instead of erroring.
  INSERT INTO public.book_entitlements (student_id, book_id, source, source_ref)
  VALUES (v.student_id, v.book_id, 'purchase', v.id::text)
  ON CONFLICT (student_id, book_id) WHERE revoked_at IS NULL DO NOTHING;
  IF NOT FOUND THEN
    UPDATE public.book_purchases
    SET status = 'needs_review', review_reason = 'already_owned', paid_at = now()
    WHERE id = v.id;
    RETURN jsonb_build_object('status', 'needs_review', 'reason', 'already_owned', 'purchaseId', v.id, 'bookId', v.book_id);
  END IF;
  UPDATE public.book_purchases SET status = 'paid', paid_at = now() WHERE id = v.id;
  -- Any other checkout the buyer still has open for this book is now pointless.
  UPDATE public.book_purchases SET status = 'failed'
  WHERE student_id = v.student_id AND book_id = v.book_id AND status = 'pending' AND id <> v.id;
  RETURN jsonb_build_object('status', 'paid', 'purchaseId', v.id, 'bookId', v.book_id, 'alreadyProcessed', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfil_book_purchase(text, numeric, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fulfil_book_purchase(text, numeric, text, bigint) TO service_role;

-- Download allowance ---------------------------------------------------------------------------
-- Takes one of a paid guest purchase's five downloads, under a row lock so parallel clicks cannot
-- take more than five. Counted when a download link is handed out; release_guest_book_download
-- gives it back when handing it out failed. Opening an HTML product in the browser does not count.
CREATE OR REPLACE FUNCTION public.take_guest_book_download(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v public.book_purchases%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.book_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND OR NOT v.is_guest THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v.status <> 'paid' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_paid'); END IF;
  IF v.guest_access_expires_at IS NULL OR v.guest_access_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v.guest_downloads_used >= 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_up'); END IF;
  UPDATE public.book_purchases SET guest_downloads_used = guest_downloads_used + 1 WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'remaining', 5 - (v.guest_downloads_used + 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.take_guest_book_download(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.take_guest_book_download(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_guest_book_download(p_purchase_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.book_purchases SET guest_downloads_used = guest_downloads_used - 1
  WHERE id = p_purchase_id AND is_guest AND guest_downloads_used > 0;
$$;
REVOKE EXECUTE ON FUNCTION public.release_guest_book_download(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_guest_book_download(uuid) TO service_role;
