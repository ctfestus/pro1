import type { Metadata } from 'next';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { listStoreBooksOrEmpty } from '@/lib/books/store';
import { listNavEvents } from '@/lib/events/store';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { ProductPreview } from '@/components/books/store/ProductPreview';

type Params = { params: Promise<{ id: string }> };

// Never indexed or shared: it shows drafts, to their author only.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return { title: `Preview | ${tenant.appName}`, robots: { index: false, follow: false } };
}

/**
 * The author's preview of a product's page, in the store's own chrome. The product itself is
 * loaded in the browser with the author's session (components/books/store/ProductPreview.tsx);
 * nothing about it is rendered here, so this page shows nobody else anything.
 */
export default async function ProductPreviewPage({ params }: Params) {
  const { id } = await params;
  const [site, tenant, programmes, books, navEvents] = await Promise.all([
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listStoreBooksOrEmpty(),
    listNavEvents(),
  ]);
  const config = resolveConfig(site.template, site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const accentColor = config.accentColor || tenant.accentColor || primaryColor;
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={accentColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      <ProductPreview id={id} more={books.slice(0, 5)} primaryColor={primaryColor} appName={tenant.appName} />
    </StoreChrome>
  );
}
