import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fresh schema books (migration 232)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/232_books.sql'), 'utf8');

  it('declares every books table', () => {
    for (const table of [
      'books', 'book_prices', 'book_chapters', 'book_purchases', 'book_entitlements',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(schema).toContain(`ALTER TABLE public.${table}`);
    }
  });

  it('keeps the catalogue tables identical to migration 232', () => {
    // Chapters are unchanged since 232 and prices only gained sale columns in 237 (added after the tables); purchases changed in 235 (tested below) and
    // books gained sample_spec in 236, which is the only difference allowed here.
    const endorsement = '  endorsement_permitted boolean     NOT NULL DEFAULT false,\n';
    const tables = migration.slice(migration.indexOf('-- Books ----'), migration.indexOf('-- Ownership ----')).trim()
      .replace(endorsement, endorsement
        + '  -- How the free sample was cut from the book (migration 236); NULL for an uploaded sample or none.\n'
        + "  sample_spec           jsonb       CHECK (sample_spec IS NULL OR jsonb_typeof(sample_spec) = 'object'),\n");
    expect(tables).toContain('sample_spec');
    expect(schema).toContain(tables);
  });

  it('allows one live entitlement per reader per book', () => {
    expect(schema).toMatch(/idx_book_entitlements_one_active\s+ON public\.book_entitlements\(student_id, book_id\) WHERE revoked_at IS NULL/);
  });

  it('gives clients no write policy on purchases or entitlements', () => {
    for (const table of ['book_purchases', 'book_entitlements']) {
      const policies = schema.match(new RegExp(`ON public\\.${table} FOR (\\w+)`, 'g')) ?? [];
      expect(policies.length).toBeGreaterThan(0);
      expect(policies.every(p => p.endsWith('FOR SELECT'))).toBe(true);
    }
  });

  it("scopes both object paths to the book's own folder, kind and format", () => {
    expect(schema).toContain("file_path ~ ('^' || id::text || '/file-[0-9a-f-]{36}\\.' || COALESCE(format, '-') || '$')");
    expect(schema).toContain("preview_file_path ~ ('^' || id::text || '/preview-[0-9a-f-]{36}\\.' || COALESCE(format, '-') || '$')");
  });

  it('keeps the audience rule out of the publish CHECK, so plan and cohort functions can untag', () => {
    const check = schema.slice(schema.indexOf('CONSTRAINT books_published_ready'), schema.indexOf('CREATE INDEX IF NOT EXISTS idx_books_status'));
    expect(check).toContain('format IS NOT NULL AND file_path IS NOT NULL AND license_type IS NOT NULL');
    expect(check).not.toMatch(/cardinality\(cohort_ids\) > 0/);
  });

  it('lets a deleted author leave the book behind rather than block the delete', () => {
    expect(schema).toMatch(/user_id\s+uuid\s+REFERENCES auth\.users\(id\) ON DELETE SET NULL,/);
  });

  it('shows books through learning paths while published, and to buyers after archiving too, like canReadBook', () => {
    const fn = schema.slice(schema.indexOf('FUNCTION public.can_see_book'), schema.indexOf('REVOKE EXECUTE ON FUNCTION public.can_see_book'));
    const published = fn.indexOf("p_book.status = 'published'");
    expect(published).toBeGreaterThan(0);
    expect(fn.indexOf('FROM public.learning_paths lp')).toBeGreaterThan(published);
    // Entitlements: published or archived, never a draft (migration 235).
    const owned = fn.indexOf("p_book.status IN ('published', 'archived')");
    expect(owned).toBeGreaterThan(fn.indexOf('FROM public.learning_paths lp'));
    expect(fn.indexOf('FROM public.book_entitlements e')).toBeGreaterThan(owned);
    const m235 = readFileSync(join(process.cwd(), 'migrations/235_book_store.sql'), 'utf8');
    expect(schema).toContain(m235.slice(m235.indexOf('CREATE OR REPLACE FUNCTION public.can_see_book'), m235.indexOf('-- Fulfilment ----')).trim());
  });

  it('lets the owning instructor or any admin set sale terms (migration 234)', () => {
    const m234 = readFileSync(join(process.cwd(), 'migrations/234_book_sale_terms_for_instructors.sql'), 'utf8');
    expect(m234).toContain('DROP TRIGGER IF EXISTS trg_guard_book_commercial_terms ON public.books;');
    expect(schema).not.toContain('guard_book_commercial_terms');
    expect(schema).not.toContain('book_prices: admin manage');
    expect(schema).toMatch(/book_prices: instructor manage"[\s\S]{0,160}USING\s+\(\(SELECT public\.is_instructor_or_admin\(\)\) AND EXISTS \(SELECT 1 FROM public\.books b WHERE b\.id = book_id AND \(b\.user_id = \(SELECT auth\.uid\(\)\) OR \(SELECT public\.is_admin\(\)\)\)\)\)/);
  });

  it('strips a deleted bootcamp cohort from books too', () => {
    expect(schema).toContain("'schedules', 'learning_paths', 'books'");
    expect(migration).toContain("'schedules', 'learning_paths', 'books'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.delete_bootcamp_cohort(p_cohort_id uuid)');
  });

  it('creates a private book bucket', () => {
    expect(schema).toContain("VALUES ('book-files', 'book-files', false,");
  });

  it('lets books into the shared content-type lists', () => {
    expect(schema).toContain("'learning_path','assignment','book'))");
    expect(schema).toContain("CHECK (content_table IN ('courses','virtual_experiences','certifications','learning_paths','books'))");
    expect(schema.match(/IF p_content_table NOT IN \('courses','virtual_experiences','certifications','learning_paths','books'\)/g)?.length).toBe(2);
  });
});

describe('fresh schema book chapters save (migration 233)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/233_book_saves.sql'), 'utf8');

  it('matches the migration and is service-role only', () => {
    // Up to save_book, which migration 236 redefined (tested below).
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.save_book_chapters'),
      migration.indexOf('-- Save a book in one transaction'),
    ).trim();
    expect(schema).toContain(fn);
    expect(fn).toContain('FROM PUBLIC, anon, authenticated');
    expect(fn).toContain('TO service_role');
  });

  // save_book was redefined by 236 (sample_spec), 237 (sale prices) and 240 (recommended courses);
  // the fresh schema carries the latest.
  const latest = readFileSync(join(process.cwd(), 'migrations/240_book_recommended_courses.sql'), 'utf8');
  const m237 = readFileSync(join(process.cwd(), 'migrations/237_book_price_sales.sql'), 'utf8');
  const m236 = readFileSync(join(process.cwd(), 'migrations/236_book_sample_spec.sql'), 'utf8');

  it('saves a book in one locked transaction, checking the version under the lock', () => {
    const fn = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    expect(schema).toContain(fn.trim());
    const lock = fn.indexOf('FROM public.books WHERE id = p_book_id FOR UPDATE');
    const version = fn.indexOf('v_old.updated_at IS DISTINCT FROM p_expected_updated_at');
    const update = fn.indexOf('UPDATE public.books SET');
    expect(lock).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(lock);
    expect(update).toBeGreaterThan(version);
    expect(fn).toContain("USING ERRCODE = 'BK409'");
    expect(fn).toContain('TO service_role');
  });

  it('writes only editable columns, never the owner, id or slug', () => {
    const fn = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    const set = fn.slice(fn.indexOf('UPDATE public.books SET'), fn.indexOf('RETURNING * INTO v_new'));
    for (const col of ['user_id', 'slug', 'created_at']) expect(set).not.toMatch(new RegExp(`\\b${col}\\s*=`));
    expect(set).not.toMatch(/\bid\s*=\s*v_new/);
    expect(fn).toContain('PERFORM public.save_book_chapters(p_book_id, p_chapters)');
  });

  it('migration 237 only adds the sale columns to the price write', () => {
    const before = m236.slice(m236.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    const after = m237.slice(m237.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    expect(after).toContain('INSERT INTO public.book_prices (book_id, currency, amount, sale_amount, sale_ends_at)');
    expect(after).toContain('sale_amount = EXCLUDED.sale_amount, sale_ends_at = EXCLUDED.sale_ends_at');
    expect(after.length - before.length).toBeLessThan(400);
    expect(schema).toContain('CHECK (sale_amount IS NULL OR (sale_amount > 0 AND sale_amount < amount))');
  });

  it('migration 240 only adds recommended_course_ids to save_book', () => {
    const before = m237.slice(m237.indexOf('CREATE OR REPLACE FUNCTION public.save_book('), m237.indexOf('GRANT  EXECUTE ON FUNCTION public.save_book'));
    const after = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.save_book('), latest.indexOf('GRANT  EXECUTE ON FUNCTION public.save_book'));
    expect(after.replace('    recommended_course_ids = v_new.recommended_course_ids,\n', '').trim()).toBe(before.trim());
    expect(latest).toContain('ADD COLUMN IF NOT EXISTS recommended_course_ids uuid[] NOT NULL DEFAULT \'{}\'');
    expect(schema).toContain('CHECK (cardinality(recommended_course_ids) <= 20)');
  });

  it('migration 236 only adds sample_spec to save_book', () => {
    const before = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    const after = m236.slice(m236.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    expect(after.replace('    sample_spec           = v_new.sample_spec,\n', '').trim()).toBe(before.trim());
    expect(schema).toContain("sample_spec           jsonb       CHECK (sample_spec IS NULL OR jsonb_typeof(sample_spec) = 'object')");
  });

  it("refuses chapter ids from another book and keeps ids rather than recreating rows", () => {
    expect(migration).toContain("'chapter does not belong to this book'");
    expect(migration).toContain('UPDATE public.book_chapters SET position = position + 1000000');
    expect(migration).not.toMatch(/DELETE FROM public\.book_chapters WHERE book_id = p_book_id;/);
  });
});

describe('fresh schema books store (migration 235)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/235_book_store.sql'), 'utf8');

  it('drops the reading tables', () => {
    for (const table of ['user_books', 'book_chapter_progress', 'book_annotations']) {
      expect(migration).toContain(`DROP TABLE IF EXISTS public.${table};`);
      expect(schema).not.toContain(`public.${table}`);
    }
  });

  it('carries the purchase columns, review status and one-open-checkout index', () => {
    for (const col of ['authorization_url', 'paystack_transaction_id', 'review_reason', 'review_resolved_at', 'receipt_email_sent_at', 'last_checked_at']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
      expect(schema).toMatch(new RegExp(`\\n  ${col}\\s+(text|bigint|timestamptz),`));
    }
    expect(migration).toContain("CHECK (status IN ('pending','paid','failed','refunded','needs_review'))");
    expect(schema).toContain("CHECK (status IN ('pending','paid','failed','refunded','needs_review'))");
    const pending = "ON public.book_purchases(student_id, book_id) WHERE status = 'pending';";
    expect(migration).toContain(pending);
    expect(schema).toContain(pending);
  });

  it('mirrors the fulfilment function, service role only, and has no refund automation', () => {
    const fn = migration.slice(migration.indexOf('-- Fulfilment ----')).trim();
    // Redefined in 238 (guest purchases); the schema carries that version, tested below.
    const m238 = readFileSync(join(process.cwd(), 'migrations/238_book_guest_purchases.sql'), 'utf8');
    expect(schema).toContain(m238.slice(m238.indexOf('-- Fulfilment ----')).trim());
    expect(fn).toContain('REVOKE EXECUTE ON FUNCTION public.fulfil_book_purchase(text, numeric, text, bigint) FROM PUBLIC, anon, authenticated;');
    expect(fn).toContain('GRANT  EXECUTE ON FUNCTION public.fulfil_book_purchase(text, numeric, text, bigint) TO service_role;');
    // Refunds are handled outside the platform.
    expect(migration).not.toContain('refund_book_purchase');
    expect(schema).not.toContain('refund_book_purchase');
  });

  it('fulfils under a row lock and grants access only on an exact match', () => {
    const fn = migration.slice(migration.indexOf('FUNCTION public.fulfil_book_purchase'));
    const lock = fn.indexOf('WHERE paystack_reference = p_reference FOR UPDATE');
    const done = fn.indexOf("IF v.status IN ('paid', 'refunded', 'needs_review')");
    const amount = fn.indexOf('round(p_amount * 100) <> round(v.amount * 100)');
    const grant = fn.indexOf('INSERT INTO public.book_entitlements');
    expect(lock).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(lock);
    expect(amount).toBeGreaterThan(done);
    expect(grant).toBeGreaterThan(amount);
    expect(fn).toContain("v_reason := 'already_owned'");
    // Two checkouts paid at once: the unique index decides, the loser goes to review.
    expect(fn).toContain('ON CONFLICT (student_id, book_id) WHERE revoked_at IS NULL DO NOTHING;');
    expect(fn.lastIndexOf('IF NOT FOUND THEN')).toBeGreaterThan(fn.indexOf('DO NOTHING;'));
    // Once paid, the buyer's other open checkouts for the book are closed.
    expect(fn).toContain("WHERE student_id = v.student_id AND book_id = v.book_id AND status = 'pending' AND id <> v.id;");
  });
});

