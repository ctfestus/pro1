import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, ChevronRight, FileText } from 'lucide-react';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { getStoreBook, listStoreBooksOrEmpty, type StoreBookDetail } from '@/lib/books/store';
import { formatLabel } from '@/lib/books/format';
import { descriptionHtml, descriptionText } from '@/lib/books/description';
import { productMetadata } from '@/lib/books/share';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { BuyPanel } from '@/components/books/store/BuyPanel';
import { ShareProduct } from '@/components/books/store/ShareProduct';
import { MobileBuyBar } from '@/components/books/store/MobileBuyBar';
import { PriceTag } from '@/components/books/store/PriceTag';
import type { StoreBook, StoreInstructor } from '@/lib/books/store';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';

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

/** White surfaces lifted off the gray page by a soft shadow (no borders). */
const CARD_SHADOW = '0 1px 2px rgba(15,23,42,0.04), 0 10px 30px -14px rgba(15,23,42,0.14)';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

/**
 * A product's public page, laid out as:
 *   hero     cover (as a 3D book), title, subtitle, format and topic tags on a plain gray page, then
 *            the price, Buy and the free sample (on phones a slim bar at the bottom keeps the price
 *            in reach once scrolled past)
 *   body     about (rich text), the instructor who created it (photo, bio, social links), then more products. No chapter list: the free sample shows the
 *            chapters itself.
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
  const accentColor = config.accentColor || tenant.accentColor || primaryColor;
  const navBooks = books.map(b => ({ id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage }));
  const format = formatLabel(book.format);
  const aboutHtml = descriptionHtml(book.description);
  // Absolute, from the tenant's own address, the same as the page's preview tags.
  const baseUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  const shareUrl = baseUrl ? `${baseUrl}/products/${encodeURIComponent(book.slug)}` : '';
  // Topics and skills read as one set of tags: not every product teaches skills.
  const tags = [...new Map([...book.topics, ...book.skills].map(t => [t.trim().toLowerCase(), t.trim()])).values()].filter(Boolean).slice(0, 12);
  const more = books.filter(b => b.id !== book.id).slice(0, 4);
  
  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={accentColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks}>
      <div className="relative">
        <section className="relative max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-6 sm:pt-10 pb-28 lg:pb-20">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm" style={{ color: '#64748b' }}>
            <Link href="/products" className="font-medium hover:underline" style={{ color: '#334155' }}>Digital Products</Link>
            {book.category && <><ChevronRight className="w-3.5 h-3.5" /><span className="truncate">{book.category}</span></>}
          </nav>

          <div className="mt-6 sm:mt-8 space-y-10 sm:space-y-14">
            {/* Hero */}
            <header className="flex flex-col sm:flex-row gap-7 sm:gap-12 lg:gap-16 items-center sm:items-start">
              <BookCover book={book} primaryColor={primaryColor} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <h1 className="text-[32px] leading-[1.1] sm:text-5xl sm:leading-[1.05] lg:text-[56px] font-extrabold tracking-tight max-w-[18ch] sm:mx-0 mx-auto" style={{ color: '#0f172a' }}>{book.title}</h1>
                {book.subtitle && <p className="mt-4 text-lg sm:text-xl leading-snug max-w-[56ch]" style={{ color: '#475569' }}>{book.subtitle}</p>}
                {(format || tags.length > 0) && (
                  <ul className="mt-5 flex flex-wrap justify-center sm:justify-start gap-2" aria-label="Format and topics">
                    {format && (
                      <li className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                        style={{ background: '#ffffff', color: '#0f172a', boxShadow: CARD_SHADOW }}>
                        <FileText className="w-4 h-4" style={{ color: primaryColor }} /> {format}
                      </li>
                    )}
                    {tags.map(t => (
                      <li key={t} className="inline-flex items-center rounded-full px-3.5 py-2 text-sm font-medium"
                        style={{ background: '#ffffff', color: '#475569', boxShadow: CARD_SHADOW }}>{t}</li>
                    ))}
                  </ul>
                )}
                <div id="buy" className="mt-8 scroll-mt-24">
                  <BuyPanel primaryColor={primaryColor}
                    book={{ id: book.id, slug: book.slug, format: book.format, free: book.free, prices: book.prices, hasSample: book.hasSample }} />
                </div>
                <ShareProduct url={shareUrl} title={book.title} free={book.free} prices={book.prices}
                  blurb={book.subtitle?.trim() || descriptionText(book.description, 160) || `${book.title}, a digital product from ${tenant.appName}.`} />
              </div>
            </header>


            {/* Body */}
            <div className="min-w-0 max-w-[960px] space-y-6">
              {aboutHtml && (
                <section aria-labelledby="about-heading" className="rounded-[28px] bg-white p-5 sm:p-7" style={{ boxShadow: CARD_SHADOW }}>
                  <h2 id="about-heading" className="text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>About this product</h2>
                  {/* The editor's rich text, sanitized (lib/books/description.ts); older plain text is escaped. */}
                  <div className="product-richtext mt-3 max-w-[70ch]" dangerouslySetInnerHTML={{ __html: aboutHtml }} />
                </section>
              )}

            </div>
          </div>

          <AboutInstructor instructor={book.instructor} authors={book.authors} primaryColor={primaryColor} />

          {more.length > 0 && (
            <section aria-labelledby="more-heading" className="mt-14">
              <div className="flex items-end justify-between gap-3">
                <h2 id="more-heading" className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>More digital products</h2>
                <Link href="/products" className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: primaryColor }}>
                  See all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {more.map(b => <MiniCard key={b.id} book={b} />)}
              </div>
            </section>
          )}
        </section>
      </div>

      <MobileBuyBar title={book.title} free={book.free} prices={book.prices} primaryColor={primaryColor} />
    </StoreChrome>
  );
}

