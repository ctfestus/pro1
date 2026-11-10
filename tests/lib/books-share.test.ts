import { describe, expect, it } from 'vitest';
import { productMetadata, productPriceLabel } from '@/lib/books/share';

const BOOK = {
  slug: 'field-guide-1a2b', title: 'Field Guide', subtitle: 'Learn SQL for analytics', description: null,
  coverImage: 'https://res.cloudinary.com/demo/image/upload/v1/covers/x.jpg', free: false,
  prices: [{ currency: 'GHS', amount: 120, original: 200 }],
};

describe('product price line', () => {
  it('reads Free, a price, a sale with the old price, and other currencies', () => {
    expect(productPriceLabel({ free: true, prices: [] })).toBe('Free');
    expect(productPriceLabel({ free: false, prices: [{ currency: 'GHS', amount: 120 }] })).toMatch(/^GHS\s?120/);
    expect(productPriceLabel({ free: false, prices: [{ currency: 'GHS', amount: 120, original: 200 }] })).toMatch(/120.*\(was GHS\s?200/);
    expect(productPriceLabel({ free: false, prices: [{ currency: 'GHS', amount: 120 }, { currency: 'USD', amount: 10 }] })).toMatch(/120.* \/ .*10/);
  });
});

describe('link previews for a product', () => {
  it('carry the cover, the name with the price, the description led by the price, and price tags', () => {
    const meta: any = productMetadata(BOOK, 'Tenant', 'https://learn.example.test');
    expect(meta.openGraph.title).toMatch(/^Field Guide \| GHS\s?120/);
    expect(meta.openGraph.description).toMatch(/^GHS\s?120.*Learn SQL for analytics$/);
    expect(meta.openGraph.images[0].url).toContain('res.cloudinary.com');
    expect(meta.openGraph.images[0].url).toContain('covers/x.jpg');
    expect(meta.openGraph.url).toBe('https://learn.example.test/products/field-guide-1a2b');
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: meta.openGraph.title });
    expect(meta.other).toEqual({ 'product:price:amount': '120.00', 'product:price:currency': 'GHS' });
  });
});

describe('link previews without a cover', () => {
  it('fall back to the brand image, and a free product says Free', () => {
    const meta: any = productMetadata({ ...BOOK, coverImage: null, free: true, prices: [] }, 'Tenant', 'https://learn.example.test');
    expect(meta.openGraph.images[0].url).toBe('https://learn.example.test/api/og/brand');
    expect(meta.openGraph.title).toBe('Field Guide | Free');
    expect(meta.other).toBeUndefined();
  });
});

describe('share messages follow the current price', () => {
  it('drops an ended sale from the price line, as the buy area does', async () => {
    const { endEndedSales } = await import('@/lib/books/pricing');
    const now = Date.parse('2026-11-10T12:00:00Z');
    const prices = [{ currency: 'GHS', amount: 120, original: 200, saleEndsAt: '2026-11-10T11:00:00Z' }];
    expect(productPriceLabel({ free: false, prices })).toMatch(/was/);
    expect(productPriceLabel({ free: false, prices: endEndedSales(prices, now) })).toMatch(/^GHS\s?200$/);
  });

  it('the share row formats its message from useCurrentPrices, not a fixed string', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(`${process.cwd()}/components/books/store/ShareProduct.tsx`, 'utf8');
    expect(src).toContain('const current = useCurrentPrices(prices);');
    expect(src).toContain('productPriceLabel({ free, prices: current })');
    const page = readFileSync(`${process.cwd()}/app/products/[slug]/page.tsx`, 'utf8');
    expect(page).toContain('free={book.free} prices={book.prices}');
  });
});
