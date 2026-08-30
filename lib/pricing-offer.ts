/**
 * The single offer a pricing hero leads with.
 *
 * A hero has room for one number, so it has to be the right one: the option that genuinely
 * saves the most per month, with the rate it is being compared against. Everything here is
 * derived from what an admin priced -- nothing is chosen by hand, so the hero cannot end up
 * advertising an option that was withdrawn or repriced.
 */
import { comparePlanPrice } from '@/lib/plan-price-comparison';
import type { PricingPlan, PricingPrice } from '@/lib/pricing-contract';

export interface FeaturedOffer {
  plan: PricingPlan;
  /** The option the hero leads with: the best value on offer. */
  price: PricingPrice;
  perMonth: number;
  savingPercent: number;
  /** The rate the saving is measured against, for the struck-through figure. Null when there is no saving to show. */
  baselinePerMonth: number | null;
  /** A shorter option worth naming as the alternative, when one exists. */
  alternative: PricingPrice | null;
}

export function formatMoney(currency: string, amount: number): string {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function durationLabel(months: number): string {
  if (months === 12) return '1 year';
  return `${months} month${months > 1 ? 's' : ''}`;
}

export function featuredOffer(plans: PricingPlan[]): FeaturedOffer | null {
  let best: FeaturedOffer | null = null;

  for (const plan of plans) {
    for (const price of plan.prices) {
      const { perMonth, savingPercent } = comparePlanPrice(price, plan.prices);
      // Biggest saving wins; where two save the same, the longer run of access does.
      const better = !best
        || savingPercent > best.savingPercent
        || (savingPercent === best.savingPercent && price.durationMonths > best.price.durationMonths);
      if (!better) continue;

      const sameCurrency = plan.prices.filter(row => row.currency === price.currency && row.durationMonths > 0);
      const shortest = sameCurrency.length
        ? sameCurrency.reduce((a, b) => (a.durationMonths <= b.durationMonths ? a : b))
        : null;

      best = {
        plan,
        price,
        perMonth,
        savingPercent,
        // Only shown when there is a real saving, so the struck-through figure always means
        // something rather than decorating a single price with a fake discount.
        baselinePerMonth: savingPercent > 0 && shortest ? shortest.amount / shortest.durationMonths : null,
        alternative: shortest && shortest.id !== price.id ? shortest : null,
      };
    }
  }

  return best;
}
