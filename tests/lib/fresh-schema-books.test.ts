import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fresh schema books (migration 232)', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/232_books.sql'), 'utf8');

  it('declares every books table', () => {
    for (const table of [
      'books', 'book_prices', 'book_chapters', 'book_purchases', 'book_entitlements',
      'user_books', 'book_chapter_progress', 'book_annotations',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(schema).toContain(`ALTER TABLE public.${table}`);
    }
  });

  it('keeps the books tables identical to migration 232', () => {
    // The tables are unchanged since 232; later migrations change policies and functions only.
    const tables = migration.slice(migration.indexOf('-- Books ----'), migration.indexOf('-- RLS ----')).trim();
    expect(schema).toContain(tables);
  });

  it('allows one live entitlement per reader per book', () => {
    expect(schema).toMatch(/idx_book_entitlements_one_active\s+ON public\.book_entitlements\(student_id, book_id\) WHERE revoked_at IS NULL/);
  });

  it('gives clients no write policy on purchases, entitlements or progress', () => {
    for (const table of ['book_purchases', 'book_entitlements', 'user_books', 'book_chapter_progress']) {
      const policies = schema.match(new RegExp(`ON public\\.${table} FOR (\\w+)`, 'g')) ?? [];
      expect(policies.length).toBeGreaterThan(0);
      expect(policies.every(p => p.endsWith('FOR SELECT'))).toBe(true);
    }
  });

  it('keeps annotations owner-only', () => {
    expect(schema).toContain('ON public.book_annotations FOR ALL TO authenticated');
    expect(schema).toMatch(/book_annotations: owner all"[\s\S]{0,200}USING\s+\(student_id = \(SELECT auth\.uid\(\)\)\)/);
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

  it('shows books through learning paths and to buyers only while published, like canReadBook', () => {
    const fn = schema.slice(schema.indexOf('FUNCTION public.can_see_book'), schema.indexOf('REVOKE EXECUTE ON FUNCTION public.can_see_book'));
    const published = fn.indexOf("p_book.status = 'published'");
    expect(published).toBeGreaterThan(0);
    expect(fn.indexOf('FROM public.learning_paths lp')).toBeGreaterThan(published);
    expect(fn.indexOf('FROM public.book_entitlements e')).toBeGreaterThan(published);
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
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.save_book_chapters')).trim();
    expect(schema).toContain(fn);
    expect(fn).toContain('FROM PUBLIC, anon, authenticated');
    expect(fn).toContain('TO service_role');
  });

  it('saves a book in one locked transaction, checking the version under the lock', () => {
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
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
    const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.save_book('));
    const set = fn.slice(fn.indexOf('UPDATE public.books SET'), fn.indexOf('RETURNING * INTO v_new'));
    for (const col of ['user_id', 'slug', 'created_at']) expect(set).not.toMatch(new RegExp(`\\b${col}\\s*=`));
    expect(set).not.toMatch(/\bid\s*=\s*v_new/);
    expect(fn).toContain('PERFORM public.save_book_chapters(p_book_id, p_chapters)');
  });

  it("refuses chapter ids from another book and keeps ids rather than recreating rows", () => {
    expect(migration).toContain("'chapter does not belong to this book'");
    expect(migration).toContain('UPDATE public.book_chapters SET position = position + 1000000');
    expect(migration).not.toMatch(/DELETE FROM public\.book_chapters WHERE book_id = p_book_id;/);
  });
});
