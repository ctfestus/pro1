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
  appName: string;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  ctaHref: string;
  ctaLabel: string;
}

export function PricingHero({
  offer, appName, primaryColor, accentColor, headingFont, bodyFont, ctaHref, ctaLabel,
}: PricingHeroProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;

  // Nothing is on sale, so there is no offer to lead with. A plain heading beats an empty
  // banner shouting about a price that does not exist.
  if (!offer) {
    return (
      <div className="text-center pt-6 pb-10">
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
    <section
      className="rounded-3xl overflow-hidden mt-2"
      style={{ background: primaryColor, fontFamily: bFont }}
    >
      <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] items-center p-7 sm:p-10">
        {/* ---------- the pitch ---------- */}
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-lg font-bold" style={{ color: '#FFFFFF', fontFamily: hFont }}>{appName}</span>
            <span
              className="rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: '#FFFFFF', color: primaryColor }}
            >
              {plan.name}
            </span>
          </div>

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
        <div className="lg:justify-self-end w-full max-w-sm">
          <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.12)' }}>
            {saving && baselinePerMonth !== null && (
              <p className="text-lg line-through" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {formatMoney(price.currency, baselinePerMonth)}
              </p>
            )}
            <p className="mt-1 font-bold tracking-tight" style={{ color: '#FFFFFF', fontFamily: hFont, fontSize: 'clamp(34px,5vw,52px)', lineHeight: 1.05 }}>
              {formatMoney(price.currency, perMonth)}
              <span className="ml-1 text-base font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>/month</span>
            </p>
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.78)' }}>
              {formatMoney(price.currency, price.amount)} for {durationLabel(price.durationMonths)}
            </p>
            {saving && (
              <p
                className="mt-4 rounded-xl px-4 py-2.5 text-sm font-bold"
                style={{ background: accentColor, color: '#101828' }}
              >
                Save {savingPercent}% over {durationLabel(price.durationMonths)}
              </p>
            )}
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.78)' }}>
              <Check className="w-3.5 h-3.5" /> One payment, no renewal
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
