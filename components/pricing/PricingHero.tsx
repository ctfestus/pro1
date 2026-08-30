/**
 * The banner at the top of the pricing page, leading with the best-value plan.
 *
 * Every figure is computed from what an admin priced. The struck-through rate appears only when
 * there is a real saving to strike it against, so the page never dresses a single price up as a
 * discount -- and there is no countdown, because there is no offer with an end date behind it.
 */
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { durationLabel, formatMoney, type FeaturedOffer } from '@/lib/pricing-offer';

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
    <section style={{ background: primaryColor, fontFamily: bFont }}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-12 sm:py-16 grid gap-10 lg:grid-cols-[1.15fr_0.85fr] items-center">
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
