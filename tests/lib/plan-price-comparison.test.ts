// The number a learner uses to decide which plan to buy. Wrong here means quoting someone a
// rate that is not what they will pay, so these exercise the arithmetic with real figures.
import { describe, expect, it } from 'vitest';
import { comparePlanPrice, type ComparablePrice } from '@/lib/plan-price-comparison';

const ghs = (durationMonths: number, amount: number): ComparablePrice =>
  ({ durationMonths, amount, currency: 'GHS' });

describe('comparePlanPrice', () => {
  it('does not round the monthly rate away', () => {
    // GHS 100 over 3 months is 33.33, not 33. Rounding down understates what the learner pays
    // and makes the shorter option look closer to the longer one than it is.
    const prices = [ghs(1, 40), ghs(3, 100)];
    expect(comparePlanPrice(ghs(3, 100), prices).perMonth).toBeCloseTo(33.333, 3);
  });

  it('works out the saving against the shortest option', () => {
    // 1 month at 100; 12 months at 900 is 75 a month, a 25% saving.
    const prices = [ghs(1, 100), ghs(12, 900)];
    expect(comparePlanPrice(ghs(12, 900), prices).savingPercent).toBe(25);
  });

  it('anchors on the shortest plan actually sold, not an assumed monthly price', () => {
    // A tenant selling only 6 and 12 months has no monthly rate. 6 months at 600 is 100 a
    // month; 12 at 900 is 75, a 25% saving against the 6-month option.
    const prices = [ghs(6, 600), ghs(12, 900)];
    expect(comparePlanPrice(ghs(12, 900), prices).savingPercent).toBe(25);
    expect(comparePlanPrice(ghs(6, 600), prices).savingPercent).toBe(0);
  });

  it('never compares across currencies', () => {
    // A saving computed between GHS and USD is a meaningless number shown with confidence.
    const mixed: ComparablePrice[] = [
      { durationMonths: 1, amount: 5, currency: 'USD' },
      { durationMonths: 12, amount: 900, currency: 'GHS' },
    ];
    const yearly = comparePlanPrice(mixed[1], mixed);
    expect(yearly.savingPercent).toBe(0);
    expect(yearly.perMonth).toBe(75);
  });

  it('compares within a currency when several are on offer', () => {
    const mixed: ComparablePrice[] = [
      { durationMonths: 1, amount: 100, currency: 'GHS' },
      { durationMonths: 12, amount: 900, currency: 'GHS' },
      { durationMonths: 1, amount: 10, currency: 'USD' },
    ];
    expect(comparePlanPrice(mixed[1], mixed).savingPercent).toBe(25);
  });

  it('shows no saving on the shortest option itself', () => {
    const prices = [ghs(1, 100), ghs(12, 900)];
    expect(comparePlanPrice(ghs(1, 100), prices).savingPercent).toBe(0);
  });

  it('reports no saving rather than a negative one when a longer plan costs more', () => {
    // Priced badly by an admin. Saying "save -20%" would be worse than saying nothing.
    const prices = [ghs(1, 50), ghs(12, 900)];
    expect(comparePlanPrice(ghs(12, 900), prices).savingPercent).toBe(0);
  });

  it('survives a single price, and a zero or missing duration', () => {
    expect(comparePlanPrice(ghs(6, 600), [ghs(6, 600)])).toEqual({ perMonth: 100, savingPercent: 0 });
    expect(comparePlanPrice(ghs(0, 600), [ghs(0, 600)]).perMonth).toBe(0);
    expect(comparePlanPrice(ghs(12, 900), []).savingPercent).toBe(0);
  });

  it('does not divide by a free shortest plan', () => {
    const prices = [ghs(1, 0), ghs(12, 900)];
    expect(comparePlanPrice(ghs(12, 900), prices).savingPercent).toBe(0);
  });
});
