export type SubscriptionDiscountType = 'percentage' | 'fixed';

export interface SubscriptionDiscount {
  discount_type?: SubscriptionDiscountType | null;
  discount_value?: number | string | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
}

export interface EffectiveSubscriptionPrice {
  amount: number;
  listAmount: number;
  discountType: SubscriptionDiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountActive: boolean;
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
    discountAmount: Number(listMinor - discountedMinor) / 100,
    discountActive: true,
  };
}
