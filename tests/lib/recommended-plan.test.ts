// The plan the seller wants people to choose.
//
// Before this, the pricing page ordered plans by name and the hero led with whichever saved the
// most. Both are accidents, and neither could be overruled: a seller adding a second plan found
// their preferred one last on the page because of how it was spelt.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { featuredOffer } from '@/lib/pricing-offer';
import type { PricingPlan } from '@/lib/pricing-contract';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const plan = (name: string, prices: [number, number][], recommended = false): PricingPlan => ({
  id: name.toLowerCase(),
  name,
  description: null,
  recommended,
  prices: prices.map(([durationMonths, amount]) => ({
    id: `${name}-${durationMonths}`, durationMonths, amount, currency: 'GHS',
  })),
  coverage: { courses: 0, learning_paths: 0, virtual_experiences: 0, certifications: 0 },
});

describe('the hero follows the recommendation', () => {
  it('leads with the recommended plan even when another one saves more', () => {
    // The whole point. Leading on arithmetic meant the hero could advertise the plan the seller
    // would rather nobody took, with no way to say otherwise.
    const cheapest = plan('Basic', [[1, 100], [12, 600]]);          // saves 50%
    const preferred = plan('Pro', [[1, 100], [12, 900]], true);     // saves 25%
    expect(featuredOffer([cheapest, preferred])?.plan.name).toBe('Pro');
  });

  it('still shows the best term inside the plan it recommends', () => {
    // Recommending a plan is not licence to quote its worst price.
    const preferred = plan('Pro', [[1, 100], [3, 285], [12, 900]], true);
    const offer = featuredOffer([plan('Basic', [[1, 50]]), preferred]);
    expect(offer?.price.durationMonths).toBe(12);
    expect(offer?.savingPercent).toBe(25);
  });

  it('falls back to the best value when nothing is recommended', () => {
    const offer = featuredOffer([
      plan('Basic', [[1, 100], [12, 600]]),
      plan('Pro', [[1, 100], [12, 900]]),
    ]);
    expect(offer?.plan.name).toBe('Basic');
  });

  it('is unaffected when the recommended plan has nothing on sale', () => {
    // A marked plan with no prices must not blank the hero for the plans that do have them.
    const offer = featuredOffer([plan('Empty', [], true), plan('Pro', [[1, 100], [12, 900]])]);
    expect(offer).toBeNull();
  });
});

describe('ordering and marking', () => {
  const loader = read('lib/get-pricing-page-data.ts');
  const section = read('components/pricing/PricingSection.tsx');
  const migration = read('migrations/201_recommended_subscription_plan.sql');
  const schema = read('festman-fresh-schema.sql');
  const route = read('app/api/payments/route.ts');
  const dashboard = read('components/dashboard/SubscriptionsSection.tsx');

  it('puts the recommended plan first, then the rest by name', () => {
    // The free tier renders before any of these, so first here is the middle card.
    expect(loader).toContain("order('recommended', { ascending: false })");
    expect(loader).toContain("order('plan_name')");
  });

  it('says recommended, not most popular', () => {
    // Popularity is a claim about other buyers that nobody checks and that can simply be false.
    // A recommendation is the seller's own opinion, and true by being stated.
    //
    // Comments are stripped first: this is about what a visitor reads, and the reasoning above
    // the badge mentions the phrase it exists to avoid.
    const visible = section
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(visible).toContain('Recommended');
    expect(visible).not.toMatch(/most popular/i);
  });

  it('lets the database hold only one at a time', () => {
    // Two recommendations recommend nothing, and the ordering would be ambiguous again.
    for (const sql of [migration, schema]) {
      expect(sql).toContain('idx_subscription_plans_one_recommended');
      expect(sql).toMatch(/UNIQUE INDEX[\s\S]{0,160}WHERE recommended/);
    }
  });

  it('clears the previous one before marking a new one', () => {
    // Otherwise the write fails on that unique index instead of doing what was asked.
    expect(route).toMatch(/recommending[\s\S]{0,300}recommended: false[\s\S]{0,200}neq\('id'/);
  });

  it('clears the cached pricing page, so the change is visible at once', () => {
    const handler = route.slice(route.indexOf("'set-subscription-plan-recommended'"));
    expect(handler.slice(0, handler.indexOf('if (body.action', 10)))
      .toContain('revalidatePricingPage()');
  });

  it('adds the column without touching existing plans', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false');
    expect(migration).not.toMatch(/UPDATE\s+public\./i);
  });

  it('gives staff somewhere to set it', () => {
    expect(dashboard).toContain('set-subscription-plan-recommended');
    expect(dashboard).toContain('Mark as recommended');
    // An archived plan is shown to nobody, so recommending one would mean nothing.
    expect(dashboard).toMatch(/setPlanRecommended[\s\S]{0,200}busy \|\| !!plan\.archived_at/);
  });
});
