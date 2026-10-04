import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasPendingVeReview, readVeReviewTarget, rememberVeReviewTarget, takeVeReviewTarget, veReviewHref,
} from '@/lib/pending-ve-review';

// Node test environment: a minimal window with storage, location and history.
const VE = '3f2c1a9e-8b7d-4c6e-9f10-a1b2c3d4e5f6';
let store: Record<string, string>;
let href: string;

beforeEach(() => {
  store = {};
  href = 'https://app.example.com/student';
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    get location() { const u = new URL(href); return { href, search: u.search }; },
  });
  vi.stubGlobal('history', { state: null, replaceState: (_s: unknown, _t: string, url: URL) => { href = String(url); } });
});
afterEach(() => vi.unstubAllGlobals());

describe('VE review links', () => {
  it('builds the email link to the VE section with the review target', () => {
    expect(veReviewHref('https://app.example.com', VE)).toBe(`https://app.example.com/student?review=${VE}#virtual_experiences`);
  });

  it('reads only a well-formed id', () => {
    expect(readVeReviewTarget(`?review=${VE}`)).toBe(VE);
    expect(readVeReviewTarget('?review=javascript:alert(1)')).toBeNull();
    expect(readVeReviewTarget('?other=1')).toBeNull();
  });

  it('opens once from the URL, then removes the parameter but keeps the section', () => {
    href = `https://app.example.com/student?review=${VE}#virtual_experiences`;
    expect(takeVeReviewTarget()).toBe(VE);
    expect(href).toBe('https://app.example.com/student#virtual_experiences');
    expect(takeVeReviewTarget()).toBeNull();
  });

  it('survives signing in: remembered before the redirect, used once after', () => {
    rememberVeReviewTarget(`?review=${VE}`);
    expect(hasPendingVeReview('')).toBe(true);
    expect(takeVeReviewTarget()).toBe(VE);
    expect(hasPendingVeReview('')).toBe(false);
  });

  it('ignores a remembered review older than a day', () => {
    store['pending-ve-review'] = JSON.stringify({ id: VE, at: Date.now() - 25 * 60 * 60 * 1000 });
    expect(hasPendingVeReview('')).toBe(false);
    expect(takeVeReviewTarget()).toBeNull();
  });
});
