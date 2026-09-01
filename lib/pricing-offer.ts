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
  /** The saving stated as months paid for at the short rate, or null when it cannot be. */
  monthsPaidFor: number | null;
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

function findFeaturedOffer(plans: PricingPlan[], durationMonths?: number): FeaturedOffer | null {
  let best: FeaturedOffer | null = null;

  for (const plan of plans) {
    for (const price of plan.prices) {
      if (durationMonths !== undefined && price.durationMonths !== durationMonths) continue;
      const { perMonth, savingPercent, monthsPaidFor } = comparePlanPrice(price, plan.prices);
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
        monthsPaidFor,
        // Only shown when there is a real saving, so the struck-through figure always means
        // something rather than decorating a single price with a fake discount.
        baselinePerMonth: savingPercent > 0 && shortest ? shortest.amount / shortest.durationMonths : null,
        alternative: shortest && shortest.id !== price.id ? shortest : null,
      };
    }
  }

  return best;
}

/**
 * A marked plan outranks the arithmetic.
 *
 * Leading with whatever saves most meant the hero could advertise a plan the seller would rather
 * nobody took, with no way to say otherwise. Where a plan is marked, only that plan is
 * considered -- and the best of ITS terms still wins, so the figure shown is the best deal
 * inside what is being put forward.
 *
 * It falls back rather than showing nothing. A marked plan with no sellable term should not
 * empty the hero for the plans that do have one: the mark is a preference, not a veto.
 */
function preferred(
  plans: PricingPlan[],
  pick: (candidates: PricingPlan[]) => FeaturedOffer | null,
): FeaturedOffer | null {
  const marked = plans.filter(plan => plan.recommended);
  return (marked.length ? pick(marked) : null) ?? pick(plans);
}

export function featuredOffer(plans: PricingPlan[]): FeaturedOffer | null {
  return preferred(plans, candidates => findFeaturedOffer(candidates));
}

/** The strongest available plan at a duration the learner has actively selected. */
export function featuredOfferForDuration(plans: PricingPlan[], durationMonths: number | null): FeaturedOffer | null {
  if (durationMonths === null) return featuredOffer(plans);
  return preferred(plans, candidates => findFeaturedOffer(candidates, durationMonths));
}
