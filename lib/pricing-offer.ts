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
import { sellablePlans, type UnlockInfo } from '@/lib/unlock-pricing';

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
        baselinePerMonth: savingPercent > 0 && shortest
          ? (shortest.listAmount ?? shortest.amount) / shortest.durationMonths
          : null,
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

/**
 * A plan's running promotion, reduced to what a small prompt on a learning page can say.
 *
 * Plain data so it can cross from the server wrapper to the client page. Only a real promotion
 * counts -- a list price above the charged one -- never the arithmetic saving of a longer term,
 * because "subscribe and get N% off" has to be a discount the checkout will actually apply.
 */
export interface PromotionTeaser {
  planId: string;
  planName: string;
  /** Marked by the seller as the plan to lead with. */
  recommended: boolean;
  percentOff: number;
  /**
   * The term the discount is on. Promotions are set per price, so a plan can be 30% off for a
   * year and full price for a month; naming the term keeps the prompt from implying the first
   * applies to the second.
   */
  durationMonths: number;
  /** What the seller called the promotion, or null when they did not name it. */
  label: string | null;
  priceId: string;
  /** When the promotion stops (ISO timestamp), or null when it is open-ended. */
  endsAt: string | null;
}

/**
 * Whether the promotion had stopped by `at` (epoch ms). A page can hold an offer for hours before
 * the moment to show it, so this is checked then, not when the offer was loaded.
 */
export function promotionEnded(promotion: PromotionTeaser, at: number): boolean {
  if (!promotion.endsAt) return false;
  const ends = Date.parse(promotion.endsAt);
  return Number.isFinite(ends) && ends <= at;
}

function percentOff(price: PricingPrice): number {
  const list = Number(price.listAmount ?? price.amount);
  if (!(list > price.amount)) return 0;
  // A percentage promotion states its own figure; a fixed one is expressed against the list
  // price, floored so the prompt never claims more than is taken off.
  if (price.discountType === 'percentage' && Number(price.discountValue) > 0) {
    return Math.floor(Number(price.discountValue));
  }
  return Math.floor(((list - price.amount) / list) * 100);
}

/** Each plan's biggest running promotion. Plans with none are left out. */
export function planPromotions(plans: PricingPlan[]): PromotionTeaser[] {
  return plans.flatMap(plan => {
    let best: PromotionTeaser | null = null;
    for (const price of plan.prices) {
      const off = percentOff(price);
      if (off <= 0 || (best && off <= best.percentOff)) continue;
      best = { planId: plan.id, planName: plan.name, recommended: plan.recommended, percentOff: off, durationMonths: price.durationMonths, label: price.discountLabel ?? null, priceId: price.id, endsAt: price.discountEndsAt ?? null };
    }
    return best ? [best] : [];
  });
}

function biggest(promotions: PromotionTeaser[]): PromotionTeaser | null {
  return promotions.reduce<PromotionTeaser | null>(
    (best, promotion) => (!best || promotion.percentOff > best.percentOff ? promotion : best),
    null,
  );
}

/**
 * The promotion to advertise on one learning detail page.
 *
 * Open content -- free, or already available to this viewer -- leads with the best discount on
 * offer, from the recommended plan when that one is discounted, the same preference the pricing
 * hero uses. Locked content only ever names a plan that opens it: a discount on a plan without
 * this item would be a true number about the wrong thing.
 */
export function promotionForItem(
  promotions: PromotionTeaser[],
  locked: boolean,
  unlock: UnlockInfo,
): PromotionTeaser | null {
  if (locked) {
    const opening = new Set(sellablePlans(unlock).map(plan => plan.id));
    return biggest(promotions.filter(promotion => opening.has(promotion.planId)));
  }
  return biggest(promotions.filter(promotion => promotion.recommended)) ?? biggest(promotions);
}
