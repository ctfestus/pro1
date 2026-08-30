'use client';

/**
 * The two-card promotional banner from the Modern landing template.
 *
 * Pulled out of LandingPageClient so the pricing page can show the same banners rather than
 * carrying a second copy that drifts. Self-contained on purpose: it brings its own reveal
 * animation and its own shine styles, because those lived in the landing page's inline style
 * block and would simply have gone missing anywhere else.
 */
import { useRef } from 'react';
import Link from 'next/link';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { SiteConfig } from '@/lib/site-templates';

export type AdCard = {
  label: string;
  title: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  bgColor: string;
  bgImage: string;
  imageLayout?: string;
};

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** The two mid-page cards an admin configured, in the order they are shown. */
export function midAdCardsFrom(config: Partial<SiteConfig>): AdCard[] {
  return [
    {
      label: config.midAd1Label ?? '', title: config.midAd1Title ?? '',
      description: config.midAd1Description ?? '', ctaText: config.midAd1CtaText ?? '',
      ctaUrl: config.midAd1CtaUrl ?? '', bgColor: config.midAd1BgColor ?? '',
      bgImage: config.midAd1BgImage ?? '', imageLayout: config.midAd1ImageLayout ?? '',
    },
    {
      label: config.midAd2Label ?? '', title: config.midAd2Title ?? '',
      description: config.midAd2Description ?? '', ctaText: config.midAd2CtaText ?? '',
      ctaUrl: config.midAd2CtaUrl ?? '', bgColor: config.midAd2BgColor ?? '',
      bgImage: config.midAd2BgImage ?? '', imageLayout: config.midAd2ImageLayout ?? '',
    },
  ];
}

/** True when an admin has actually set these up and not switched them off. */
export function hasMidAds(config: Partial<SiteConfig>): boolean {
  return config.hideMidAdBanner !== '1' && midAdCardsFrom(config).some(ad => ad.title);
}

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
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cards.map((ad, i) => {
            const sideImage = ad.imageLayout === 'side' && !!ad.bgImage;
            const bg = sideImage
              ? (ad.bgColor || '#0056D2')
              : ad.bgImage
                ? `url(${ad.bgImage}) center/cover no-repeat`
                : ad.bgColor || '#0056D2';
            const body = (
              <div className="relative z-10 flex flex-col gap-3" style={{ padding: '28px 32px', minHeight: sideImage ? undefined : 164 }}>
                <div>
                  {ad.label && (
                    <span className="inline-block text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded mb-2.5"
                      style={{ background: 'rgba(255,255,255,0.22)', color: 'white', letterSpacing: '0.1em' }}>
                      {ad.label}
                    </span>
                  )}
                  <h3 className="font-extrabold leading-tight mb-1.5"
                    style={{ color: 'white', fontFamily: hFont, letterSpacing: '-0.02em', fontSize: 'clamp(15px,1.4vw,19px)', maxWidth: sideImage ? 'none' : 240 }}>
                    {ad.title}
                  </h3>
                  {ad.description && (
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.82)', fontFamily: bFont, maxWidth: sideImage ? 'none' : 280 }}>
                      {ad.description}
                    </p>
                  )}
                </div>
                {ad.ctaText && (
                  <div className="mt-1">
                    <Link href={ad.ctaUrl || '/auth'}
                      className="group inline-flex items-center gap-2 self-start font-bold rounded-xl transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                      style={{ background: 'white', color: ad.bgColor || '#0056D2', fontFamily: hFont, fontSize: 13, padding: '10px 20px' }}>
                      {ad.ctaText}
                      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </div>
                )}
              </div>
            );
            return (
              <Reveal key={i} delay={i * 0.1}>
                <div className="rounded-2xl overflow-hidden mid-ad-shine-host transition-shadow duration-300 hover:shadow-[0_20px_48px_-20px_rgba(2,32,71,0.4)]" style={{ minHeight: 220 }}>
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
              </Reveal>
            );
          })}
        </div>
      </div>
    </div>
  );
}
