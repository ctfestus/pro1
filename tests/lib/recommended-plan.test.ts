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
  const migration = read('migrations/202_recommended_subscription_plan.sql');
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

  it('moves the mark in one database call, not a clear then a set', () => {
    // Two updates meant a failure between them left nothing marked, and two callers at once
    // could collide on the unique index with one having already cleared the other. Neither is
    // fixed by retrying, because by then the old mark is gone.
    const handler = route.slice(route.indexOf("'set-subscription-plan-recommended'"));
    const body = handler.slice(0, handler.indexOf('if (body.action', 10));
    expect(body).toContain("db.rpc('set_recommended_subscription_plan'");
    expect(body).not.toMatch(/\.update\(/);
  });

  it('serialises the whole decision, before it reads anything', () => {
    // Row locks were not enough. Two callers marking different plans lock the same current
    // holder; the one that waits re-reads after the other commits, no longer matches
    // "recommended", finds nothing, and marks its own target anyway -- colliding on the unique
    // index. And with no plan marked there is no row to lock, so nothing serialises them at all.
    //
    // There is one mark for the whole platform, so what has to be locked is the decision.
    for (const sql of [migration, schema]) {
      const fn = sql.slice(sql.indexOf('FUNCTION public.set_recommended_subscription_plan'));
      expect(fn).toContain("pg_advisory_xact_lock(hashtext('subscription_plans.recommended'))");
      // Before the first read, or two callers are already past it with the same picture.
      expect(fn.indexOf('pg_advisory_xact_lock')).toBeLessThan(fn.indexOf('SELECT id, name, status'));
      // Transaction-scoped, so it is released by commit or rollback and never leaks.
      expect(fn).not.toMatch(/pg_advisory_lock\(/);
      // The row locks stay as well: they keep the rows still while this transaction works.
      expect(fn).toMatch(/WHERE id = p_plan_id FOR UPDATE/);
      expect(fn).toMatch(/WHERE recommended AND id <> p_plan_id FOR UPDATE/);
    }
  });

  it('refuses a plan that is switched off, not only one that is archived', () => {
    // Inactive keeps it off the pricing page just as surely as archived hides it, so the success
    // message would have been a lie.
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(/v_target\.status <> 'active'[\s\S]{0,120}'inactive'/);
    }
    expect(route).toContain('Activate this plan before marking it as best value.');
    expect(dashboard).toContain('Activate this plan before marking it as best value.');
  });

  it('drops the mark when a plan is switched off', () => {
    // Otherwise a plan nobody can see holds the one mark there is.
    expect(route).toMatch(/body\.status === 'inactive'\) updates\.recommended = false/);
  });

  it('checks ownership of the plan it is taking the mark from, inside the same transaction', () => {
    for (const sql of [migration, schema]) {
      const fn = sql.slice(sql.indexOf('FUNCTION public.set_recommended_subscription_plan'));
      expect(fn).toMatch(/v_current\.created_by IS DISTINCT FROM p_actor_id/);
      expect(fn).toContain('held_by_other');
    }
  });

  it('clears the cached pricing page, so the change is visible at once', () => {
    const handler = route.slice(route.indexOf("'set-subscription-plan-recommended'"));
    expect(handler.slice(0, handler.indexOf('if (body.action', 10)))
      .toContain('revalidatePricingPage()');
  });

  it('adds the column without touching existing plans', () => {
    // Only the part that runs when the migration is applied. The function it also defines
    // contains UPDATEs, but those run later, when somebody moves the mark.
    const applied = migration.slice(0, migration.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(applied).toContain('ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false');
    expect(applied).not.toMatch(/UPDATE\s+public\./i);
    expect(applied).not.toMatch(/DELETE\s+FROM/i);
  });

  it('gives staff somewhere to set it', () => {
    expect(dashboard).toContain('set-subscription-plan-recommended');
    expect(dashboard).toContain('Mark as best value');
    // Neither an archived plan nor a switched-off one reaches the pricing page, so neither can
    // hold the mark. Un-marking stays available, or a plan could get stuck holding it.
    const control = dashboard.slice(dashboard.indexOf('setPlanRecommended(plan, !plan.recommended)'));
    expect(control.slice(0, 600)).toMatch(/!plan\.recommended[\s\S]{0,160}archived_at[\s\S]{0,120}status !== "active"/);
  });

  it('does not let one instructor quietly unmark a plan they do not own', () => {
    // Only one plan may hold the mark, so taking it is taking somebody else's.
    expect(route).toContain('Ask an administrator to change it.');
  });

  it('refuses to mark an archived plan, not only disable the button', () => {
    expect(route).toContain('This plan is archived, so visitors never see it. Restore it first.');
  });

  it('drops the mark when a plan is archived', () => {
    // Otherwise a hidden plan keeps the only mark there is, and nothing in the list explains why
    // the badge cannot be given to anything else.
    expect(route).toMatch(/archiving \? \{ recommended: false \} : \{\}/);
  });
});
