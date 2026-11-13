import type { Metadata } from 'next';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { listStoreBooksOrEmpty } from '@/lib/books/store';
import { listNavEvents } from '@/lib/events/store';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { GuestDownload } from '@/components/books/store/GuestDownload';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  // The link carries the buyer's access: never indexed, never sent on as a referrer.
  return { title: `Your download - ${tenant.appName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * Where a guest buyer's links lead (the receipt email, and the product page after paying). Opening
 * the page uses nothing; the Download button takes one of the purchase's five downloads.
 */
export default async function GuestDownloadPage({ searchParams }: { searchParams: Promise<{ access?: string }> }) {
  const [{ access }, site, tenant, programmes, books, navEvents] = await Promise.all([
    searchParams,
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listStoreBooksOrEmpty(),
    listNavEvents(),
  ]);
  const config = resolveConfig(site.template, site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={config.accentColor || tenant.accentColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      <section className="max-w-[720px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-20">
        <GuestDownload access={typeof access === 'string' ? access : ''} primaryColor={primaryColor} />
      </section>
    </StoreChrome>
  );
}
