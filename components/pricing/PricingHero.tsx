'use client';

import { useToolIcons } from '@/lib/use-tool-icons';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

// Space Grotesk, the display face the course pages use for their headings.
const DISPLAY_FONT = 'var(--font-display), sans-serif';

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

export interface PricingHeroProps {
  offer: FeaturedOffer | null;
  /** The page's best offer, whose saving the length switch names. */
  bestOffer: FeaturedOffer | null;
  durationOptions: number[];
  selectedDuration: number | null;
  onSelectDuration: (months: number) => void;
  primaryColor: string;
  /** The site's secondary accent, for the chosen length in the headline. */
  accentColor: string;
  bodyFont?: string;
}

export function PricingHero({
  offer, bestOffer, durationOptions, selectedDuration, onSelectDuration, primaryColor, accentColor, bodyFont,
}: PricingHeroProps) {
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
        <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h1 className="text-4xl leading-[44px] font-black tracking-[-0.04em] sm:text-[45px] sm:leading-[52px]" style={{ color: '#FFFFFF', fontFamily: DISPLAY_FONT, textWrap: 'balance' }}>
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
  // The chosen length stands out in the secondary accent, so the switch visibly changes the headline.
  const length = <span style={{ color: accentColor }}>{durationLabel(price.durationMonths)}</span>;

  return (
    <section className="relative overflow-hidden" style={{ background: primaryColor, fontFamily: bFont }}>
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-24 pt-12 sm:px-8 sm:pb-28 sm:pt-14 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h1 className="text-4xl leading-[44px] font-black tracking-[-0.04em] sm:text-[45px] sm:leading-[52px]" style={{ color: '#FFFFFF', fontFamily: DISPLAY_FONT, textWrap: 'balance' }}>
            {promotion
              ? <>Get {length} of full access at a better price</>
              : saving
              ? <>Learn at your own pace and save {savingPercent}% over {length}</>
              : <>Learn at your own pace with {length} of full access</>}
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