/** The cover drawn as a standing book: a slight turn, a lit spine edge and a soft neutral shadow. */
function BookCover({ book, primaryColor }: { book: StoreBook; primaryColor: string }) {
  return (
    <div className="shrink-0 w-[190px] sm:w-[230px] lg:w-[270px]" style={{ perspective: '1400px' }}>
      <div className="relative rounded-r-2xl rounded-l-md overflow-hidden bg-white"
        style={{ aspectRatio: '3 / 4', transform: 'rotateY(-14deg) rotateX(2deg)', transformOrigin: 'left center',
          boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 14px 32px -16px rgba(15,23,42,0.28)' }}>
        {book.coverImage
          ? <img src={resolveCoverUrl(book.coverImage)} alt={`Cover of ${book.title}`} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex flex-col justify-between p-5" style={{ background: `linear-gradient(150deg, ${primaryColor}, color-mix(in srgb, ${primaryColor} 55%, #0f172a))` }}>
              <BookOpen className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.85)' }} />
              <p className="text-white font-bold text-lg leading-snug line-clamp-4">{book.title}</p>
            </div>
          )}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-3" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.22), rgba(255,255,255,0.18) 55%, transparent)' }} />
        <span aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.22), transparent 38%)' }} />
      </div>
    </div>
  );
}

function MiniCard({ book }: { book: StoreBook }) {
  return (
    <Link href={`/products/${book.slug}`} className="group rounded-3xl bg-white p-3 sm:p-4 flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-xl" style={{ boxShadow: CARD_SHADOW }}>
      <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ background: '#E8EEF0', aspectRatio: '3 / 4' }}>
        {book.coverImage
          ? <img src={resolveCoverUrl(book.coverImage)} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
          : <BookOpen className="w-10 h-10" style={{ color: '#94a3b8' }} />}
      </div>
      <p className="mt-3 text-sm sm:text-base font-semibold leading-snug line-clamp-2" style={{ color: '#0f172a' }}>{book.title}</p>
      {book.authors.length > 0 && <p className="text-xs mt-1 truncate" style={{ color: '#64748b' }}>{book.authors.join(', ')}</p>}
      <div className="mt-auto pt-3">
        {book.free
          ? <span className="text-sm font-bold" style={{ color: '#16a34a' }}>Free</span>
          : <PriceTag prices={book.prices} className="text-sm font-bold" style={{ color: '#0f172a' }} />}
      </div>
    </Link>
  );
}

/**
 * The account that created the product, from its own profile (Settings): photo, name, bio and
 * social links. Only if that account no longer exists are the product's author names shown instead.
 */
function AboutInstructor({ instructor, authors, primaryColor }: { instructor: StoreInstructor | null; authors: string[]; primaryColor: string }) {
  if (!instructor) {
    if (!authors.length) return null;
    return (
      <section aria-labelledby="instructor-heading" className="mt-10 sm:mt-14 max-w-[960px] rounded-[28px] bg-white p-5 sm:p-7" style={{ boxShadow: CARD_SHADOW }}>
        <h2 id="instructor-heading" className="text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>{authors.length > 1 ? 'About the authors' : 'About the author'}</h2>
        <p className="mt-3 text-[15px] font-semibold" style={{ color: '#0f172a' }}>{authors.join(', ')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="instructor-heading" className="mt-10 sm:mt-14 max-w-[960px] rounded-[28px] bg-white p-5 sm:p-7" style={{ boxShadow: CARD_SHADOW }}>
      <h2 id="instructor-heading" className="text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>About the creator</h2>
      <div className="mt-5 flex flex-col sm:flex-row gap-5 sm:gap-6">
        {instructor.avatar
          ? <img src={resolveCoverUrl(instructor.avatar)} alt={instructor.name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover shrink-0" />
          : (
            <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-full shrink-0 inline-flex items-center justify-center text-2xl font-bold"
              style={{ background: `color-mix(in srgb, ${primaryColor} 14%, #ffffff)`, color: primaryColor }}>{initials(instructor.name)}</span>
          )}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold" style={{ color: '#0f172a' }}>{instructor.name}</p>
          {instructor.bio && <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line max-w-[68ch]" style={{ color: '#475569' }}>{instructor.bio}</p>}
          {instructor.links.length > 0 && <InstructorLinks name={instructor.name} links={instructor.links} />}
        </div>
      </div>
    </section>
  );
}
