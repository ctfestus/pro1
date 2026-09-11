import { describe, expect, it } from 'vitest';
import { effectiveSubscriptionPrice, promotionBadgeText } from '@/lib/subscription-discount';

const now = new Date('2026-09-05T12:00:00.000Z');

describe('subscription discounts', () => {
  it('applies an active percentage discount and rounds currency amounts', () => {
    expect(effectiveSubscriptionPrice(199.99, {
      discount_type: 'percentage',
      discount_value: 15,
      discount_starts_at: '2026-09-01T00:00:00.000Z',
      discount_ends_at: '2026-09-10T00:00:00.000Z',
      discount_label: 'Black Friday',
    }, now)).toEqual({
      amount: 169.99,
      listAmount: 199.99,
      discountType: 'percentage',
      discountValue: 15,
      discountLabel: 'Black Friday',
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

  it('drops the promotion name with the promotion it belongs to', () => {
    // A name is a label for a saving. Once the window closes there is no saving to label, and a
    // stray "Black Friday" beside a full price would be an offer the learner cannot take.
    const ended = effectiveSubscriptionPrice(300, {
      discount_type: 'percentage',
      discount_value: 20,
      discount_ends_at: '2026-09-05T00:00:00.000Z',
      discount_label: 'Black Friday',
    }, now);
    expect(ended.discountActive).toBe(false);
    expect(ended.discountLabel).toBeNull();
  });

  it('treats a blank promotion name as no name', () => {
    expect(effectiveSubscriptionPrice(300, {
      discount_type: 'fixed',
      discount_value: 25,
      discount_label: '   ',
    }, now).discountLabel).toBeNull();
  });

  it('matches decimal currency rounding at half-cent boundaries', () => {
    expect(effectiveSubscriptionPrice(2.3, {
      discount_type: 'percentage',
      discount_value: 5,
    }, now).amount).toBe(2.19);
  });
});

describe('promotionBadgeText', () => {
  it('puts the promotion name in front of the saving', () => {
    expect(promotionBadgeText('Black Friday', '15% off')).toBe('Black Friday - 15% off');
  });

  it.each([[null], [undefined], [''], ['  ']])('shows the saving alone without a name: %s', (name) => {
    expect(promotionBadgeText(name, '15% off')).toBe('15% off');
  });

  it('trims a name typed with stray spacing', () => {
    expect(promotionBadgeText('  New Year  ', 'GHS 50.00 off')).toBe('New Year - GHS 50.00 off');
  });
});
