-- 237_book_price_sales.sql
--
-- A digital product can be put on sale: each price may carry a lower sale price and, optionally,
-- when the sale ends. While a sale is on, checkout charges the sale price and the store shows the
-- regular price crossed out next to it; after sale_ends_at it is back to the regular price on its
-- own (lib/books/pricing.ts decides "on sale", in one place for checkout, the store and Explore).
--
-- save_book (last redefined in 236) writes prices from its own column list, so it is redefined
-- with the sale columns.
--
-- Mirrored into festman-fresh-schema.sql.

ALTER TABLE public.book_prices
  ADD COLUMN IF NOT EXISTS sale_amount  numeric(10,2),
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;
ALTER TABLE public.book_prices DROP CONSTRAINT IF EXISTS book_prices_sale_check;
ALTER TABLE public.book_prices ADD CONSTRAINT book_prices_sale_check
  CHECK (sale_amount IS NULL OR (sale_amount > 0 AND sale_amount < amount));

CREATE OR REPLACE FUNCTION public.save_book(
  p_book_id             uuid,
  p_expected_updated_at timestamptz,
  p_patch               jsonb,
  p_chapters            jsonb   DEFAULT NULL,
  p_clear_chapters      boolean DEFAULT false,
  p_prices              jsonb   DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old public.books;
  v_new public.books;
BEGIN
  SELECT * INTO v_old FROM public.books WHERE id = p_book_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book not found' USING ERRCODE = 'BK404';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'book changed since it was loaded' USING ERRCODE = 'BK409';
  END IF;

  v_new := jsonb_populate_record(v_old, COALESCE(p_patch, '{}'::jsonb));
  v_new.cohort_ids := COALESCE(ARRAY(
    SELECT c FROM unnest(v_new.cohort_ids) AS c
     WHERE EXISTS (SELECT 1 FROM public.cohorts k WHERE k.id = c)
  ), '{}'::uuid[]);

  UPDATE public.books SET
    title                 = v_new.title,
    subtitle              = v_new.subtitle,
    description           = v_new.description,
    cover_image           = v_new.cover_image,
    authors               = v_new.authors,
    category              = v_new.category,
    topics                = v_new.topics,
    skills                = v_new.skills,
    difficulty            = v_new.difficulty,
    estimated_minutes     = v_new.estimated_minutes,
    status                = v_new.status,
    cohort_ids            = v_new.cohort_ids,
    available_to_everyone = v_new.available_to_everyone,
    purchasable           = v_new.purchasable,
    royalty_pct           = v_new.royalty_pct,
    format                = v_new.format,
    file_path             = v_new.file_path,
    file_size             = v_new.file_size,
    preview_file_path     = v_new.preview_file_path,
    rights_holder         = v_new.rights_holder,
    license_type          = v_new.license_type,
    license_url           = v_new.license_url,
    license_expires_at    = v_new.license_expires_at,
    ai_allowed            = v_new.ai_allowed,
    endorsement_permitted = v_new.endorsement_permitted,
    sample_spec           = v_new.sample_spec,
    updated_at            = clock_timestamp()
  WHERE id = p_book_id
  RETURNING * INTO v_new;

  IF p_chapters IS NOT NULL THEN
    IF jsonb_typeof(p_chapters) = 'array' AND jsonb_array_length(p_chapters) = 0
       AND NOT COALESCE(p_clear_chapters, false)
       AND EXISTS (SELECT 1 FROM public.book_chapters WHERE book_id = p_book_id) THEN
      RAISE EXCEPTION 'saving would remove every chapter' USING ERRCODE = 'BK400';
    END IF;
    PERFORM public.save_book_chapters(p_book_id, p_chapters);
  END IF;

  IF p_prices IS NOT NULL THEN
    INSERT INTO public.book_prices (book_id, currency, amount, sale_amount, sale_ends_at)
    SELECT p_book_id, p->>'currency', (p->>'amount')::numeric,
           NULLIF(p->>'sale_amount', '')::numeric, NULLIF(p->>'sale_ends_at', '')::timestamptz
      FROM jsonb_array_elements(p_prices) AS p
    ON CONFLICT (book_id, currency) DO UPDATE
      SET amount = EXCLUDED.amount, sale_amount = EXCLUDED.sale_amount, sale_ends_at = EXCLUDED.sale_ends_at;
    DELETE FROM public.book_prices
     WHERE book_id = p_book_id
       AND currency NOT IN (SELECT p->>'currency' FROM jsonb_array_elements(p_prices) AS p);
  END IF;

  -- Assignments follow the book's cohorts: a cohort taken off loses its row now; a cohort is
  -- assigned once the book is published. Unpublishing keeps rows, so dates survive a republish.
  DELETE FROM public.cohort_assignments
   WHERE content_id = p_book_id AND NOT (cohort_id = ANY(v_new.cohort_ids));
  IF v_new.status = 'published' THEN
    INSERT INTO public.cohort_assignments (content_type, content_id, cohort_id)
    SELECT 'book', p_book_id, c FROM unnest(v_new.cohort_ids) AS c
    ON CONFLICT (content_id, cohort_id) DO NOTHING;
  END IF;

  RETURN to_jsonb(v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_book(uuid, timestamptz, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_book(uuid, timestamptz, jsonb, jsonb, boolean, jsonb) TO service_role;
