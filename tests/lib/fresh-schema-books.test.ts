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

  it('keeps the books block identical to the migration', () => {
    const block = migration.slice(migration.indexOf('-- Books ----'), migration.indexOf('-- Shared content plumbing')).trim();
    expect(schema).toContain(block);
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

  it('reserves sale terms and prices for admins', () => {
    expect(schema).toContain('BEFORE INSERT OR UPDATE ON public.books');
    expect(schema).toContain('EXECUTE FUNCTION public.guard_book_commercial_terms()');
    expect(schema).toMatch(/book_prices: admin manage"[\s\S]{0,120}USING\s+\(\(SELECT public\.is_admin\(\)\)\)/);
    expect(schema).not.toContain('book_prices: instructor manage');
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
