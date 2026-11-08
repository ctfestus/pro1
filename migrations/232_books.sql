-- 232: Books -- a readable, purchasable learning content type.
--
-- A book is catalogue metadata plus ONE file in the private 'book-files' bucket (EPUB, PDF, or a
-- self-contained single-file HTML book). Unlike a course row, a book row holds no content: every
-- byte a reader sees comes from that bucket through /api/books/[id]/file or /api/books/[id]/html,
-- which re-check access server-side. That is why the row itself can be visible to people who do not
-- own the book -- it is the shop window, not the goods.
--
-- Access to read a book's file (lib/books/access.ts canReadBook) is any of:
--   * the owner, or an admin (the same pair that sees a draft course)
--   * the cohort rule every content type uses (published AND (available_to_everyone OR the reader's
--     cohort is in cohort_ids)) -- subscription plans ride this through their synthetic cohort
--   * an active book_entitlements row (a single-book purchase, or a manual grant)
-- and never once license_expires_at has passed.
--
-- Progress and library rows (user_books, book_chapter_progress) have NO client write policy at all:
-- completion will feed XP and certificates later, so only /api/books/progress (service role) writes
-- them. Purchases and entitlements are likewise service-role only. Annotations are the learner's own
-- private notes and are the one thing written straight from the browser, under owner-only RLS.
--
-- Money follows subscription_payments: numeric(10,2) in major units plus a currency code.

