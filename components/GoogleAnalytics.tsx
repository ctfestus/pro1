'use client';

/**
 * The Google Analytics 4 tag, loaded only when a measurement ID is configured.
 *
 * The ID comes from platform_settings via getTenantSettings(), so a tenant turns analytics on by
 * pasting an ID into Settings rather than by redeploying.
 *
 * The tag is configured from an effect rather than the usual inline snippet so the URL redaction
 * in lib/analytics is real, imported, tested code instead of a string of JavaScript that no test
 * can reach. Commands queue in window.dataLayer, which is how gtag.js is designed to be fed, so
 * it does not matter whether the effect or the script arrives first.
 *
 * Route changes are NOT tracked here. GA4's enhanced measurement sends a page_view on pushState,
 * replaceState and popstate ("page changes based on browser history events", on by default),
 * which is exactly how the App Router navigates. Sending our own page_view alongside it would
 * count every in-app navigation twice.
 */
import Script from 'next/script';
import { useEffect } from 'react';
import { normalizeGaMeasurementId, redactSensitiveUrl } from '@/lib/analytics';

// Module scope, so a remount does not configure the same property twice. React strict mode
// double-invokes effects in development, which would otherwise double every page view there.
let configuredId: string | null = null;

export default function GoogleAnalytics({ measurementId, nonce }: { measurementId?: string; nonce?: string }) {
  const id = normalizeGaMeasurementId(measurementId);

  useEffect(() => {
    if (!id || configuredId === id) return;
    configuredId = id;

    const w = window as typeof window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
    const dataLayer = (w.dataLayer = w.dataLayer ?? []);
    // Pushes the arguments object, not an array of the arguments: that array-like shape is what
    // gtag.js recognises as a command. The cast is only so callers below type-check.
    const gtag = function gtag() {
      dataLayer.push(arguments);
    } as (...args: unknown[]) => void;

    // The usual global, so anything added later (a custom event, say) finds the API where every
    // GA guide says it is.
    w.gtag = w.gtag ?? gtag;

    gtag('js', new Date());
    // page_location and page_referrer are passed explicitly because the defaults gtag would read
    // for itself are the raw address bar and document.referrer, either of which can be an auth
    // URL holding a live token. Set on config, so every event the page sends inherits them.
    const referrer = redactSensitiveUrl(document.referrer);
    gtag('config', id, {
      page_location: redactSensitiveUrl(window.location.href),
      ...(referrer ? { page_referrer: referrer } : {}),
    });
  }, [id]);

  if (!id) return null;

  // nonce: the CSP is nonce-based, and while googletagmanager.com is also allowed by host, a
  // stamped script keeps working if that host allowance is ever tightened.
  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
      strategy="afterInteractive"
      nonce={nonce}
    />
  );
}
