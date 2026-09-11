export type SubscriptionDiscountType = 'percentage' | 'fixed';

/**
 * Longest promotion name the badge can hold.
 *
 * The name shares one line with the saving, on a card that is narrow on a phone. Past this the
 * badge wraps and stops reading as a badge, so the limit is enforced where the name is typed,
 * where it is saved, and on the column itself.
 */
export const PROMOTION_NAME_MAX = 40;

export interface SubscriptionDiscount {
  discount_type?: SubscriptionDiscountType | null;
  discount_value?: number | string | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
  discount_label?: string | null;
}

export interface EffectiveSubscriptionPrice {
  amount: number;
  listAmount: number;
  discountType: SubscriptionDiscountType | null;
  discountValue: number | null;
  /** What the seller called this promotion, or null when they did not name it. */
  discountLabel: string | null;
  discountAmount: number;
  discountActive: boolean;
}

/**
 * What to call the offer on its ticket.
 *
 * The ticket already has a slot naming what it is, and until a promotion could be named that slot
 * held a fixed "Special offer" -- a label that says nothing the yellow panel had not already said.
 * The seller's own name belongs there instead: "Black Friday" over "20% off" reads as one offer,
 * where repeating both in the same line read as two. Unnamed promotions keep the generic label,
 * so nothing is invented on their behalf.
 */
export function promotionHeading(name: string | null | undefined, fallback: string): string {
  return (name ?? '').trim() || fallback;
}

function scaledInteger(value: number | string, scale: number): bigint {
  const fixed = Number(value).toFixed(scale);
  const [whole, fraction = ''] = fixed.split('.');
  return BigInt(whole) * (BigInt(10) ** BigInt(scale))
    + BigInt(fraction.padEnd(scale, '0')) * (Number(value) < 0 ? BigInt(-1) : BigInt(1));
}

function roundedDivision(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
}

/** Applies a plan promotion at the instant a price is displayed or charged. */
export function effectiveSubscriptionPrice(
  amount: number | string,
  discount: SubscriptionDiscount | null | undefined,
  now: Date = new Date(),
): EffectiveSubscriptionPrice {
  const listMinor = scaledInteger(amount, 2);
  const listAmount = Number(listMinor) / 100;
  const type = discount?.discount_type ?? null;
  const value = Number(discount?.discount_value);
  const startsAt = discount?.discount_starts_at ? Date.parse(discount.discount_starts_at) : null;
  const endsAt = discount?.discount_ends_at ? Date.parse(discount.discount_ends_at) : null;
  const timestamp = now.getTime();
  const active =
    (type === 'percentage' || type === 'fixed') &&
    Number.isFinite(value) &&
    value > 0 &&
    (startsAt === null || (Number.isFinite(startsAt) && timestamp >= startsAt)) &&
    (endsAt === null || (Number.isFinite(endsAt) && timestamp < endsAt));

  if (!active) {
    return {
      amount: listAmount,
      listAmount,
      discountType: null,
      discountValue: null,
      discountLabel: null,
      discountAmount: 0,
      discountActive: false,
    };
  }

  const discountBasisPoints = type === 'percentage' ? scaledInteger(value, 2) : BigInt(0);
  const discountedMinor = type === 'percentage'
    ? roundedDivision(listMinor * (BigInt(10_000) - discountBasisPoints), BigInt(10_000))
    : listMinor - scaledInteger(value, 2);
  if (discountedMinor <= BigInt(0) || discountedMinor >= listMinor) {
    return {
      amount: listAmount,
      listAmount,
      discountType: null,
      discountValue: null,
      discountLabel: null,
      discountAmount: 0,
      discountActive: false,
    };
  }

  const finalAmount = Number(discountedMinor) / 100;
  return {
    amount: finalAmount,
    listAmount,
    discountType: type,
    discountValue: value,
    discountLabel: (discount?.discount_label ?? '').trim() || null,
    discountAmount: Number(listMinor - discountedMinor) / 100,
    discountActive: true,
  };
}
