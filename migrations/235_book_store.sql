-- 235_book_store.sql
--
-- Books becomes a digital product store: people preview a book, buy it, and download the file.
-- Reading inside the platform is dropped, so the reading tables from 232 go (they never had any
-- UI or API writing to them). Purchases gain what checkout and fulfilment need.
--
-- Mirrored into festman-fresh-schema.sql.

-- Reading tables (unused) --------------------------------------------------------------------
DROP TABLE IF EXISTS public.book_annotations;
DROP TABLE IF EXISTS public.book_chapter_progress;
DROP TABLE IF EXISTS public.user_books;

-- Purchases ------------------------------------------------------------------------------------
ALTER TABLE public.book_purchases
  ADD COLUMN IF NOT EXISTS authorization_url       text,
  ADD COLUMN IF NOT EXISTS paystack_transaction_id bigint,
  ADD COLUMN IF NOT EXISTS review_reason           text,
  ADD COLUMN IF NOT EXISTS review_resolved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_email_sent_at   timestamptz,
  -- When the hourly sweep last asked Paystack about this open checkout. It checks the least
  -- recently checked first, so abandoned checkouts cannot starve newer ones.
  ADD COLUMN IF NOT EXISTS last_checked_at         timestamptz;

-- needs_review: money arrived but access could not be granted automatically (wrong amount, the
-- buyer already owned the book, or the account was deleted). The admin Books section lists every
-- row with a review_reason until an admin marks it resolved (review_resolved_at). Refunds are
-- handled outside the platform, so this migration does not react to them.
ALTER TABLE public.book_purchases DROP CONSTRAINT IF EXISTS book_purchases_status_check;
ALTER TABLE public.book_purchases ADD CONSTRAINT book_purchases_status_check
  CHECK (status IN ('pending','paid','failed','refunded','needs_review'));

-- One open checkout per buyer per book, so two tabs cannot both hold a payable Paystack link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_purchases_one_pending
  ON public.book_purchases(student_id, book_id) WHERE status = 'pending';
-- The admin "needs attention" list.
CREATE INDEX IF NOT EXISTS idx_book_purchases_attention
  ON public.book_purchases(created_at) WHERE review_reason IS NOT NULL AND review_resolved_at IS NULL;

-- Visibility -----------------------------------------------------------------------------------
-- A buyer keeps seeing a book they own after it is archived, matching lib/books/access.ts (which
-- already lets them download it). Without this their RLS-backed library queries lose the title.
CREATE OR REPLACE FUNCTION public.can_see_book(p_book public.books)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_book.user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
    OR (
      p_book.status = 'published'
      AND (
        p_book.available_to_everyone
        OR p_book.purchasable
        OR (SELECT s.cohort_id FROM public.students s WHERE s.id = (SELECT auth.uid())) = ANY(p_book.cohort_ids)
        -- Same path rule as "courses: participants select" and hasPublishedStudentContentAccess:
        -- a published path reaching the reader grants its items.
        OR EXISTS (
          SELECT 1 FROM public.learning_paths lp
          WHERE lp.status = 'published'
            AND p_book.id = ANY(lp.item_ids)
            AND (
              lp.available_to_everyone
              OR (SELECT s.cohort_id FROM public.students s WHERE s.id = (SELECT auth.uid())) = ANY(lp.cohort_ids)
            )
        )
      )
    )
    -- Owners keep a book after it is archived (migration 235), as canReadBook does. Drafts stay hidden.
    OR (
      p_book.status IN ('published', 'archived')
      AND EXISTS (
        SELECT 1 FROM public.book_entitlements e
        WHERE e.book_id = p_book.id
          AND e.student_id = (SELECT auth.uid())
          AND e.revoked_at IS NULL
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_see_book(public.books) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_book(public.books) TO authenticated, service_role;

-- Fulfilment -----------------------------------------------------------------------------------
-- Called once Paystack has said the charge succeeded (webhook or the buyer's return page, often
-- both at once). The row lock makes it run once: the second caller sees 'paid' and stops. A
-- purchase marked failed (an abandoned checkout replaced by a newer one) is still fulfilled if its
-- money turns up later -- the buyer paid, so they own it.
--
-- Refunds are handled outside the platform (in Paystack, by staff), so nothing here reacts to them.
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
