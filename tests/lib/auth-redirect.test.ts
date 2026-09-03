import { describe, it, expect } from 'vitest';

import { safeNextPath, signInHref } from '@/lib/auth-redirect';

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/sql4datascience')).toBe('/sql4datascience');
    expect(safeNextPath('/fintech-ve?tab=outline')).toBe('/fintech-ve?tab=outline');
  });

  it('reads nothing as nothing', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });

  // The reason this function exists. `next` comes off the query string, so an attacker writes it:
  // a link to OUR sign-in page that lands the visitor on THEIR page, with our domain in the
  // address bar the whole way there. Every shape a browser would treat as another origin has to
  // be refused, including the ones that do not look absolute.
  it('refuses anywhere that is not this site', () => {
    for (const hostile of [
      'https://evil.example',
      'http://evil.example',
      '//evil.example',            // protocol-relative: the browser reads this as another origin
      '/\\evil.example',           // backslash variant some parsers normalise to //
      '/\/evil.example',
      'javascript:alert(1)',
      'evil.example',
      '/\u0000/evil',              // control characters, used to slip past naive checks
      '/path\nwith-newline',
    ]) {
      expect(safeNextPath(hostile)).toBeNull();
    }
  });

  // Returning to the sign-in page after signing in would bounce the visitor straight back to it.
  it('refuses the sign-in page and its sub-flows', () => {
    expect(safeNextPath('/auth')).toBeNull();
    expect(safeNextPath('/auth/callback')).toBeNull();
    expect(safeNextPath('/auth/reset-password')).toBeNull();
  });

  it('does not mistake a path that merely starts with the same letters', () => {
    expect(safeNextPath('/authors')).toBe('/authors');
  });
});

describe('signInHref', () => {
  it('carries the page to come back to', () => {
    expect(signInHref('/sql4datascience')).toBe('/auth?next=%2Fsql4datascience');
  });

  it('falls back to a plain sign-in link when there is nowhere safe to return', () => {
    expect(signInHref(null)).toBe('/auth');
    expect(signInHref('https://evil.example')).toBe('/auth');
    expect(signInHref('/auth')).toBe('/auth');
  });
});