describe('fresh schema guest purchases (migration 238)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const m235 = readFileSync(join(process.cwd(), 'migrations/235_book_store.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/238_book_guest_purchases.sql'), 'utf8');
  const fulfil = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.fulfil_book_purchase'), migration.indexOf('-- Download allowance'));
  const take = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.take_guest_book_download'), migration.indexOf('CREATE OR REPLACE FUNCTION public.release_guest_book_download'));

  it('is mirrored whole into the fresh schema', () => {
    expect(schema).toContain(migration.slice(migration.indexOf('ALTER TABLE public.book_purchases')).trim());
  });

  it('keeps a guest purchase apart from accounts, and a signed-in one free of guest fields', () => {
    expect(migration).toContain('(is_guest AND student_id IS NULL AND guest_email IS NOT NULL');
    expect(migration).toContain('OR (NOT is_guest AND guest_email IS NULL AND guest_name IS NULL AND guest_return_hash IS NULL AND guest_access_expires_at IS NULL)');
    expect(migration).toContain('AND guest_name IS NOT NULL AND length(btrim(guest_name)) BETWEEN 1 AND 120');
    expect(migration).toContain("guest_return_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('CHECK (guest_downloads_used >= 0 AND guest_downloads_used <= 5)');
  });

  it('changes fulfilment only by the guest branch: same lock, same amount check, allowance set once at payment', () => {
    const before = m235.slice(m235.indexOf('CREATE OR REPLACE FUNCTION public.fulfil_book_purchase'), m235.indexOf('REVOKE EXECUTE ON FUNCTION public.fulfil_book_purchase'));
    for (const line of before.split('\n').map(l => l.trim()).filter(Boolean)) expect(fulfil).toContain(line);
    const done = fulfil.indexOf("IF v.status IN ('paid', 'refunded', 'needs_review')");
    const amount = fulfil.indexOf('round(p_amount * 100) <> round(v.amount * 100)');
    const guest = fulfil.indexOf("guest_access_expires_at = coalesce(guest_access_expires_at, now() + interval '7 days')");
    expect(done).toBeGreaterThan(0);
    expect(amount).toBeGreaterThan(done);
    // An already-processed purchase returns before the allowance is ever set: confirming again
    // cannot restart the seven days.
    expect(guest).toBeGreaterThan(amount);
    // A guest purchase never creates an account entitlement.
    expect(fulfil.slice(fulfil.indexOf('IF v.is_guest THEN', amount), fulfil.indexOf('INSERT INTO public.book_entitlements'))).toContain('RETURN');
    expect(fulfil).toContain("ELSIF v.student_id IS NULL THEN\n    v_reason := 'account_deleted';");
    // Paid before and moved off 'paid' by hand (a refund recorded as failed): never quietly restored.
    const revived = fulfil.indexOf("ELSIF v.is_guest AND v.guest_access_expires_at IS NOT NULL THEN\n    -- Paid before");
    expect(revived).toBeGreaterThan(amount);
    expect(fulfil.indexOf("v_reason := 'guest_previously_paid';")).toBeGreaterThan(revived);
    expect(revived).toBeLessThan(fulfil.indexOf('  ELSIF v.is_guest THEN\n    v_reason := NULL;'));
  });

  it('takes a download under a lock, only while paid, inside the seven days and under five', () => {
    const lock = take.indexOf('WHERE id = p_purchase_id FOR UPDATE');
    expect(lock).toBeGreaterThan(0);
    for (const check of ["IF v.status <> 'paid'", 'v.guest_access_expires_at <= now()', 'IF v.guest_downloads_used >= 5']) {
      expect(take.indexOf(check)).toBeGreaterThan(lock);
      expect(take.indexOf(check)).toBeLessThan(take.indexOf('UPDATE public.book_purchases'));
    }
  });

  it('lets only the service role run the guest functions', () => {
    for (const fn of ['take_guest_book_download(uuid)', 'release_guest_book_download(uuid)']) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });
});

