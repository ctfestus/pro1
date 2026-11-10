-- 242_book_product_type.sql
--
-- What kind of digital product it is: a book, template, guide, prompt, skill or plugin, or another
-- kind the author names (product_type 'other' with product_type_label). Shown on the product page,
-- the store and Explore, and the store can filter by it. Existing products start as books.
--
-- Also a format rule for product web addresses (books.slug), now that authors can choose their own
-- (PATCH /api/books/address): lowercase letters, digits and hyphens. NOT VALID, so rows made before
-- the rule are not re-checked; every new or changed address is.
--
-- save_book (last redefined in 240) writes the books columns from its own list, so it is redefined
-- with the two new columns. Safe to run again. Mirrored into festman-fresh-schema.sql.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS product_type       text NOT NULL DEFAULT 'book',
  ADD COLUMN IF NOT EXISTS product_type_label text;
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_product_type_check;
ALTER TABLE public.books ADD CONSTRAINT books_product_type_check CHECK (
  product_type IN ('book', 'template', 'guide', 'prompt', 'skill', 'plugin', 'other')
  AND (product_type_label IS NULL OR length(btrim(product_type_label)) BETWEEN 1 AND 40)
  AND (product_type <> 'other' OR product_type_label IS NOT NULL)
);
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_slug_format_check;
ALTER TABLE public.books ADD CONSTRAINT books_slug_format_check
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,119}$') NOT VALID;

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
    recommended_course_ids = v_new.recommended_course_ids,
    product_type          = v_new.product_type,
    product_type_label    = v_new.product_type_label,
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
