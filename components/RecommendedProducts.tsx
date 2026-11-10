'use client';

/**
 * Digital products an author recommends with a course (migration 240): on the course page beside
 * the enrol card, and under "What to take next" after a learner passes. Renders nothing until there
 * is at least one, so a course with none shows no empty box. Data from /api/books/for-course.
 * Colours are passed in, so it fits both the course page and the course player.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { PriceTag } from '@/components/books/store/PriceTag';

type Product = {
  id: string;
  slug: string;
  title: string;
  coverImage: string | null;
  free: boolean;
  prices: { currency: string; amount: number; original?: number }[];
};

export type RecommendedPalette = { card: string; title: string; muted: string; border: string; accent: string };

export function RecommendedProducts({ courseId, palette, heading = 'Recommended product', framed = true }: {
  courseId: string;
  palette: RecommendedPalette;
  heading?: string;
  /** A card of its own (course page), or rows inside a list that already has one (course player). */
  framed?: boolean;
}) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    fetch(`/api/books/for-course?courseId=${encodeURIComponent(courseId)}`)
      .then(r => (r.ok ? r.json() : { products: [] }))
      .then(d => { if (!cancelled && Array.isArray(d.products)) setProducts(d.products); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [courseId]);

  if (!products.length) return null;

  const rows = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.map(p => (
        <a key={p.id} href={`/products/${p.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <div style={{ width: 44, height: 58, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: `${palette.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {p.coverImage
              ? <img src={resolveCoverUrl(p.coverImage)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Package style={{ width: 18, height: 18, color: palette.accent }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: palette.title, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{p.title}</p>
            <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700 }}>
              {p.free
                ? <span style={{ color: '#16a34a' }}>Free</span>
                : <PriceTag prices={p.prices.slice(0, 1)} style={{ color: palette.title }} />}
            </div>
          </div>
          <ArrowRight style={{ width: 15, height: 15, color: palette.accent, flexShrink: 0 }} />
        </a>
      ))}
    </div>
  );

  return (
    <div style={framed ? { background: palette.card, borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 10px 30px -14px rgba(15,23,42,0.14)' } : undefined}>
      <p style={{ margin: '0 0 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: palette.muted }}>
        {heading}{products.length > 1 ? 's' : ''}
      </p>
      {rows}
    </div>
  );
}
