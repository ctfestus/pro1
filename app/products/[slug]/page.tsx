import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BookOpen, Check } from 'lucide-react';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { resolveCoverUrl, socialImageUrl } from '@/lib/cloudinary-url';
import { getStoreBook, listStoreBooksOrEmpty, type StoreBookDetail } from '@/lib/books/store';
import { fileSizeLabel, formatLabel } from '@/lib/books/format';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { BuyPanel } from '@/components/books/store/BuyPanel';

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

function plainText(value: string | null, max: number): string {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [book, tenant] = await Promise.all([findBook(slug), getTenantSettings()]);
  if (!book) return { title: tenant.appName };
  const appUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  const cover = book.coverImage && !book.coverImage.startsWith('data:') ? socialImageUrl(book.coverImage) : '';
  const image = cover || (appUrl ? `${appUrl}/api/og/brand` : '');
  const description = plainText(book.subtitle || book.description, 200) || `${book.title}, a digital product from ${tenant.appName}.`;
  const title = `${book.title} - ${tenant.appName}`;
  return {
    title,
    description,
    openGraph: { title, description, siteName: tenant.appName, type: 'book', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(image ? { images: [image] } : {}) },
  };
}

/**
 * A book's public page: what it is, what is inside, its price, the free sample and the Buy button.
 * Everything here comes from lib/books/store.ts, which only returns books the public may buy or
 * download and never a file path. Drafts, cohort-only and unknown books are a 404.
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
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
  const facts = [
    formatLabel(book.format),
    fileSizeLabel(book.fileSize),
    book.estimatedMinutes ? `About ${Math.max(1, Math.round(book.estimatedMinutes / 60))} hours of reading` : '',
    book.difficulty ? book.difficulty[0].toUpperCase() + book.difficulty.slice(1) : '',
  ].filter(Boolean);
  const tags = [...new Set([...book.topics, ...book.skills])].slice(0, 12);
  const sampleCount = book.chapters.filter(c => c.inSample).length;

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={config.accentColor || tenant.accentColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks}>
      <section className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-8 sm:pt-12 pb-16">
        <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: '#475569' }}>
          <ArrowLeft className="w-4 h-4" /> All products
        </Link>

        <div className="mt-6 grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,320px)] items-start">
          <div className="rounded-3xl overflow-hidden flex items-center justify-center bg-white max-w-[340px] w-full mx-auto lg:mx-0" style={{ aspectRatio: '3 / 4' }}>
            {book.coverImage
              ? <img src={resolveCoverUrl(book.coverImage)} alt={`Cover of ${book.title}`} className="w-full h-full object-cover" />
              : <BookOpen className="w-14 h-14" style={{ color: '#94a3b8' }} />}
          </div>

          <div className="min-w-0 lg:order-none order-last">
            {book.category && <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: primaryColor }}>{book.category}</p>}
            <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: '#0f172a' }}>{book.title}</h1>
            {book.subtitle && <p className="mt-2 text-lg" style={{ color: '#475569' }}>{book.subtitle}</p>}
            {book.authors.length > 0 && <p className="mt-3 text-sm" style={{ color: '#334155' }}>By {book.authors.join(', ')}</p>}
            {facts.length > 0 && <p className="mt-2 text-xs" style={{ color: '#64748b' }}>{facts.join(' / ')}</p>}

            {book.description && (
              // Plain text from the editor's description box; React escapes it, line breaks are kept.
              <div className="mt-6 text-[15px] leading-relaxed whitespace-pre-line" style={{ color: '#334155' }}>{book.description}</div>
            )}

            {tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {tags.map(t => <span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-white" style={{ color: '#475569' }}>{t}</span>)}
              </div>
            )}

            {book.chapters.length > 0 && (
              <div className="mt-8 rounded-3xl bg-white p-5 sm:p-6">
                <h2 className="text-base font-bold" style={{ color: '#0f172a' }}>What is inside</h2>
                {sampleCount > 0 && (
                  <p className="mt-1 text-xs" style={{ color: '#64748b' }}>The free sample includes the first {sampleCount === 1 ? 'chapter' : `${sampleCount} chapters`}.</p>
                )}
                <ol className="mt-4 space-y-2.5">
                  {book.chapters.map((c, i) => (
                    <li key={`${i}-${c.title}`} className="flex items-start gap-3 text-sm">
                      <span className="w-6 shrink-0 text-right tabular-nums" style={{ color: '#94a3b8' }}>{i + 1}</span>
                      <span className="flex-1 min-w-0" style={{ color: '#334155' }}>{c.title}</span>
                      {c.inSample && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: '#ffffff', color: '#16a34a', boxShadow: 'inset 0 0 0 1px #bbf7d0' }}>
                          <Check className="w-3 h-3" /> Free sample
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-24 w-full max-w-[420px] mx-auto lg:mx-0">
            <BuyPanel primaryColor={primaryColor}
              book={{ id: book.id, slug: book.slug, format: book.format, free: book.free, prices: book.prices, hasSample: book.hasSample }} />
          </div>
        </div>
      </section>
    </StoreChrome>
  );
}
