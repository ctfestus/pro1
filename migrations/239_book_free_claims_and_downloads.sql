-- 239_book_free_claims_and_downloads.sql
--
-- 1. Free claims. A free product (available_to_everyone) can be had without an account: the visitor
--    gives a name and email, and the download link is emailed to them, never shown on screen, so
--    only the owner of the address gets the file. A claim is a guest book_purchases row (migration
--    238) with kind = 'free_claim', amount 0 and currency 'XXX' (ISO 4217's "no currency"). It is
--    marked paid when created and gets the same allowance as a guest purchase: 7 days, 5 downloads.
--    Its reference starts with "free-", so the Paystack webhook and sweep never treat it as a sale.
--
-- 2. Download log. Every download link handed out for a full product (signed-in buyers, cohort
--    readers, free downloads and guests; not the owner's or an admin's own previews) is recorded,
--    so instructors and admins can see how often each product is downloaded and by whom. Service
--    role only: no client reads or writes it.
--
-- Safe to run again: every statement is idempotent. Mirrored into festman-fresh-schema.sql.

-- Also in 238; repeated so a database that ran an earlier 238 without it still gets it.
ALTER TABLE public.book_purchases ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE public.book_purchases
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sale';
ALTER TABLE public.book_purchases DROP CONSTRAINT IF EXISTS book_purchases_kind_check;
ALTER TABLE public.book_purchases ADD CONSTRAINT book_purchases_kind_check CHECK (
  (kind = 'sale' AND amount > 0)
  OR (kind = 'free_claim' AND is_guest AND amount = 0 AND currency = 'XXX' AND paystack_reference LIKE 'free-%')
);
-- The column's own "amount > 0" check would refuse a free claim; book_purchases_kind_check keeps it
-- for sales.
ALTER TABLE public.book_purchases DROP CONSTRAINT IF EXISTS book_purchases_amount_check;

CREATE INDEX IF NOT EXISTS idx_book_purchases_book_paid
  ON public.book_purchases(book_id, paid_at) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS public.book_download_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  -- Who downloaded: an account, or a guest purchase / free claim. Exactly one of the two.
  student_id  uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  purchase_id uuid        REFERENCES public.book_purchases(id) ON DELETE SET NULL,
  source      text        NOT NULL CHECK (source IN ('account', 'guest')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_book_download_events_book ON public.book_download_events(book_id, created_at);

ALTER TABLE public.book_download_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.book_download_events FROM anon, authenticated;
GRANT ALL ON public.book_download_events TO service_role;

-- Sales and downloads, totalled in the database (lib/books/stats.ts) ---------------------------
-- Per product: paid sales, revenue per currency, free claims, downloads (all time and 30 days).
-- Service role only; the caller decides which products a person may see.
CREATE OR REPLACE FUNCTION public.book_product_stats(p_book_ids uuid[])
RETURNS TABLE (book_id uuid, sold bigint, revenue jsonb, free_claims bigint, downloads bigint, downloads_30d bigint)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_book_ids) AS book_id
  ), counts AS (
    SELECT p.book_id,
           count(*) FILTER (WHERE p.kind = 'sale')       AS sold,
           count(*) FILTER (WHERE p.kind = 'free_claim') AS free_claims
      FROM public.book_purchases p
     WHERE p.book_id = ANY (p_book_ids) AND p.status = 'paid'
     GROUP BY p.book_id
  ), revenue AS (
    SELECT t.book_id, jsonb_object_agg(t.currency, t.total) AS revenue
      FROM (
        SELECT p.book_id, p.currency, round(sum(p.amount), 2) AS total
          FROM public.book_purchases p
         WHERE p.book_id = ANY (p_book_ids) AND p.status = 'paid' AND p.kind = 'sale'
         GROUP BY p.book_id, p.currency
      ) t
     GROUP BY t.book_id
  ), dl AS (
    SELECT e.book_id,
           count(*) AS downloads,
           count(*) FILTER (WHERE e.created_at > now() - interval '30 days') AS downloads_30d
      FROM public.book_download_events e
     WHERE e.book_id = ANY (p_book_ids)
     GROUP BY e.book_id
  )
  SELECT i.book_id,
         coalesce(c.sold, 0), coalesce(r.revenue, '{}'::jsonb), coalesce(c.free_claims, 0),
         coalesce(d.downloads, 0), coalesce(d.downloads_30d, 0)
    FROM ids i
    LEFT JOIN counts  c ON c.book_id = i.book_id
    LEFT JOIN revenue r ON r.book_id = i.book_id
    LEFT JOIN dl      d ON d.book_id = i.book_id;
