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

describe('guest download links never reach analytics', () => {
  it('redacts the access token as the page location and as the next page referrer', async () => {
    process.env.BOOK_GUEST_ACCESS_SECRET = 'guest-test-secret';
    const { guestAccessPath, guestAccessToken } = await import('@/lib/books/guest-access');
    const id = '33333333-3333-4333-8333-333333333333';
    const url = `https://app.test${guestAccessPath(id)}`;
    const token = guestAccessToken(id);
    const [, mac] = token.split('.');
    // Location (on the download page) and referrer (the page after it) are the same URL.
    for (const reported of [redactSensitiveUrl(url), redactSensitiveUrl(`${url}&utm_source=email`)]) {
      expect(reported).not.toContain(mac);
      expect(reported).not.toContain(encodeURIComponent(token));
      expect(new URL(reported).searchParams.get('access')).toBe('redacted');
      expect(new URL(reported).pathname).toBe('/products/download');
    }
    expect(redactSensitiveUrl(`${url}`.replace('https://', 'not a url '))).toBe('');
  });

  it('the analytics tag redacts both the location and the referrer it reports', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(`${process.cwd()}/components/GoogleAnalytics.tsx`, 'utf8');
    expect(src).toContain('redactSensitiveUrl(document.referrer)');
    expect(src).toContain('page_location: redactSensitiveUrl(window.location.href)');
  });
});

describe('error reports never carry a credential', () => {
  it('redacts the page URL, navigation paths and request URLs in a browser error report', async () => {
    const { scrubSentryEvent, scrubSentryBreadcrumb } = await import('../../sentry.shared');
    const event = scrubSentryEvent({
      request: { url: 'https://app.test/products/download?access=SECRET-1', query_string: 'access=SECRET-1' },
      breadcrumbs: [
        { data: { from: '/products/x', to: '/products/download?access=SECRET-2' } },
        { data: { url: 'https://app.test/auth/confirm?token_hash=SECRET-3&type=recovery' } },
        { data: { url: '/api/books/guest-access' } },
      ],
    });
    const json = JSON.stringify(event);
    expect(json).not.toMatch(/SECRET-/);
    expect(event.breadcrumbs![0].data!.to).toBe('/products/download?access=redacted');
    expect(event.breadcrumbs![2].data!.url).toBe('/api/books/guest-access');
    expect(JSON.stringify(scrubSentryBreadcrumb({ data: { to: '/products/download?access=SECRET-4' } }))).not.toContain('SECRET-4');
  });

  it('redacts server request queries and traced request URLs', async () => {
    const { scrubSentryEvent } = await import('../../sentry.shared');
    const event = scrubSentryEvent({
      request: { url: 'https://app.test/api/books/guest-access?access=SECRET-5', query_string: 'access=SECRET-5' },
      spans: [{ data: { 'http.url': 'https://app.test/products/download?access=SECRET-6', 'url.query': 'access=SECRET-7&x=1', other: 'kept' } }],
      contexts: { trace: { data: { 'url.full': 'https://app.test/products/download?access=SECRET-8' } } },
    });
    expect(JSON.stringify(event)).not.toMatch(/SECRET-/);
    expect(event.request!.query_string).toBeUndefined();
    expect(event.spans![0].data!['url.query']).toBe('access=redacted&x=1');
    expect(event.spans![0].data!.other).toBe('kept');
  });

  it.each(['instrumentation-client.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts'])(
    'is wired into %s for errors, traces and breadcrumbs',
    async (file) => {
      const { readFileSync } = await import('fs');
      const src = readFileSync(`${process.cwd()}/${file}`, 'utf8');
      expect(src).toContain('beforeSend: (event) => scrubSentryEvent(');
      expect(src).toContain('beforeSendTransaction: (event) => scrubSentryEvent(');
      expect(src).toContain('beforeBreadcrumb: (crumb) => scrubSentryBreadcrumb(');
    },
  );
});
