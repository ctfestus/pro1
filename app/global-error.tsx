'use client';

/**
 * Last-resort boundary for errors thrown in the root layout itself. Next.js
 * renders this INSTEAD of the layout, so globals.css, ThemeProvider, and the
 * tenant context are all unavailable here -- every style has to be inline and
 * every string has to be tenant-neutral.
 *
 * Its job is to report the error and offer a way out. Anything more elaborate
 * risks throwing inside the handler for a throw.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#475569', margin: '0 0 20px' }}>
              This page could not load. The problem has been reported. You can try again,
              and if it keeps happening please contact support.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ padding: '10px 20px', fontSize: 14, fontWeight: 500, color: '#ffffff', background: '#0f172a', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              Try again
            </button>
            {error.digest && (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '20px 0 0' }}>
                Reference: {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
