import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { getStoreBook, listStoreBooksOrEmpty, type StoreBookDetail } from '@/lib/books/store';
import { productMetadata } from '@/lib/books/share';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { ProductPageView } from '@/components/books/store/ProductPageView';

type Params = { params: Promise<{ slug: string }> };

/** A lookup failure shows "not found" rather than an error page. */
async function findBook(slug: string): Promise<StoreBookDetail | null> {
  try {
    return await getStoreBook(slug);
  } catch (e: any) {
    console.error('[books/page] lookup failed', e?.message ?? e);
    return null;
  }
}


export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [book, tenant] = await Promise.all([findBook(slug), getTenantSettings()]);
  if (!book) return { title: tenant.appName };
  const appUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  return productMetadata(book, tenant.appName, appUrl);
}

/**
 * A product's public page (the layout is components/books/store/ProductPageView.tsx, shared with the
 * author's preview). Everything here comes from lib/books/store.ts, which only returns books the
 * public may buy or download and never a file path. Drafts, cohort-only and unknown books are a 404.
 */
export default async function BookStorePage({ params }: Params) {
  const { slug } = await params;
  const [book, site, tenant, programmes, books] = await Promise.all([
    findBook(slug),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listStoreBooksOrEmpty(),
  ]);
  if (!book) notFound();
  const config = resolveConfig(site.template, site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const accentColor = config.accentColor || tenant.accentColor || primaryColor;
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
  // Absolute, from the tenant's own address, the same as the page's preview tags.
  const baseUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  const shareUrl = baseUrl ? `${baseUrl}/products/${encodeURIComponent(book.slug)}` : '';
  const more = books.filter(b => b.id !== book.id).slice(0, 4);

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={accentColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks}>
      <ProductPageView book={book} more={more} primaryColor={primaryColor} appName={tenant.appName} shareUrl={shareUrl} />
    </StoreChrome>
  );
}
