'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Award,
  Building2,
  Check,
  CreditCard,
  Minus,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { comparePlanPrice } from '@/lib/plan-price-comparison';
import { startPlanCheckout } from '@/lib/start-plan-checkout';
import { planBenefits } from '@/lib/pricing-benefits';
import { MidAdBanner } from '@/components/landing/MidAdBanner';
import type { AdCard } from '@/lib/mid-ads';
import { durationLabel, formatMoney as money } from '@/lib/pricing-offer';
import {
  CONTENT_KINDS,
  type ContentCounts,
  type PricingPageData,
  type PricingPlan,
} from '@/lib/pricing-contract';
import type { PurchasableContentTable } from '@/lib/subscription-plan-access';

const KIND_LABEL: Record<PurchasableContentTable, string> = {
  courses: 'Courses',
  learning_paths: 'Learning paths',
  virtual_experiences: 'Virtual experiences',
  certifications: 'Certifications',
};

const KIND_DESCRIPTION: Record<PurchasableContentTable, string> = {
  courses: 'Build focused, practical skills',
  learning_paths: 'Follow a guided sequence',
  virtual_experiences: 'Practise through realistic work',
  certifications: 'Prove what you have completed',
};

export interface PricingSectionProps extends PricingPageData {
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  signedIn: boolean;
  /** Whether a card checkout can be opened from here at all. */
  paystackEnabled: boolean;
  supportEmail?: string;
  midAds?: AdCard[];
  durations: number[];
  selectedDuration: number | null;
  onSelectDuration: (months: number) => void;
}

