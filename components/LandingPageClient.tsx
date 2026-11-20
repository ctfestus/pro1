'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useInView, AnimatePresence, useMotionValue, useSpring, useScroll, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { resolveConfig, type SiteConfig } from '@/lib/site-templates';
import { ArrowRight, Pause, ChevronLeft, ChevronRight, BookOpen, Briefcase, Award, TrendingUp, Users, Zap, BarChart3, GraduationCap, Play, Brain, Megaphone, Banknote, Palette, Code2, Globe, HeartPulse } from 'lucide-react';
import { HoverPreviewCard } from '@/components/student/shared';
import { CataloguePreview, type CatalogueItem } from '@/components/CataloguePreview';
import { normalizePathItemType } from '@/lib/catalogue-path-items';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { useHoverPreview } from '@/lib/use-hover-preview';
import { useToolIcons } from '@/lib/use-tool-icons';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { landingHref } from '@/lib/landing-href';
import { MidAdBanner } from '@/components/landing/MidAdBanner';
import { hasMidAds, midAdCardsFrom, type AdCard } from '@/lib/mid-ads';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import { PromoCard } from '@/components/PromoCard';
import { M3, DISPLAY_CLASS, GUTTER, SECTION_Y, BUTTON_PAD } from '@/components/landing/type';
import { ProductsShowcase, type LandingProduct } from '@/components/landing/ProductsShowcase';
import { buildNavGroups, groupByField, type NavBook } from '@/lib/landing-nav';

// --- Floating orb ---
function Orb({ x, y, size, color, delay, active = true }: { x: string; y: string; size: number; color: string; delay: number; active?: boolean }) {
  // A 130px blur across a 320-430px element is one of the more expensive things to composite, and
  // this loops forever. Holding it still while its section is off screen keeps the look on the
  // sections a visitor is actually looking at and stops the work everywhere else.
  return (
    <motion.div className="absolute rounded-full pointer-events-none"
      style={{ left: x, top: y, width: size, height: size, background: color, filter: 'blur(130px)', opacity: 0.35 }}
      animate={active ? { scale: [1, 1.18, 1], opacity: [0.35, 0.5, 0.35] } : { scale: 1, opacity: 0.35 }}
      transition={active ? { duration: 8 + delay, repeat: Infinity, ease: 'easeInOut', delay } : { duration: 0.4 }}
    />
  );
}


function ProgrammeLoadError({ dark = false }: { dark?: boolean }) {
  return (
    <div
      role="alert"
      className="mx-auto my-8 max-w-xl px-5 py-4 text-center rounded-lg border"
      style={{
        color: dark ? 'rgba(255,255,255,0.82)' : '#344054',
        borderColor: dark ? 'rgba(255,255,255,0.18)' : '#d0d5dd',
        background: dark ? 'rgba(255,255,255,0.06)' : '#ffffff',
      }}
    >
      <p className="text-sm">Some programmes could not be loaded.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-2 text-sm font-bold underline">
        Try again
      </button>
    </div>
  );
}

// --- Modern template helpers ---
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour
function shade(hex: string, amt: number): string {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const ch = (o: number) => {
    const v = parseInt(h.slice(o, o + 2), 16);
    const t = amt < 0 ? 0 : 255;
    return Math.round(v + (t - v) * Math.abs(amt)).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

// #rrggbb -> rgba() string with the given alpha
function hexRgba(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
}

// Magnetic hover wrapper for primary CTAs
function Magnetic({ children, strength = 0.16 }: { children: React.ReactNode; strength?: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.3 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.3 });
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div className="inline-block" style={{ x: sx, y: sy }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength * 1.6);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.div>
  );
}

// Thin scroll progress hairline above the nav
function LandingScrollProgress({ from, to }: { from: string; to: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 28, mass: 0.35 });
  return (
    <motion.div aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[3px] origin-left pointer-events-none"
      style={{ scaleX, zIndex: 60, background: `linear-gradient(90deg, ${from}, ${to})` }} />
  );
}

// Animated section heading: title, growing accent underline, subtext
function MSectionHeading({ title, sub, color, subColor, accent, hFont, bFont }: {
  title: string; sub: string; color: string; subColor: string; accent: string; hFont?: string; bFont?: string;
}) {
  return (
    <div className="mb-6">
      <h2 style={{ ...M3.headlineMedium, fontWeight: 900, fontFamily: hFont, color }}>{title}</h2>
      <motion.span aria-hidden="true" className="block h-[3px] w-11 rounded-full origin-left mt-2 mb-2" style={{ background: accent }}
        initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, delay: 0.3, ease: EASE_OUT }} />
      {sub && <p style={{ ...M3.bodyLarge, color: subColor, fontFamily: bFont ?? hFont, maxWidth: 640 }}>{sub}</p>}
    </div>
  );
}

