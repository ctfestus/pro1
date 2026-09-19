import { describe, expect, it } from 'vitest';
import { normalizeGaMeasurementId, redactSensitiveUrl } from '@/lib/analytics';

describe('normalizeGaMeasurementId', () => {
  it('accepts a GA4 ID and returns it uppercase', () => {
    // An admin typing the ID by hand in lower case meant the same property.
    expect(normalizeGaMeasurementId('g-abc1234567')).toBe('G-ABC1234567');
    expect(normalizeGaMeasurementId('  G-ABC1234567  ')).toBe('G-ABC1234567');
  });

  it('rejects IDs that would collect nothing', () => {
    // UA stopped collecting in 2023 and a GTM container needs a different snippet, so storing
    // either would leave an admin waiting for numbers that never arrive.
    expect(normalizeGaMeasurementId('UA-12345-1')).toBeNull();
    expect(normalizeGaMeasurementId('GTM-ABCD12')).toBeNull();
    expect(normalizeGaMeasurementId('')).toBeNull();
    expect(normalizeGaMeasurementId(undefined)).toBeNull();
    expect(normalizeGaMeasurementId(12345)).toBeNull();
  });

  it('rejects anything that could break out of the tag', () => {
    expect(normalizeGaMeasurementId("G-ABC1234567');alert(1);//")).toBeNull();
    expect(normalizeGaMeasurementId('G-ABC</script><script>')).toBeNull();
  });
});

describe('redactSensitiveUrl', () => {
  it('redacts the confirmation token, which is live while that page is open', () => {
    // app/auth/confirm verifies on POST, not on GET, so the token in the address bar still works
    // at the moment analytics reports the page.
    const scrubbed = redactSensitiveUrl('https://app.test/auth/confirm?token_hash=pkce_abc123&type=recovery');

    expect(scrubbed).not.toContain('pkce_abc123');
    expect(scrubbed).toContain('token_hash=redacted');
    // The rest of the URL survives, or the report is useless.
    expect(scrubbed).toContain('/auth/confirm');
    expect(scrubbed).toContain('type=recovery');
  });

  it('redacts the PKCE code on the callback and the root fallback', () => {
    expect(redactSensitiveUrl('https://app.test/auth/callback?code=xyz789')).toContain('code=redacted');
    expect(redactSensitiveUrl('https://app.test/?code=xyz789')).not.toContain('xyz789');
  });

  it('drops a fragment carrying implicit-flow tokens', () => {
    const scrubbed = redactSensitiveUrl('https://app.test/auth#access_token=abc&refresh_token=def');

    expect(scrubbed).toBe('https://app.test/auth');
  });

  it('leaves an ordinary URL untouched', () => {
    const url = 'https://app.test/student?section=courses';

    expect(redactSensitiveUrl(url)).toBe(url);
  });

  it('passes an empty referrer through rather than inventing one', () => {
    expect(redactSensitiveUrl('')).toBe('');
  });

  it('reports nothing at all when it cannot parse a URL that holds a token', () => {
    // Nothing can be edited out precisely, so no URL beats a URL that may still hold a token.
    expect(redactSensitiveUrl('not a url token_hash=abc123')).toBe('');
    expect(redactSensitiveUrl('not a url')).toBe('not a url');
  });
});
