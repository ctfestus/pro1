import type { CSSProperties } from 'react';
import type { Metadata, Viewport } from 'next';
/* eslint-disable @next/next/no-page-custom-font -- Google Sans Text and the admin-selected Google Font are not available through next/font. */
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import './globals.css';
import ThemeProvider from '@/components/ThemeProvider';
import NavigationProgress from '@/components/NavigationProgress';
import SessionInactivityGuard from '@/components/SessionInactivityGuard';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { resolveConfig } from '@/lib/site-templates';
import { TenantProvider } from '@/components/TenantProvider';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import InstallAppButton from '@/components/InstallAppButton';
import AuthPopupHost from '@/components/AuthPopupHost';
import GoogleAnalytics from '@/components/GoogleAnalytics';

// The fonts are files in app/fonts, not fetched from Google at build time: next/font/google
// downloads them on every build, and a bad answer from Google failed the build. Same fonts,
// latin subset, the variable ones covering every weight.
const inter = localFont({ src: './fonts/inter-latin-wght-normal.woff2', weight: '100 900', variable: '--font-sans', display: 'swap' });
// preload: false -- these fonts are only used when a form creator picks serif/mono
// so they shouldn't block every page load
const playfair = localFont({ src: './fonts/playfair-display-latin-wght-normal.woff2', weight: '400 900', variable: '--font-serif', display: 'swap', preload: false });
const jetbrainsMono = localFont({ src: './fonts/jetbrains-mono-latin-wght-normal.woff2', weight: '100 800', variable: '--font-mono', display: 'swap', preload: false });
const lato = localFont({
  src: [
    { path: './fonts/lato-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/lato-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/lato-latin-900-normal.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-lato', display: 'swap', preload: false,
});
// The heading font (--font-display, DISPLAY_FONT): Lato, from the same files as --font-lato, so the
// browser downloads them once. (It was Space Grotesk until 2026-11-22.)
const displayFont = localFont({
  src: [
    { path: './fonts/lato-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/lato-latin-900-normal.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-display', display: 'swap', preload: false,
});

function selectedFontFamily(fontName: string): string {
  const safeName = fontName.replace(/[;'"\\]/g, '').trim();
  if (!safeName || safeName === 'Inter') return 'var(--font-sans), sans-serif';
  return `'${safeName}', var(--font-sans), sans-serif`;
}

function selectedFontUrl(fontName: string): string | null {
  const safeName = fontName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!safeName || safeName === 'Inter' || safeName === 'Google Sans Text') return null;
  return `https://fonts.googleapis.com/css2?family=${safeName.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`;
}

export async function generateViewport(): Promise<Viewport> {
  const t = await getTenantSettings();
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: t.brandColor,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTenantSettings();
  return {
    title: t.appName,
    description: t.appDescription || t.appName,
    icons: {
      icon: t.faviconUrl,
      shortcut: t.faviconUrl,
      apple: t.faviconUrl,
    },
    // Standalone launch on iOS (Add to Home Screen), where the web manifest is ignored.
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: t.appName,
    },
  };
}

// Async server component so we can read the per-request nonce set by middleware.
// Next.js uses the nonce on the <html> element to stamp its own inline bootstrap
// scripts, satisfying the nonce-based CSP without needing unsafe-inline.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [headerStore, tenantSettings, site] = await Promise.all([
    headers(),
    getTenantSettings(),
    getLandingSiteSettingsOrDefault(),
  ]);
  const nonce = headerStore.get('x-nonce') ?? '';

  // The brand colours an admin actually sets live in Site settings, which is what the landing and
  // pricing pages read. getTenantSettings() maps primaryColor/accentColor from platform_settings,
  // which has no such columns, so it always fell through to the library default -- and every
  // C.cta in the app rendered #2563eb rather than the configured colour, while the pricing hero
  // beside it rendered the real one. One source, resolved the same way the pricing page resolves
  // it, so template defaults still apply when a tenant has saved no colour of its own.
  const siteConfig = resolveConfig(site.config);
  const branding = {
    ...tenantSettings,
    primaryColor: siteConfig.primaryColor || tenantSettings.primaryColor,
    accentColor:  siteConfig.accentColor  || tenantSettings.accentColor,
    headingFont: siteConfig.headingFont,
    bodyFont: siteConfig.bodyFont,
  };
  const selectedFontUrls = [...new Set([
    selectedFontUrl(branding.headingFont),
    selectedFontUrl(branding.bodyFont),
  ].filter((value): value is string => Boolean(value)))];
  // A heading font picked in Site settings replaces Lato everywhere the code uses --font-display.
  // Inter is the saved default and Lato is the code's own, so either (or nothing) keeps Lato.
  const pickedHeadingFont = branding.headingFont.replace(/[;'"\\]/g, '').trim();
  const platformFontStyle = {
    '--platform-heading-font': selectedFontFamily(branding.headingFont),
    '--platform-body-font': selectedFontFamily(branding.bodyFont),
    ...(pickedHeadingFont && pickedHeadingFont !== 'Inter' && pickedHeadingFont !== 'Lato' ? { '--font-display': selectedFontFamily(pickedHeadingFont) } : {}),
  } as CSSProperties;

  return (
    <html lang="en" nonce={nonce} className={`${inter.variable} ${playfair.variable} ${jetbrainsMono.variable} ${lato.variable} ${displayFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Google Sans Text is not exposed by next/font. The other links load only when selected in Site Settings. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Text:wght@400;500;700&display=swap" />
        {selectedFontUrls.map(url => <link key={url} rel="stylesheet" href={url} />)}
      </head>
      <body nonce={nonce} className="platform-font-scope" style={platformFontStyle} suppressHydrationWarning>
        <GoogleAnalytics measurementId={tenantSettings.googleAnalyticsId} nonce={nonce} />
        <NavigationProgress />
        <TenantProvider initialSettings={branding}>
          <ThemeProvider>
            <SessionInactivityGuard />
            <ServiceWorkerRegistrar />
            <InstallAppButton />
            <AuthPopupHost />
            {children}
          </ThemeProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
