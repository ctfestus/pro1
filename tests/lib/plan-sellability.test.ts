// Which plans a surface is allowed to offer.
//
// The pricing page and checkout both sell only what public_pricing_plans lists. A surface that
// offers more than that offers a purchase the API refuses -- which is how a learner came to see
// a plan, press buy, and be told it was unavailable. The exemption matters just as much in the
// other direction: a current subscriber may renew a plan that has stopped taking new learners,
// so filtering their own plan out of their own list would take that renewal away.
import { describe, expect, it } from 'vitest';
import { loadPlansForContent } from '@/lib/subscription-plan-access';

/** Minimal chainable stub: configured rows per table, narrowed by eq and in. */
function db(byTable: Record<string, any[]>) {
  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const ins: Record<string, unknown[]> = {};
      const rows = () => (byTable[table] ?? []).filter((row: any) =>
        Object.entries(eqs).every(([col, value]) => !(col in row) || row[col] === value) &&
        Object.entries(ins).every(([col, values]) => !(col in row) || values.includes(row[col])));
      const builder: any = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === 'then') return (r: any) => Promise.resolve({ data: rows(), error: null }).then(r);
          if (prop === 'eq') return (col: string, value: unknown) => { eqs[col] = value; return builder; };
          if (prop === 'in') return (col: string, values: unknown[]) => { ins[col] = values; return builder; };
          return () => builder;
        },
      });
      return builder;
    },
  } as any;
}

// Two active, priced plans. Only one of them is still sellable: the other's attached content was
// all unpublished, so public_pricing_plans has dropped it while the plan row is untouched.
const rows = () => ({
  subscription_plan_prices: [
    {
      id: 'price-live', plan_id: 'plan-live', duration_months: 1, amount: 100, currency: 'GHS', sort_order: 0,
      subscription_plans: { id: 'plan-live', name: 'Live', description: null, status: 'active', cohort_id: 'cohort-live' },
    },
    {
      id: 'price-empty', plan_id: 'plan-empty', duration_months: 1, amount: 200, currency: 'GHS', sort_order: 0,
      subscription_plans: { id: 'plan-empty', name: 'Emptied', description: null, status: 'active', cohort_id: 'cohort-empty' },
    },
  ],
  cohorts: [
    { id: 'cohort-live', cohort_kind: 'subscription_plan' },
    { id: 'cohort-empty', cohort_kind: 'subscription_plan' },
  ],
  public_pricing_plans: [{ plan_id: 'plan-live' }],
});

describe('loadPlansForContent sellability', () => {
  it('still returns every active priced plan when sellability was not asked for', async () => {
    const plans = await loadPlansForContent(db(rows()), null);
    expect(plans.map(plan => plan.id)).toEqual(['plan-live', 'plan-empty']);
  });

  it('drops a plan the pricing view no longer lists, so no surface can offer it', async () => {
    const plans = await loadPlansForContent(db(rows()), null, { sellableOnly: true });
    expect(plans.map(plan => plan.id)).toEqual(['plan-live']);
  });

  it('keeps the plan a learner already holds, so they can still renew it', async () => {
    const plans = await loadPlansForContent(db(rows()), null, {
      sellableOnly: true,
      keepPlanIds: ['plan-empty'],
    });
    expect(plans.map(plan => plan.id)).toEqual(['plan-live', 'plan-empty']);
  });

  it('exempts only the named plan, never sellability as a whole', async () => {
    const plans = await loadPlansForContent(db({ ...rows(), public_pricing_plans: [] }), null, {
      sellableOnly: true,
      keepPlanIds: ['plan-empty'],
    });
    expect(plans.map(plan => plan.id)).toEqual(['plan-empty']);
  });
});