export function PricingSection({
  plans,
  free,
  primaryColor,
  accentColor,
  headingFont,
  bodyFont,
  signedIn,
  paystackEnabled,
  supportEmail,
  midAds,
  durations,
  selectedDuration,
  onSelectDuration,
}: PricingSectionProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  // One label for everyone. The button opened the same checkout either way, and the signed-in
  // wording resolved a moment after the page drew, so it changed under whoever was reading it.
  const buyLabel = 'Enroll Now';
  const [busyPriceId, setBusyPriceId] = useState('');

  const buy = async (priceId: string) => {
    setBusyPriceId(priceId);
    const outcome = await startPlanCheckout(priceId, { paystackEnabled });
    if (outcome.kind !== 'redirecting') window.location.href = outcome.href;
  };

  const bestDuration = useMemo(() => {
    let best: { months: number; saving: number; monthsPaidFor: number | null } | null = null;
    for (const months of durations) {
      for (const plan of plans) {
        const price = plan.prices.find(row => row.durationMonths === months);
        if (!price) continue;
        const { savingPercent, monthsPaidFor } = comparePlanPrice(price, plan.prices);
        if (savingPercent > 0 && (!best || savingPercent > best.saving)) {
          best = { months, saving: savingPercent, monthsPaidFor };
        }
      }
    }
    return best;
  }, [durations, plans]);

  return (
    <section
      id="pricing-plans"
      className="relative z-20 -mt-16 scroll-mt-24"
      style={{ fontFamily: bFont, '--pricing-accent': accentColor } as CSSProperties}
    >
      <style>{`
        .pricing-plan-card:hover {
          box-shadow: inset 0 0 0 3px var(--pricing-accent);
        }
      `}</style>
      <div className="rounded-[30px] bg-white p-5 sm:p-8" style={{ boxShadow: '0 24px 80px rgba(16,24,40,0.12)' }}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl" style={{ color: '#101828', fontFamily: hFont, textWrap: 'balance' }}>
              Pick a term. Choose your experience.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: '#5F6B7A' }}>
              Prices update with your access length, so every option stays easy to compare.
            </p>
          </div>

          {durations.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-bold lg:text-right" style={{ color: '#667085' }}>Access length</p>
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl p-1.5" role="group" aria-label="Access length" style={{ background: '#F1F4F7' }}>
                {durations.map(months => {
                  const active = months === selectedDuration;
                  const marked = bestDuration?.months === months ? bestDuration : null;
                  return (
                    <button
                      key={months}
                      type="button"
                      onClick={() => onSelectDuration(months)}
                      aria-pressed={active}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-black transition-all duration-200 motion-reduce:transition-none"
                      style={{
                        background: active ? '#FFFFFF' : 'transparent',
                        color: active ? '#101828' : '#667085',
                        boxShadow: active ? '0 4px 16px rgba(16,24,40,0.10)' : undefined,
                      }}
                    >
                      {durationLabel(months)}
                      {marked && (
                        <span className="hidden rounded-full px-2 py-0.5 text-[10px] font-black sm:inline" style={{ background: accentColor, color: '#101828' }}>
                          {marked.monthsPaidFor !== null ? `Pay for ${marked.monthsPaidFor}` : `Save ${marked.saving}%`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FreePlanCard
            free={free}
            signedIn={signedIn}
            hFont={hFont}
          />
          {plans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              months={selectedDuration}
              hFont={hFont}
              primaryColor={primaryColor}
              accentColor={accentColor}
              buyLabel={buyLabel}
              busy={busyPriceId}
              onBuy={buy}
            />
          ))}
        </div>

        {plans.length === 0 && (
          <div className="mt-8 rounded-2xl p-6 text-center" style={{ background: '#F7F9FB' }}>
            <p className="font-bold" style={{ color: '#344054' }}>Paid access is not available yet.</p>
            <p className="mt-1 text-sm" style={{ color: '#667085' }}>Start free and check back soon.</p>
          </div>
        )}

        <TeamsStrip supportEmail={supportEmail} accentColor={accentColor} hFont={hFont} />
      </div>

      <TrustRail />

      <ComparisonTable
        plans={plans}
        free={free}
        months={selectedDuration}
        hFont={hFont}
      />

      {midAds && midAds.some(ad => ad.title) && (
        <section className="mt-20">
          <div className="mb-7 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: '#475467', fontFamily: hFont }}>What access can unlock</p>
            <h3 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl" style={{ color: '#101828', fontFamily: hFont }}>
              Turn learning into visible progress
            </h3>
          </div>
          <div className="-mx-5 sm:-mx-8">
            <MidAdBanner ads={midAds} hFont={hFont} bFont={bFont} background="transparent" />
          </div>
        </section>
      )}
    </section>
  );
}

function PlanCard({
  plan, months, hFont, primaryColor, accentColor, buyLabel, busy, onBuy,
}: {
  plan: PricingPlan;
  months: number | null;
  hFont?: string;
  primaryColor: string;
  accentColor: string;
  buyLabel: string;
  busy: string;
  onBuy: (priceId: string) => void;
}) {
  const price = plan.prices.find(row => row.durationMonths === months) ?? null;
  const comparison = price ? comparePlanPrice(price, plan.prices) : null;
  const benefits = planBenefits(plan.coverage);

  return (
    <article
      className="pricing-plan-card group relative isolate flex min-h-full flex-col overflow-hidden rounded-[26px] p-6 transition-shadow duration-200 sm:p-7 motion-reduce:transition-none"
      style={plan.recommended
        // Lifted, so the recommendation is visible before anyone reads a word of it.
        ? { background: '#FFFFFF', boxShadow: `inset 0 0 0 2px ${primaryColor}` }
        : { background: '#F7F9FB', boxShadow: 'inset 0 0 0 1px rgba(16,24,40,0.04)' }}
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-30 motion-reduce:transition-none" style={{ background: primaryColor }} />
      <div className="relative flex flex-1 flex-col">
        <div>
          {plan.recommended && (
            // The seller's own pick, and openly that. Not "most popular", which is a claim about
            // other buyers that nobody here can check.
            <p
              className="mb-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: primaryColor, color: '#FFFFFF' }}
            >
              Best Value
            </p>
          )}
          <p className="text-xl font-black tracking-tight" style={{ fontFamily: hFont, color: '#101828' }}>{plan.name}</p>
          <p className="mt-1.5 min-h-10 text-sm leading-5" style={{ color: '#667085' }}>
            {plan.description || 'Full access while your selected term runs.'}
          </p>
        </div>

        {price ? (
          <div className="mt-7">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <p className="text-4xl font-black tracking-[-0.045em]" style={{ fontFamily: hFont, color: '#101828' }}>{money(price.currency, price.amount)}</p>
              <p className="pb-1 text-xs font-semibold" style={{ color: '#667085' }}>for {durationLabel(price.durationMonths)}</p>
            </div>
            <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2">
              <p className="text-xs" style={{ color: '#667085' }}>{money(price.currency, comparison?.perMonth ?? 0)} per month</p>
              {(comparison?.savingPercent ?? 0) > 0 && (
                <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: accentColor, color: '#101828' }}>
                  Save {comparison?.savingPercent}%
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-7 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: '#FFFFFF', color: '#667085' }}>
            Choose another access length for this plan.
          </div>
        )}

        <div className="my-6 h-px" style={{ background: '#E8ECF1' }} />
        <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: '#98A2B3' }}>Your access includes</p>
        <ul className="mt-4 space-y-3">
          {benefits.map(line => (
            <li key={line} className="flex items-start gap-3 text-sm" style={{ color: '#344054' }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: '#ECFDF3', color: '#16A34A' }}>
                <Check className="h-3 w-3" />
              </span>
              <span>{line}</span>
            </li>
          ))}
          <li className="flex items-start gap-3 text-sm" style={{ color: '#344054' }}>
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: '#ECFDF3', color: '#16A34A' }}>
              <Check className="h-3 w-3" />
            </span>
            <span>No automatic renewal</span>
          </li>
        </ul>

        {price ? (
          <button
            type="button"
            onClick={() => onBuy(price.id)}
            disabled={!!busy}
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-all duration-200 hover:-translate-y-0.5 hover:brightness-105 disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none"
            style={{ background: primaryColor, color: '#FFFFFF', boxShadow: `0 10px 24px color-mix(in srgb, ${primaryColor} 22%, transparent)` }}
          >
            {busy === price.id
              ? <>Opening checkout <Loader2 className="h-4 w-4 animate-spin" /></>
              : <>{buyLabel} <ArrowRight className="h-4 w-4" /></>}
          </button>
        ) : (
          <span className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-black" style={{ background: '#E9EDF2', color: '#98A2B3' }}>
            Unavailable for this term
          </span>
        )}
      </div>
    </article>
  );
}

