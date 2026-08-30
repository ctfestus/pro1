// The one number a pricing hero leads with.
//
// A hero has room for a single figure, so choosing the wrong one misprices the whole page in a
// visitor's head -- and a struck-through rate with nothing behind it is a fake discount.
import { describe, expect, it } from 'vitest';
import { featuredOffer, formatMoney, durationLabel } from '@/lib/pricing-offer';
import type { PricingPlan } from '@/lib/pricing-contract';

const plan = (name: string, prices: [number, number][]): PricingPlan => ({
  id: name.toLowerCase(),
  name,
  description: null,
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
});
