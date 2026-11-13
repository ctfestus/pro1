import Link from 'next/link';
import { ChevronRight, FileText, Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { formatLabel } from '@/lib/books/format';
import { descriptionHtml, descriptionText } from '@/lib/books/description';
import { BuyPanel } from '@/components/books/store/BuyPanel';
import { PreviewBuyPanel } from '@/components/books/store/PreviewBuyPanel';
import { ShareProduct } from '@/components/books/store/ShareProduct';
import { MobileBuyBar } from '@/components/books/store/MobileBuyBar';
import { PriceTag } from '@/components/books/store/PriceTag';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';
import { CARD_SHADOW, initials } from '@/components/books/store/card-style';
import type { StoreBook, StoreBookDetail, StoreInstructor } from '@/lib/books/store';


/**
 * A product's page, laid out as:
 *   hero     cover (as a 3D book), type and format, title, subtitle and topic tags on a plain gray
 *            page, then the price, Buy and the free sample (on phones a slim bar at the bottom keeps
 *            the price in reach once scrolled past)
 *   body     about (rich text), the account that created it (photo, bio, social links), then more
 *            products. No chapter list: the free sample shows the chapters itself.
 *
 * Shared by the public page (app/products/[slug]) and the author's preview
 * (app/products/preview/[id]), so the preview is exactly what buyers get. In the preview the buy
 * area is a look-alike whose buttons do nothing, and sharing is left out.
 */
export function ProductPageView({ book, more, primaryColor, appName, shareUrl, preview = false }: {
  book: StoreBookDetail;
  more: StoreBook[];
  primaryColor: string;
  appName: string;
  shareUrl: string;
  preview?: boolean;
}) {
  const format = formatLabel(book.format);
  const aboutHtml = descriptionHtml(book.description);
  // Topics and skills read as one set of tags: not every product teaches skills.
  const tags = [...new Map([...book.topics, ...book.skills].map(t => [t.trim().toLowerCase(), t.trim()])).values()].filter(Boolean).slice(0, 12);

  return (
    <>
    <div className="relative">
      <section className="relative max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-5 sm:pt-8 pb-28 lg:pb-16">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm" style={{ color: '#64748b' }}>
          <Link href="/products" className="font-medium hover:underline" style={{ color: '#334155' }}>Digital Products</Link>
          {book.category && <><ChevronRight className="w-3.5 h-3.5" /><span className="truncate">{book.category}</span></>}
        </nav>

        <div className="mt-5 sm:mt-6 space-y-8 sm:space-y-10">
          {/* Hero */}
          <header className="flex flex-col sm:flex-row gap-6 sm:gap-10 lg:gap-12 items-center sm:items-start">
            <BookCover book={book} primaryColor={primaryColor} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              {/* What kind of product it is (migration 242) and its format, above the title. */}
              <p className="mb-3 flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1 text-[11px] sm:text-xs font-bold uppercase tracking-[0.14em]"
                style={{ color: '#0f172a' }}>
                <span>{book.productTypeLabel}</span>
                {format && (
                  <>
                    <span aria-hidden className="w-1 h-1 rounded-full" style={{ background: '#94a3b8' }} />
                    <span className="inline-flex items-center gap-1.5" style={{ color: '#475569' }}>
                      <FileText className="w-3.5 h-3.5" style={{ color: '#64748b' }} /> {format}
                    </span>
                  </>
                )}
              </p>
              <h1 className="text-[28px] leading-[1.15] sm:text-4xl sm:leading-[1.1] lg:text-[44px] font-extrabold tracking-tight max-w-[20ch] sm:mx-0 mx-auto" style={{ color: '#0f172a' }}>{book.title}</h1>
              {book.subtitle && <p className="mt-3 text-base sm:text-lg leading-snug max-w-[56ch]" style={{ color: '#475569' }}>{book.subtitle}</p>}
              {tags.length > 0 && (
                <ul className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2" aria-label="Topics">
                  {tags.map(t => (
                    <li key={t} className="inline-flex items-center rounded-full px-3 py-1.5 text-xs sm:text-[13px] font-medium"
                      style={{ background: '#ffffff', color: '#475569', boxShadow: CARD_SHADOW }}>{t}</li>
                  ))}
                </ul>
              )}
              <div id="buy" className="mt-6 scroll-mt-24">
                {preview
                  ? <PreviewBuyPanel book={book} primaryColor={primaryColor} />
                  : <BuyPanel primaryColor={primaryColor}
                      book={{ id: book.id, slug: book.slug, format: book.format, free: book.free, prices: book.prices, hasSample: book.hasSample }} />}
              </div>
              {/* Sharing a page that may not be live yet is left out of the preview. */}
              {!preview && (
                <ShareProduct url={shareUrl} title={book.title} free={book.free} prices={book.prices}
                  blurb={book.subtitle?.trim() || descriptionText(book.description, 160) || `${book.title}, a digital product from ${appName}.`} />
              )}
            </div>
          </header>


          {/* Body */}
          <div className="min-w-0 max-w-[960px] space-y-6">
            {aboutHtml && (
              <section aria-labelledby="about-heading" className="rounded-3xl bg-white p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
                <h2 id="about-heading" className="text-lg font-bold tracking-tight" style={{ color: '#0f172a' }}>About this product</h2>
                {/* The editor's rich text, sanitized (lib/books/description.ts); older plain text is escaped. */}
                <div className="product-richtext mt-3 max-w-[70ch]" dangerouslySetInnerHTML={{ __html: aboutHtml }} />
              </section>
            )}

          </div>
        </div>

        <AboutInstructor instructor={book.instructor} authors={book.authors} primaryColor={primaryColor} />

        {more.length > 0 && (
          <section aria-labelledby="more-heading" className="mt-10">
            <div className="flex items-end justify-between gap-3">
              <h2 id="more-heading" className="text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>More digital products</h2>
              <Link href="/products" className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: '#0f172a' }}>
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
    </>
  );
}

/**
 * The product's cover: one flat card for every kind of product (book, template, prompt...), with a
 * soft neutral shadow. Without a cover image, the title on the brand color.
 */
function BookCover({ book, primaryColor }: { book: StoreBook; primaryColor: string }) {
  return (
    <div className="shrink-0 w-[160px] sm:w-[200px] lg:w-[230px]">
      <div className="rounded-2xl overflow-hidden bg-white"
        style={{ aspectRatio: '3 / 4', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 14px 32px -16px rgba(15,23,42,0.28)' }}>
        {book.coverImage
          ? <img src={resolveCoverUrl(book.coverImage)} alt={`Cover of ${book.title}`} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex flex-col justify-between p-5" style={{ background: `linear-gradient(150deg, ${primaryColor}, color-mix(in srgb, ${primaryColor} 55%, #0f172a))` }}>
              <Package className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.85)' }} />
              <p className="font-bold text-lg leading-snug line-clamp-4" style={{ color: '#ffffff' }}>{book.title}</p>
            </div>
          )}
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
          : <Package className="w-10 h-10" style={{ color: '#94a3b8' }} />}
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
      <section aria-labelledby="instructor-heading" className="mt-8 sm:mt-10 max-w-[960px] rounded-3xl bg-white p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
        <h2 id="instructor-heading" className="text-lg font-bold tracking-tight" style={{ color: '#0f172a' }}>{authors.length > 1 ? 'About the authors' : 'About the author'}</h2>
        <p className="mt-3 text-[15px] font-semibold" style={{ color: '#0f172a' }}>{authors.join(', ')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="instructor-heading" className="mt-8 sm:mt-10 max-w-[960px] rounded-3xl bg-white p-5 sm:p-6" style={{ boxShadow: CARD_SHADOW }}>
      <h2 id="instructor-heading" className="text-lg font-bold tracking-tight" style={{ color: '#0f172a' }}>About the creator</h2>
      <div className="mt-5 flex flex-col sm:flex-row gap-5 sm:gap-6">
        {instructor.avatar
          ? <img src={resolveCoverUrl(instructor.avatar)} alt={instructor.name} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover shrink-0" />
          : (
            <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full shrink-0 inline-flex items-center justify-center text-2xl font-bold"
              style={{ background: '#E8EEF0', color: '#334155' }}>{initials(instructor.name)}</span>
          )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold" style={{ color: '#0f172a' }}>{instructor.name}</p>
          {instructor.bio && <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line max-w-[68ch]" style={{ color: '#475569' }}>{instructor.bio}</p>}
          {instructor.links.length > 0 && <InstructorLinks name={instructor.name} links={instructor.links} />}
        </div>
      </div>
    </section>
  );
}
