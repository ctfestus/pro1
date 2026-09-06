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
  const discountMarks: { top?: string; bottom?: string; right: string; size: number; delay: string }[] = [
    { top: '12%', right: '29%', size: 20, delay: '0s' },
    { top: '22%', right: '4%', size: 16, delay: '0.9s' },
    { bottom: '15%', right: '25%', size: 24, delay: '1.6s' },
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes hero-offer-pulse {
          0%, 100% { opacity: 0.55; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .hero-discount-mark { animation: hero-offer-pulse 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hero-discount-mark { animation: none; } }
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
        className="absolute bottom-0 right-0 hidden lg:block"
        style={{ width: '34%', height: '72%' }}
        viewBox="0 0 300 220"
        fill="none"
        preserveAspectRatio="xMidYMax slice"
      >
        <path
          d="M-20 232 C 42 206, 108 202, 175 150 S 265 70, 320 100"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M-20 234 C 48 216, 114 220, 182 168 S 268 92, 320 122"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </svg>
      {discountMarks.map((discountMark, index) => (
        <svg
          key={index}
          className="hero-discount-mark absolute"
          style={{ ...discountMark, width: discountMark.size, height: discountMark.size, animationDelay: discountMark.delay }}
          viewBox="0 0 24 24"
          fill="none"
          stroke={accentColor}
          strokeWidth="1.75"
        >
          <circle cx="7.5" cy="7.5" r="2.5" />
          <circle cx="16.5" cy="16.5" r="2.5" />
          <path d="M18.5 5.5 5.5 18.5" strokeLinecap="round" />
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

  const { plan, price, perMonth, savingPercent, baselinePerMonth, alternative } = offer;
  const saving = savingPercent > 0;
  const promotion = Boolean(price.listAmount && price.listAmount > price.amount);
  const promotionBaseline = promotion ? Number(price.listAmount) / price.durationMonths : null;
  const displayedBaseline = promotionBaseline ?? baselinePerMonth;
  const displayedTotalBaseline = promotion
    ? Number(price.listAmount)
    : displayedBaseline !== null
      ? displayedBaseline * price.durationMonths
      : null;
  const promotionLabel = price.discountType === 'percentage'
    ? `${price.discountValue}% off`
    : `${formatMoney(price.currency, price.discountAmount ?? 0)} off`;

  return (
    <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
      <HeroFlourish accentColor={accentColor} />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <span className="inline-block rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider" style={{ background: '#FFFFFF', color: '#101828' }}>
            {plan.name}
          </span>
          <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] sm:text-5xl" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance', lineHeight: 1.02 }}>
            {promotion
              ? `Get ${durationLabel(price.durationMonths)} of full access at a better price`
              : saving
              ? `Learn at your own pace and save ${savingPercent}% over ${durationLabel(price.durationMonths)}`
              : `Learn at your own pace with ${durationLabel(price.durationMonths)} of full access`}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7" style={{ color: 'rgba(255,255,255,0.84)' }}>
            {plan.description || 'Full access to the catalogue while your plan runs. Start whenever suits you, and keep the certificates you earn.'}
          </p>
          <p className="mt-5 text-base" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="font-bold">{formatMoney(price.currency, price.amount)}</span>
            <span> for {durationLabel(price.durationMonths)}</span>
            <span style={{ color: 'rgba(255,255,255,0.70)' }}> - one payment, no automatic renewal</span>
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
              {promotion && (
                <div className="ticket-cutout relative rounded-2xl px-5 py-4" style={{ background: '#FFCC00' }}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                    <div className="min-w-0">
                      <span className="text-[11px] font-black uppercase tracking-[0.15em]" style={{ color: 'rgba(16,24,40,0.58)' }}>Offer applied</span>
                      <p className="mt-1 text-base font-black" style={{ color: '#101828', fontFamily: hFont }}>{promotionLabel}</p>
                    </div>
                    <div className="border-l-2 border-dashed pl-4 text-right" style={{ borderColor: 'rgba(16,24,40,0.42)' }}>
                      <p className="text-[11px] font-bold" style={{ color: 'rgba(16,24,40,0.58)' }}>You save</p>
                      <p className="mt-0.5 text-sm font-black" style={{ color: '#101828' }}>
                        {formatMoney(price.currency, price.discountAmount ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="rounded-2xl bg-white px-5 py-5 text-center">
                <p className="whitespace-nowrap font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont, fontSize: 'clamp(28px,3vw,38px)', lineHeight: 1.1 }}>
                  {formatMoney(price.currency, price.amount)}
                </p>
                <p className="mt-1 text-sm font-bold" style={{ color: '#344054' }}>
                  for {durationLabel(price.durationMonths)} of access
                </p>
                <div className="mt-4 border-t pt-3" style={{ borderColor: '#EAECF0' }}>
                  {displayedTotalBaseline !== null && displayedTotalBaseline > price.amount && (
                    <p className="text-xs" style={{ color: '#98A2B3' }}>
                      Usually <span className="line-through">{formatMoney(price.currency, displayedTotalBaseline)}</span>
                    </p>
                  )}
                  <p className="mt-1 text-xs font-bold" style={{ color: '#475467' }}>
                    {formatMoney(price.currency, perMonth)}/month equivalent
                  </p>
                </div>
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
