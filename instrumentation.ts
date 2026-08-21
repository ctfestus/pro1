import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Catches errors thrown out of route handlers and server components. Routes that
// catch their own errors and return a 500 body do NOT reach this hook -- those
// still need an explicit Sentry.captureException where they log.
export const onRequestError = Sentry.captureRequestError;
