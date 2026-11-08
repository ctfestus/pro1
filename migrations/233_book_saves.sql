-- 233: save a book, and its table of contents, in one transaction each.
--
-- Chapters cannot be saved by "delete all, insert again": book_chapter_progress cascades from a
-- chapter and book_annotations point at one, so recreating rows would wipe every reader's progress
-- and orphan their notes each time an author fixed a typo. They cannot be reordered with plain
-- UPDATEs either, because UNIQUE (book_id, position) is checked row by row and a swap collides
-- half way.
--
-- So the editor sends the whole ordered list, existing rows by id, and this function:
--   1. locks the book row (two saves of one book serialize),
--   2. deletes the chapters the list no longer contains,
--   3. parks the survivors on positions far above any real one,
--   4. walks the list, updating survivors and inserting new chapters at their final positions.
-- An id that belongs to another book is refused, so a crafted request cannot move or rename
-- someone else's chapter. Service role only: /api/books checks ownership and validates locators.

CREATE OR REPLACE FUNCTION public.save_book_chapters(p_book_id uuid, p_chapters jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item  jsonb;
  v_pos   integer;
  v_id    uuid;
  v_keep  uuid[];
BEGIN
  IF jsonb_typeof(p_chapters) <> 'array' THEN
    RAISE EXCEPTION 'chapters must be an array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_chapters) > 1000 THEN
    RAISE EXCEPTION 'too many chapters' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM public.books WHERE id = p_book_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'book % not found', p_book_id; END IF;

  SELECT COALESCE(array_agg((c->>'id')::uuid), '{}'::uuid[]) INTO v_keep
    FROM jsonb_array_elements(p_chapters) AS c
   WHERE COALESCE(c->>'id', '') <> '';

  IF EXISTS (
    SELECT 1 FROM unnest(v_keep) AS k(id)
     WHERE NOT EXISTS (SELECT 1 FROM public.book_chapters bc WHERE bc.id = k.id AND bc.book_id = p_book_id)
  ) THEN
    RAISE EXCEPTION 'chapter does not belong to this book' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.book_chapters WHERE book_id = p_book_id AND NOT (id = ANY(v_keep));
  UPDATE public.book_chapters SET position = position + 1000000 WHERE book_id = p_book_id;

  v_pos := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_chapters) LOOP
    v_id := NULLIF(v_item->>'id', '')::uuid;
    IF v_id IS NOT NULL THEN
      UPDATE public.book_chapters SET
        position          = v_pos,
        title             = v_item->>'title',
        locator           = COALESCE(v_item->'locator', '{}'::jsonb),
        estimated_minutes = NULLIF(v_item->>'estimated_minutes', '')::integer,
        required          = COALESCE((v_item->>'required')::boolean, true),
        is_preview        = COALESCE((v_item->>'is_preview')::boolean, false)
      WHERE id = v_id AND book_id = p_book_id;
    ELSE
      INSERT INTO public.book_chapters (book_id, position, title, locator, estimated_minutes, required, is_preview)
      VALUES (
        p_book_id, v_pos, v_item->>'title', COALESCE(v_item->'locator', '{}'::jsonb),
        NULLIF(v_item->>'estimated_minutes', '')::integer,
        COALESCE((v_item->>'required')::boolean, true),
        COALESCE((v_item->>'is_preview')::boolean, false)
      );
    END IF;
    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_pos);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_book_chapters(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_book_chapters(uuid, jsonb) TO service_role;

-- Save a book in one transaction: the row, its chapters, its prices and its cohort assignments.
--
-- /api/books validates and sanitizes the request (ownership, uploaded files, publish readiness) and
-- passes the result here. Doing the writes as separate requests let a failure part way leave a book
-- published without its prices, and let two saves that read the same version both pass the stale
-- check and overwrite each other. Here:
--   * the book row is locked first, and the version the caller read is compared under that lock,
--     so of two concurrent saves of one version the second is refused (BK409);
--   * only the editable columns below are written -- never id, user_id, slug or created_at,
--     whatever p_patch contains;
--   * cohort ids that no longer exist are dropped, so a deleted cohort cannot break the
--     cohort_assignments foreign key on every later save;
--   * an empty chapter list is refused (BK400) unless p_clear_chapters says it is deliberate;
--   * any error rolls back everything, including the row update.
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
    INSERT INTO public.book_prices (book_id, currency, amount)
    SELECT p_book_id, p->>'currency', (p->>'amount')::numeric
      FROM jsonb_array_elements(p_prices) AS p
    ON CONFLICT (book_id, currency) DO UPDATE SET amount = EXCLUDED.amount;
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
