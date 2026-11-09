import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookReturnHref, readBookReturn, rememberBookReturn, takeBookReturnHref } from '@/lib/books/pending-return';

const REF = 'book-0b6f2c1e-8d6a-4a57-9f0e-3c2b1a0d9e8f';
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('book payment return across sign-in and onboarding', () => {
  it('survives the round trip once, and rebuilds the My Books return page', () => {
    rememberBookReturn(`?book_reference=${REF}&trxref=${REF}`, '#products');
    expect(takeBookReturnHref()).toBe(`/student?book_reference=${REF}#products`);
    expect(takeBookReturnHref()).toBeNull(); // single use
  });

  it('remembers My Books itself for the receipt link, which carries no reference', () => {
    rememberBookReturn('', '#products');
    expect(takeBookReturnHref()).toBe('/student#products');
  });

  it('remembers nothing for other sections', () => {
    rememberBookReturn('', '#payments');
    rememberBookReturn('?contentTable=courses', '');
    expect(store.size).toBe(0);
  });

  it('stores nothing that is not a book payment reference', () => {
    for (const bad of ['sub-0b6f2c1e-8d6a-4a57-9f0e-3c2b1a0d9e8f', 'book-x', 'https://evil.example', '']) {
      expect(readBookReturn(`?book_reference=${encodeURIComponent(bad)}`)).toBeNull();
      rememberBookReturn(`?book_reference=${encodeURIComponent(bad)}`, '');
    }
    expect(store.size).toBe(0);
    expect(bookReturnHref('/evil')).toBeNull();
  });

  it('drops a tampered or stale entry', () => {
    store.set('pending-book-return', JSON.stringify({ reference: '//evil.example', at: Date.now() }));
    expect(takeBookReturnHref()).toBeNull();
    store.set('pending-book-return', JSON.stringify({ books: 'yes', at: Date.now() }));
    expect(takeBookReturnHref()).toBeNull();
    store.set('pending-book-return', JSON.stringify({ reference: REF, at: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(takeBookReturnHref()).toBeNull();
    store.set('pending-book-return', 'not json');
    expect(takeBookReturnHref()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} } });
    expect(() => rememberBookReturn(`?book_reference=${REF}`, '#products')).not.toThrow();
    expect(takeBookReturnHref()).toBeNull();
  });
});

describe('the book a visitor was buying, across sign-up', () => {
  it('is restored once, as its store page', async () => {
    const { rememberBookPage, takeBookPageHref } = await import('@/lib/books/pending-return');
    rememberBookPage('field-guide');
    expect(takeBookPageHref()).toBe('/products/field-guide');
    expect(takeBookPageHref()).toBeNull();
  });

  it('stores only a slug-shaped value, and is cleared on return', async () => {
    const { clearBookPage, rememberBookPage, takeBookPageHref } = await import('@/lib/books/pending-return');
    for (const bad of ['../x', '//evil.example', 'Field Guide', '']) rememberBookPage(bad);
    expect(store.size).toBe(0);
    rememberBookPage('field-guide');
    clearBookPage();
    expect(takeBookPageHref()).toBeNull();
    store.set('pending-book-page', JSON.stringify({ slug: '/evil', at: Date.now() }));
    expect(takeBookPageHref()).toBeNull();
  });
});
