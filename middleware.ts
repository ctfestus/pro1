import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import {
  restrictionFor,
  isPathOpenTo,
  redirectPathFor,
  denialMessageFor,
} from '@/lib/account-state';
import { SESSION_LOOKUP_FREE_API_PATH_SET } from '@/lib/middleware-session-policy';

// App routes that must never be iframed
const APP_ROUTE = /^\/(dashboard|settings|create|admin|auth|onboarding|student)/;

function hasSupabaseSessionCookie(req: NextRequest): boolean {
  return req.cookies.getAll().some(({ name }) =>
    name === 'supabase-auth-token'
      || (name.startsWith('sb-') && name.includes('-auth-token')),
  );
}

function needsSessionLookup(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return false;
  if (SESSION_LOOKUP_FREE_API_PATH_SET.has(pathname)) return false;
  return hasSupabaseSessionCookie(req);
}

// The browser SDK POSTs error reports to the DSN's own host, which this CSP would
// otherwise block -- silently, since a blocked report cannot report itself. Derived
// from the DSN so a region-specific or self-hosted ingest host needs no second
// variable, and so an unconfigured deploy widens the policy by nothing at all.
const sentryIngest = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return '';
  try { return ` ${new URL(dsn).origin}`; } catch { return ''; }
})();

const isDev = process.env.NODE_ENV === 'development';

// Web Crypto API -- available in Edge runtime (no Node.js crypto needed)
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function middleware(req: NextRequest) {
  // Fallback: if a code lands on the root (Supabase fell back to the site URL),
  // send it to the callback Route Handler so it can exchange the code properly.
  const authCode = req.nextUrl.searchParams.get('code');
  if (authCode && req.nextUrl.pathname === '/') {
    const dest = new URL('/auth/callback', req.url);
    dest.searchParams.set('code', authCode);
    // The code reached the Site URL because Supabase could not use a more specific
    // redirect. After exchange, the callback can safely distinguish an established
    // account recovering its password from a pending signup completing admission.
    dest.searchParams.set('site_fallback', '1');
    return NextResponse.redirect(dest);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://*.supabase.co';
  const isAppRoute  = APP_ROUTE.test(req.nextUrl.pathname);

  // Generate a unique cryptographic nonce per request.
  // Next.js reads the x-nonce request header and stamps it onto its inline scripts,
  // replacing the need for unsafe-inline in production.
  const nonce = generateNonce();

  const csp = [
    "default-src 'self'",

    // Production: nonce-only -- no unsafe-inline, no unsafe-eval.
    // Development: add unsafe-eval for HMR/webpack dev runtime.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://challenges.cloudflare.com`
      : `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://challenges.cloudflare.com`,

    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src https: data: blob:",
    `connect-src 'self' ${supabaseUrl} https://*.supabase.co https://api.resend.com wss://*.supabase.co https://cdn.jsdelivr.net https://challenges.cloudflare.com https://raw.githubusercontent.com https://api.brandfetch.io${sentryIngest}`,
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    // Allow <audio>/<video> from any https source (Supabase Storage, Cloudinary, and
    // author-pasted media URLs). Mirrors the permissive img-src https: policy.
    "media-src 'self' blob: https:",
    "frame-src 'self' blob: https://www.youtube.com https://player.vimeo.com https://iframe.mediadelivery.net https://player.mediadelivery.net https://video.bunnycdn.com https://www.canva.com https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isAppRoute ? ["frame-ancestors 'none'"] : []),
  ].join('; ');

  // Build request headers with nonce so Next.js stamps it onto inline scripts
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  let res = NextResponse.next({ request: { headers: requestHeaders } });

  if (needsSessionLookup(req)) {
    // Refresh authenticated sessions only where the request actually needs the account
    // gate. Anonymous traffic and the setup flow no longer turn into remote Auth calls.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll(cookiesToSet) {
            // Recreate the response so updated session cookies are sent to the browser
            res = NextResponse.next({ request: { headers: requestHeaders } });
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    let authedUser: { app_metadata?: unknown } | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      authedUser = data.user;
    } catch { /* session refresh failed -- continue */ }

    // Account restrictions are enforced platform-wide, from the session. Bearer-only
    // API calls are enforced independently at the shared boundary in lib/api-auth.
    const restriction = restrictionFor(authedUser);
    if (restriction !== 'none' && !isPathOpenTo(restriction, req.nextUrl.pathname)) {
      return req.nextUrl.pathname.startsWith('/api/')
        ? NextResponse.json({ error: denialMessageFor(restriction) }, { status: 403 })
        : NextResponse.redirect(new URL(redirectPathFor(restriction), req.url));
    }
  }

  // The HTML-embed proxy sets its own CSP (sandbox) on instructor-uploaded
  // pages; the app CSP's nonce-based script-src would block their inline
  // scripts, and two CSP headers enforce the intersection of both.
  if (req.nextUrl.pathname !== '/api/html-embed') {
    res.headers.set('Content-Security-Policy', nonce ? csp : '');
  }
  return res;
}

export const config = {
  matcher: [
    // Run on application routes, not Next.js internals or browser-requested assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|map|txt|xml|webmanifest|woff2?|ttf|eot)$).*)',
  ],
};
