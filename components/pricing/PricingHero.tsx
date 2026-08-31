'use client';

import Link from 'next/link';
import { ArrowDown } from 'lucide-react';
import { useToolIcons } from '@/lib/use-tool-icons';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

const HERO_TOOLS: { name: string; glyph: number }[] = [
  { name: 'Claude', glyph: 36 },
  { name: 'ChatGPT', glyph: 32 },
  { name: 'Excel', glyph: 32 },
  { name: 'Power BI', glyph: 32 },
];

function HeroFlourish({ accentColor }: { accentColor: string }) {
  const sparkles: { top?: string; bottom?: string; right: string; size: number; delay: string }[] = [
    { top: '10%', right: '30%', size: 18, delay: '0s' },
    { top: '20%', right: '4%', size: 14, delay: '0.9s' },
    { bottom: '14%', right: '26%', size: 22, delay: '1.6s' },
    { bottom: '30%', right: '2%', size: 15, delay: '0.4s' },
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes hero-twinkle {
          0%, 100% { opacity: 0.55; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .hero-sparkle { animation: hero-twinkle 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hero-sparkle { animation: none; } }
      `}</style>
      <div
        className="absolute rounded-full"
        style={{
          right: '-6%',
          top: '-18%',
          width: 520,
          height: 520,
          background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 68%)',
        }}
      />
      <svg
        className="absolute inset-y-0 -right-[4%] hidden h-full w-[54%] lg:block"
        viewBox="0 0 560 420"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        <path d="M-30 355 C 95 238, 166 360, 282 252 S 438 92, 610 148" stroke="rgba(255,255,255,0.09)" strokeWidth="58" strokeLinecap="round" />
        <path d="M-30 340 C 96 224, 168 345, 280 238 S 438 78, 610 134" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
        <path d="M-30 369 C 96 252, 166 373, 286 266 S 442 108, 610 164" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeLinecap="round" />
        <path d="M20 338 C 128 260, 176 335, 276 245 S 422 112, 548 136" stroke={accentColor} strokeOpacity="0.72" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {sparkles.map((sparkle, index) => (
        <svg
          key={index}
          className="hero-sparkle absolute"
          style={{ ...sparkle, width: sparkle.size, height: sparkle.size, animationDelay: sparkle.delay }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path d="M12 0 C 13 8, 16 11, 24 12 C 16 13, 13 16, 12 24 C 11 16, 8 13, 0 12 C 8 11, 11 8, 12 0 Z" fill={accentColor} />
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
}

export function PricingHero({
  offer, primaryColor, accentColor, headingFont, bodyFont,
}: PricingHeroProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  const toolIcon = useToolIcons();

  if (!offer) {
    return (
      <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
        <HeroFlourish accentColor={accentColor} />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 pt-12 text-center sm:px-8 sm:pb-28 sm:pt-14">
          <h1 className="text-4xl font-black tracking-[-0.04em] sm:text-5xl" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance' }}>
            Learn the skills you need to move your career forward
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base" style={{ color: 'rgba(255,255,255,0.82)' }}>
            Start free and keep going at your own pace.
          </p>
          <Link href="#pricing-plans" className="mt-8 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none" style={{ background: '#FFFFFF', color: '#101828' }}>
            Explore access plans <ArrowDown className="h-4 w-4" />
          </Link>
        </div>
      </section>
    );
  }

  const { plan, price, perMonth, savingPercent, monthsPaidFor, baselinePerMonth, alternative } = offer;
  const saving = savingPercent > 0;

  return (
    <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
      <HeroFlourish accentColor={accentColor} />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <span className="inline-block rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider" style={{ background: '#FFFFFF', color: '#101828' }}>
            {plan.name}
          </span>
          <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] sm:text-5xl" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance', lineHeight: 1.02 }}>
            {saving
              ? `Learn at your own pace and save ${savingPercent}% over ${durationLabel(price.durationMonths)}`
              : `Learn at your own pace with ${durationLabel(price.durationMonths)} of full access`}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7" style={{ color: 'rgba(255,255,255,0.84)' }}>
            {plan.description || 'Full access to the catalogue while your plan runs. Start whenever suits you, and keep the certificates you earn.'}
          </p>
          <p className="mt-5 text-base" style={{ color: 'rgba(255,255,255,0.92)' }}>
            {saving && baselinePerMonth !== null && (
              <span className="mr-2 line-through" style={{ color: 'rgba(255,255,255,0.55)' }}>{formatMoney(price.currency, baselinePerMonth)}</span>
            )}
            <span className="font-bold">{formatMoney(price.currency, perMonth)} a month</span>
            <span style={{ color: 'rgba(255,255,255,0.70)' }}> - no automatic renewal</span>
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="#pricing-plans" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none" style={{ background: '#FFFFFF', color: '#101828' }}>
              Explore access plans <ArrowDown className="h-4 w-4" />
            </Link>
            {alternative && (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
                or {formatMoney(alternative.currency, alternative.amount)} for {durationLabel(alternative.durationMonths)}
              </span>
            )}
          </div>
        </div>

        <div className="w-full max-w-sm lg:justify-self-end">
          <div className="flex items-center gap-9 sm:gap-11">
            <div className="min-w-0 max-w-[240px] flex-1 space-y-2.5">
              <div className="rounded-xl bg-white px-4 py-4 text-center">
                {saving && baselinePerMonth !== null && (
                  <p className="text-sm line-through" style={{ color: '#98A2B3' }}>{formatMoney(price.currency, baselinePerMonth)}</p>
                )}
                <p className="whitespace-nowrap font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont, fontSize: 'clamp(20px,2.3vw,28px)', lineHeight: 1.15 }}>
                  {formatMoney(price.currency, perMonth)}
                  <span className="ml-1 text-xs font-bold" style={{ color: '#475467' }}>/month</span>
                </p>
              </div>
              <div className="rounded-xl px-4 py-4 text-center" style={{ background: accentColor }}>
                <p className="text-sm font-black" style={{ color: '#101828', fontFamily: hFont }}>
                  {monthsPaidFor !== null
                    ? `Pay for only ${monthsPaidFor} months`
                    : saving
                      ? `Save ${savingPercent}%`
                      : `${durationLabel(price.durationMonths)} of full access`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2.5">
              {HERO_TOOLS.map(tool => {
                const icon = toolIcon(tool.name);
                if (!icon) return null;
                return (
                  <span key={tool.name} title={tool.name} className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white" style={{ boxShadow: '0 2px 8px rgba(16,24,40,0.20)' }}>
                    <img src={icon} alt={tool.name} className="object-contain" style={{ width: tool.glyph, height: tool.glyph }} loading="lazy" />
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