describe('fresh schema free claims and download log (migration 239)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/239_book_free_claims_and_downloads.sql'), 'utf8');

  it('is mirrored whole into the fresh schema', () => {
    expect(schema).toContain(migration.slice(migration.indexOf('ALTER TABLE public.book_purchases')).trim());
  });

  it('lets only a guest free claim have no price, and keeps sales above zero', () => {
    expect(migration).toContain("(kind = 'sale' AND amount > 0)");
    expect(migration).toContain("OR (kind = 'free_claim' AND is_guest AND amount = 0 AND currency = 'XXX' AND paystack_reference LIKE 'free-%')");
    // A free reference never looks like a Paystack one, so the webhook and sweep leave it alone.
    expect(migration).not.toContain("LIKE 'book-%'");
  });

  it('makes 238 re-runnable on a database that already has guest rows without a name', () => {
    const m238 = readFileSync(join(process.cwd(), 'migrations/238_book_guest_purchases.sql'), 'utf8');
    const backfill = m238.indexOf("UPDATE public.book_purchases SET guest_name = 'Guest' WHERE is_guest AND guest_name IS NULL;");
    expect(backfill).toBeGreaterThan(0);
    expect(backfill).toBeLessThan(m238.indexOf('ADD CONSTRAINT book_purchases_guest_check'));
    expect(migration).toContain('ALTER TABLE public.book_purchases ADD COLUMN IF NOT EXISTS guest_name text;');
  });

  it('totals in the database, counting only paid rows, and lets only the service role run it', () => {
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.book_product_stats'), migration.indexOf('CREATE OR REPLACE FUNCTION public.book_download_counts'));
    expect(fn.match(/p\.status = 'paid'/g)).toHaveLength(2);
    expect(fn).toContain("p.kind = 'sale'");
    for (const sig of ['book_product_stats(uuid[])', 'book_download_counts(uuid)']) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT  EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it('makes a free claim under per-email and platform locks, checks before inserting, service role only', () => {
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.claim_free_book'));
    // The email lock covers the per-email limit across every product (not one product), and the
    // platform lock covers the 300-an-hour check; both are held until the insert commits.
    const emailLock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('book-free-claim:email:' || lower(p_email), 0))");
    const open = fn.indexOf('guest_downloads_used < 5');
    const perEmail = fn.indexOf(">= 3");
    const allLock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('book-free-claim:all', 0))");
    const platform = fn.indexOf('>= 300');
    const insert = fn.indexOf('INSERT INTO public.book_purchases');
    expect(emailLock).toBeGreaterThan(0);
    expect(fn).not.toContain("p_book_id::text || ':' || lower(p_email)");
    expect(open).toBeGreaterThan(emailLock);
    expect(perEmail).toBeGreaterThan(open);
    expect(allLock).toBeGreaterThan(perEmail);
    expect(platform).toBeGreaterThan(allLock);
    expect(insert).toBeGreaterThan(platform);
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.claim_free_book(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT  EXECUTE ON FUNCTION public.claim_free_book(uuid, text, text, text, text) TO service_role;');
  });

  it('keeps the download log server-only', () => {
    expect(migration).toContain('ALTER TABLE public.book_download_events ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('REVOKE ALL ON public.book_download_events FROM anon, authenticated;');
    expect(migration).not.toMatch(/CREATE POLICY[^;]*book_download_events/);
  });
});

describe('fresh schema product launch emails (migration 241)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/241_product_announcements.sql'), 'utf8');

  it('is mirrored whole into the fresh schema', () => {
    expect(schema).toContain(migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.book_announcements')).trim());
  });

  it('allows one send in progress per product, and keeps each recipient with a status', () => {
    expect(migration).toContain("ON public.book_announcements(book_id) WHERE status IN ('preparing', 'sending');");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_book_announcements_one_active');
    expect(migration).toContain("DEFAULT 'preparing' CHECK (status IN ('preparing', 'sending', 'sent', 'failed'))");
    expect(migration).toContain('PRIMARY KEY (announcement_id, student_id)');
    expect(migration).toContain("CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'))");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS email_html text NOT NULL DEFAULT');
    expect(migration).toContain('attempted_at    timestamptz,');
  });

  it('keeps both tables server-only', () => {
    expect(migration).toContain('REVOKE ALL ON public.book_announcements, public.book_announcement_recipients FROM anon, authenticated;');
    expect(migration).not.toMatch(/CREATE POLICY[^;]*book_announcement/);
  });
});
