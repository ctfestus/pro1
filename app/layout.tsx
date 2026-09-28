import type { CSSProperties } from 'react';
import type { Metadata, Viewport } from 'next';
/* eslint-disable @next/next/no-page-custom-font -- Google Sans Text and the admin-selected Google Font are not available through next/font. */
import { Inter, Playfair_Display, JetBrains_Mono, Lato } from 'next/font/google';
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
import GoogleAnalytics from '@/components/GoogleAnalytics';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
// preload: false -- these fonts are only used when a form creator picks serif/mono
// so they shouldn't block every page load
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-serif', preload: false });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', preload: false });
const lato = Lato({ subsets: ['latin'], weight: ['400', '700', '900'], variable: '--font-lato', preload: false });

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
  const siteConfig = resolveConfig(site.template, site.config);
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
  const platformFontStyle = {
    '--platform-heading-font': selectedFontFamily(branding.headingFont),
    '--platform-body-font': selectedFontFamily(branding.bodyFont),
  } as CSSProperties;

  return (
    <html lang="en" nonce={nonce} className={`${inter.variable} ${playfair.variable} ${jetbrainsMono.variable} ${lato.variable}`} suppressHydrationWarning>
      <head>
        {/* Google Sans Text is not exposed by next/font. The other links load only when selected in Site Settings. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Text:wght@400;500;700&display=swap" />
        {selectedFontUrls.map(url => <link key={url} rel="stylesheet" href={url} />)}
      </head>
      <body nonce={nonce} style={platformFontStyle} suppressHydrationWarning>
        <GoogleAnalytics measurementId={tenantSettings.googleAnalyticsId} nonce={nonce} />
        <NavigationProgress />
        <TenantProvider initialSettings={branding}>
          <ThemeProvider>
            <SessionInactivityGuard />
            <ServiceWorkerRegistrar />
            <InstallAppButton />
            {children}
          </ThemeProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
