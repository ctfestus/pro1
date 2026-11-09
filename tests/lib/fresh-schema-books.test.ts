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

  // save_book was redefined by migration 236 (sample_spec); the fresh schema carries that version.
  const latest = readFileSync(join(process.cwd(), 'migrations/237_book_price_sales.sql'), 'utf8');
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
    const after = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    expect(after).toContain('INSERT INTO public.book_prices (book_id, currency, amount, sale_amount, sale_ends_at)');
    expect(after).toContain('sale_amount = EXCLUDED.sale_amount, sale_ends_at = EXCLUDED.sale_ends_at');
    expect(after.length - before.length).toBeLessThan(400);
    expect(schema).toContain('CHECK (sale_amount IS NULL OR (sale_amount > 0 AND sale_amount < amount))');
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
    expect(schema).toContain(fn);
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
