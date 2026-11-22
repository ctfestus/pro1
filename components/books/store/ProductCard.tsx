// The store's product card, as the landing page and the dashboard draw content: the cover edge to
// edge with the product type on a yellow tag, then the title, the author, the price, the tags and
// the level. Used by the store list and by "More digital products" on a product page.

import Link from 'next/link';
import { Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { PriceTag } from '@/components/books/store/PriceTag';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';
import type { StoreBook } from '@/lib/books/store';

export function ProductCard({ book }: { book: StoreBook }) {
  const level = book.difficulty ? book.difficulty.charAt(0).toUpperCase() + book.difficulty.slice(1) : undefined;
  return (
    <Link href={`/products/${book.slug}`} className={FRAMED_CARD} style={{ background: '#ffffff', textDecoration: 'none' }}>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden" style={{ background: '#E8EEF0' }}>
        {book.coverImage
          ? <img src={resolveCoverUrl(book.coverImage)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
          : <Package className="h-10 w-10" style={{ color: '#94a3b8' }} />}
        {book.productTypeLabel && (
          <span className="absolute left-0 top-3 px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>{book.productTypeLabel}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-[18px]">
        <p className="line-clamp-2 min-h-[40px] text-[15px] leading-5 font-bold" style={{ color: '#0f172a' }}>{book.title}</p>
        {book.authors.length > 0 && <p className="mt-1 truncate text-sm" style={{ color: '#64748b' }}>{book.authors.join(', ')}</p>}
        <div className="mt-1.5 text-sm font-bold">
          {book.free ? <span style={{ color: '#16a34a' }}>Free</span> : <PriceTag prices={book.prices} style={{ color: '#0f172a' }} />}
        </div>
        <CardMeta tags={book.topics} level={level} text="#0f172a" muted="#64748b" />
      </div>
    </Link>
  );
}