-- Books --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.books (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE as courses use: a book can have buyers, and deleting the uploading
  -- account must not take purchased books (and their purchase history) with it. An ownerless book
  -- is managed by admins. Not RESTRICT either: that would make the author's account undeletable.
  user_id               uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  slug                  text        NOT NULL UNIQUE,
  title                 text        NOT NULL DEFAULT 'Untitled',
  subtitle              text,
  description           text,
  cover_image           text,
  authors               text[]      NOT NULL DEFAULT '{}',
  category              text,
  topics                text[]      NOT NULL DEFAULT '{}',
  skills                text[]      NOT NULL DEFAULT '{}',
  difficulty            text        CHECK (difficulty IN ('beginner','intermediate','advanced')),
  estimated_minutes     integer     CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  status                text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft','published','archived')),
  cohort_ids            uuid[]      NOT NULL DEFAULT '{}',
  available_to_everyone boolean     NOT NULL DEFAULT false
                                      CHECK (NOT available_to_everyone OR cardinality(cohort_ids) = 0),
  -- Sold one at a time through /api/books/checkout. A purchasable book is visible to every
  -- signed-in account so it can be found and bought; reading it still needs an entitlement.
  purchasable           boolean     NOT NULL DEFAULT false,
  royalty_pct           numeric(5,2) NOT NULL DEFAULT 0 CHECK (royalty_pct >= 0 AND royalty_pct <= 100),
  format                text        CHECK (format IN ('epub','pdf','html')),
  file_path             text,
  file_size             bigint      CHECK (file_size IS NULL OR file_size > 0),
  -- Optional free sample, a separate object so the full file is never sent to a non-owner.
  preview_file_path     text,
  -- Rights. Own / openly licensed titles first; the columns cover third-party licences too.
  rights_holder         text,
  license_type          text        CHECK (license_type IN ('own','cc_by','cc_by_sa','cc_by_nc','public_domain','licensed','other')),
  license_url           text,
  license_expires_at    timestamptz,
  ai_allowed            boolean     NOT NULL DEFAULT true,
  endorsement_permitted boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Object paths are author-writable, and the delivery routes sign them with the service role. So
  -- a path may only name an object under THIS book's own folder, of the matching kind and format
  -- (the shape bookObjectPath issues) -- an author cannot point a draft at another book's file.
  -- lib/books/schema.ts isBookObjectPath applies the same rule in the routes.
  CONSTRAINT books_file_path_scoped CHECK (
    file_path IS NULL
    OR file_path ~ ('^' || id::text || '/file-[0-9a-f-]{36}\.' || COALESCE(format, '-') || '$')
  ),
  CONSTRAINT books_preview_path_scoped CHECK (
    preview_file_path IS NULL
    OR preview_file_path ~ ('^' || id::text || '/preview-[0-9a-f-]{36}\.' || COALESCE(format, '-') || '$')
  ),
  -- A published book has a file and a licence. "Reaches somebody" (open, a cohort, or for sale) is
  -- deliberately NOT here but in validateBookForPublish: a CHECK is evaluated per statement, and the
  -- shared plan/cohort functions (set_subscription_plan_content with p_clear_public, untagging a
  -- book's last cohort, delete_bootcamp_cohort) legitimately pass through a state with no audience.
  -- A published book that reaches nobody is merely invisible, never exposed.
  CONSTRAINT books_published_ready CHECK (
    status <> 'published'
    OR (format IS NOT NULL AND file_path IS NOT NULL AND license_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_books_status ON public.books(status);
CREATE INDEX IF NOT EXISTS idx_books_user ON public.books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_cohort_ids ON public.books USING gin (cohort_ids);

CREATE TABLE IF NOT EXISTS public.book_prices (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id    uuid          NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  currency   text          NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount     numeric(10,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (book_id, currency)
);

CREATE TABLE IF NOT EXISTS public.book_chapters (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id           uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  position          integer     NOT NULL CHECK (position >= 0),
  title             text        NOT NULL,
  -- EPUB: {"href": "..."}; PDF: {"pageStart": n, "pageEnd": n}; HTML: {"anchor": "..."}.
  locator           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estimated_minutes integer     CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  required          boolean     NOT NULL DEFAULT true,
  is_preview        boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, position)
);

-- Ownership ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.book_purchases (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, as subscription_payments: the money record outlives the account.
  student_id         uuid          REFERENCES public.students(id) ON DELETE SET NULL,
  book_id            uuid          NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  book_title         text          NOT NULL,
  currency           text          NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount             numeric(10,2) NOT NULL CHECK (amount > 0),
  paystack_reference text          NOT NULL UNIQUE CHECK (length(btrim(paystack_reference)) > 0),
  status             text          NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','paid','failed','refunded')),
  -- Snapshot at sale time, so a later change to books.royalty_pct never rewrites past royalties.
  royalty_pct        numeric(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_pct >= 0 AND royalty_pct <= 100),
  paid_at            timestamptz,
  refunded_at        timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_purchases_student ON public.book_purchases(student_id);
CREATE INDEX IF NOT EXISTS idx_book_purchases_book ON public.book_purchases(book_id);

CREATE TABLE IF NOT EXISTS public.book_entitlements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id    uuid        NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  source     text        NOT NULL CHECK (source IN ('purchase','grant')),
  -- book_purchases.id for a purchase; free text (who granted it, why) for a grant.
  source_ref text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- One live entitlement per reader per book. A refund revokes; a re-purchase grants afresh.
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_entitlements_one_active
  ON public.book_entitlements(student_id, book_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_book_entitlements_book ON public.book_entitlements(book_id);

-- Reading ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_books (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id       uuid         NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  shelf         text         NOT NULL DEFAULT 'want_to_read'
                               CHECK (shelf IN ('want_to_read','reading','completed')),
  -- EPUB CFI, PDF page, or HTML anchor + scroll; shape owned by lib/books/schema.ts BookLocation.
  last_location jsonb,
  progress_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  started_at    timestamptz,
  last_read_at  timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (student_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_user_books_recent ON public.user_books(student_id, last_read_at DESC);

CREATE TABLE IF NOT EXISTS public.book_chapter_progress (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id      uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_id   uuid        NOT NULL REFERENCES public.book_chapters(id) ON DELETE CASCADE,
  seconds_read integer     NOT NULL DEFAULT 0 CHECK (seconds_read >= 0),
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_book_chapter_progress_book ON public.book_chapter_progress(student_id, book_id);

CREATE TABLE IF NOT EXISTS public.book_annotations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id    uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_id uuid        REFERENCES public.book_chapters(id) ON DELETE SET NULL,
  kind       text        NOT NULL CHECK (kind IN ('highlight','bookmark','note')),
  locator    jsonb       NOT NULL,
  quote      text        CHECK (quote IS NULL OR length(quote) <= 5000),
  note       text        CHECK (note IS NULL OR length(note) <= 10000),
  color      text        CHECK (color IS NULL OR color ~ '^[a-z]{1,16}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_annotations_owner ON public.book_annotations(student_id, book_id);

-- RLS ----------------------------------------------------------------------------------------
ALTER TABLE public.books                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_chapters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_purchases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_entitlements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_books            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_chapter_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_annotations      ENABLE ROW LEVEL SECURITY;

-- Who may see a book row. Signed-in accounts only (as migration 215 set for courses). Cohort-only
-- books that are not for sale stay invisible to everyone outside the cohort -- a client's private
-- title must not leak by appearing in a stranger's catalogue. lib/books/access.ts canReadBook
-- applies the same visibility before it serves any file, so the two must change together.
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
        -- Inside the published branch, so a withdrawn book is hidden from buyers too, as
        -- canReadBook does.
        OR EXISTS (
          SELECT 1 FROM public.book_entitlements e
          WHERE e.book_id = p_book.id
            AND e.student_id = (SELECT auth.uid())
            AND e.revoked_at IS NULL
        )
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_see_book(public.books) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_book(public.books) TO authenticated, service_role;

DROP POLICY IF EXISTS "books: visible select" ON public.books;
CREATE POLICY "books: visible select"
  ON public.books FOR SELECT TO authenticated
  USING (public.can_see_book(books));

DROP POLICY IF EXISTS "books: instructor insert" ON public.books;
CREATE POLICY "books: instructor insert"
  ON public.books FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())));

DROP POLICY IF EXISTS "books: instructor update" ON public.books;
CREATE POLICY "books: instructor update"
  ON public.books FOR UPDATE TO authenticated
  USING      ((SELECT public.is_instructor_or_admin()) AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())));

DROP POLICY IF EXISTS "books: instructor delete" ON public.books;
CREATE POLICY "books: instructor delete"
  ON public.books FOR DELETE TO authenticated
  USING ((SELECT public.is_instructor_or_admin()) AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())));

-- Prices and chapters follow their book: visible when it is, written by whoever may write it.
DROP POLICY IF EXISTS "book_prices: visible select" ON public.book_prices;
CREATE POLICY "book_prices: visible select"
  ON public.book_prices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND public.can_see_book(b)));

-- Prices are commercial terms: admins only (see guard_book_commercial_terms below).
DROP POLICY IF EXISTS "book_prices: admin manage" ON public.book_prices;
CREATE POLICY "book_prices: admin manage"
  ON public.book_prices FOR ALL TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "book_chapters: visible select" ON public.book_chapters;
CREATE POLICY "book_chapters: visible select"
  ON public.book_chapters FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND public.can_see_book(b)));

