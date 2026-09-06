import { describe, expect, it } from 'vitest';
import { effectiveSubscriptionPrice } from '@/lib/subscription-discount';

const now = new Date('2026-09-05T12:00:00.000Z');

describe('subscription discounts', () => {
  it('applies an active percentage discount and rounds currency amounts', () => {
    expect(effectiveSubscriptionPrice(199.99, {
      discount_type: 'percentage',
      discount_value: 15,
      discount_starts_at: '2026-09-01T00:00:00.000Z',
      discount_ends_at: '2026-09-10T00:00:00.000Z',
    }, now)).toEqual({
      amount: 169.99,
      listAmount: 199.99,
      discountType: 'percentage',
      discountValue: 15,
      discountAmount: 30,
      discountActive: true,
    });
  });

  it('applies an active fixed discount', () => {
    expect(effectiveSubscriptionPrice(300, {
      discount_type: 'fixed',
      discount_value: 25,
    }, now).amount).toBe(275);
  });

  it.each([
    ['future', '2026-09-06T00:00:00.000Z', null],
    ['expired', null, '2026-09-05T12:00:00.000Z'],
  ])('does not apply a %s promotion', (_label, starts, ends) => {
    expect(effectiveSubscriptionPrice(300, {
      discount_type: 'percentage',
      discount_value: 20,
      discount_starts_at: starts,
      discount_ends_at: ends,
    }, now).discountActive).toBe(false);
  });

  it('refuses a fixed discount that would make a price free or negative', () => {
    expect(effectiveSubscriptionPrice(20, {
      discount_type: 'fixed',
      discount_value: 20,
    }, now).amount).toBe(20);
  });

  it('refuses a discount that rounds the payable amount to zero', () => {
    expect(effectiveSubscriptionPrice(0.01, {
      discount_type: 'percentage',
      discount_value: 99.99,
    }, now).discountActive).toBe(false);
  });

  it('matches decimal currency rounding at half-cent boundaries', () => {
    expect(effectiveSubscriptionPrice(2.3, {
      discount_type: 'percentage',
      discount_value: 5,
    }, now).amount).toBe(2.19);
  });
});
