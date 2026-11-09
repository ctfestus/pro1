// Edge runtime SDK. This is the runtime middleware.ts executes in, so it covers
// the account-state gate and the CSP layer that run ahead of every request.
import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  SENTRY_TRACES_SAMPLE_RATE,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './sentry.shared';

Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  sendDefaultPii: false,

  // Request URLs can hold a working credential (an auth token_hash, a guest download link,
  // ?access=...); sendDefaultPii does not remove query strings, so they are redacted here.
  beforeSend: (event) => scrubSentryEvent(event as any),
  beforeSendTransaction: (event) => scrubSentryEvent(event as any),
  beforeBreadcrumb: (crumb) => scrubSentryBreadcrumb(crumb as any),
});