DROP POLICY IF EXISTS "book_chapters: instructor manage" ON public.book_chapters;
CREATE POLICY "book_chapters: instructor manage"
  ON public.book_chapters FOR ALL TO authenticated
  USING      ((SELECT public.is_instructor_or_admin()) AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))));

-- Commercial terms. An author may edit their book's content and metadata under the owner policy,
-- but whether it is sold and what royalty it pays are an admin's decision: book_purchases snapshots
-- royalty_pct at sale time, so an author-set value would become the payout record. Service-role
-- callers (auth.uid() IS NULL) pass; the admin save route must enforce the same rule itself.
CREATE OR REPLACE FUNCTION public.guard_book_commercial_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT public.is_admin()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchasable OR NEW.royalty_pct <> 0 THEN
      RAISE EXCEPTION 'permission denied: only an admin may set a book''s sale terms'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.purchasable IS DISTINCT FROM OLD.purchasable
     OR NEW.royalty_pct IS DISTINCT FROM OLD.royalty_pct THEN
    RAISE EXCEPTION 'permission denied: only an admin may change a book''s sale terms'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_book_commercial_terms() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_book_commercial_terms ON public.books;
CREATE TRIGGER trg_guard_book_commercial_terms
  BEFORE INSERT OR UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.guard_book_commercial_terms();

-- Purchases, entitlements, library and progress: the reader sees their own rows, an admin sees
-- all. No INSERT/UPDATE/DELETE policy, so RLS denies every client write; the service role writes.
DROP POLICY IF EXISTS "book_purchases: own or admin select" ON public.book_purchases;
CREATE POLICY "book_purchases: own or admin select"
  ON public.book_purchases FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "book_entitlements: own or admin select" ON public.book_entitlements;
CREATE POLICY "book_entitlements: own or admin select"
  ON public.book_entitlements FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "user_books: own or admin select" ON public.user_books;
CREATE POLICY "user_books: own or admin select"
  ON public.user_books FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "book_chapter_progress: own or admin select" ON public.book_chapter_progress;
CREATE POLICY "book_chapter_progress: own or admin select"
  ON public.book_chapter_progress FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

