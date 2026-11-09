import { describe, expect, it } from 'vitest';
import { saleIsOn, shownPrice } from '@/lib/books/pricing';
import { commercialFromInput } from '@/lib/books/admin';
import { parseSampleSpec, sampleStorePath } from '@/lib/books/schema';

const NOW = new Date('2026-11-10T12:00:00Z');

describe('sale prices', () => {
  it('shows the sale price with the regular price as the original while the sale is on', () => {
    expect(shownPrice({ currency: 'GHS', amount: '200.00', sale_amount: '150.00', sale_ends_at: '2026-11-20T23:59:59Z' }, NOW))
      .toEqual({ currency: 'GHS', amount: 150, original: 200, saleEndsAt: '2026-11-20T23:59:59Z' });
  });

  it('goes back to the regular price once the sale ends', () => {
    expect(shownPrice({ currency: 'GHS', amount: 200, sale_amount: 150, sale_ends_at: '2026-11-10T11:59:59Z' }, NOW)).toEqual({ currency: 'GHS', amount: 200 });
  });

  it('keeps a sale with no end date on', () => {
    expect(saleIsOn({ currency: 'GHS', amount: 200, sale_amount: 150, sale_ends_at: null }, NOW)).toBe(true);
  });

  it('ignores a sale that is missing, zero, or not lower', () => {
    for (const sale_amount of [null, '', 0, 200, 250]) {
      expect(saleIsOn({ currency: 'GHS', amount: 200, sale_amount, sale_ends_at: null }, NOW)).toBe(false);
    }
  });
});

describe('saving sale prices', () => {
  it('keeps a valid sale with its end, and drops one that is not lower than the price', () => {
    const out = commercialFromInput({ prices: [
      { currency: 'ghs', amount: 200, saleAmount: 150, saleEndsAt: '2026-11-20T23:59:59.000Z' },
      { currency: 'USD', amount: 20, saleAmount: 25, saleEndsAt: '2026-11-20T23:59:59.000Z' },
      { currency: 'NGN', amount: 5000, saleAmount: 4000, saleEndsAt: null },
    ] });
    expect(out.prices).toEqual([
      { currency: 'GHS', amount: 200, saleAmount: 150, saleEndsAt: '2026-11-20T23:59:59.000Z' },
      { currency: 'USD', amount: 20 },
      { currency: 'NGN', amount: 5000, saleAmount: 4000, saleEndsAt: null },
    ]);
  });
});

describe('sample store address', () => {
  it('keeps the store path a chapter cut links to, so an older one can be noticed', () => {
    expect(sampleStorePath('field-guide')).toBe('/products/field-guide');
    expect(parseSampleSpec({ chapters: 2, storePath: '/products/field-guide' })).toEqual({ chapters: 2, storePath: '/products/field-guide' });
    expect(parseSampleSpec({ chapters: 2 })).toEqual({ chapters: 2 });
  });

  it('drops a store path that is not a plain site path', () => {
    for (const storePath of ['https://evil.test/x', '//evil.test', '/products/a b', 'javascript:alert(1)', 5]) {
      expect(parseSampleSpec({ chapters: 2, storePath })).toEqual({ chapters: 2 });
    }
  });
});
