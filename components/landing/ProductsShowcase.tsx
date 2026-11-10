'use client';

/**
 * The home page's "Digital Products" section: up to four of the newest products in the store, with
 * cover, title and price, and a link to the full store. Shown only when the store has products.
 * Used by both landing templates, so colours come in as props.
 */
import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { PriceTag } from '@/components/books/store/PriceTag';

export type LandingProduct = {
  id: string;
  slug: string;
  title: string;
  coverImage: string | null;
  free: boolean;
  prices: { currency: string; amount: number; original?: number }[];
};

export function ProductsShowcase({ products, dark, accent, background, hFont, bFont }: {
  products: LandingProduct[];
  dark: boolean;
  accent: string;
  background?: string;
  hFont?: string;
  bFont?: string;
}) {
  if (!products.length) return null;
  const title = dark ? '#ffffff' : '#1C1D1F';
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#6E7383';
  const card = dark ? 'rgba(255,255,255,0.06)' : '#ffffff';
  const shadow = dark ? 'none' : '0 1px 2px rgba(15,23,42,0.05), 0 10px 30px -14px rgba(15,23,42,0.16)';

  return (
    <section id="section-products" className="py-12 md:py-20" style={{ background }}>
      <div className="max-w-[1240px] mx-auto px-6 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6 md:mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: title, fontFamily: hFont }}>Digital Products</h2>
            <p className="mt-2 text-sm md:text-base max-w-xl" style={{ color: muted, fontFamily: bFont }}>
              Practical guides and resources you can download and keep. Read a free sample first.
            </p>
          </div>
          <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: accent, fontFamily: bFont }}>
            See all products <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {products.slice(0, 4).map(p => (
            <Link key={p.id} href={`/products/${p.slug}`} className="group rounded-3xl p-3 md:p-4 flex flex-col transition-transform hover:-translate-y-0.5"
              style={{ background: card, boxShadow: shadow }}>
              <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ aspectRatio: '3 / 4', background: dark ? 'rgba(255,255,255,0.04)' : '#E8EEF0' }}>
                {p.coverImage
                  ? <img src={resolveCoverUrl(p.coverImage)} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  : <Package className="w-10 h-10" style={{ color: muted }} />}
              </div>
              <p className="mt-3 text-sm md:text-base font-semibold leading-snug line-clamp-2" style={{ color: title, fontFamily: hFont }}>{p.title}</p>
              <div className="mt-auto pt-2 text-sm font-bold" style={{ fontFamily: bFont }}>
                {p.free ? <span style={{ color: '#16a34a' }}>Free</span> : <PriceTag prices={p.prices} style={{ color: title }} />}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
