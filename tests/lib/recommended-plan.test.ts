// The plan the seller wants people to choose.
//
// Before this, the pricing page ordered plans by name and the hero led with whichever saved the
// most. Both are accidents, and neither could be overruled: a seller adding a second plan found
// their preferred one last on the page because of how it was spelt.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { featuredOffer, featuredOfferForDuration } from '@/lib/pricing-offer';
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

  it('falls back rather than emptying the hero when the marked plan has nothing on sale', () => {
    // The name of this test used to claim one thing and the assertion prove the opposite: it
    // expected null, which is the hero going blank. A mark is a preference, not a veto.
    const offer = featuredOffer([plan('Empty', [], true), plan('Pro', [[1, 100], [12, 900]])]);
    expect(offer?.plan.name).toBe('Pro');
  });

  it('falls back at a chosen duration too, not only on first load', () => {
    // The duration toggle takes the same path, and it was the one more likely to find a marked
    // plan with nothing at the selected term.
    const marked = plan('Pro', [[1, 100]], true);
    const other = plan('Basic', [[1, 80], [12, 600]]);
    expect(featuredOfferForDuration([marked, other], 12)?.plan.name).toBe('Basic');
    // And still prefers the marked plan where it does sell that term.
    expect(featuredOfferForDuration([marked, other], 1)?.plan.name).toBe('Pro');
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

  it('says best value, not most popular', () => {
    // Popularity is a claim about other buyers that nobody checks and that can simply be false.
    // Best value is the seller's own judgement of their own prices, which is theirs to make.
    //
    // Comments are stripped first: this is about what a visitor reads, and the reasoning above
    // the badge mentions the phrase it exists to avoid.
    const visible = section
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(visible).toContain('Best Value');
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
    // Otherwise the write fails on that unique index instead of doing what was asked. It clears
    // the row it actually found rather than everything else, so the ownership check above has
    // something to check.
    const handler = route.slice(route.indexOf("'set-subscription-plan-recommended'"));
    const body = handler.slice(0, handler.indexOf('if (body.action', 10));
    expect(body).toMatch(/eq\('recommended', true\)[\s\S]{0,80}maybeSingle/);
    expect(body).toMatch(/recommended: false[\s\S]{0,80}eq\('id', current\.id\)/);
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
    expect(dashboard).toContain('Mark as best value');
    // An archived plan is shown to nobody, so recommending one would mean nothing.
    expect(dashboard).toMatch(/setPlanRecommended[\s\S]{0,200}busy \|\| !!plan\.archived_at/);
  });

  it('does not let one instructor quietly unmark a plan they do not own', () => {
    // Only one plan may hold the mark, so taking it is taking somebody else's. The target was
    // ownership-checked; the plan being cleared was not.
    expect(route).toMatch(/current\.created_by !== sessionUser\.id/);
    expect(route).toContain('Ask an administrator to change it.');
  });

  it('refuses to mark an archived plan, not only disable the button', () => {
    // A archived plan is shown to nobody, so the badge would sit on a card no visitor reaches --
    // and it would hold the one mark the platform allows.
    expect(route).toContain('This plan is archived, so visitors never see it. Restore it first.');
  });

  it('drops the mark when a plan is archived', () => {
    // Otherwise a hidden plan keeps the only mark there is, and nothing in the list explains why
    // the badge cannot be given to anything else.
    expect(route).toMatch(/archiving \? \{ recommended: false \} : \{\}/);
  });
});
