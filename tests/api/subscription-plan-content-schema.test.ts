import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('subscription plan cohort assignment schema', () => {
  const admissions = readFileSync(join(process.cwd(), 'app/api/admissions/route.ts'), 'utf8');
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');

  // The write moved out of the route and into set_subscription_plan_content, so that the four
  // writes a plan-content change makes happen in one transaction. The column guard follows it:
  // the deployed table has no assigned_by, and naming one is how this broke before.
  it('uses the deployed cohort_assignments columns', () => {
    const fn = schema.slice(
      schema.indexOf('CREATE OR REPLACE FUNCTION public.set_subscription_plan_content'),
      schema.indexOf('CREATE OR REPLACE FUNCTION public.toggle_content_cohort_tag'),
    );
    expect(fn).toContain('INSERT INTO public.cohort_assignments (content_id, content_type, cohort_id)');
    expect(fn).not.toContain('assigned_by');

    const tableBlock = schema.slice(
      schema.indexOf('CREATE TABLE public.cohort_assignments'),
      schema.indexOf(');', schema.indexOf('CREATE TABLE public.cohort_assignments')),
    );
    expect(tableBlock).not.toContain('assigned_by');
  });

  it('no longer writes the four parts of a plan-content change separately', () => {
    // Separate writes were the defect: a failure part-way left the earlier ones standing, and
    // for open content the cohort tag genuinely fails at the database.
    expect(admissions).toContain("db.rpc('set_subscription_plan_content'");
    expect(admissions).not.toContain("db.from('cohort_assignments').upsert");
    expect(admissions).not.toContain("db.from('subscription_plan_content').upsert");
  });
});
