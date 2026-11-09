import { beforeEach, describe, expect, it } from 'vitest';
import {
  guestAccessPath, guestAccessToken, newReturnCode, normalizeGuestEmail, returnCodeMatches, verifyGuestAccessToken,
} from '@/lib/books/guest-access';

const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';

beforeEach(() => { process.env.BOOK_GUEST_ACCESS_SECRET = 'guest-test-secret'; });

describe('guest access links', () => {
  it('are the same every time for a purchase, so retries and resends never change them', () => {
    expect(guestAccessToken(A)).toBe(guestAccessToken(A));
    expect(guestAccessToken(A)).not.toBe(guestAccessToken(B));
    expect(verifyGuestAccessToken(guestAccessToken(A))).toBe(A);
    expect(guestAccessPath(A)).toBe(`/products/download?access=${encodeURIComponent(guestAccessToken(A))}`);
  });

  it('cannot be edited to open another purchase, or made without the secret', () => {
    const [, macA] = guestAccessToken(A).split('.');
    expect(verifyGuestAccessToken(`${B}.${macA}`)).toBeNull();
    expect(verifyGuestAccessToken(`${A}.`)).toBeNull();
    expect(verifyGuestAccessToken(guestAccessToken(A).toUpperCase())).toBeNull();
    expect(verifyGuestAccessToken(12)).toBeNull();
    const token = guestAccessToken(A);
    process.env.BOOK_GUEST_ACCESS_SECRET = 'another-secret';
    expect(verifyGuestAccessToken(token)).toBeNull();
  });
});

describe('return codes', () => {
  it('match only their own hash', () => {
    const one = newReturnCode();
    const two = newReturnCode();
    expect(one.code).not.toBe(two.code);
    expect(returnCodeMatches(one.code, one.hash)).toBe(true);
    expect(returnCodeMatches(two.code, one.hash)).toBe(false);
    expect(returnCodeMatches(one.hash, one.hash)).toBe(false);
    expect(returnCodeMatches(one.code, null)).toBe(false);
    expect(returnCodeMatches(undefined, one.hash)).toBe(false);
  });
});

describe('guest emails', () => {
  it('are trimmed and lowercased, and junk is refused', () => {
    expect(normalizeGuestEmail(' Ama@Example.COM ')).toBe('ama@example.com');
    for (const bad of ['', 'ama', 'ama@', '@x.com', 'a b@x.com', 'ama@x', '<a@x.com>', 5, null]) expect(normalizeGuestEmail(bad)).toBeNull();
  });
});
