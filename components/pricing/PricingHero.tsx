'use client';

import { useToolIcons } from '@/lib/use-tool-icons';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

const HERO_TOOLS: { name: string; glyph: number }[] = [
  { name: 'Claude', glyph: 36 },
  { name: 'ChatGPT', glyph: 32 },
  { name: 'Excel', glyph: 32 },
  { name: 'Power BI', glyph: 32 },
];

function billingLabel(months: number): string {
  if (months === 1) return 'Monthly';
  if (months === 3) return 'Quarterly';
  if (months === 12) return 'Yearly';
  return `Every ${months} months`;
}

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
  /** The page's best offer, whose saving the length switch names. */
  bestOffer: FeaturedOffer | null;
  durationOptions: number[];
  selectedDuration: number | null;
  onSelectDuration: (months: number) => void;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
}

export function PricingHero({
  offer, bestOffer, durationOptions, selectedDuration, onSelectDuration, primaryColor, accentColor, headingFont, bodyFont,
}: PricingHeroProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  const toolIcon = useToolIcons();

  // One switch for every plan, where the choice starts. The saving rides on the length it belongs to.
  const lengthSwitch = durationOptions.length === 2 && durationOptions[0] !== durationOptions[1] && (
    <div role="radiogroup" aria-label="Access length" className="inline-flex gap-1 rounded-full p-1" style={{ background: 'rgba(255,255,255,0.16)' }}>
      {durationOptions.map(option => {
        const selected = option === selectedDuration;
        const saving = bestOffer && bestOffer.price.durationMonths === option && bestOffer.savingPercent > 0 ? bestOffer.savingPercent : 0;
        return (
          <button key={option} type="button" role="radio" aria-checked={selected} onClick={() => onSelectDuration(option)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors"
            style={{ background: selected ? '#FFFFFF' : 'transparent', color: selected ? primaryColor : '#FFFFFF' }}>
            {billingLabel(option)}
            {saving > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-black" style={{ background: '#F5D77A', color: '#3d2e00' }}>Save {saving}%</span>}
          </button>
        );
      })}
    </div>
  );

  const tools = (
    <div className="flex gap-3 lg:flex-col lg:justify-self-end">
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
  );

  if (!offer) {
    return (
      <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
        <HeroFlourish accentColor={accentColor} />
        <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h1 className="text-4xl leading-[44px] font-black tracking-[-0.04em] sm:text-[45px] sm:leading-[52px]" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance' }}>
              Learn the skills you need to move your career forward
            </h1>
            <p className="mt-5 max-w-2xl text-base" style={{ color: 'rgba(255,255,255,0.82)' }}>
              Start free and keep going at your own pace.
            </p>
            {lengthSwitch && <div className="mt-7">{lengthSwitch}</div>}
          </div>
          {tools}
        </div>
      </section>
    );
  }

  const { price, savingPercent } = offer;
  const saving = savingPercent > 0;
  const promotion = Boolean(price.listAmount && price.listAmount > price.amount);

  return (
    <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
      <HeroFlourish accentColor={accentColor} />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h1 className="text-4xl leading-[44px] font-black tracking-[-0.04em] sm:text-[45px] sm:leading-[52px]" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance' }}>
            {promotion
              ? `Get ${durationLabel(price.durationMonths)} of full access at a better price`
              : saving
              ? `Learn at your own pace and save ${savingPercent}% over ${durationLabel(price.durationMonths)}`
              : `Learn at your own pace with ${durationLabel(price.durationMonths)} of full access`}
          </h1>
          <p className="mt-5 text-base" style={{ color: 'rgba(255,255,255,0.92)' }}>
            <span className="font-bold">{formatMoney(price.currency, price.amount)}</span>
            <span> for {durationLabel(price.durationMonths)}</span>
            <span style={{ color: 'rgba(255,255,255,0.70)' }}>, one payment, no automatic renewal.</span>
          </p>
          {lengthSwitch && <div className="mt-7">{lengthSwitch}</div>}
        </div>
        {tools}
      </div>
    </section>
  );
}
