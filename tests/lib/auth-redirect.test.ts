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
  // A query string or a fragment does not make it a different page: /auth?mode=signup is the
  // same loop as /auth, and checking only for "/" or end-of-string let both through.
  it('refuses the sign-in page whatever follows it', () => {
    for (const loop of [
      '/auth',
      '/auth/',
      '/auth/callback',
      '/auth/reset-password',
      '/auth?mode=signup',
      '/auth?next=%2Fsomewhere',
      '/auth#top',
      '/auth/callback?retry=1',
    ]) {
      expect(safeNextPath(loop)).toBeNull();
    }
  });

  // Slugs are not unique across content types, so a landing link carries catalogueType to say
  // which kind of thing a slug means. It has to survive the round trip or a colliding slug
  // resolves to different content than the one that was clicked.
  it('keeps the query string that says which content this is', () => {
    expect(safeNextPath('/sql4datascience?catalogueType=course')).toBe('/sql4datascience?catalogueType=course');
    expect(signInHref('/shared-slug?catalogueType=virtual_experience'))
      .toBe('/auth?next=%2Fshared-slug%3FcatalogueType%3Dvirtual_experience');
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
