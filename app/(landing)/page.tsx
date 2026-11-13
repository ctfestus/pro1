import type { Metadata } from 'next';
import LandingPageClient from '@/components/LandingPageClient';
import { getLandingPageData, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { listStoreBooksOrEmpty } from '@/lib/books/store';
import { listNavEvents } from '@/lib/events/store';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { resolveConfig } from '@/lib/site-templates';

type LandingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function cleanMetadataText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

export async function generateMetadata(): Promise<Metadata> {
  const [tenant, settings] = await Promise.all([
    getTenantSettings(),
    getLandingSiteSettingsOrDefault(),
  ]);
  const config = resolveConfig(settings.template, settings.config);
  const appName = tenant.appName || tenant.orgName || 'Learning platform';
  const offer = config.heroTitle || config.tracksHeading || config.offeringsHeading || '';
  const title = cleanMetadataText(offer ? `${appName} | ${offer}` : appName, 65);
  const description = cleanMetadataText(
    tenant.appDescription || `Build job-ready skills with courses, guided projects and learning paths from ${appName}.`,
    160,
  );
  const appUrl = normalizeAbsoluteBaseUrl(
    tenant.appUrl,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  );

  return {
    metadataBase: appUrl ? new URL(appUrl) : undefined,
    title,
    description,
    alternates: { canonical: appUrl || '/' },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: appUrl || '/',
      siteName: appName,
      title,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const [params, data, storeBooks, navEvents] = await Promise.all([
    searchParams,
    getLandingPageData(),
    listStoreBooksOrEmpty(),
    listNavEvents(),
  ]);
  const navBooks = storeBooks.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
  // The newest few for the home page's Digital Products section (display fields only).
  const storeProducts = storeBooks.slice(0, 4).map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage, free: b.free, prices: b.prices }));

  return (
    <LandingPageClient
      initialTemplateId={data.template}
      initialSiteConfig={data.config}
      initialProgrammes={data.programmes}
      programmesError={data.programmesError}
      navBooks={navBooks}
      navEvents={navEvents}
      storeProducts={storeProducts}
      isPreview={'_preview' in params}
    />
  );
}
