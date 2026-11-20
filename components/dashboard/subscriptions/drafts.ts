// Form drafts and plan helpers for the Subscriptions page: what a new payment or plan starts as,
// and how a stored plan turns into a draft and back.

import { durationLabel } from '@/lib/pricing-offer';
import { effectiveSubscriptionPrice } from '@/lib/subscription-discount';
import type { PlanDiscountDraft, PlanPriceDraft } from './PlanForm';

export const CONTENT_TYPES = [
  { value: 'courses', label: 'Course', plural: 'Courses' },
  { value: 'virtual_experiences', label: 'Virtual experience', plural: 'Virtual experiences' },
  { value: 'certifications', label: 'Certification', plural: 'Certifications' },
  { value: 'learning_paths', label: 'Learning path', plural: 'Learning paths' },
] as const;

// The server refuses a payment deadline earlier than today, and a rejected save is a poor way
// to learn that -- a mistyped year or a reused date reads as valid until it is submitted. This
// is the same UTC day the server compares against, so the calendar cannot offer a date it will
// turn down. Spreadsheet imports carry their own dates and cannot be guarded here, which is why
// the server keeps the rule.
export const earliestDeadline = () => new Date().toISOString().slice(0, 10);

/**
 * The currency a new price or payment starts in: the one this tenant's plans already sell in.
 * No tenant is assumed, so with no priced plan yet it starts empty and is typed in.
 */
export function defaultCurrency(plans: any[]) {
  for (const plan of plans) {
    const price = (plan.subscription_plan_prices ?? []).find((row: any) => row.is_active && row.currency);
    if (price) return String(price.currency);
  }
  return '';
}

export const freshPayment = (currency: string) => ({
  durationMonths: '1',
  amount: '',
  currency,
  dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  paymentMethod: '',
  paymentReference: '',
  notes: '',
});
export type PaymentDraft = ReturnType<typeof freshPayment>;

export const PLAN_PRICE_DURATIONS = [1, 3, 6, 12] as const;
export const DURATION_OPTIONS = PLAN_PRICE_DURATIONS.map((months) => ({ value: String(months), label: durationLabel(months) }));

/** Every length a plan can sell, filled from the plan's stored prices where it has them. */
export function planPriceDrafts(plan: any, currency: string): PlanPriceDraft[] {
  const stored = new Map((plan?.subscription_plan_prices ?? []).map((price: any) => [Number(price.duration_months), price]));
  return PLAN_PRICE_DURATIONS.map((durationMonths) => {
    const price: any = stored.get(durationMonths);
    return {
      durationMonths: String(durationMonths),
      amount: price?.amount == null ? '' : String(price.amount),
      currency: price?.currency || currency,
      isActive: price?.is_active === true,
      sortOrder: durationMonths,
    };
  });
}

export function pricesPayload(prices: PlanPriceDraft[]) {
  return prices.map((price) => ({
    durationMonths: Number(price.durationMonths),
    amount: Number(price.amount),
    currency: price.currency,
    isActive: price.isActive,
    sortOrder: price.sortOrder,
  }));
}

export const freshPlanDiscount = (): PlanDiscountDraft => ({ type: '', value: '', startsAt: '', endsAt: '', label: '' });

export function planDiscountFromRow(plan: any): PlanDiscountDraft {
  return {
    type: plan?.discount_type === 'percentage' || plan?.discount_type === 'fixed' ? plan.discount_type : '',
    value: plan?.discount_value == null ? '' : String(plan.discount_value),
    startsAt: plan?.discount_starts_at ? String(plan.discount_starts_at).slice(0, 16) : '',
    endsAt: plan?.discount_ends_at ? String(plan.discount_ends_at).slice(0, 16) : '',
    label: plan?.discount_label ?? '',
  };
}

export function planDiscountPayload(discount: PlanDiscountDraft) {
  return {
    type: discount.type,
    value: discount.type ? Number(discount.value) : null,
    startsAt: discount.type && discount.startsAt ? `${discount.startsAt}:00.000Z` : null,
    endsAt: discount.type && discount.endsAt ? `${discount.endsAt}:00.000Z` : null,
    label: discount.type ? discount.label.trim() || null : null,
  };
}

export function startingPlanPrice(plan: any) {
  const price = [...(plan?.subscription_plan_prices ?? [])]
    .filter((row: any) => row.is_active)
    .sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0];
  if (!price) return null;
  return { ...price, ...effectiveSubscriptionPrice(price.amount, plan) };
}

/** On sale needs a live price and something to unlock. */
export function planIsReady(plan: any) {
  return (
    (plan?.subscription_plan_prices ?? []).some((price: any) => price.is_active && Number(price.amount) > 0) &&
    (plan?.subscription_plan_content ?? []).length > 0
  );
}

/** "courses:abc" into its table and id. */
export function splitContentKey(key: string) {
  const separator = key.indexOf(':');
  return { contentTable: key.slice(0, separator), contentId: key.slice(separator + 1) };
}
