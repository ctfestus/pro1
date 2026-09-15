import { describe, expect, it } from 'vitest';
import { aiReviewPriceLabel } from '@/lib/ai-review-upgrade';

describe('AI review upgrade price label', () => {
  it('states the payment and the term it buys', () => {
    expect(aiReviewPriceLabel(60, 'GHS', 1)).toBe('GHS 60 for 1 month');
  });

  it('keeps a longer term in its own words rather than converting it', () => {
    // The learner is charged 300 for six months. A derived "GHS 50 a month" is a number they are
    // never billed and would not find on the pricing page, so the term is stated as it is sold.
    expect(aiReviewPriceLabel(300, 'GHS', 6)).toBe('GHS 300 for 6 months');
    expect(aiReviewPriceLabel(500, 'GHS', 12)).toBe('GHS 500 for 1 year');
  });

  it('says nothing when the price is unknown', () => {
    expect(aiReviewPriceLabel(null, 'GHS', 1)).toBeNull();
    expect(aiReviewPriceLabel(60, null, 1)).toBeNull();
    expect(aiReviewPriceLabel(60, 'GHS', null)).toBeNull();
  });

  it('says nothing rather than quoting a free or negative price', () => {
    expect(aiReviewPriceLabel(0, 'GHS', 1)).toBeNull();
    expect(aiReviewPriceLabel(-10, 'GHS', 1)).toBeNull();
    expect(aiReviewPriceLabel(Number.NaN, 'GHS', 1)).toBeNull();
  });
});