$$;
REVOKE EXECUTE ON FUNCTION public.book_product_stats(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.book_product_stats(uuid[]) TO service_role;

-- Downloads of one product per person (an account, or a guest purchase / free claim), for People.
CREATE OR REPLACE FUNCTION public.book_download_counts(p_book_id uuid)
RETURNS TABLE (student_id uuid, purchase_id uuid, downloads bigint, first_at timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT e.student_id, e.purchase_id, count(*), min(e.created_at)
    FROM public.book_download_events e
   WHERE e.book_id = p_book_id
   GROUP BY e.student_id, e.purchase_id;
$$;
REVOKE EXECUTE ON FUNCTION public.book_download_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.book_download_counts(uuid) TO service_role;

-- Free claims per email in the last hour, checked in the database as well as in Redis, so the limit
-- holds even if the rate-limit store is down.
CREATE INDEX IF NOT EXISTS idx_book_purchases_free_claims_recent
  ON public.book_purchases(guest_email, created_at) WHERE kind = 'free_claim';
CREATE INDEX IF NOT EXISTS idx_book_purchases_free_claims_time
  ON public.book_purchases(created_at) WHERE kind = 'free_claim';

-- Free claims, made atomically --------------------------------------------------------------------
-- One claim per email and product at a time, and the hourly limits (3 new claims per email across
-- all products, 300 across the platform: the backstop to the Redis limits) checked atomically.
-- Two transaction-level advisory locks, always taken in this order so they cannot deadlock:
--   1. per email, held for the whole call: the open-claim lookup, the per-email limit and the insert
--      are one step for that address, across every product;
--   2. platform-wide, taken only when a new claim is about to be made: the 300-an-hour check and the
--      insert are one step for everyone.
-- Returns the open claim if there is one (inside its seven days, downloads left), refuses past
-- the limits, or creates the claim.
CREATE OR REPLACE FUNCTION public.claim_free_book(
  p_book_id     uuid,
  p_book_title  text,
  p_email       text,
  p_name        text,
  p_return_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('book-free-claim:email:' || lower(p_email), 0));

  SELECT id INTO v_id FROM public.book_purchases
   WHERE kind = 'free_claim' AND book_id = p_book_id AND guest_email = lower(p_email) AND status = 'paid'
     AND guest_access_expires_at > now() AND guest_downloads_used < 5
   ORDER BY paid_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'existing', true);
  END IF;

  IF (SELECT count(*) FROM public.book_purchases
       WHERE kind = 'free_claim' AND guest_email = lower(p_email) AND created_at > now() - interval '1 hour') >= 3 THEN
    RETURN jsonb_build_object('limited', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('book-free-claim:all', 0));
  IF (SELECT count(*) FROM public.book_purchases
       WHERE kind = 'free_claim' AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN jsonb_build_object('limited', true);
  END IF;

  INSERT INTO public.book_purchases (
    kind, is_guest, student_id, guest_email, guest_name, guest_return_hash, book_id, book_title,
    amount, currency, paystack_reference, royalty_pct, status, paid_at, guest_access_expires_at
  ) VALUES (
    'free_claim', true, NULL, lower(p_email), p_name, p_return_hash, p_book_id, p_book_title,
    0, 'XXX', 'free-' || gen_random_uuid()::text, 0, 'paid', now(), now() + interval '7 days'
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'existing', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_free_book(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_free_book(uuid, text, text, text, text) TO service_role;
