import type { Metadata } from 'next';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { listStoreBooksOrEmpty } from '@/lib/books/store';
import { listNavEvents } from '@/lib/events/store';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { BookCatalogue } from '@/components/books/store/BookCatalogue';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return {
    title: `Digital Products - ${tenant.appName}`,
    description: 'Practical guides and resources you can preview for free, buy once and download to keep.',
  };
}

/**
 * The public book store. Rendered on the server (books come from lib/books/store.ts, cached for a
 * minute and refreshed on every book save) so it can be shared and indexed; search and category
 * filters run in the browser.
 */
export default async function BooksStorePage() {
  const [books, site, tenant, programmes, navEvents] = await Promise.all([
    listStoreBooksOrEmpty(),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listNavEvents(),
  ]);
  const config = resolveConfig(site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      <section className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-10 sm:pt-14 pb-16">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: '#0f172a' }}>Digital products</h1>
        <p className="mt-3 max-w-2xl text-base" style={{ color: '#475569' }}>
          Practical guides and resources. Pay once, then download them and keep them; many have a free sample to read first.
        </p>
        <div className="mt-8">
          <BookCatalogue books={books} />
        </div>
      </section>
    </StoreChrome>
  );
}
