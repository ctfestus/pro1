-- 243_book_more_formats.sql
--
-- More kinds of digital product file, and products that are a link.
--
-- Files: besides EPUB, PDF and HTML, a product may now be a ZIP, an Excel workbook (.xlsx), a Word
-- document (.docx), a PowerPoint (.pptx), a CSV, a text file (.txt) or a Markdown file (.md). They
-- live in the same private book-files bucket under the same scoped paths
-- (<book id>/file-<uuid>.<format>, books_*_path_scoped in 232, which already follow books.format),
-- and are only ever handed out as short-lived signed downloads.
--
-- Links: format 'link' is a product delivered as a web address (a Canva template, a Notion page, a
-- shared drive folder). A link product has no file and no sample file. The address itself is kept
-- out of books on purpose: books rows are readable by every signed-in account that can see the
-- product (can_see_book), and a for-sale product is visible to all of them, so a column there would
-- hand the address to people who never bought it. It lives in book_links instead, which only the
-- service role writes and only the owning instructor or an admin may read. Buyers get it from
-- /api/books/[id]/file and guests from /api/books/guest-access/open, which check access every time.
--
-- save_book (last redefined in 242) gains p_link, so the address is written in the same transaction
-- as the row: a product can never be published as a link without one, and moving a product from a
-- link to a file removes its address in the same save.
--
-- Safe to run again. Mirrored into festman-fresh-schema.sql.

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_format_check;
ALTER TABLE public.books ADD CONSTRAINT books_format_check CHECK (
  format IN ('epub', 'pdf', 'html', 'zip', 'xlsx', 'docx', 'pptx', 'csv', 'txt', 'md', 'link')
);

-- A published product has its file, or for a link product its address (checked in save_book, as a
-- CHECK cannot see book_links), and a licence.
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_published_ready;
ALTER TABLE public.books ADD CONSTRAINT books_published_ready CHECK (
  status <> 'published'
  OR (format IS NOT NULL AND license_type IS NOT NULL AND (format = 'link' OR file_path IS NOT NULL))
);
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_link_has_no_file;
ALTER TABLE public.books ADD CONSTRAINT books_link_has_no_file CHECK (
  format IS DISTINCT FROM 'link' OR (file_path IS NULL AND file_size IS NULL AND preview_file_path IS NULL)
);

-- The address of a link product ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.book_links (
  book_id    uuid        PRIMARY KEY REFERENCES public.books(id) ON DELETE CASCADE,
  url        text        NOT NULL CHECK (url ~ '^https://[^\s/?#@]+\.[^\s/?#@]+' AND length(url) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.book_links FROM anon, authenticated;
GRANT SELECT ON public.book_links TO authenticated;
GRANT ALL ON public.book_links TO service_role;

-- The editor reads the address back for the product's own author (or an admin). There is no write
-- policy: only save_book, on the service role, changes it.
DROP POLICY IF EXISTS "book_links: owner select" ON public.book_links;
CREATE POLICY "book_links: owner select"
  ON public.book_links FOR SELECT TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND EXISTS (
    SELECT 1 FROM public.books b
    WHERE b.id = book_id AND (b.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  ));

-- The rule also holds for direct writes to books, not only for save_book: the owner may still update
-- their row under its RLS policy. Checked when the transaction commits (deferred), so save_book can
-- write the row and then its address. A product that is not a link loses any address it had; a
-- published link product without one is refused, so it can never be listed and sold with nothing
-- to hand over.
CREATE OR REPLACE FUNCTION public.check_book_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_format text;
  v_status text;
BEGIN
  -- The row as it stands at commit, not as this statement left it.
  SELECT format, status INTO v_format, v_status FROM public.books WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_format IS DISTINCT FROM 'link' THEN
    DELETE FROM public.book_links WHERE book_id = NEW.id;
  ELSIF v_status = 'published' AND NOT EXISTS (SELECT 1 FROM public.book_links WHERE book_id = NEW.id) THEN
    RAISE EXCEPTION 'a published link product needs its address' USING ERRCODE = 'BK422';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_book_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS books_link_check ON public.books;
CREATE CONSTRAINT TRIGGER books_link_check
  AFTER INSERT OR UPDATE OF format, status ON public.books
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_book_link();

-- Storage: the new file types ------------------------------------------------------------------
UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'application/epub+zip', 'application/pdf', 'text/html',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'text/markdown'
] WHERE id = 'book-files';

-- save_book, with the link ---------------------------------------------------------------------
-- As in 242, plus:
--   p_link  {"url": "https://..."} sets the product's address (the row must be a link product)
--   * a product that is not a link keeps no address;
--   * a published link product must have one (BK422).
DROP FUNCTION IF EXISTS public.save_book(uuid, timestamptz, jsonb, jsonb, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.save_book(
  p_book_id             uuid,
  p_expected_updated_at timestamptz,
  p_patch               jsonb,
  p_chapters            jsonb   DEFAULT NULL,
  p_clear_chapters      boolean DEFAULT false,
  p_prices              jsonb   DEFAULT NULL,
  p_link                jsonb   DEFAULT NULL
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

  -- The address of a link product (migration 243).
  IF p_link IS NOT NULL THEN
    IF v_new.format IS DISTINCT FROM 'link' THEN
      RAISE EXCEPTION 'only a link product has an address' USING ERRCODE = 'BK422';
    END IF;
    INSERT INTO public.book_links (book_id, url, updated_at)
    VALUES (p_book_id, p_link->>'url', clock_timestamp())
    ON CONFLICT (book_id) DO UPDATE SET url = EXCLUDED.url, updated_at = EXCLUDED.updated_at;
  END IF;
  IF v_new.format IS DISTINCT FROM 'link' THEN
    DELETE FROM public.book_links WHERE book_id = p_book_id;
  ELSIF v_new.status = 'published' AND NOT EXISTS (SELECT 1 FROM public.book_links WHERE book_id = p_book_id) THEN
    RAISE EXCEPTION 'a published link product needs its address' USING ERRCODE = 'BK422';
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.save_book(uuid, timestamptz, jsonb, jsonb, boolean, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_book(uuid, timestamptz, jsonb, jsonb, boolean, jsonb, jsonb) TO service_role;
