// "Available to everyone" means every signed-in account, never an anonymous visitor (migration 215).
//
// Vitest never talks to a real database, so this cannot prove the policies are live -- that is
// scripts/smoke-anon-content.mjs, run against each tenant after migrating. What it does guard is
// the source: the migration, the fresh schema and the page must not drift back to handing a
// signed-out visitor the full course or experience row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const migration = read('migrations/215_available_to_everyone_means_signed_in.sql');
const schema = read('festman-fresh-schema.sql');
const page = read('app/[id]/page.tsx');

const POLICIES: Array<[string, string]> = [
  ['courses: participants select', 'courses'],
  ['virtual_experiences: participants select', 'virtual_experiences'],
  ['students_read_published_paths', 'learning_paths'],
];

// The CREATE POLICY statement for one policy, up to the terminating semicolon.
function createPolicy(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE POLICY "${name}"`);
  expect(start, `CREATE POLICY "${name}" missing from the fresh schema`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(';', start));
}

describe('open-access content is closed to anonymous callers', () => {
  it.each(POLICIES)('migration 215 scopes "%s" to authenticated', (name, table) => {
    expect(migration).toMatch(new RegExp(`ALTER POLICY "${name}"\\s+ON public\\.${table} TO authenticated;`));
  });

  it.each(POLICIES)('the fresh schema creates "%s" for authenticated only', (name) => {
    expect(createPolicy(schema, name)).toMatch(/FOR SELECT\s+TO authenticated/);
  });

  it('the free-courses view carries display fields only', () => {
    const start = schema.indexOf('CREATE OR REPLACE VIEW public.public_free_courses');
    expect(start).toBeGreaterThanOrEqual(0);
    const view = schema.slice(start, schema.indexOf(';', start));
    for (const content of ['questions', 'fields', 'post_submission', 'cohort_ids', 'c.*']) {
      expect(view).not.toContain(content);
    }
    expect(view).toContain('public_free_content');
  });

  it('the detail page never asks for a course or experience row without a session', () => {
    // A tenant that missed the migration must still not receive the content from this page.
    expect(page).toContain("signedIn ? supabase.from('courses').select('*')");
    expect(page).toContain("signedIn ? supabase.from('virtual_experiences').select('*')");
  });
});
