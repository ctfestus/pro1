// The rule deciding what a visitor without an account sees on the marketing page.
//
// This is the one place where getting it wrong is visible to the whole internet: too loose and
// private client delivery is advertised publicly, too tight and the homepage empties out. The
// SQL itself cannot run here, so these pin the two things the app side controls -- the shape of
// the rule in the migration, and the landing page's behaviour when the lookup fails.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'migrations/194_publicly_offered_content.sql'),
  'utf8',
);
const freshSchema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
const loader = readFileSync(join(process.cwd(), 'lib/get-landing-page-data.ts'), 'utf8');

describe('publicly offered content', () => {
  it('is applied to the fresh schema as well as the migration', () => {
    // Every migration is also applied to festman-fresh-schema.sql in the same change, or a new
    // environment comes up without the view and the landing page query fails.
    expect(freshSchema).toContain('CREATE OR REPLACE VIEW public.publicly_offered_content');
    expect(freshSchema).toContain('GRANT SELECT ON public.publicly_offered_content TO anon');
  });

  it('counts a plan as sellable only when it is active and actually priced', () => {
    expect(migration).toContain("p.status = 'active'");
    expect(migration).toContain('FROM public.subscription_plan_prices pr');
    expect(migration).toContain('pr.is_active');
  });

  it('excludes bootcamp cohorts from what counts as a sellable plan', () => {
    // cohort_kind is the discriminator: a plan's access cohort is an individual subscription,
    // never a bootcamp. This is the clause that keeps cohort-only delivery off the public page.
    expect(migration).toContain("c.cohort_kind IN ('legacy_individual', 'subscription_plan')");
    expect(migration).not.toContain("'bootcamp'");
  });

  it('still offers content a plan grants through a learning path', () => {
    // A plan can include a path rather than the item itself. Miss this and content someone can
    // genuinely buy disappears from the marketing page.
    expect(migration).toContain('sold_via_path');
    expect(migration).toContain('unnest(lp.item_ids)');
  });

  it('only ever considers published rows', () => {
    const published = migration.match(/status = 'published'/g) ?? [];
    expect(published.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves the existing published_* views untouched', () => {
    // They also feed certification authoring, where an instructor must still see bootcamp
    // content. Narrowing them would break that.
    expect(migration).not.toContain('CREATE OR REPLACE VIEW public.published_courses');
    expect(migration).not.toContain('DROP VIEW');
  });

  it('shows everything rather than an empty homepage if the lookup fails', () => {
    // A failed lookup must degrade to the old behaviour, which is a dead-end click at worst.
    // An empty marketing page is a far worse outcome than an over-full one.
    expect(loader).toContain('offeredResult.error ? null');
    expect(loader).toContain('offeredRows === null ||');
  });

  it('filters every listing the landing page renders', () => {
    for (const table of ['courses', 'virtual_experiences', 'learning_paths']) {
      expect(loader).toContain(`offered('${table}'`);
    }
  });
});
