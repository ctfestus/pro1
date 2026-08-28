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

  it('fails closed when the allowlist cannot be read', () => {
    // Falling back to showing everything would restore the leak at exactly the moment the guard
    // is broken or the migration has not been applied. Throwing surfaces programmesError, and
    // the page says so, rather than quietly publishing private cohort content.
    expect(loader).toContain('if (offeredResult.error) throw offeredResult.error;');
    expect(loader).not.toContain('offeredRows === null');
  });

  it('constrains the queries by id rather than filtering their results', () => {
    // Filtering after the row limits lets private rows occupy the budget and pushes genuine
    // public offerings off the page. The ids have to reach the database.
    expect(loader).toContain(".in('id', courseIds)");
    expect(loader).toContain(".in('id', experienceIds)");
    expect(loader).toContain(".in('id', offeredPathIds)");
    // And the allowlist must be read before the listings, not alongside them.
    expect(loader.indexOf('publicly_offered_content')).toBeLessThan(loader.indexOf('published_courses'));
  });
});
