import Link from 'next/link';
import { ChevronRight, Package, UserRound } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { descriptionSections, descriptionText } from '@/lib/books/description';
import { BuyPanel } from '@/components/books/store/BuyPanel';
import { PreviewBuyPanel } from '@/components/books/store/PreviewBuyPanel';
import { ShareProduct } from '@/components/books/store/ShareProduct';
import { MobileBuyBar } from '@/components/books/store/MobileBuyBar';
import { PriceTag } from '@/components/books/store/PriceTag';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';
import { CARD_SHADOW } from '@/components/books/store/card-style';
import { ProductCard } from '@/components/books/store/ProductCard';
import type { StoreBook, StoreBookDetail, StoreInstructor } from '@/lib/books/store';

/** The primary blue, for the buy buttons. */
const BLUE = '#3E93FF';
const SECTION = 'rounded-3xl bg-white p-5 sm:p-6';
const SECTION_TITLE = 'text-[22px] leading-7 font-bold tracking-tight';

/**
 * A product's page, laid out as:
 *   hero     cover, title, subtitle and topic tags on a plain gray
 *            page, then the price, Buy and the free sample (on phones a slim bar at the bottom keeps
 *            the price in reach once scrolled past)
 *   body     the description as one card per heading (About this product, What you will learn...),
 *            the account that created it (photo, bio, social links), sharing, then more products.
 *            No chapter list: the free sample shows the chapters itself.
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
  const sections = descriptionSections(book.description);
  // Topics and skills read as one set of tags: not every product teaches skills.
  const tags = [...new Map([...book.topics, ...book.skills].map(t => [t.trim().toLowerCase(), t.trim()])).values()].filter(Boolean).slice(0, 12);

  return (
    <>
    <div className="relative">
      <section className="relative max-w-[1080px] mx-auto px-4 sm:px-6 md:px-10 pt-5 sm:pt-8 pb-28 lg:pb-16">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm" style={{ color: '#64748b' }}>
          <Link href="/products" className="font-medium hover:underline" style={{ color: '#334155' }}>Digital products</Link>
          {book.category && <><ChevronRight className="w-3.5 h-3.5" /><span className="truncate">{book.category}</span></>}
        </nav>

        <div className="mt-5 sm:mt-6 space-y-8 sm:space-y-10">
          {/* Hero */}
          <header className="flex flex-col sm:flex-row gap-6 sm:gap-10 lg:gap-12 items-center">
            <BookCover book={book} primaryColor={primaryColor} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h1 className="text-[28px] leading-9 sm:text-[32px] sm:leading-10 lg:text-[36px] lg:leading-[44px] font-extrabold tracking-tight max-w-[20ch] sm:mx-0 mx-auto" style={{ color: '#0f172a' }}>{book.title}</h1>
              {book.subtitle && <p className="mt-3 text-base leading-6 max-w-[56ch]" style={{ color: '#475569' }}>{book.subtitle}</p>}
              {tags.length > 0 && (
                <ul className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2" aria-label="Topics">
                  {tags.map(t => (
                    <li key={t} className="inline-flex items-center rounded-full px-3 py-2 text-xs font-medium"
                      style={{ background: '#ffffff', color: '#475569', boxShadow: CARD_SHADOW }}>{t}</li>
                  ))}
                </ul>
              )}
              <div id="buy" className="mt-6 scroll-mt-24">
                {preview
                  ? <PreviewBuyPanel book={book} primaryColor={BLUE} />
                  : <BuyPanel primaryColor={BLUE}
                      book={{ id: book.id, slug: book.slug, format: book.format, free: book.free, prices: book.prices, hasSample: book.hasSample }} />}
              </div>
            </div>
          </header>

          {/* Body */}
          <div className="min-w-0 space-y-5">
            {sections.map(s => (
              <section key={s.title} className={SECTION} style={{ boxShadow: CARD_SHADOW }}>
                <h2 className={SECTION_TITLE} style={{ color: '#0f172a' }}>{s.title}</h2>
                {/* The editor's rich text, sanitized (lib/books/description.ts); older plain text is escaped. */}
                <div className="product-richtext mt-3" dangerouslySetInnerHTML={{ __html: s.html }} />
              </section>
            ))}
            <AboutInstructor instructor={book.instructor} authors={book.authors} />
            {/* Sharing a page that may not be live yet is left out of the preview. */}
            {!preview && (
              <section aria-label="Share" className={SECTION} style={{ boxShadow: CARD_SHADOW }}>
                <ShareProduct url={shareUrl} title={book.title} free={book.free} prices={book.prices}
                  blurb={book.subtitle?.trim() || descriptionText(book.description, 160) || `${book.title}, a digital product from ${appName}.`} />
              </section>
            )}
          </div>
        </div>

        {more.length > 0 && (
          <section aria-labelledby="more-heading" className="mt-10">
            <div className="flex items-end justify-between gap-3">
              <h2 id="more-heading" className="text-[22px] leading-7 font-bold tracking-tight" style={{ color: '#0f172a' }}>More digital products</h2>
              <Link href="/products" className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: '#0f172a' }}>
                See all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {more.slice(0, 3).map(b => <ProductCard key={b.id} book={b} />)}
            </div>
          </section>
        )}
      </section>
    </div>

    <MobileBuyBar title={book.title} free={book.free} prices={book.prices} primaryColor={BLUE} />
    </>
  );
}

