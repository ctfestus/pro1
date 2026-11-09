import { describe, expect, it } from 'vitest';
import { buildNavGroups } from '@/lib/landing-nav';

describe('Learn menu: the store Books entry', () => {
  it('is left out while the store is empty', () => {
    expect(buildNavGroups([], null).some(g => g.label === 'Digital Products')).toBe(false);
  });

  it('links to the store and to each book page', () => {
    const books = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, slug: `book-${i}`, title: `Book ${i}`, coverImage: i === 0 ? 'covers/x' : null }));
    const group = buildNavGroups([], null, books).find(g => g.label === 'Digital Products')!;
    expect(group.anchor).toBe('/products');
    const items = group.subGroups[0].items;
    expect(items).toHaveLength(8);
    expect(items[0]).toEqual({ id: 'b0', title: 'Book 0', imageUrl: 'covers/x', href: '/products/book-0' });
    expect(items[1].imageUrl).toBeUndefined();
  });
});
