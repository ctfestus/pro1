import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('subscription plan cohort assignment schema', () => {
  const admissions = readFileSync(join(process.cwd(), 'app/api/admissions/route.ts'), 'utf8');
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');

  it('uses the deployed cohort_assignments columns', () => {
    const assignmentBlock = admissions.slice(
      admissions.indexOf("db.from('cohort_assignments').upsert"),
      admissions.indexOf("onConflict: 'content_id,cohort_id'"),
    );
    expect(assignmentBlock).toContain('content_id: contentId');
    expect(assignmentBlock).toContain('content_type: contentConfig.caContentType');
    expect(assignmentBlock).toContain('cohort_id: plan.cohort_id');
    expect(assignmentBlock).not.toContain('assigned_by');

    const tableBlock = schema.slice(
      schema.indexOf('CREATE TABLE public.cohort_assignments'),
      schema.indexOf(');', schema.indexOf('CREATE TABLE public.cohort_assignments')),
    );
    expect(tableBlock).not.toContain('assigned_by');
  });
});
