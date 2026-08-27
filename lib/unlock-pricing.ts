/**
 * How a locked item's price is worded, wherever a learner is asked to buy access.
 *
 * Kept apart from the data lookup in `lib/subscription-plan-access` because these run in the
 * browser, on more than one surface: the content detail page and the locked learning path both
 * quote a price and must word it the same way.
 *
 * Durations come from the data, never from a fixed list. A tenant selling only six months has
 * one price row, and any copy naming "1, 3 or 12 months" would be advertising options that are
 * not on sale while hiding the one that is.
 */

export interface UnlockPrice {
  id: string;
  durationMonths: number;
  amount: number;
  currency: string;
}

export interface UnlockPlan {
  id: string;
  name: string;
  description?: string | null;
  prices?: UnlockPrice[];
}

export type UnlockInfo = { plans?: UnlockPlan[] } | null | undefined;

export function unlockDurationLabel(months: number) {
  if (months === 12) return '1 year';
  return `${months} month${months > 1 ? 's' : ''}`;
}

export function unlockMoney(currency: string, amount: number) {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Plans that actually have something on sale. */
export function sellablePlans(unlock: UnlockInfo): UnlockPlan[] {
  return (unlock?.plans ?? []).filter(plan => (plan.prices ?? []).length > 0);
}

/** The cheapest way in, for compact panels with room for a single number. */
export function lowestUnlockPrice(unlock: UnlockInfo): UnlockPrice | null {
  const prices = (unlock?.plans ?? []).flatMap(plan => plan.prices ?? []);
  if (!prices.length) return null;
  return prices.reduce((cheapest, price) => (price.amount < cheapest.amount ? price : cheapest));
}
