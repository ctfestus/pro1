/**
 * One place for the Sentry options that must match across the three runtimes
 * (browser, Node server, Edge middleware). Each runtime still calls Sentry.init
 * in its own file -- that is the layout the SDK requires -- but the shared
 * decisions live here so they cannot drift apart.
 *
 * DSN comes from the environment and is never hardcoded: this platform is
 * multi-tenant, and a baked-in DSN would send one tenant's errors to another
 * tenant's project. With no DSN set the SDK initialises disabled and sends
 * nothing, which is what local development and any unconfigured deploy get.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

// Vercel distinguishes production from preview; NODE_ENV cannot. SENTRY_DEPLOY_ENV is
// next.config.ts's build-time copy of VERCEL_ENV, which is server-only and so reads as
// undefined in the browser -- without that copy this line silently degrades to NODE_ENV
// on the client and preview errors arrive labelled production. Read the copy, never
// VERCEL_ENV directly: inlining that name would freeze the cron auth gates that depend
// on it into build-time constants.
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
  || process.env.SENTRY_DEPLOY_ENV
  || process.env.NODE_ENV
  || 'development';

/**
 * Tracing is OFF by default. It is metered separately from errors on every
 * Sentry plan and it samples EVERY request, so leaving it on quietly consumes
 * the transaction quota that error reports need. Turn it on deliberately, for a
 * bounded window, when investigating latency:
 *
 *     NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
 */
export const SENTRY_TRACES_SAMPLE_RATE = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0;
})();

/**
 * Browser extensions throw inside pages they have injected themselves into, and
 * those frames are attributed to this app. They are unactionable and they are
 * the single largest source of wasted error quota on a public site.
 */
export const SENTRY_DENY_URLS = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-(web-)?extension:\/\//i,
];
