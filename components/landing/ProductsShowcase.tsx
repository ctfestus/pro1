'use client';

/**
 * The home page's "Digital Products" section: up to four of the newest products in the store, with
 * cover, title and price, and a link to the full store. Shown only when the store has products.
 * Colours come in as props because the page can be light or dark.
 */
import Link from 'next/link';
import { Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { PriceTag } from '@/components/books/store/PriceTag';
import { M3, GUTTER, SECTION_Y } from '@/components/landing/type';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';
import { SectionHeading } from '@/components/landing/SectionHeading';

export type LandingProduct = {
  id: string;
  slug: string;
  title: string;
  coverImage: string | null;
  free: boolean;
  prices: { currency: string; amount: number; original?: number }[];
  /** Shown as tags on the card, as many as fit. */
  topics: string[];
  /** beginner, intermediate or advanced, as stored. */
  difficulty: string | null;
};

export function ProductsShowcase({ products, dark, hFont, bFont }: {
  products: LandingProduct[];
  dark: boolean;
  hFont?: string;
  bFont?: string;
}) {
  if (!products.length) return null;
  const title = dark ? '#ffffff' : '#1C1D1F';
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#6E7383';

  return (
    <section id="section-products" className={SECTION_Y}>
      <div className={`max-w-[1240px] mx-auto ${GUTTER}`}>
        <SectionHeading title="Digital products" seeAll="/products" color={title} subColor={muted} hFont={hFont} bFont={bFont}
          sub="Practical guides and resources you can download and keep. Many have a free sample to read first." />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {products.slice(0, 4).map(p => (
            // The course card's style: a white card, the cover edge to edge, then title, price, tags and level.
            <Link key={p.id} href={`/products/${p.slug}`} className={FRAMED_CARD} style={{ background: dark ? '#1E1F26' : '#ffffff' }}>
              {/* The cover in the courses' shape, as on the learner's My Products. */}
              <div className="overflow-hidden flex items-center justify-center aspect-video" style={{ background: dark ? 'rgba(255,255,255,0.04)' : '#E8EEF0' }}>
                {p.coverImage
                  ? <img src={resolveCoverUrl(p.coverImage)} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
                  : <Package className="w-10 h-10" style={{ color: muted }} />}
              </div>
              <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-[18px]">
                <p className="line-clamp-2 text-[15px] leading-5 min-h-[40px]" style={{ fontWeight: 700, color: title, fontFamily: hFont }}>{p.title}</p>
                <div className="mt-1 text-sm font-bold" style={{ fontFamily: bFont }}>
                  {p.free ? <span style={{ color: '#16a34a' }}>Free</span> : <PriceTag prices={p.prices} style={{ color: title }} />}
                </div>
                <CardMeta tags={p.topics} level={p.difficulty ? p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1) : undefined}
                  isDark={dark} text={title} muted={muted} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