function FreePlanCard({
  free, signedIn, hFont,
}: {
  free: ContentCounts;
  signedIn: boolean;
  hFont?: string;
}) {
  const freeBenefits = [
    ...(free.courses > 0 ? ['Access to free courses'] : []),
    ...(free.learning_paths > 0 ? ['Access to free learning paths'] : []),
    ...(free.virtual_experiences > 0 ? ['Access to free virtual experiences'] : []),
    ...(free.certifications > 0 ? ['Access to free certifications'] : []),
    'Verifiable certificates you earn stay yours',
  ];

  return (
    <article className="pricing-plan-card relative flex min-h-full flex-col overflow-hidden rounded-[26px] p-6 transition-shadow duration-200 sm:p-7 motion-reduce:transition-none" style={{ background: 'transparent', boxShadow: 'none' }}>
      <div className="flex flex-1 flex-col">
        <div>
          <p className="text-xl font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont }}>Starter</p>
          <p className="mt-1.5 min-h-10 text-sm leading-5" style={{ color: '#667085' }}>Free forever. Upgrade only when you are ready.</p>
        </div>

        <div className="mt-7">
          <p className="text-4xl font-black tracking-[-0.045em]" style={{ color: '#101828', fontFamily: hFont }}>Free</p>
          <p className="mt-2 text-xs" style={{ color: '#667085' }}>No card needed</p>
        </div>

        <div className="my-6 h-px" style={{ background: '#E8ECF1' }} />
        <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: '#98A2B3' }}>Your access includes</p>
        <ul className="mt-4 space-y-3">
          {freeBenefits.map(line => (
            <li key={line} className="flex items-start gap-3 text-sm" style={{ color: '#344054' }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: '#ECFDF3', color: '#16A34A' }}>
                <Check className="h-3 w-3" />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {signedIn ? (
          <span className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-black" style={{ background: '#E9EDF2', color: '#667085' }}>Your current access</span>
        ) : (
          <Link href="/auth?mode=signup" className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black" style={{ color: '#101828', boxShadow: 'inset 0 0 0 1px #D0D5DD', fontFamily: hFont }}>
            Create a free account <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </article>
  );
}

function TrustRail() {
  const signals = [
    { Icon: ShieldCheck, title: 'No automatic renewal', text: 'Your access ends on the date shown.' },
    { Icon: CreditCard, title: 'Flexible ways to pay', text: 'Card, bank transfer or mobile money.' },
    { Icon: Award, title: 'Your proof stays yours', text: 'Keep certificates after access ends.' },
  ];

  return (
    <div className="grid gap-3 py-8 sm:grid-cols-3">
      {signals.map(({ Icon, title, text }) => (
        <div key={title} className="flex items-start gap-3 rounded-2xl px-4 py-4" style={{ background: 'rgba(255,255,255,0.65)' }}>
          <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#344054' }} />
          <div>
            <p className="text-sm font-black" style={{ color: '#101828' }}>{title}</p>
            <p className="mt-1 text-xs leading-5" style={{ color: '#667085' }}>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ComparisonTable({
  plans, free, months, hFont,
}: {
  plans: PricingPlan[];
  free: ContentCounts;
  months: number | null;
  hFont?: string;
}) {
  const columns = [
    { key: 'starter', name: 'Starter', note: 'Free' },
    ...plans.map(plan => {
      const price = plan.prices.find(row => row.durationMonths === months);
      return { key: plan.id, name: plan.name, note: price ? money(price.currency, price.amount) : 'Unavailable' };
    }),
  ];

  const includes = (columnKey: string, kind: PurchasableContentTable): boolean => {
    if (columnKey === 'starter') return free[kind] > 0;
    const plan = plans.find(row => row.id === columnKey);
    return !!plan && plan.coverage[kind] > 0;
  };

  return (
    <section className="mt-14" aria-labelledby="plan-comparison-heading">
      <div className="text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: '#475467', fontFamily: hFont }}>Compare access</p>
        <h3 id="plan-comparison-heading" className="mt-2 text-2xl font-black tracking-tight sm:text-3xl" style={{ fontFamily: hFont, color: '#101828' }}>
          See exactly what fits your next move
        </h3>
      </div>
      <div className="mt-7 overflow-hidden rounded-[26px] bg-white" style={{ boxShadow: '0 14px 45px rgba(16,24,40,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr style={{ background: '#F7F9FB' }}>
                <th className="px-5 py-5 text-left font-black" style={{ color: '#101828', fontFamily: hFont }}>Experience</th>
                {columns.map(column => (
                  <th key={column.key} className="px-4 py-5 text-center">
                    <span className="block font-black" style={{ color: '#101828', fontFamily: hFont }}>{column.name}</span>
                    <span className="mt-1 block text-xs font-semibold" style={{ color: '#667085' }}>{column.note}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTENT_KINDS.map(kind => (
                <tr key={kind} style={{ borderTop: '1px solid #EEF1F4' }}>
                  <td className="px-5 py-4">
                    <span className="block font-bold" style={{ color: '#344054' }}>{KIND_LABEL[kind]}</span>
                    <span className="mt-1 block text-xs" style={{ color: '#98A2B3' }}>{KIND_DESCRIPTION[kind]}</span>
                  </td>
                  {columns.map(column => (
                    <td key={column.key} className="px-4 py-4 text-center">
                      {includes(column.key, kind) ? (
                        <span className="mx-auto grid h-7 w-7 place-items-center rounded-full" style={{ background: '#ECFDF3', color: '#16A34A' }}>
                          <Check className="h-4 w-4" aria-label="Included" />
                        </span>
                      ) : (
                        <Minus className="mx-auto h-4 w-4" style={{ color: '#C1C7D0' }} aria-label="Not included" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TeamsStrip({ supportEmail, accentColor, hFont }: { supportEmail?: string; accentColor: string; hFont?: string }) {
  return (
    <section className="relative mt-8 overflow-hidden rounded-[26px] px-6 py-7 sm:px-8" style={{ background: accentColor, color: '#101828' }}>
      <div aria-hidden="true" className="absolute -right-14 -top-24 h-64 w-64 rounded-full bg-white opacity-25 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgba(16,24,40,0.10)', color: '#101828' }}>
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-black" style={{ color: '#101828', fontFamily: hFont }}>Learning for teams</h3>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(16,24,40,0.10)', color: '#101828', fontFamily: hFont }}>Coming soon</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'rgba(16,24,40,0.72)' }}>
              Shared billing, seats for your organisation, and a clear view of group progress.
            </p>
          </div>
        </div>
        {supportEmail ? (
          <a href={`mailto:${supportEmail}?subject=Teams%20plan`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black" style={{ color: '#101828', fontFamily: hFont }}>
            Register interest <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <span className="shrink-0 rounded-xl px-4 py-3 text-center text-sm font-bold" style={{ background: 'rgba(16,24,40,0.10)', color: '#101828', fontFamily: hFont }}>Coming soon</span>
        )}
      </div>
    </section>
  );
}
