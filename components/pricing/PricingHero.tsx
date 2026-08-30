'use client';

/**
 * The banner at the top of the pricing page, leading with the best-value plan.
 *
 * Every figure is computed from what an admin priced. The struck-through rate appears only when
 * there is a real saving to strike it against, so the page never dresses a single price up as a
 * discount -- and there is no countdown, because there is no offer with an end date behind it.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useToolIcons } from '@/lib/use-tool-icons';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

/** Named here rather than read from the catalogue: the tools column lives on virtual
 *  experiences only and is not in any public view, so this is a short curated list. */
const HERO_TOOLS = ['Claude', 'ChatGPT', 'Excel', 'Power BI', 'SQL'];

/**
 * Decoration only -- a ribbon and a scatter of sparkles, so the offer reads as an offer rather
 * than as a table of figures. Hidden from assistive technology and from pointer events, and it
 * holds still for anyone who has asked for less motion.
 */
function HeroFlourish({ accentColor }: { accentColor: string }) {
  const sparkles = [
    { top: '12%', left: '8%', size: 26, delay: '0s' },
    { top: '68%', left: '3%', size: 18, delay: '0.9s' },
    { top: '6%', right: '18%', size: 20, delay: '1.6s' },
    { top: '78%', right: '9%', size: 30, delay: '0.4s' },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes hero-twinkle {
          0%, 100% { opacity: 0.55; transform: scale(0.9); }
          50%      { opacity: 1;    transform: scale(1.1); }
        }
        .hero-sparkle { animation: hero-twinkle 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hero-sparkle { animation: none; } }
      `}</style>

      {/* A soft glow so the price lifts off the band instead of sitting flat on it. */}
      <div
        className="absolute rounded-full"
        style={{
          right: '-6%', top: '-18%', width: 520, height: 520,
          background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 68%)',
        }}
      />

      {/* The ribbon. Stroked rather than filled, so it stays a light line on any brand colour. */}
      <svg className="absolute right-0 top-0 h-full w-[62%] hidden sm:block"
        viewBox="0 0 400 300" fill="none" preserveAspectRatio="xMidYMid slice">
        <path
          d="M-20 210 C 60 150, 90 250, 170 190 S 300 60, 420 120"
          stroke="rgba(255,255,255,0.20)" strokeWidth="26" strokeLinecap="round"
        />
        <path
          d="M-20 232 C 70 176, 96 268, 178 210 S 306 86, 420 146"
          stroke="rgba(255,255,255,0.10)" strokeWidth="14" strokeLinecap="round"
        />
      </svg>

      {sparkles.map((sparkle, i) => (
        <svg
          key={i}
          className="hero-sparkle absolute"
          style={{ ...sparkle, width: sparkle.size, height: sparkle.size, animationDelay: sparkle.delay }}
          viewBox="0 0 24 24" fill="none"
        >
          <path d="M12 0 C 13 8, 16 11, 24 12 C 16 13, 13 16, 12 24 C 11 16, 8 13, 0 12 C 8 11, 11 8, 12 0 Z"
            fill={accentColor} />
        </svg>
      ))}
    </div>
  );
}

export interface PricingHeroProps {
  offer: FeaturedOffer | null;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  ctaHref: string;
  ctaLabel: string;
}

export function PricingHero({
  offer, primaryColor, accentColor, headingFont, bodyFont, ctaHref, ctaLabel,
}: PricingHeroProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  // Built-in logos render at once; anything an instructor uploaded replaces them when it arrives.
  const toolIcon = useToolIcons();

  // Nothing is on sale, so there is no offer to lead with. A plain heading beats an empty
  // banner shouting about a price that does not exist.
  if (!offer) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 text-center pt-10 pb-4">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight"
          style={{ fontFamily: hFont, color: '#101828', textWrap: 'balance' }}>
          Learn the skills you need to move your career forward
        </h1>
        <p className="mt-4 text-base max-w-2xl mx-auto" style={{ color: '#475467', fontFamily: bFont }}>
          Start free and keep going at your own pace.
        </p>
      </div>
    );
  }

  const { plan, price, perMonth, savingPercent, baselinePerMonth, alternative } = offer;
  const saving = savingPercent > 0;

  return (
    // Edge to edge: the band runs the full width of the page and only its contents are
    // constrained, so the colour reaches both sides of the screen rather than floating in a card.
    <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
      <HeroFlourish accentColor={accentColor} />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8 py-12 sm:py-16 grid gap-10 lg:grid-cols-[1.15fr_0.85fr] items-center">
        {/* ---------- the pitch ---------- */}
        <div>
          <span
            className="inline-block rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: '#FFFFFF', color: primaryColor }}
          >
            {plan.name}
          </span>

          <h1
            className="mt-5 text-3xl sm:text-5xl font-bold tracking-tight"
            style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance', lineHeight: 1.05 }}
          >
            {saving
              ? `Learn at your own pace and save ${savingPercent}% over ${durationLabel(price.durationMonths)}`
              : `Learn at your own pace with ${durationLabel(price.durationMonths)} of full access`}
          </h1>

          <p className="mt-5 text-base leading-relaxed max-w-xl" style={{ color: 'rgba(255,255,255,0.86)' }}>
            {plan.description
              || 'Full access to the catalogue while your plan runs. Start whenever suits you, and keep the certificates you earn.'}
          </p>

          <p className="mt-5 text-base" style={{ color: 'rgba(255,255,255,0.92)' }}>
            {saving && baselinePerMonth !== null && (
              <span className="line-through mr-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {formatMoney(price.currency, baselinePerMonth)}
              </span>
            )}
            <span className="font-bold">{formatMoney(price.currency, perMonth)} a month</span>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}> - no automatic renewal</span>
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold"
              style={{ background: '#FFFFFF', color: primaryColor }}
            >
              {ctaLabel} <ArrowRight className="w-4 h-4" />
            </Link>
            {alternative && (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
                or {formatMoney(alternative.currency, alternative.amount)} for {durationLabel(alternative.durationMonths)}
              </span>
            )}
          </div>

          <p className="mt-5 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Access runs for the length you choose and ends on the date shown. Nothing charges you again.
          </p>
        </div>

        {/* ---------- the number ---------- */}
        <div className="lg:justify-self-end w-full max-w-sm space-y-3">
          <div className="rounded-2xl px-6 py-6 text-center" style={{ background: '#FFFFFF' }}>
            {saving && baselinePerMonth !== null && (
              <p className="text-xl line-through" style={{ color: '#98A2B3' }}>
                {formatMoney(price.currency, baselinePerMonth)}
              </p>
            )}
            <p
              className="font-bold tracking-tight"
              style={{ color: '#101828', fontFamily: hFont, fontSize: 'clamp(32px,4.4vw,50px)', lineHeight: 1.05 }}
            >
              {formatMoney(price.currency, perMonth)}
              <span className="ml-1 text-base font-bold" style={{ color: '#475467' }}>/month</span>
            </p>
          </div>

          <div className="flex items-center justify-center gap-2.5 pt-1">
            {HERO_TOOLS.map(tool => {
              const icon = toolIcon(tool);
              if (!icon) return null;
              return (
                <span
                  key={tool}
                  title={tool}
                  className="grid place-items-center rounded-full"
                  style={{ background: '#FFFFFF', width: 38, height: 38, boxShadow: '0 2px 6px rgba(16,24,40,0.18)' }}
                >
                  <img src={icon} alt={tool} className="w-5 h-5 object-contain" loading="lazy" />
                </span>
              );
            })}
          </div>

          {saving ? (
            <div className="rounded-2xl px-6 py-4 text-center" style={{ background: accentColor }}>
              <p className="text-base font-bold" style={{ color: '#101828', fontFamily: hFont }}>
                {durationLabel(price.durationMonths)} of savings
              </p>
            </div>
          ) : (
            <div className="rounded-2xl px-6 py-4 text-center" style={{ background: accentColor }}>
              <p className="text-base font-bold" style={{ color: '#101828', fontFamily: hFont }}>
                {durationLabel(price.durationMonths)} of full access
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
