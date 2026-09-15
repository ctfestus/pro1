import { formatMoney, durationLabel } from '@/lib/pricing-offer';

// Where a learner goes to lift an AI review limit.
//
// Shared by the server gate, the entitlement route, the client hook and every player fallback.
// It was written out five times before this; the copies are the kind that stay identical right
// up until the pricing page moves.
//
// Client-safe: the only import is pure pricing formatting, no server or Node dependency.
export const AI_REVIEW_UPGRADE_URL = '/pricing';

/**
 * The cheapest way onto the recommended plan, written the way the pricing page writes it.
 *
 * Stated as a payment and its term -- "GHS 60 for 1 month" -- rather than converted to a monthly
 * rate. A "per month" figure derived from a yearly plan is not a number anyone is ever charged,
 * and it appears nowhere else in the product, so a learner who clicks through would not find it
 * on the pricing page.
 *
 * Returns null whenever the price is unknown, and every surface then simply omits the line. A
 * missing price is quieter than a wrong one.
 */
export function aiReviewPriceLabel(
  amount: number | null | undefined,
  currency: string | null | undefined,
  months: number | null | undefined,
): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (!currency || typeof months !== 'number' || months < 1) return null;
  return `${formatMoney(currency, amount)} for ${durationLabel(months)}`;
}
