// The one number a pricing hero leads with.
//
// A hero has room for a single figure, so choosing the wrong one misprices the whole page in a
// visitor's head -- and a struck-through rate with nothing behind it is a fake discount.
import { describe, expect, it } from 'vitest';
import { featuredOffer, featuredOfferForDuration, formatMoney, durationLabel, planPromotions, promotionForItem } from '@/lib/pricing-offer';
import type { PricingPlan } from '@/lib/pricing-contract';

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

describe('featuredOffer', () => {
  it('leads with the option that actually saves the most', () => {
    // 1 month at 100; 12 months at 900 is 75 a month, a 25% saving.
    const offer = featuredOffer([plan('Pro', [[1, 100], [3, 285], [12, 900]])]);
    expect(offer?.price.durationMonths).toBe(12);
    expect(offer?.savingPercent).toBe(25);
    expect(offer?.perMonth).toBe(75);
  });

  it('strikes through the rate the saving is measured against', () => {
    const offer = featuredOffer([plan('Pro', [[1, 100], [12, 900]])]);
    expect(offer?.baselinePerMonth).toBe(100);
  });

  it('uses list prices for the duration baseline during a fixed promotion', () => {
    const promoted = plan('Pro', [[1, 50], [12, 850]]);
    promoted.prices[0].listAmount = 100;
    promoted.prices[1].listAmount = 900;
    const offer = featuredOffer([promoted]);
    expect(offer?.savingPercent).toBe(25);
    expect(offer?.perMonth).toBeCloseTo(70.833, 3);
    expect(offer?.baselinePerMonth).toBe(100);
  });

  it('shows no struck-through rate when there is no saving to strike', () => {
    // One duration means nothing to compare against. Dressing it up as a discount would be a lie.
    const offer = featuredOffer([plan('Pro', [[6, 600]])]);
    expect(offer?.savingPercent).toBe(0);
    expect(offer?.baselinePerMonth).toBeNull();
  });

  it('names a shorter option as the alternative, when there is one', () => {
    const offer = featuredOffer([plan('Pro', [[1, 100], [12, 900]])]);
    expect(offer?.alternative?.durationMonths).toBe(1);
    expect(featuredOffer([plan('Pro', [[6, 600]])])?.alternative).toBeNull();
  });

  it('prefers the longer run when two options save the same', () => {
    // 3 months at 270 and 12 at 1080 are both 90 a month, a 10% saving on 100.
    const offer = featuredOffer([plan('Pro', [[1, 100], [3, 270], [12, 1080]])]);
    expect(offer?.price.durationMonths).toBe(12);
  });

  it('picks across plans, not just within one', () => {
    const offer = featuredOffer([
      plan('Starter Pro', [[1, 100], [12, 1080]]),
      plan('Full Pro', [[1, 200], [12, 1200]]),
    ]);
    expect(offer?.plan.name).toBe('Full Pro');
    expect(offer?.savingPercent).toBe(50);
  });

  it('has nothing to lead with when nothing is priced', () => {
    expect(featuredOffer([])).toBeNull();
    expect(featuredOffer([plan('Pro', [])])).toBeNull();
  });

  it('keeps the hero aligned with the duration selected on the page', () => {
    const offer = featuredOfferForDuration([
      plan('Basic', [[1, 100], [3, 240]]),
      plan('Practice', [[1, 120], [6, 480]]),
    ], 3);

    expect(offer?.plan.name).toBe('Basic');
    expect(offer?.price.durationMonths).toBe(3);
    expect(offer?.savingPercent).toBe(20);
  });
});

describe('formatting', () => {
  it('keeps a fractional rate rather than rounding it away', () => {
    expect(formatMoney('GHS', 33.333)).toBe('GHS 33.33');
  });

  it('says a year rather than twelve months', () => {
    expect(durationLabel(12)).toBe('1 year');
    expect(durationLabel(1)).toBe('1 month');
    expect(durationLabel(3)).toBe('3 months');
  });
  it('carries the months-paid-for figure the hero states', () => {
    // 900 at the 100-a-month short rate is nine months' worth, so the hero can say "pay for
    // only 9 months" rather than asserting a saving with no figure behind it.
    const offer = featuredOffer([plan('Pro', [[1, 100], [12, 900]])]);
    expect(offer?.monthsPaidFor).toBe(9);
  });

  it('leaves the months figure null when there is nothing to count against', () => {
    const offer = featuredOffer([plan('Pro', [[12, 900]])]);
    expect(offer?.monthsPaidFor).toBeNull();
  });
});

