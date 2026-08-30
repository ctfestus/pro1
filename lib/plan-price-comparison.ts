/**
 * What a plan option costs per month, and what it saves against the shortest one on offer.
 *
 * A year of access reads as a big number beside a month of it, so the better deal looks like the
 * dearer one. The per-month figure is what makes it legible.
 *
 * Two rules keep the comparison honest:
 *
 * - Only prices in the same currency are compared. A plan priced in two currencies would
 *   otherwise produce a saving computed across them, which is a meaningless number presented
 *   with total confidence.
 * - The anchor is the shortest option actually sold, not an assumed monthly price. A tenant
 *   selling only six and twelve months has no monthly rate, and inventing one would misstate
 *   every saving on the card.
 */

export interface ComparablePrice {
  durationMonths: number;
  amount: number;
  currency: string;
}

export interface PriceComparison {
  /** Unrounded, so the caller can format it. Rounding here understates the real rate. */
  perMonth: number;
  /** Whole percent saved against the shortest same-currency option, or 0 when there is none. */
  savingPercent: number;
  /**
   * How many of the shortest option this one costs, rounded DOWN, or null when there is no
   * saving to express that way.
   *
   * Twelve months at a discount rarely divides into a whole number of monthly payments -- it
   * lands on something like 8.04 -- and rounding that down to "pay for 8" states a slightly
   * better deal than is actually sold. That is a deliberate choice by the site owner, taken
   * with the effect known: the shortfall is whatever the fraction was, up to just under one
   * full period of the shortest option.
   */
  monthsPaidFor: number | null;
}

export function comparePlanPrice(
  price: ComparablePrice,
  allPrices: readonly ComparablePrice[],
): PriceComparison {
  const perMonth = price.durationMonths > 0 ? price.amount / price.durationMonths : 0;

  const none = { perMonth, savingPercent: 0, monthsPaidFor: null };

  const sameCurrency = allPrices.filter(
    row => row.currency === price.currency && row.durationMonths > 0,
  );
  if (!sameCurrency.length) return none;

  const shortest = sameCurrency.reduce((a, b) => (a.durationMonths <= b.durationMonths ? a : b));
  // The shortest option is the anchor; it cannot save against itself.
  if (price.durationMonths <= shortest.durationMonths) return none;

  const baseRate = shortest.amount / shortest.durationMonths;
  if (baseRate <= 0) return none;

  const savingPercent = Math.round((1 - perMonth / baseRate) * 100);
  // A longer option priced worse than the short one is not a saving. Say nothing rather than
  // showing a negative one.
  if (savingPercent <= 0) return none;

  // The epsilon guards the division, not the rounding: an exact eight can arrive as
  // 7.999999999 out of binary floating point, and flooring that would quietly give away a whole
  // month that was never discounted.
  const monthsPaid = Math.floor(price.amount / baseRate + 1e-9);
  // Nothing to say when it does not come out shorter than the term itself, and "pay for 0
  // months" is not a sentence about a price anyone is charged.
  const monthsPaidFor =
    monthsPaid >= 1 && monthsPaid < price.durationMonths ? monthsPaid : null;

  return { perMonth, savingPercent, monthsPaidFor };
}