// Stagger variants for the ad banner slide content
const bannerStagger = { hide: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.12 } } };
const bannerItem = {
  hide: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

// One neutral ground for an item without a cover, readable on the light and the dark page.
const NO_COVER_BG = 'rgba(127,127,127,0.16)';
const LAND_C = { card: 'white', text: '#1C1D1F', muted: '#6E7383', faint: '#9CA3AF', cardBorder: '#E8EBEF' };

// Fallback icon for category rows without a tool icon: match by keyword, then by content type
const CATEGORY_ICONS: Array<[RegExp, React.ElementType]> = [
  [/data|analytic|statistic/i,                          BarChart3],
  [/\bai\b|machine|intelligen/i,                        Brain],
  [/market|sales|brand|growth/i,                        Megaphone],
  [/financ|bank|account|invest/i,                       Banknote],
  [/design|creativ|\bux\b|\bui\b/i,                     Palette],
  [/cod|program|develop|software|engineer|web|cloud|tech/i, Code2],
  [/health|medic/i,                                     HeartPulse],
  [/\bhr\b|people|talent|leadership/i,                  Users],
  [/language|communicat|global/i,                       Globe],
  [/automat|productiv/i,                                Zap],
  [/business|consult|strateg|manage/i,                  Briefcase],
];

function getCategoryIcon(title: string, type: ProgrammeItem['type']): React.ElementType {
  const hit = CATEGORY_ICONS.find(([re]) => re.test(title));
  if (hit) return hit[1];
  if (type === 've') return Briefcase;
  if (type === 'path') return TrendingUp;
  if (type === 'certification') return Award;
  return GraduationCap;
}

// --- Ad banner carousel ---

const BANNER_AUTO_MS = 6500;

function LandingAdBanner({ ads, hFont, bFont, fullWidth, isDark }: { ads: AdCard[]; hFont?: string; bFont?: string; fullWidth?: boolean; isDark?: boolean }) {
  const cards = ads.filter(a => a.title);
  const [storedIdx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // Kept apart from `paused`. That one is the transient hover/swipe hold, so folding the two
  // together would let moving the mouse away restart a carousel the visitor deliberately stopped.
  const [userPaused, setUserPaused] = useState(false);
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const clipRef  = useRef<HTMLDivElement>(null);
  const touchX   = useRef<number | null>(null);
  const [containerW, setContainerW] = useState(0);
  const GAP = fullWidth ? 0 : 16;
  const isMobile = containerW > 0 && containerW < 640;
  // Two whole cards side by side on a wide screen, one on a phone or in full-width mode. Sizing
  // the cards to the track means the last one is never cut off at the edge.
  const perView = fullWidth || isMobile ? 1 : 2;
  const max = Math.max(0, cards.length - perView);
  // Clamped on read: switching off the card on screen shortens the list under a stored index,
  // which would otherwise point past the end and leave the track scrolled onto nothing.
  const idx = Math.min(storedIdx, max);

  useEffect(() => {
    if (!clipRef.current) return;
    const obs = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    obs.observe(clipRef.current);
    return () => obs.disconnect();
  }, []);

  // Gentle auto-advance; paused on hover/touch, off for reduced motion
  useEffect(() => {
    if (paused || userPaused || reduced || max === 0) return;
    const t = setInterval(() => setIdx(i => (i >= max ? 0 : i + 1)), BANNER_AUTO_MS);
    return () => clearInterval(t);
  }, [paused, userPaused, reduced, max, idx]);

  const hasSideImage = cards.some(c => c.imageLayout === 'side' && !!c.bgImage);
  const CARD_W = fullWidth
    ? (containerW > 0 ? containerW : 1280)
    : (containerW > 0 ? (containerW - GAP * (perView - 1)) / perView : 646);
  const CARD_H = fullWidth
    ? (isMobile ? 380 : Math.max(340, Math.min(500, Math.round((containerW || 1280) * 0.34))))
    : isMobile
      ? (hasSideImage ? 430 : Math.max(220, Math.round(297 * Math.min(1, CARD_W / 646))))
      // Two to a row makes each card narrower than before, so the height no longer scales with
      // the width: it holds the badge, a two-line title, the description and the button.
      : 300;


  const goTo = (next: number) => setIdx(Math.max(0, Math.min(next, max)));

  // Touch swipe (mobile) -- the prev/next arrows are hidden on small screens
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; setPaused(true); };
  const onTouchEnd = (e: React.TouchEvent) => {
    setPaused(false);
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx <= -40) goTo(idx + 1);
    else if (dx >= 40) goTo(idx - 1);
  };

  if (!cards.length) return null;

  return (
    <div>
      <div className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}>
        {/* Left arrow - hidden on mobile, vertically centered on desktop */}
        {max > 0 && !isMobile && (
          <button onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Previous slide"
            className={`absolute top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full grid place-items-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-20 outline-none focus:outline-none ${fullWidth ? 'left-3 sm:left-6 bg-white shadow-md hover:shadow-xl' : isDark ? 'left-0 -translate-x-1/2 hover:bg-white/10' : 'left-0 -translate-x-1/2 hover:bg-white hover:shadow-md'}`}
            style={{ color: !fullWidth && isDark ? 'white' : LAND_C.text }}>
            <ChevronLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
        )}

        <div ref={clipRef} style={{ overflow: 'hidden', touchAction: 'pan-y' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div ref={trackRef} style={{ display: 'flex', gap: GAP, transform: `translateX(-${idx * (CARD_W + GAP)}px)`, transition: 'transform 0.65s cubic-bezier(0.22,1,0.36,1)' }}>
          {cards.map((ad, i) => {
            const active = i === idx;
            const contentKey = active ? `on-${idx}` : `off-${i}`;
            if (fullWidth) {
              const isSide = ad.imageLayout === 'side' && !!ad.bgImage;
              const baseColor = ad.bgColor || '#0056D2';
              return (
                <div key={i} className="flex-shrink-0 relative overflow-hidden" style={{ width: CARD_W, height: CARD_H }}>
                  {isSide ? (
                    <>
                      <div className="absolute inset-0" style={{ background: baseColor }} />
                      <div className="absolute top-0 right-0 h-full overflow-hidden" style={{ width: isMobile ? '46%' : '54%' }}>
                        <motion.img key={contentKey} src={ad.bgImage} alt="" className="w-full h-full object-contain object-right"
                          animate={active && !reduced ? { scale: [1, 1.05] } : { scale: 1 }}
                          transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                        <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: '35%', background: `linear-gradient(to right, ${baseColor}, transparent)` }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <motion.div key={`bg-${contentKey}`} className="absolute inset-0"
                        style={{ background: ad.bgImage ? `url(${ad.bgImage}) center/cover no-repeat` : baseColor }}
                        animate={active && !reduced && ad.bgImage ? { scale: [1, 1.06] } : { scale: 1 }}
                        transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                      {ad.bgImage && (
                        <div className="absolute inset-0 pointer-events-none"
                          style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.34) 48%, rgba(0,0,0,0) 82%)' }} />
                      )}
                    </>
                  )}
                  <div className="relative h-full flex items-center max-w-[1240px] mx-auto px-4 sm:px-8 md:px-14">
                    <motion.div key={`panel-${contentKey}`} variants={bannerStagger}
                      initial={active && !reduced ? 'hide' : false} animate="show"
                      style={{ maxWidth: isMobile ? (isSide ? '52%' : '92%') : 620 }}>
                      {ad.label && (
                        <motion.span variants={bannerItem} className="inline-flex items-center gap-2 mb-4"
                          style={{ ...M3.labelLarge, fontWeight: 800, color: 'rgba(255,255,255,0.85)' }}>
                          <span aria-hidden="true" className="inline-block w-4 h-[2px] rounded-full" style={{ background: 'rgba(255,255,255,0.85)' }} />
                          {ad.label}
                        </motion.span>
                      )}
                      <motion.h3 variants={bannerItem} className="text-balance"
                        style={{ ...(isMobile ? M3.headlineMedium : { fontSize: 45, lineHeight: '52px' }), fontWeight: 500, color: 'white', fontFamily: hFont }}>
                        {ad.title}
                      </motion.h3>
                      {ad.description && (
                        <motion.p variants={bannerItem} className="mt-4"
                          style={{ ...M3.bodyLarge, color: 'rgba(255,255,255,0.88)', fontFamily: bFont ?? hFont, maxWidth: 560 }}>
                          {ad.description}
                        </motion.p>
                      )}
                      {ad.ctaText && (
                        <motion.div variants={bannerItem} className="mt-8">
                          <Link href={ad.ctaUrl || '/auth'}
                            className="group inline-flex items-center gap-2 rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                            style={{ ...M3.labelLarge, fontWeight: 700, background: 'white', color: baseColor, fontFamily: hFont, padding: BUTTON_PAD }}>
                            {ad.ctaText}
                            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                          </Link>
                        </motion.div>
                      )}
                    </motion.div>
                  </div>
                </div>
              );
            }
            const isSide = ad.imageLayout === 'side' && !!ad.bgImage;
            const baseColor = ad.bgColor || '#0056D2';
            const padding = isMobile ? '24px' : '32px';
            const body = (
              <>
                <div>
                  {ad.label && (
                    <motion.span variants={bannerItem} className="inline-block px-2 py-1 rounded-md mb-4"
                      style={{ ...M3.labelMedium, fontWeight: 700, background: 'rgba(255,255,255,0.22)', color: 'white', backdropFilter: 'blur(4px)' }}>
                      {ad.label}
                    </motion.span>
                  )}
                  <motion.h3 variants={bannerItem} className="mb-2"
                    style={{ ...(isMobile ? M3.headlineSmall : M3.headlineMedium), fontWeight: 900, color: 'white', fontFamily: hFont, maxWidth: isSide ? 'none' : 380 }}>
                    {ad.title}
                  </motion.h3>
                  {!isMobile && (
                    <motion.p variants={bannerItem}
                      style={{ ...M3.bodyLarge, color: 'rgba(255,255,255,0.80)', fontFamily: bFont ?? hFont, maxWidth: isSide ? 'none' : 380 }}>
                      {ad.description}
                    </motion.p>
                  )}
                </div>
                {ad.ctaText && (
                  <motion.div variants={bannerItem} className="mt-4">
                    <Link href={ad.ctaUrl || '/auth'}
                      className="group inline-flex items-center gap-2 self-start rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                      style={{ ...M3.labelLarge, fontWeight: 700, background: 'white', color: baseColor, fontFamily: hFont, padding: BUTTON_PAD }}>
                      {ad.ctaText}
                      <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </motion.div>
                )}
              </>
            );
            return (
              <div key={i} className="flex-shrink-0 rounded-2xl overflow-hidden cursor-pointer land-shine-host"
                style={{ width: CARD_W, height: CARD_H }}>
                <div className="relative w-full h-full transition-transform duration-300 hover:scale-[1.02]"
                  style={{ background: isSide ? baseColor : undefined }}>
                {!isSide && (
                  <motion.div key={`bg-${contentKey}`} className="absolute inset-0"
                    style={{ background: ad.bgImage ? `url(${ad.bgImage}) center/cover no-repeat` : baseColor }}
                    animate={active && !reduced && ad.bgImage ? { scale: [1, 1.07] } : { scale: 1 }}
                    transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                )}
                {!isSide && ad.bgImage && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.48)' }} />}
                <span className="land-card-shine" aria-hidden="true" />
                {isSide ? (
                  <motion.div key={contentKey} variants={bannerStagger} initial={active && !reduced ? 'hide' : false} animate="show"
                    className="relative z-10 flex h-full" style={{ height: CARD_H, flexDirection: isMobile ? 'column' : 'row' }}>
                    <div className="flex flex-col justify-between" style={{ flex: 1, minWidth: 0, padding }}>
                      {body}
                    </div>
                    <div style={{ flex: isMobile ? '0 0 50%' : '0 0 44%', position: 'relative', overflow: 'hidden' }}>
                      <img src={ad.bgImage} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: isMobile ? 'contain' : 'cover' }} />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key={contentKey} variants={bannerStagger} initial={active && !reduced ? 'hide' : false} animate="show"
                    className="relative z-10 flex flex-col justify-between h-full" style={{ height: CARD_H, padding }}>
                    {body}
                  </motion.div>
                )}
                </div>
              </div>
            );
          })}
        </div>
        </div>

        {/* Right arrow - hidden on mobile, vertically centered on desktop */}
        {max > 0 && !isMobile && (
          <button onClick={() => goTo(idx + 1)} disabled={idx >= max} aria-label="Next slide"
            className={`absolute top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full grid place-items-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-20 outline-none focus:outline-none ${fullWidth ? 'right-3 sm:right-6 bg-white shadow-md hover:shadow-xl' : isDark ? 'right-0 translate-x-1/2 hover:bg-white/10' : 'right-0 translate-x-1/2 hover:bg-white hover:shadow-md'}`}
            style={{ color: !fullWidth && isDark ? 'white' : LAND_C.text }}>
            <ChevronRight className="w-5 h-5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Dots centered below -- the active dot fills with the auto-advance timer */}
      {max > 0 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          {/* Auto-advance runs every 6.5s and hovering was the only way to hold it, which leaves
              touch visitors no way at all. WCAG 2.2.2 asks for a real mechanism to pause anything
              that moves for longer than five seconds. */}
          {!reduced && (
            <button type="button" onClick={() => setUserPaused(v => !v)}
              aria-label={userPaused ? 'Resume slideshow' : 'Pause slideshow'}
              className="grid place-items-center w-7 h-7 rounded-full mr-1 transition-opacity hover:opacity-70"
              style={{ background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(28,29,31,0.08)', color: isDark ? '#ffffff' : LAND_C.text }}>
              {userPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
          )}
          {Array.from({ length: max + 1 }, (_, i) => {
            const activeDot = i === idx;
            const base = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(28,29,31,0.20)';
            const fill = isDark ? '#ffffff' : LAND_C.text;
            return (
              <button key={i} onClick={() => goTo(i)} aria-label={`Go to slide ${i + 1}`}
                className="relative rounded-full overflow-hidden transition-all duration-300"
                style={{ width: activeDot ? 26 : 7, height: 7, background: base }}>
                {activeDot && !reduced && !paused && !userPaused && (
                  <motion.span key={`fill-${idx}`} aria-hidden="true" className="absolute inset-0 origin-left rounded-full"
                    style={{ background: fill }}
                    initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                    transition={{ duration: BANNER_AUTO_MS / 1000, ease: 'linear' }} />
                )}
                {activeDot && (reduced || paused || userPaused) && (
                  <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ background: fill }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


// The hover preview is Explore's, so a visitor sees what a signed-in learner sees there.
const PREVIEW_TYPE = { course: 'course', path: 'learning_path', ve: 'virtual_experience', certification: 'certification' } as const;

function toPreviewItem(item: ProgrammeItem): CatalogueItem {
  return {
    id: item.id,
    type: PREVIEW_TYPE[item.type],
    title: item.title,
    slug: item.slug || null,
    coverImage: item.imageUrl || null,
    description: item.description,
    category: item.category || null,
    byline: item.partnerName ? `Offered by ${item.partnerName}` : item.byline ?? null,
    bylineLogo: item.partnerLogoUrl ?? null,
    outcomes: item.outcomes,
    level: item.level,
    duration: item.duration,
    tools: item.tools,
    examMinutes: item.examMinutes,
    passmark: item.passmark,
    locked: false,
    pathItems: item.pathCourses?.map(c => ({
      id: c.id, type: normalizePathItemType(c.type), title: c.title, slug: c.slug || null,
      coverImage: c.imageUrl || null, description: null, category: null,
    })),
  };
}

/** Four across, two down. */
const GRID_PAGE_SIZE = 8;

function LandingCarouselRow({ title, items, type, typeColor, buttonColor, user, hFont, bFont, isDark, hideTitle, transparentBg, popupDark, bg, paged }: {
  title: string; items: ProgrammeItem[]; type: ProgrammeItem['type']; typeColor: string; buttonColor: string; user: any; hFont?: string; bFont?: string; isDark?: boolean; hideTitle?: boolean; transparentBg?: boolean; popupDark?: boolean; bg?: string;
  /** Render as a paginated grid of eight rather than a row that scrolls sideways. */
  paged?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // A paged row is a GRID, not a carousel: eight cards a page, four across and two down on a
  // large screen, with the next eight a click away. Slicing the list is the whole mechanism --
  // there is no scroll position to measure and so nothing to drift out of step with the counter.
  const [page, setPage] = useState(0);
  const pages = paged ? Math.max(1, Math.ceil(items.length / GRID_PAGE_SIZE)) : 1;
  const visible = paged ? items.slice(page * GRID_PAGE_SIZE, (page + 1) * GRID_PAGE_SIZE) : items;
  const atStart = page <= 0;
  const atEnd = page >= pages - 1;
  // A sideways row only gets arrows when its cards actually run past the edge.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (paged || !el) return;
    // The observer reports once on observe, so this also covers the first layout.
    const obs = new ResizeObserver(() => setOverflows(el.scrollWidth > el.clientWidth + 1));
    obs.observe(el);
    return () => obs.disconnect();
  }, [paged, items.length]);
  const showControls = paged ? pages > 1 : overflows;

  // Only the peeking row scrolls; a grid page turns.
  const scrollByCards = (dir: number) => {
    if (paged) {
      setPage(current => Math.max(0, Math.min(pages - 1, current + dir)));
      return;
    }
    scrollRef.current?.scrollBy({ left: dir * 380, behavior: 'smooth' });
  };

  const { hover, open: openPreview, scheduleClose, cancelClose } = useHoverPreview<ProgrammeItem>();
  // Path previews widen with the path's contents so their thumbnails lay out in rows.
  const openHover = (item: ProgrammeItem, el: HTMLElement) => openPreview(item, el, {
    width: item.type === 'path' ? Math.min(640, Math.max(360, (item.pathCourses?.length ?? 0) * 120 + 32)) : 340,
    height: 560,
  });

  const toolIcon = useToolIcons();
  const rowBg    = bg ?? (transparentBg ? 'transparent' : (isDark ? '#1E1F26' : 'white'));
  const rowText  = isDark ? 'white' : LAND_C.text;
  const rowMuted = isDark ? 'rgba(255,255,255,0.65)' : LAND_C.muted;
  const rowBorder = isDark ? 'rgba(255,255,255,0.25)' : LAND_C.cardBorder;

  return (
    <section className="rounded-2xl p-4 sm:p-6" style={{ background: rowBg }}>
      {(() => {
        const arrowBtn = (dir: number, label: string) => {
          const spent = paged && (dir < 0 ? atStart : atEnd);
          return (
            <button onClick={() => scrollByCards(dir)} aria-label={label} disabled={spent}
              className="w-9 h-9 rounded-full grid place-items-center transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-35 disabled:hover:scale-100 disabled:cursor-default"
              style={{ border: `1px solid ${rowBorder}`, color: rowMuted }}
              onMouseEnter={e => { if (spent) return; e.currentTarget.style.background = rowText; e.currentTarget.style.borderColor = rowText; e.currentTarget.style.color = isDark ? '#111318' : '#ffffff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = rowBorder; e.currentTarget.style.color = rowMuted; }}>
              {dir < 0 ? <ChevronLeft className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
            </button>
          );
        };
        const pageCount = paged && pages > 1 && (
          <span className="tabular-nums" style={{ ...M3.labelLarge, fontWeight: 600, color: rowMuted, fontFamily: bFont ?? hFont }}>
            {page + 1} / {pages}
          </span>
        );
        return !hideTitle ? (
          <div className="flex items-center justify-between gap-4 mb-0">
            <div className="flex items-center gap-2 min-w-0">
              {(() => { const icon = toolIcon(title);
                if (icon) return <img src={icon} alt="" className="w-6 h-6 object-contain flex-shrink-0" />;
                const Fallback = getCategoryIcon(title, type);
                return <Fallback className="w-5 h-5 flex-shrink-0" strokeWidth={2.2} style={{ color: rowText }} />;
              })()}
              <h3 className="truncate" style={{ ...M3.titleLarge, fontWeight: 700, color: rowText, fontFamily: hFont }}>{title}</h3>
            </div>
            {showControls && (
              <div className="flex items-center gap-3 flex-shrink-0">
                {pageCount}
                <div className="flex items-center gap-2">
                  {arrowBtn(-1, 'Previous')}
                  {arrowBtn(1, 'Next')}
                </div>
              </div>
            )}
          </div>
        ) : !showControls ? null : (
          <div className="flex justify-end mb-0">
            <div className="flex items-center gap-3">
              {pageCount}
              {arrowBtn(-1, 'Previous')}
              {arrowBtn(1, 'Next')}
            </div>
          </div>
        );
      })()}

      {/* A paged row lays its page out as a grid and wraps -- four columns on a large screen, and
          fewer as the screen narrows, so the cards stay a readable size rather than the count
          staying fixed. A peeking row keeps fixed-width cards on one scrolling line, with the fade
          at the right edge that tells you there is more. */}
      <div ref={scrollRef}
        className={paged
          ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 pt-4 pb-2'
          : 'flex flex-nowrap gap-4 md:gap-6 overflow-x-auto pt-4 pb-2 snap-x'}
        style={paged ? undefined : { scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitMaskImage: 'linear-gradient(90deg, #000 94%, transparent)', maskImage: 'linear-gradient(90deg, #000 94%, transparent)' }}>
        {visible.map((item, i) => (
          <div key={item.id}
            className={paged ? 'min-w-0' : 'flex-shrink-0 snap-start w-[220px] sm:w-[260px]'}
            onMouseEnter={e => openHover(item, e.currentTarget)}
            onMouseLeave={scheduleClose}>
              <Link href={landingHref(item, user)} className="block group cursor-pointer transition-transform duration-300 hover:-translate-y-1">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.45)]"
                  style={{ background: item.imageUrl ? '#0b0b0d' : 'transparent' }}>
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
                    : <div className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]" style={{ background: NO_COVER_BG }}>
                        <BookOpen className="w-8 h-8" style={{ color: LAND_C.faint }}/>
                      </div>
                  }
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />
                </div>
                <p className="mt-3 line-clamp-2" style={{ ...M3.titleMedium, fontWeight: 700, color: rowText, fontFamily: hFont }}>{item.title}</p>
                {item.partnerName && (
                  <div className="flex items-center gap-2 mt-1" style={{ ...M3.bodyMedium, color: rowMuted }}>
                    {item.partnerLogoUrl && <img src={item.partnerLogoUrl} alt="" className="w-4 h-4 object-contain" />}
                    <span>Offered by {item.partnerName}</span>
                  </div>
                )}
                {item.difficulty && <p className="mt-1" style={{ ...M3.bodyMedium, color: rowMuted }}>{item.difficulty}</p>}
              </Link>
          </div>
        ))}
      </div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={hover.item.id}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              width={hover.width}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <CataloguePreview
                item={toPreviewItem(hover.item)}
                accent={typeColor}
                href={landingHref(hover.item, user)}
                onOpen={() => { window.location.href = landingHref(hover.item, user); }}
                viewOnly={!user}
                C={{ ...((popupDark ?? isDark) ? DARK_C : LIGHT_C), cta: buttonColor }}
              />
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}

// --- Modern template ---
function ModernTemplate({ user, profile, scrolled, siteConfig, logoUrl, logoDarkUrl, appName, publicSignupEnabled, programmes, programmesError, navBooks = [], navEvents = [], storeProducts = [] }: {
  user: any; profile: any; scrolled: boolean; siteConfig: SiteConfig; logoUrl: string; logoDarkUrl: string; appName: string;
  publicSignupEnabled: boolean;
  programmes: ProgrammeItem[]; programmesError: boolean;
  navBooks?: NavBook[];
  navEvents?: NavBook[];
  storeProducts?: LandingProduct[];
}) {
  const reduced = useReducedMotion();

  // Drives the decorative orbs in the two gradient sections. The margin starts them just before
  // the section arrives, so nothing visibly kicks into motion mid-view.
  const pathsRef = useRef<HTMLElement>(null);
  const ctaRef   = useRef<HTMLElement>(null);
  const pathsInView = useInView(pathsRef, { margin: '200px' });
  const ctaInView   = useInView(ctaRef,   { margin: '200px' });

  const {
    primaryColor, accentColor, headingFont, bodyFont,
    heroTitle, heroTitleAccent,
    ctaHeading, ctaHeadingAccent, ctaSubtext, ctaButton,
    footerTagline, footerLinksHeading,
    footerLink1Label, footerLink1Url, footerLink2Label, footerLink2Url,
    footerLink3Label, footerLink3Url, footerLink4Label, footerLink4Url,
    hideCta,
    ad1Label, ad1Title, ad1Description, ad1CtaText, ad1CtaUrl, ad1BgColor, ad1BgImage, ad1ImageLayout,
    ad2Label, ad2Title, ad2Description, ad2CtaText, ad2CtaUrl, ad2BgColor, ad2BgImage, ad2ImageLayout,
    ad3Label, ad3Title, ad3Description, ad3CtaText, ad3CtaUrl, ad3BgColor, ad3BgImage, ad3ImageLayout,
    hideAd1, hideAd2, hideAd3,
    hideAdBanner,
    adBannerFullWidth,
    siteDarkMode,
  } = siteConfig;
  const isPageDark = siteDarkMode === '1';

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont    ? `'${bodyFont}', sans-serif`    : undefined;

  const headingFontUrl = headingFont && headingFont !== 'Inter'
    ? `https://fonts.googleapis.com/css2?family=${headingFont.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`
    : null;
  const bodyFontUrl = bodyFont && bodyFont !== 'Inter' && bodyFont !== headingFont
    ? `https://fonts.googleapis.com/css2?family=${bodyFont.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`
    : null;

  const BLUE  = primaryColor || '#0056D2';
  const AMBER = accentColor  || '#FF9933';
  const GREEN = '#00BF63';
  const SLATE = '#334155';

  const courses   = programmes.filter(p => p.type === 'course');
  const paths     = programmes.filter(p => p.type === 'path');
  const ves       = programmes.filter(p => p.type === 've');
  const certs     = programmes.filter(p => p.type === 'certification');

  const courseGroups = groupByField(courses, 'category');
  const adCards = ([
    hideAd1 === '1' ? null : { label: ad1Label, title: ad1Title, description: ad1Description, ctaText: ad1CtaText, ctaUrl: ad1CtaUrl, bgColor: ad1BgColor, bgImage: ad1BgImage, imageLayout: ad1ImageLayout },
    hideAd2 === '1' ? null : { label: ad2Label, title: ad2Title, description: ad2Description, ctaText: ad2CtaText, ctaUrl: ad2CtaUrl, bgColor: ad2BgColor, bgImage: ad2BgImage, imageLayout: ad2ImageLayout },
    hideAd3 === '1' ? null : { label: ad3Label, title: ad3Title, description: ad3Description, ctaText: ad3CtaText, ctaUrl: ad3CtaUrl, bgColor: ad3BgColor, bgImage: ad3BgImage, imageLayout: ad3ImageLayout },
  ] as (AdCard | null)[]).filter((c): c is AdCard => c !== null);
  const midAdCards = midAdCardsFrom(siteConfig);


  // Shared with the pricing page, so both public pages offer the same Learn menu.
  const NAV_LINKS = buildNavGroups(programmes, user, navBooks, navEvents);

  return (
    <>
      {headingFontUrl && <link rel="stylesheet" href={headingFontUrl} />}
      {bodyFontUrl    && <link rel="stylesheet" href={bodyFontUrl} />}
    <main className="landing-scope min-h-screen overflow-x-hidden antialiased" style={{ background: isPageDark ? '#0d1117' : '#f4f7f9', fontFamily: bFont }}>

      <style>{`
        .land-shine-host { position: relative; }
        .land-card-shine { position: absolute; top: 0; bottom: 0; left: 0; width: 45%; opacity: 0; pointer-events: none; z-index: 15;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,0.17), transparent);
          transform: translateX(-130%) skewX(-14deg); }
        .land-shine-host:hover .land-card-shine { animation: land-sheen 0.9s ease; }
        @keyframes land-sheen {
          from { opacity: 1; transform: translateX(-130%) skewX(-14deg); }
          to   { opacity: 1; transform: translateX(330%) skewX(-14deg); }
        }
        @media (prefers-reduced-motion: reduce) { .land-card-shine { display: none; } }
      `}</style>

      {/* The page opens on the ad banner, not a hero, so the page's one H1 is for screen readers
          and search engines: the headline from Site settings, or the platform name. */}
      <h1 className="sr-only">{[heroTitle, heroTitleAccent].filter(Boolean).join(' ') || appName}</h1>

      <LandingScrollProgress from={BLUE} to={AMBER} />

      {/* NAV */}
      <LandingNav
        appName={appName}
        logoUrl={logoUrl}
        logoDarkUrl={logoDarkUrl}
        isPageDark={isPageDark}
        scrolled={scrolled}
        user={user}
        profile={profile}
        publicSignupEnabled={publicSignupEnabled}
        primaryColor={primaryColor}
        accentColor={accentColor}
        navLinks={NAV_LINKS}
        navMenuLabel="Learn"
      />

      {/* AD BANNER */}
      {hideAdBanner !== '1' && adCards.some(card => card.title) && (
        adBannerFullWidth === '1' ? (
          <div className="pt-16 md:pt-20">
            <LandingAdBanner ads={adCards} hFont={hFont} bFont={bFont} fullWidth isDark={isPageDark} />
          </div>
        ) : (
          <div className={`max-w-[1240px] mx-auto ${GUTTER} pb-2 pt-20 md:pt-24`}>
            <LandingAdBanner ads={adCards} hFont={hFont} bFont={bFont} isDark={isPageDark} />
          </div>
        )
      )}

      <div id="browse" />

      {/* COURSES */}
      {courses.length > 0 && (
        <section id="section-courses" className={SECTION_Y}>
          <div className={`max-w-[1240px] mx-auto ${GUTTER}`}>
            <MSectionHeading title="Courses" sub="Level up your skills with interactive and project-based courses."
              color={isPageDark ? 'white' : '#1C1D1F'} subColor={isPageDark ? 'rgba(255,255,255,0.55)' : LAND_C.muted}
              accent={AMBER} hFont={hFont} bFont={bFont} />
            <div className="space-y-4">
              {courseGroups.map(([cat, items]) => (
                <LandingCarouselRow buttonColor={BLUE} key={cat} title={cat} items={items} type="course" typeColor={BLUE} user={user} hFont={hFont} bFont={bFont} isDark={isPageDark} hideTitle={courseGroups.length === 1} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* LEARNING PATHS */}
      {paths.length > 0 && (
        <section id="section-paths" ref={pathsRef} className={`relative ${SECTION_Y} overflow-hidden`}
          style={{ background: isPageDark
            ? `linear-gradient(140deg, #0d1117 0%, ${shade(BLUE, -0.72)} 100%)`
            : `linear-gradient(140deg, ${shade(BLUE, -0.4)} 0%, ${BLUE} 62%, ${shade(BLUE, -0.12)} 100%)` }}>
          {!reduced && <>
            <Orb x="78%" y="-40%" size={360} color={shade(BLUE, 0.55)} delay={1} active={pathsInView} />
            <Orb x="-6%" y="55%" size={320} color={AMBER} delay={3} active={pathsInView} />
          </>}
          <div className={`relative z-10 max-w-[1240px] mx-auto ${GUTTER}`}>
            <MSectionHeading title="Learning paths" sub="Launch your career in tech with curated courses, virtual experiences and guided projects."
              color="white" subColor="rgba(255,255,255,0.85)" accent={AMBER} hFont={hFont} bFont={bFont} />
            <LandingCarouselRow buttonColor={BLUE} title="Learning Paths" items={paths} type="path" typeColor={AMBER} user={user} hFont={hFont} bFont={bFont} isDark transparentBg={!isPageDark} popupDark={isPageDark} hideTitle
              bg={isPageDark ? `linear-gradient(140deg, rgba(13,17,23,0.55) 0%, ${hexRgba(shade(BLUE, -0.72), 0.55)} 100%)` : undefined} />
          </div>
        </section>
      )}

      {/* MID-PAGE AD BANNER */}
      {hasMidAds(siteConfig) && (
        <MidAdBanner ads={midAdCards} hFont={hFont} bFont={bFont} isDark={isPageDark} />
      )}

      {/* VIRTUAL EXPERIENCES */}
      {ves.length > 0 && (
        <section id="section-ves" className={SECTION_Y}>
          <div className={`max-w-[1240px] mx-auto ${GUTTER}`}>
            <MSectionHeading title="Virtual experiences" sub="Gain job-ready skills with virtual internship programs and projects to build your portfolio."
              color={isPageDark ? 'white' : '#1C1D1F'} subColor={isPageDark ? 'rgba(255,255,255,0.55)' : LAND_C.muted}
              accent={AMBER} hFont={hFont} bFont={bFont} />
            {/* One row, not one per category. Grouping split a handful of experiences across
                several near-empty rows, each with its own heading, so the section read as
                fragmented rather than as a catalogue. */}
            <LandingCarouselRow buttonColor={BLUE} title="Virtual Experiences" items={ves} type="ve" typeColor={GREEN}
              user={user} hFont={hFont} bFont={bFont} isDark={isPageDark} hideTitle paged />
          </div>
        </section>
      )}

      {/* CERTIFICATIONS */}
      {certs.length > 0 && (
        <section id="section-certifications" className={SECTION_Y}>
          <div className={`max-w-[1240px] mx-auto ${GUTTER}`}>
            <MSectionHeading title="Certifications" sub="Prove what you can already do. Timed, protected exams that end in a credential you can share."
              color={isPageDark ? 'white' : '#1C1D1F'} subColor={isPageDark ? 'rgba(255,255,255,0.55)' : LAND_C.muted}
              accent={AMBER} hFont={hFont} bFont={bFont} />
            <LandingCarouselRow buttonColor={BLUE} title="Certifications" items={certs} type="certification" typeColor={SLATE}
              user={user} hFont={hFont} bFont={bFont} isDark={isPageDark} hideTitle paged />
          </div>
        </section>
      )}

      {/* DIGITAL PRODUCTS */}
      <ProductsShowcase products={storeProducts} dark={isPageDark} hFont={hFont} bFont={bFont} />

      {programmesError && <ProgrammeLoadError dark={isPageDark} />}

      {!programmesError && programmes.length === 0 && (
        <div className="min-h-[40vh] flex items-center justify-center text-sm" style={{ color: isPageDark ? 'rgba(255,255,255,0.40)' : '#6E7383' }}>
          No programmes yet. Check back soon.
        </div>
      )}

      {/* CTA SECTION */}
      {hideCta !== '1' && (
        <section ref={ctaRef} className="relative py-16 md:py-24 text-center overflow-hidden"
          style={{ background: `linear-gradient(140deg, ${shade(BLUE, -0.62)} 0%, ${BLUE} 72%, ${shade(BLUE, -0.1)} 100%)` }}>
          {!reduced && <>
            <Orb x="-8%" y="-30%" size={430} color={shade(BLUE, 0.4)} delay={0} active={ctaInView} />
            <Orb x="72%" y="40%" size={380} color={AMBER} delay={2.5} active={ctaInView} />
          </>}
          <div className={`relative z-10 max-w-[1240px] mx-auto ${GUTTER}`}>
            <h2 className={`mb-4 ${DISPLAY_CLASS}`} style={{ fontWeight: 900, fontFamily: hFont, color: 'white' }}>
              {ctaHeading}
              {ctaHeadingAccent && <><br /><span style={{ color: AMBER }}>{ctaHeadingAccent}</span></>}
            </h2>
            {ctaSubtext && (
              <p className="mx-auto mb-8" style={{ ...M3.bodyLarge, color: 'rgba(255,255,255,0.72)', maxWidth: 500, fontFamily: bFont ?? hFont }}>
                  {ctaSubtext}
                </p>
            )}
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Magnetic>
                  {/* With signups closed the page has nothing to sign up for, so the button
                      offers Log in, as the nav does. */}
                  <Link href={user ? '/student' : publicSignupEnabled ? '/auth?mode=signup' : '/auth'}
                    className="group inline-flex items-center gap-2 rounded-xl transition-shadow duration-300 hover:shadow-[0_16px_40px_-10px_rgba(0,0,0,0.45)]"
                    style={{ ...M3.labelLarge, fontWeight: 700, background: 'white', color: BLUE, padding: BUTTON_PAD }}>
                    {user ? 'Go to my learning' : publicSignupEnabled ? (ctaButton || 'Create free account') : 'Log in'}
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Magnetic>
                <a href="#browse"
                  className="inline-flex items-center rounded-xl transition-all"
                  style={{ ...M3.labelLarge, fontWeight: 700, padding: '8px 22px', color: 'white', border: '2px solid rgba(255,255,255,0.32)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'white'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.32)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  Explore programmes
                </a>
              </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <LandingFooter
        appName={appName}
        isPageDark={isPageDark}
        primaryColor={primaryColor}
        user={user}
        footerTagline={footerTagline}
        footerLinksHeading={footerLinksHeading}
        footerLink1Label={footerLink1Label} footerLink1Url={footerLink1Url}
        footerLink2Label={footerLink2Label} footerLink2Url={footerLink2Url}
        footerLink3Label={footerLink3Label} footerLink3Url={footerLink3Url}
        footerLink4Label={footerLink4Label} footerLink4Url={footerLink4Url}
      />


    </main>
    </>
  );
}

// --- Page ---
type LandingPageClientProps = {
  initialSiteConfig: Partial<SiteConfig>;
  initialProgrammes: ProgrammeItem[];
  programmesError: boolean;
  /** The store's books, for the Learn menu's Books entry. */
  navBooks?: NavBook[];
  /** Upcoming public events, for the Learn menu's Events entry. */
  navEvents?: NavBook[];
  /** The newest store products, for the Digital Products section. */
  storeProducts?: LandingProduct[];
  isPreview: boolean;
};

export default function LandingPageClient({
  initialSiteConfig,
  initialProgrammes,
  programmesError,
  navBooks,
  navEvents,
  storeProducts = [],
  isPreview,
}: LandingPageClientProps) {
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();

  const [user, setUser]         = useState<any>(null);
  const [profile, setProfile]   = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  // The dashboard's preview reads its config from localStorage after mount, so it renders nothing
  // until then rather than flashing the saved page.
  const [loading, setLoading]   = useState(isPreview);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => resolveConfig(initialSiteConfig));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isPreview) return;

    // Dashboard preview config must override the server-rendered settings.
    try {
      const raw = localStorage.getItem('_site_preview');
      if (raw) {
        const { config } = JSON.parse(raw);
        setSiteConfig(resolveConfig(config ?? {}));
      }
    } catch {}
    setLoading(false);
  }, [isPreview]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Live preview: receive config updates from dashboard iframe via postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'preview-config') {
        setSiteConfig(resolveConfig(e.data.config ?? {}));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    // Redirect to password reset if Supabase fires a PASSWORD_RECOVERY event
    // (happens when the recovery email link uses implicit flow and the hash
    // fragment lands on this page instead of /auth/callback).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/auth/reset-password';
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        const { data } = await supabase
          .from('students')
          .select('username, role, full_name, avatar_url')
          .eq('id', u.id)
          .single();
        setProfile(data);
      }
    });
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (loading) return null;

  return (
    <>
      <ModernTemplate user={user} profile={profile} scrolled={scrolled} siteConfig={siteConfig} logoUrl={logoUrl} logoDarkUrl={logoDarkUrl} appName={appName} publicSignupEnabled={publicSignupEnabled} programmes={initialProgrammes} programmesError={programmesError} navBooks={navBooks} navEvents={navEvents} storeProducts={storeProducts} />
      {/* Never inside the dashboard's site-editor preview. */}
      {!isPreview && <PromoCard placement="landing" light />}
    </>
  );
}
