import { describe, expect, it } from 'vitest';
import { normalizeProductAddress, PRODUCT_ADDRESS, productTypeLabel } from '@/lib/books/product-type';
import { bookColumnsFromInput } from '@/lib/books/admin';

describe('product type', () => {
  it('reads as the type name, or the author\'s own word for other', () => {
    expect(productTypeLabel('template')).toBe('Template');
    expect(productTypeLabel('other', '  Course   pack ')).toBe('Course pack');
    expect(productTypeLabel('other', '')).toBe('Digital product');
    expect(productTypeLabel('nonsense')).toBe('Book');
    expect(productTypeLabel(null)).toBe('Book');
  });

  it('is saved as one of the types; "other" needs a name and drops it otherwise', () => {
    expect(bookColumnsFromInput({ productType: 'prompt', productTypeLabel: 'ignored' })).toMatchObject({ product_type: 'prompt', product_type_label: null });
    expect(bookColumnsFromInput({ productType: 'other', productTypeLabel: '<b>Dataset</b>' })).toMatchObject({ product_type: 'other', product_type_label: 'Dataset' });
    expect(bookColumnsFromInput({ productType: 'other', productTypeLabel: '   ' })).toMatchObject({ product_type: 'book', product_type_label: null });
    expect(bookColumnsFromInput({ productType: 'hack' })).toMatchObject({ product_type: 'book' });
    expect(bookColumnsFromInput({ title: 'T' })).not.toHaveProperty('product_type');
  });
});

describe('product web addresses', () => {
  it('are tidied into lowercase letters, numbers and hyphens', () => {
    expect(normalizeProductAddress('  SQL for Analysts_2026! ')).toBe('sql-for-analysts-2026');
    expect(normalizeProductAddress('--a--b--')).toBe('a-b');
    expect(PRODUCT_ADDRESS.test('sql-for-analysts')).toBe(true);
    for (const bad of ['a', '-abc', 'ABC', 'a b', 'a/b', 'x'.repeat(121)]) expect(PRODUCT_ADDRESS.test(bad)).toBe(false);
  });
});