describe('planPromotions', () => {
  const promo = (
    name: string,
    prices: { months: number; amount: number; list?: number; type?: 'percentage' | 'fixed'; value?: number; label?: string }[],
    recommended = false,
  ): PricingPlan => ({
    id: name.toLowerCase(),
    name,
    description: null,
    recommended,
    prices: prices.map(p => ({
      id: `${name}-${p.months}`, durationMonths: p.months, amount: p.amount, currency: 'GHS',
      listAmount: p.list ?? p.amount, discountType: p.type ?? null, discountValue: p.value ?? null,
      discountLabel: p.label ?? null, discountAmount: (p.list ?? p.amount) - p.amount,
    })),
    coverage: { courses: 0, learning_paths: 0, virtual_experiences: 0, certifications: 0 },
  });

  it('says nothing when no promotion is running, even where a longer term saves', () => {
    // 12 months at 900 against 100 a month is a term saving, not a discount at checkout.
    expect(planPromotions([plan('Pro', [[1, 100], [12, 900]])])).toEqual([]);
  });

  it('states a percentage promotion as the seller set it', () => {
    const [teaser] = planPromotions([promo('Pro', [{ months: 12, amount: 800, list: 1000, type: 'percentage', value: 20, label: 'Back to school' }])]);
    expect(teaser).toEqual({ planId: 'pro', planName: 'Pro', recommended: false, percentOff: 20, label: 'Back to school', priceId: 'Pro-12' });
  });

  it('expresses a fixed promotion against the list price, never rounding up', () => {
    // 155 off 1000 is 15.5%, which must not be advertised as 16%.
    const [teaser] = planPromotions([promo('Pro', [{ months: 12, amount: 845, list: 1000, type: 'fixed', value: 155 }])]);
    expect(teaser.percentOff).toBe(15);
  });

  it('keeps the biggest promotion of each plan', () => {
    const teasers = planPromotions([
      promo('Pro', [{ months: 1, amount: 90, list: 100, type: 'percentage', value: 10 }, { months: 12, amount: 700, list: 1000, type: 'percentage', value: 30 }]),
      promo('Basic', [{ months: 1, amount: 100 }]),
    ]);
    expect(teasers).toHaveLength(1);
    expect(teasers[0]).toMatchObject({ planId: 'pro', percentOff: 30 });
  });

  describe('promotionForItem', () => {
    const promotions = planPromotions([
      promo('Basic', [{ months: 1, amount: 50, list: 100, type: 'percentage', value: 50 }]),
      promo('Pro', [{ months: 12, amount: 700, list: 1000, type: 'percentage', value: 30 }], true),
    ]);
    const unlock = (...ids: string[]) => ({ plans: ids.map(id => ({ id, name: id, prices: [{ id: `${id}-p`, durationMonths: 1, amount: 1, currency: 'GHS' }] })) });

    it('leads open content with the recommended plan when it is discounted', () => {
      expect(promotionForItem(promotions, false, null)).toMatchObject({ planId: 'pro', percentOff: 30 });
    });

    it('falls back to the biggest discount when the recommended plan has none', () => {
      const unmarked = promotions.map(p => ({ ...p, recommended: false }));
      expect(promotionForItem(unmarked, false, null)).toMatchObject({ planId: 'basic', percentOff: 50 });
    });

    it('only advertises a plan that actually opens a locked item', () => {
      expect(promotionForItem(promotions, true, unlock('pro'))).toMatchObject({ planId: 'pro', percentOff: 30 });
      expect(promotionForItem(promotions, true, unlock('premium'))).toBeNull();
      expect(promotionForItem(promotions, true, unlock('pro', 'basic'))).toMatchObject({ planId: 'basic', percentOff: 50 });
    });

    it('ignores plans with nothing on sale, and locked items with no plan at all', () => {
      expect(promotionForItem(promotions, true, { plans: [{ id: 'pro', name: 'Pro', prices: [] }] })).toBeNull();
      expect(promotionForItem(promotions, true, null)).toBeNull();
    });

    it('shows nothing when no plan is discounted', () => {
      expect(promotionForItem([], false, null)).toBeNull();
    });
  });
});