/**
 * The product's cover: one flat card for every kind of product (book, template, prompt...), with a
 * soft neutral shadow. Without a cover image, the title on the brand color.
 */
function BookCover({ book, primaryColor }: { book: StoreBook; primaryColor: string }) {
  return (
    <div className="w-full shrink-0 sm:w-[320px] lg:w-[380px]">
      <div className="rounded-2xl overflow-hidden bg-white"
        style={{ aspectRatio: '16 / 9', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 14px 32px -16px rgba(15,23,42,0.28)' }}>
        {book.coverImage
          ? <img src={resolveCoverUrl(book.coverImage)} alt={`Cover of ${book.title}`} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex flex-col justify-between p-5" style={{ background: `linear-gradient(150deg, ${primaryColor}, color-mix(in srgb, ${primaryColor} 55%, #0f172a))` }}>
              <Package className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.85)' }} />
              <p className="font-bold text-base leading-6 line-clamp-4" style={{ color: '#ffffff' }}>{book.title}</p>
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * The account that created the product, from its own profile (Settings): photo, name, bio and
 * social links. Only if that account no longer exists are the product's author names shown instead.
 */
function AboutInstructor({ instructor, authors }: { instructor: StoreInstructor | null; authors: string[] }) {
  if (!instructor) {
    if (!authors.length) return null;
    return (
      <section aria-labelledby="instructor-heading" className={SECTION} style={{ boxShadow: CARD_SHADOW }}>
        <h2 id="instructor-heading" className={SECTION_TITLE} style={{ color: '#0f172a' }}>{authors.length > 1 ? 'About the authors' : 'About the author'}</h2>
        <p className="mt-3 text-base font-semibold" style={{ color: '#0f172a' }}>{authors.join(', ')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="instructor-heading" className={SECTION} style={{ boxShadow: CARD_SHADOW }}>
      <h2 id="instructor-heading" className={SECTION_TITLE} style={{ color: '#0f172a' }}>About the creator</h2>
      <div className="mt-5 flex flex-col sm:flex-row gap-5 sm:gap-6">
        {instructor.avatar
          ? <img src={resolveCoverUrl(instructor.avatar)} alt={instructor.name} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover shrink-0" />
          : (
            <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full shrink-0 inline-flex items-center justify-center"
              style={{ background: '#E8EEF0', color: '#64748b' }}><UserRound className="w-8 h-8" /></span>
          )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold" style={{ color: '#0f172a' }}>{instructor.name}</p>
          {instructor.bio && <p className="mt-2 text-base leading-6 whitespace-pre-line" style={{ color: '#475569' }}>{instructor.bio}</p>}
          {instructor.links.length > 0 && <InstructorLinks name={instructor.name} links={instructor.links} />}
        </div>
      </div>
    </section>
  );
}
