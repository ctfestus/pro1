'use client';

import Link from 'next/link';
import { ArrowDown, Check, Sparkles } from 'lucide-react';
import { useToolIcons } from '@/lib/use-tool-icons';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

const HERO_TOOLS: { name: string; glyph: number }[] = [
  { name: 'Claude', glyph: 30 },
  { name: 'ChatGPT', glyph: 28 },
  { name: 'Excel', glyph: 28 },
  { name: 'Power BI', glyph: 28 },
];

function ConsoleBackdrop({ primaryColor, accentColor }: { primaryColor: string; accentColor: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes pricing-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pricing-pulse {
          0%, 100% { opacity: 0.34; transform: scale(0.96); }
          50% { opacity: 0.7; transform: scale(1.04); }
        }
        .pricing-orbit { animation: pricing-orbit 30s linear infinite; }
        .pricing-pulse { animation: pricing-pulse 5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .pricing-orbit, .pricing-pulse { animation: none; }
        }
      `}</style>
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'linear-gradient(to right, transparent 2%, black 56%, black)',
        }}
      />
      <div
        className="pricing-pulse absolute -right-24 -top-44 h-[520px] w-[520px] rounded-full blur-3xl"
        style={{ background: `color-mix(in srgb, ${accentColor} 32%, transparent)` }}
      />
      <div
        className="absolute -bottom-48 left-[28%] h-96 w-96 rounded-full blur-3xl"
        style={{ background: `color-mix(in srgb, ${primaryColor} 58%, #ffffff 14%)`, opacity: 0.3 }}
      />
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

  return (
    <section
      className="relative isolate overflow-hidden"
      style={{ background: `linear-gradient(135deg, #09111F 0%, color-mix(in srgb, ${primaryColor} 48%, #09111F) 62%, #09111F 100%)`, fontFamily: bFont }}
    >
      <ConsoleBackdrop primaryColor={primaryColor} accentColor={accentColor} />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-12 px-5 pb-28 pt-14 sm:px-8 sm:pb-32 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ background: 'rgba(255,255,255,0.09)', color: '#FFFFFF' }}>
            <Sparkles className="h-3.5 w-3.5" style={{ color: accentColor }} />
            Flexible learning access
          </div>
          <h1
            className="mt-6 max-w-3xl text-4xl font-black tracking-[-0.045em] text-white sm:text-6xl lg:text-[64px]"
            style={{ fontFamily: hFont, color: '#FFFFFF', textWrap: 'balance', lineHeight: 0.98 }}
          >
            Choose the access that moves you forward.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 sm:text-lg" style={{ color: 'rgba(255,255,255,0.72)' }}>
            Start free, choose the learning experience you need, and pay only for the time you want. Your work and certificates stay with you.
          </p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {['No card to start', 'No automatic renewal', 'Flexible payment options'].map(item => (
              <span key={item} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4" style={{ color: accentColor }} />
                {item}
              </span>
            ))}
          </div>
          <Link
            href="#pricing-plans"
            className="mt-8 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none"
            style={{ background: '#FFFFFF', color: '#101828' }}
          >
            Explore access plans <ArrowDown className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:justify-self-end">
          <div className="pricing-orbit absolute -inset-8 rounded-full border" style={{ borderColor: 'rgba(255,255,255,0.10)' }} />
          <div className="absolute -inset-3 rounded-[36px] opacity-45 blur-2xl" style={{ background: `color-mix(in srgb, ${accentColor} 20%, transparent)` }} />
          <div className="relative overflow-hidden rounded-[30px] p-5 sm:p-6" style={{ background: 'rgba(255,255,255,0.10)', boxShadow: '0 28px 80px rgba(0,0,0,0.34)', backdropFilter: 'blur(24px)' }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.52)' }}>Access console</p>
                <p className="mt-1 text-sm font-bold" style={{ color: '#FFFFFF' }}>Your selected term</p>
              </div>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#34D399', boxShadow: '0 0 18px #34D399' }} />
            </div>

            <div className="mt-8 rounded-2xl p-5" style={{ background: 'rgba(5,12,24,0.58)' }}>
              {offer ? (
                <>
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-sm font-bold" style={{ color: '#FFFFFF' }}>{offer.plan.name}</p>
                      <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.52)' }}>{durationLabel(offer.price.durationMonths)} access</p>
                    </div>
                    {offer.savingPercent > 0 && (
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: accentColor, color: '#101828' }}>
                        Save {offer.savingPercent}%
                      </span>
                    )}
                  </div>
                  <p className="mt-7 text-4xl font-black tracking-[-0.04em]" style={{ color: '#FFFFFF', fontFamily: hFont }}>
                    {formatMoney(offer.price.currency, offer.price.amount)}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.56)' }}>
                    {formatMoney(offer.price.currency, offer.perMonth)} a month. Nothing renews automatically.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold" style={{ color: '#FFFFFF' }}>Start with free access</p>
                  <p className="mt-2 text-xs leading-5" style={{ color: 'rgba(255,255,255,0.58)' }}>
                    Create your account now and upgrade when you are ready.
                  </p>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <p className="max-w-[150px] text-xs leading-5" style={{ color: 'rgba(255,255,255,0.52)' }}>Learn with the tools used in modern teams.</p>
              <div className="flex -space-x-2">
                {HERO_TOOLS.map(tool => {
                  const icon = toolIcon(tool.name);
                  if (!icon) return null;
                  return (
                    <span key={tool.name} title={tool.name} className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#172033] bg-white">
                      <img src={icon} alt={tool.name} className="object-contain" style={{ width: tool.glyph, height: tool.glyph }} loading="lazy" />
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
