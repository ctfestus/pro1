import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The test harness does not run migrations against Postgres, so this pins the SQL contract
// of the count function in both the migration and the fresh schema.
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const compact = (value: string) => value.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

function countFunction(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.count_submitted_applications_by_form(');
  expect(start).toBeGreaterThanOrEqual(0);
  const grant = 'GRANT EXECUTE ON FUNCTION public.count_submitted_applications_by_form(text[], uuid) TO service_role;';
  const end = sql.indexOf(grant, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + grant.length);
}

describe('count_submitted_applications_by_form', () => {
  const sources = {
    migration: countFunction(compact(read('migrations/217_count_submitted_applications_by_form.sql'))),
    schema: countFunction(compact(read('festman-fresh-schema.sql'))),
  };

  it('is identical in the migration and the fresh schema', () => {
    expect(sources.schema).toBe(sources.migration);
  });

  for (const [name, sql] of Object.entries(sources)) {
    it(`${name}: takes text form IDs and an optional reviewer UUID, returns bigint totals`, () => {
      expect(sql).toContain('( p_form_ids text[], p_reviewer_id uuid DEFAULT NULL ) RETURNS TABLE(form_id text, total bigint)');
      expect(sql).toContain('LANGUAGE sql STABLE SET search_path = \'\'');
    });

    it(`${name}: counts submitted applications only, never drafts`, () => {
      expect(sql).toContain("WHERE submissions.state = 'submitted'");
      expect(sql).toContain('AND submissions.form_id = ANY(p_form_ids)');
      expect(sql).toContain('GROUP BY submissions.form_id');
    });

    it(`${name}: filters by reviewer only when one is passed`, () => {
      expect(sql).toContain('p_reviewer_id IS NULL OR submissions.assigned_reviewer_id = p_reviewer_id');
    });

    it(`${name}: runs as the caller and only the service role may call it`, () => {
      expect(sql).not.toMatch(/SECURITY DEFINER/i);
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.count_submitted_applications_by_form(text[], uuid) FROM PUBLIC, anon, authenticated;');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.count_submitted_applications_by_form(text[], uuid) TO service_role;');
    });
  }
});
