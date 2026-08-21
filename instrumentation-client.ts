// Browser SDK. Loaded by Next.js on every client navigation.
import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_DENY_URLS,
} from './sentry.shared';

Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  denyUrls: SENTRY_DENY_URLS,

  // Students are minors in some cohorts and every account carries real contact
  // details, so request headers, cookies, and IP addresses stay out of reports.
  // The SDK's own default is false; setting it explicitly stops a future
  // dependency bump or copied snippet from flipping it.
  sendDefaultPii: false,

  // Session Replay is deliberately NOT enabled. It records the DOM of whatever
  // the student was looking at, which here includes submitted work, grades, and
  // assignment answers. Enabling it would put that in a third-party service and
  // consume the replay quota on the same plan the error reports come out of.
});

// Reports client-side navigation as the span it belongs to, so an error is
// attributed to the route the student was moving to rather than the one they left.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
