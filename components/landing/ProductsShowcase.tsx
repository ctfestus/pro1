'use client';

/**
 * The home page's "Digital Products" section: up to four of the newest products in the store, with
 * cover, title and price, and a link to the full store. Shown only when the store has products.
 * Colours come in as props because the page can be light or dark.
 */
import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { PriceTag } from '@/components/books/store/PriceTag';
import { M3, GUTTER, SECTION_Y } from '@/components/landing/type';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';

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
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 style={{ ...M3.headlineSmall, fontWeight: 700, color: title, fontFamily: hFont }}>Digital products</h2>
            <p className="mt-2 max-w-xl" style={{ ...M3.bodyLarge, color: muted, fontFamily: bFont }}>
              Practical guides and resources you can download and keep. Read a free sample first.
            </p>
          </div>
          <Link href="/products" className="inline-flex items-center gap-2 hover:opacity-70 transition-opacity" style={{ ...M3.labelLarge, fontWeight: 600, color: title, fontFamily: bFont }}>
            See all products <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {products.slice(0, 4).map(p => (
            // The course card's style: a white card, the cover edge to edge, then title, price, tags and level.
            <Link key={p.id} href={`/products/${p.slug}`} className={FRAMED_CARD} style={{ background: dark ? '#1E1F26' : '#ffffff' }}>
              <div className="overflow-hidden flex items-center justify-center" style={{ aspectRatio: '3 / 4', background: dark ? 'rgba(255,255,255,0.04)' : '#E8EEF0' }}>
                {p.coverImage
                  ? <img src={resolveCoverUrl(p.coverImage)} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
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
