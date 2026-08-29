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
}

export function comparePlanPrice(
  price: ComparablePrice,
  allPrices: readonly ComparablePrice[],
): PriceComparison {
  const perMonth = price.durationMonths > 0 ? price.amount / price.durationMonths : 0;

  const sameCurrency = allPrices.filter(
    row => row.currency === price.currency && row.durationMonths > 0,
  );
  if (!sameCurrency.length) return { perMonth, savingPercent: 0 };

  const shortest = sameCurrency.reduce((a, b) => (a.durationMonths <= b.durationMonths ? a : b));
  // The shortest option is the anchor; it cannot save against itself.
  if (price.durationMonths <= shortest.durationMonths) return { perMonth, savingPercent: 0 };

  const baseRate = shortest.amount / shortest.durationMonths;
  if (baseRate <= 0) return { perMonth, savingPercent: 0 };

  const savingPercent = Math.round((1 - perMonth / baseRate) * 100);
  // A longer option priced worse than the short one is not a saving. Say nothing rather than
  // showing a negative one.
  return { perMonth, savingPercent: savingPercent > 0 ? savingPercent : 0 };
}
