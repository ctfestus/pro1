// Node runtime SDK: route handlers, server components, and the cron jobs.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE } from './sentry.shared';

Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,

  // Server-side reports would otherwise carry request headers, which on this
  // platform means the Authorization bearer token and the Supabase session cookie.
  sendDefaultPii: false,
});
