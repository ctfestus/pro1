// What a visitor was trying to buy, carried across signing in.
//
// The security-relevant property is that no caller-supplied destination is ever stored or
// navigated to: only a content table and id, both validated, with the path rebuilt from them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readPurchaseIntent,
  rememberPurchaseIntent,
  takePurchaseIntent,
  purchaseIntentHref,
} from '@/lib/pending-purchase';

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    _store: store,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  (globalThis as any).window = { localStorage: storage };
  vi.useRealTimers();
});

describe('pending purchase intent', () => {
  it('carries a real target across sign-in, once', () => {
    rememberPurchaseIntent('?contentTable=courses&contentId=abc-123');

    const first = takePurchaseIntent();
    expect(first).toEqual({ contentTable: 'courses', contentId: 'abc-123' });
    // Single use: a second read must not redirect them again later.
    expect(takePurchaseIntent()).toBeNull();
  });

  it('refuses a content table the purchase API would not accept', () => {
    rememberPurchaseIntent('?contentTable=students&contentId=abc-123');
    expect(takePurchaseIntent()).toBeNull();
    expect(readPurchaseIntent('?contentTable=students&contentId=abc-123')).toBeNull();
  });

  it('ignores a stored intent once it is stale', () => {
    const thirtyHoursAgo = Date.now() - 30 * 60 * 60 * 1000;
    storage.setItem(
      'pending-purchase-intent',
      JSON.stringify({ contentTable: 'courses', contentId: 'abc-123', at: thirtyHoursAgo }),
    );
    expect(takePurchaseIntent()).toBeNull();
  });

  it('ignores a stored intent with no timestamp or damaged contents', () => {
    storage.setItem('pending-purchase-intent', JSON.stringify({ contentTable: 'courses', contentId: 'abc' }));
    expect(takePurchaseIntent()).toBeNull();
    storage.setItem('pending-purchase-intent', 'not json');
    expect(takePurchaseIntent()).toBeNull();
  });

  it('builds the destination itself, so a supplied URL can never be followed', () => {
    // Even if an attacker-shaped value reaches storage, the href is assembled from the two
    // validated fields and stays on /student.
    const href = purchaseIntentHref({ contentTable: 'courses', contentId: 'https://evil.test' });
    expect(href.startsWith('/student?')).toBe(true);
    expect(href).toContain('contentId=https%3A%2F%2Fevil.test');
    expect(href.endsWith('#payments')).toBe(true);
  });

  it('stores nothing when there is no target in the query', () => {
    rememberPurchaseIntent('?section=courses');
    expect(storage._store.size).toBe(0);
  });

  it('survives storage being unavailable', () => {
    (globalThis as any).window = {
      localStorage: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
      },
    };
    expect(() => rememberPurchaseIntent('?contentTable=courses&contentId=abc')).not.toThrow();
    expect(takePurchaseIntent()).toBeNull();
  });
});