-- Personal notes are private: owner only, not even admins read them through the API key.
DROP POLICY IF EXISTS "book_annotations: owner all" ON public.book_annotations;
CREATE POLICY "book_annotations: owner all"
  ON public.book_annotations FOR ALL TO authenticated
  USING      (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

REVOKE ALL ON public.book_purchases, public.book_entitlements, public.user_books,
  public.book_chapter_progress FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.book_purchases, public.book_entitlements, public.user_books,
  public.book_chapter_progress FROM authenticated;
REVOKE ALL ON public.books, public.book_prices, public.book_chapters, public.book_annotations FROM anon;
GRANT SELECT ON public.book_purchases, public.book_entitlements, public.user_books,
  public.book_chapter_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books, public.book_prices, public.book_chapters,
  public.book_annotations TO authenticated;
GRANT ALL ON public.books, public.book_prices, public.book_chapters, public.book_purchases,
  public.book_entitlements, public.user_books, public.book_chapter_progress, public.book_annotations
  TO service_role;

-- Storage ------------------------------------------------------------------------------------
-- Private, no storage.objects policy: uploads use signed upload URLs minted after a role check,
-- reads use short-lived signed URLs (EPUB/PDF) or the ticketed HTML route, all on the service role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('book-files', 'book-files', false, 104857600, ARRAY[
  'application/epub+zip', 'application/pdf', 'text/html'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 104857600,
  allowed_mime_types = ARRAY['application/epub+zip', 'application/pdf', 'text/html'];

-- Shared content plumbing --------------------------------------------------------------------
-- Books can be assigned to cohorts (assignment emails, cohort dates) and bundled into
-- subscription plans like every other content type.
ALTER TABLE public.cohort_assignments DROP CONSTRAINT IF EXISTS cohort_assignments_content_type_check;
ALTER TABLE public.cohort_assignments ADD CONSTRAINT cohort_assignments_content_type_check
  CHECK (content_type IN ('course','event','virtual_experience','form','certification','learning_path','assignment','book'));

ALTER TABLE public.subscription_plan_content DROP CONSTRAINT IF EXISTS subscription_plan_content_content_table_check;
ALTER TABLE public.subscription_plan_content ADD CONSTRAINT subscription_plan_content_content_table_check
  CHECK (content_table IN ('courses','virtual_experiences','certifications','learning_paths','books'));

CREATE OR REPLACE FUNCTION public.toggle_content_cohort_tag(p_content_table text,p_content_id uuid,p_cohort_id uuid,p_add boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_content_table NOT IN ('courses','virtual_experiences','certifications','learning_paths','books') THEN RAISE EXCEPTION 'invalid content table: %', p_content_table; END IF;
  IF p_add THEN
    EXECUTE format('UPDATE public.%I SET cohort_ids=array_append(cohort_ids,$1) WHERE id=$2 AND NOT ($1=ANY(cohort_ids))',p_content_table) USING p_cohort_id,p_content_id;
  ELSE
    EXECUTE format('UPDATE public.%I SET cohort_ids=array_remove(cohort_ids,$1) WHERE id=$2',p_content_table) USING p_cohort_id,p_content_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_content_cohort_tag(text,uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.set_subscription_plan_content(
  p_plan_id uuid,
  p_content_table text,
  p_content_id uuid,
  p_actor_id uuid,
  p_add boolean,
  p_clear_public boolean DEFAULT false,
  p_ca_content_type text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cohort_id uuid;
BEGIN
  IF p_content_table NOT IN ('courses','virtual_experiences','certifications','learning_paths','books') THEN
    RAISE EXCEPTION 'invalid content table: %', p_content_table;
  END IF;

  SELECT cohort_id INTO v_cohort_id FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription plan not found'; END IF;

  -- Only ever on request, and only while adding. The caller has already shown the author who
  -- loses access; this is the point where that answer is acted on.
  IF p_add AND p_clear_public THEN
    EXECUTE format('UPDATE public.%I SET available_to_everyone = false WHERE id = $1', p_content_table)
      USING p_content_id;
  END IF;

  IF p_add THEN
    INSERT INTO public.subscription_plan_content (plan_id, content_table, content_id, added_by)
    VALUES (p_plan_id, p_content_table, p_content_id, p_actor_id)
    ON CONFLICT (plan_id, content_table, content_id) DO NOTHING;
  ELSE
    DELETE FROM public.subscription_plan_content
    WHERE plan_id = p_plan_id
      AND content_table = p_content_table
      AND content_id = p_content_id;
  END IF;

  -- The tag is what actually grants access. If it fails, nothing above it may stand.
  PERFORM public.toggle_content_cohort_tag(p_content_table, p_content_id, v_cohort_id, p_add);

  IF p_ca_content_type IS NOT NULL THEN
    IF p_add THEN
      INSERT INTO public.cohort_assignments (content_id, content_type, cohort_id)
      VALUES (p_content_id, p_ca_content_type, v_cohort_id)
      ON CONFLICT (content_id, cohort_id) DO NOTHING;
    ELSE
      DELETE FROM public.cohort_assignments
      WHERE content_id = p_content_id AND cohort_id = v_cohort_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'planId', p_plan_id, 'contentId', p_content_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_subscription_plan_content(uuid, text, uuid, uuid, boolean, boolean, text)
  TO service_role;

-- Deleting a bootcamp intake strips its id from every content table's cohort_ids. Books join that
-- list; otherwise a cohort-only book keeps a dead id and quietly reaches nobody. Recreated whole
-- from migration 207 as it stands in the fresh schema; the only change is 'books' below.
CREATE OR REPLACE FUNCTION public.delete_bootcamp_cohort(p_cohort_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind            text;
  v_payments        integer := 0;
  v_untagged        integer := 0;
  v_released        integer := 0;
  v_member_ids      uuid[];
  v_table           text;
  v_rows            integer;
  -- Every table that records a cohort assignment as an array member rather than a row. Checked
  -- against the catalogue rather than trusted: tenant databases drift from this file (public.forms
  -- is declared here and absent from at least one live database), and a hard-coded list turns that
  -- drift into a failed delete. A table this tenant does not have has no ids to strip, so skipping
  -- it is the whole correction.
  v_content_tables  text[] := ARRAY[
    'forms', 'courses', 'events', 'virtual_experiences', 'certifications', 'assignments',
    'communities', 'announcements', 'recordings', 'schedules', 'learning_paths', 'books'
  ];
BEGIN
  SELECT cohort_kind INTO v_kind FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cohort % not found', p_cohort_id; END IF;
  IF v_kind <> 'bootcamp' THEN
    RAISE EXCEPTION 'cohort % is not a bootcamp intake', p_cohort_id USING ERRCODE = 'check_violation';
  END IF;

  -- Defence in depth: the route refuses these too, but a plan's payment history hangs off the plan
  -- through several restricted references and must never be reachable from here.
  IF EXISTS (SELECT 1 FROM public.subscription_plans WHERE cohort_id = p_cohort_id)
     OR EXISTS (SELECT 1 FROM public.individual_subscriptions WHERE cohort_id = p_cohort_id) THEN
    RAISE EXCEPTION 'cohort % backs a subscription plan', p_cohort_id USING ERRCODE = 'check_violation';
  END IF;

  -- Who this delete actually detaches, captured under lock so the caller acts on the set that was
  -- really affected rather than on a list read moments earlier. Locking first and aggregating
  -- second because FOR UPDATE and array_agg cannot share a query level.
  PERFORM 1 FROM public.students
   WHERE (cohort_id = p_cohort_id OR original_cohort_id = p_cohort_id)
     AND role = 'student'
   ORDER BY id
     FOR UPDATE;

  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_member_ids
    FROM public.students
   WHERE (cohort_id = p_cohort_id OR original_cohort_id = p_cohort_id)
     AND role = 'student';

  -- A student held over an unpaid balance sits in the outstanding-payments cohort with
  -- original_cohort_id pointing back here. The foreign key would null only that pointer, leaving
  -- them parked in the outstanding cohort with nowhere to be restored to, and a non-null cohort_id
  -- blocks any later move onto an individual subscription. Release them properly instead. This runs
  -- before the cohort goes so trg_prune_group_memberships_on_cohort_change (migration 206) sees the
  -- hold already lifted and treats it as the departure it now is.
  UPDATE public.students
     SET cohort_id = NULL, original_cohort_id = NULL, enrollment_model = NULL
   WHERE original_cohort_id = p_cohort_id;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  UPDATE public.payment_config SET outstanding_cohort_id = NULL
   WHERE outstanding_cohort_id = p_cohort_id;

  DELETE FROM public.payments WHERE cohort_id = p_cohort_id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  FOREACH v_table IN ARRAY v_content_tables LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'cohort_ids'
    );
    EXECUTE format(
      'UPDATE public.%I SET cohort_ids = array_remove(cohort_ids, $1) WHERE $1 = ANY(cohort_ids)',
      v_table
    ) USING p_cohort_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_untagged := v_untagged + v_rows;
  END LOOP;

  DELETE FROM public.cohorts WHERE id = p_cohort_id;

  RETURN jsonb_build_object('ok', true, 'paymentsDeleted', v_payments,
                            'contentUntagged', v_untagged, 'holdsReleased', v_released,
                            'memberIds', to_jsonb(v_member_ids));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_bootcamp_cohort(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_bootcamp_cohort(uuid) TO service_role;
