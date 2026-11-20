'use client';

/**
 * The two-card promotional banner from the Modern landing template.
 *
 * Pulled out of LandingPageClient so the pricing page can show the same banners rather than
 * carrying a second copy that drifts. The card shape and the helpers that read site settings
 * live in lib/mid-ads, because a server page cannot call a function exported from a client
 * module -- it receives a reference and throws. Self-contained on purpose: it brings its own shine
 * styles, because those lived in the landing page's inline style block and would simply have gone
 * missing anywhere else.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { AdCard } from '@/lib/mid-ads';
import { M3, GUTTER, BUTTON_PAD } from '@/components/landing/type';

export function MidAdBanner({
  ads, hFont, bFont, isDark, background,
}: {
  ads: AdCard[]; hFont?: string; bFont?: string; isDark?: boolean;
  /** Overridden where the surrounding page is not the landing page's own ground. */
  background?: string;
}) {
  const cards = ads.filter(ad => ad.title);
  if (!cards.length) return null;

  return (
    <div style={{ background: background ?? (isDark ? '#0d1117' : '#f4f7f9') }}>
      <style>{`
        .mid-ad-shine-host { position: relative; }
        .mid-ad-shine { position: absolute; top: 0; bottom: 0; left: 0; width: 45%; opacity: 0; pointer-events: none; z-index: 15;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,0.17), transparent);
          transform: translateX(-130%) skewX(-14deg); }
        .mid-ad-shine-host:hover .mid-ad-shine { animation: mid-ad-sheen 0.9s ease; }
        @keyframes mid-ad-sheen {
          from { opacity: 1; transform: translateX(-130%) skewX(-14deg); }
          to   { opacity: 1; transform: translateX(330%) skewX(-14deg); }
        }
        @media (prefers-reduced-motion: reduce) { .mid-ad-shine { display: none; } }
      `}</style>
      <div className={`max-w-[1240px] mx-auto ${GUTTER} py-8 md:py-10`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cards.map((ad, i) => {
            const sideImage = ad.imageLayout === 'side' && !!ad.bgImage;
            const bg = sideImage
              ? (ad.bgColor || '#0056D2')
              : ad.bgImage
                ? `url(${ad.bgImage}) center/cover no-repeat`
                : ad.bgColor || '#0056D2';
            const body = (
              <div className="relative z-10 flex flex-col gap-4" style={{ padding: 24, minHeight: sideImage ? undefined : 164 }}>
                <div>
                  {ad.label && (
                    <span className="inline-block px-2 py-1 rounded-md mb-4"
                      style={{ ...M3.labelMedium, background: 'rgba(255,255,255,0.22)', color: 'white' }}>
                      {ad.label}
                    </span>
                  )}
                  <h3 className="mb-2"
                    style={{ ...M3.titleLarge, color: 'white', fontFamily: hFont, maxWidth: sideImage ? 'none' : 240 }}>
                    {ad.title}
                  </h3>
                  {ad.description && (
                    <p style={{ ...M3.bodyMedium, color: 'rgba(255,255,255,0.82)', fontFamily: bFont, maxWidth: sideImage ? 'none' : 280 }}>
                      {ad.description}
                    </p>
                  )}
                </div>
                {ad.ctaText && (
                  <div>
                    <Link href={ad.ctaUrl || '/auth'}
                      className="group inline-flex items-center gap-2 self-start rounded-xl transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                      style={{ ...M3.labelLarge, background: 'white', color: ad.bgColor || '#0056D2', fontFamily: hFont, padding: BUTTON_PAD }}>
                      {ad.ctaText}
                      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </div>
                )}
              </div>
            );
            return (
                <div key={i} className="rounded-2xl overflow-hidden mid-ad-shine-host transition-shadow duration-300 hover:shadow-[0_20px_48px_-20px_rgba(2,32,71,0.4)]" style={{ minHeight: 220 }}>
                  <div className="relative w-full h-full transition-transform duration-300 hover:scale-[1.02]"
                    style={{ background: bg, minHeight: 220 }}>
                    {!sideImage && ad.bgImage && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.48)' }} />}
                    <span className="mid-ad-shine" aria-hidden="true" />
                    {sideImage ? (
                      <div className="relative z-10 flex flex-col sm:flex-row sm:items-stretch" style={{ minHeight: 220 }}>
                        <div className="flex-1 min-w-0">{body}</div>
                        <div className="relative w-full h-44 sm:h-auto sm:w-[44%] flex-shrink-0 overflow-hidden">
                          <img src={ad.bgImage} alt="" className="absolute inset-0 w-full h-full object-contain sm:object-cover" />
                        </div>
                      </div>
                    ) : body}
                  </div>
                </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
