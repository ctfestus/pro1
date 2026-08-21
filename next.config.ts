import type {NextConfig} from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// CSP is set per-request in middleware.ts using a cryptographic nonce.
// Only non-CSP security headers are defined here.

const commonHeaders = [
  { key: 'X-Content-Type-Options',  value: 'nosniff' },
  { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

// Public pages -- embeddable
const publicHeaders = [
  ...commonHeaders,
];

// App/auth routes -- never embeddable
const appHeaders = [
  ...commonHeaders,
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['@duckdb/duckdb-wasm'],
  // Expose the (non-secret) Cloudinary cloud name to the browser bundle under its own name, so
  // covers stored as bare public_ids resolve client-side using the SAME CLOUDINARY_CLOUD_NAME the
  // server uses -- no separate NEXT_PUBLIC_ variable to set or keep in sync.
  env: {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  },
  async redirects() {
    return [
      { source: '/favicon.ico', destination: 'https://jbdfdxqvdaztmlzaxxtk.supabase.co/storage/v1/object/public/Assets/brand_assets/powered%20by%20FestMan%20(1).png', permanent: false },
    ];
  },
  async headers() {
    return [
      // Public routes -- embeddable, no frame-ancestors restriction
      { source: '/(.*)', headers: publicHeaders },
      // App routes override with stricter CSP + clickjack protection
      { source: '/dashboard/:path*', headers: appHeaders },
      { source: '/settings/:path*',  headers: appHeaders },
      { source: '/create/:path*',    headers: appHeaders },
      { source: '/admin/:path*',     headers: appHeaders },
      { source: '/auth/:path*',       headers: appHeaders },
      { source: '/onboarding/:path*', headers: appHeaders },
      { source: '/onboarding',        headers: appHeaders },
    ];
  },
  reactStrictMode: true,
  eslint: {
    // Run ESLint during `next build`. The lint is clean of errors (only warnings remain,
    // which do not fail the build), so this is a guardrail against new error-level violations.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

// Sentry wraps the build to upload source maps, so a minified production stack trace
// resolves back to real files and line numbers. org and project come from the
// environment rather than being hardcoded, because this codebase is deployed per
// tenant and each tenant reports to its own Sentry project.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload needs a write token that only CI and the deploy environment
  // hold. Disabling it locally keeps 'npm run build' quiet on a dev machine instead
  // of warning about a missing credential on every run.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  // Uploads a wider set of client maps, which is what makes browser stack traces
  // readable rather than a list of chunk hashes.
  widenClientFileUpload: true,

  silent: !process.env.CI,
  telemetry: false,
});
