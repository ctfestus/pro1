'use client';

/**
 * The public pricing section: a duration toggle, a card per tier, and a comparison table.
 *
 * Durations come from what an admin actually priced, so the toggle never offers a term that is
 * not on sale. Everything the table says about a tier is counted from the database rather than
 * written here -- a tier that gains a certification tomorrow says so without an edit.
 *
 * Starter is presentation only. It is what an account with no plan already sees, so it has no
 * price, no button to buy and no row in the plans table.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, ArrowRight } from 'lucide-react';
import { comparePlanPrice } from '@/lib/plan-price-comparison';
import {
  CONTENT_KINDS,
  type ContentCounts,
  type PricingPageData,
  type PricingPlan,
} from '@/lib/get-pricing-page-data';
import type { PurchasableContentTable } from '@/lib/subscription-plan-access';

const KIND_LABEL: Record<PurchasableContentTable, string> = {
  courses: 'Courses',
  learning_paths: 'Learning paths',
  virtual_experiences: 'Virtual experiences',
  certifications: 'Certifications',
};

function durationLabel(months: number) {
  if (months === 12) return '1 year';
  return `${months} month${months > 1 ? 's' : ''}`;
}

function money(currency: string, amount: number) {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export interface PricingSectionProps extends PricingPageData {
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  /** Signed-in learners go straight to checkout; everyone else makes an account first. */
  signedIn: boolean;
  supportEmail?: string;
}

export function PricingSection({
  plans, free, primaryColor, accentColor, headingFont, bodyFont, signedIn, supportEmail,
}: PricingSectionProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;

  // Only terms someone can actually buy. With one plan this is its price list; with several it
  // is the union, and a plan without the selected term simply says so on its card.
  const durations = useMemo(() => {
    const all = new Set<number>();
    plans.forEach(plan => plan.prices.forEach(price => all.add(price.durationMonths)));
    return [...all].sort((a, b) => a - b);
  }, [plans]);

  const [selected, setSelected] = useState<number | null>(durations[durations.length - 1] ?? null);

  const buyHref = signedIn ? '/student#payments' : '/auth?mode=signup';
  const buyLabel = signedIn ? 'Choose this plan' : 'Create your account';

  /** The saving shown on a toggle option, taken from the first plan that sells that term. */
  const savingFor = (months: number) => {
    for (const plan of plans) {
      const price = plan.prices.find(row => row.durationMonths === months);
      if (price) return comparePlanPrice(price, plan.prices).savingPercent;
    }
    return 0;
  };

  return (
    <section style={{ fontFamily: bFont }}>
      {/* ---------- duration toggle ---------- */}
      {durations.length > 1 && (
        <div className="flex justify-center">
          <div
            className="inline-flex flex-wrap justify-center gap-1 rounded-full p-1"
            role="group"
            aria-label="Access length"
            style={{ background: '#EEF1F5' }}
          >
            {durations.map(months => {
              const active = months === selected;
              const saving = savingFor(months);
              return (
                <button
                  key={months}
                  type="button"
                  onClick={() => setSelected(months)}
                  aria-pressed={active}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors"
                  style={{
                    background: active ? '#FFFFFF' : 'transparent',
                    color: active ? '#101828' : '#5C6470',
                    boxShadow: active ? '0 1px 2px rgba(16,24,40,0.10)' : undefined,
                  }}
                >
                  {durationLabel(months)}
                  {saving > 0 && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: accentColor, color: '#101828' }}
                    >
                      save {saving}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- tier cards ---------- */}
      <div className="mt-8 grid gap-5 md:grid-cols-3 items-start">
        <TierCard
          name="Starter"
          tagline="Free forever"
          price="Free"
          priceNote="No card needed"
          hFont={hFont}
          bullets={[
            ...CONTENT_KINDS.filter(kind => free[kind] > 0)
              .map(kind => `${free[kind]} free ${KIND_LABEL[kind].toLowerCase()}`),
            'Your progress and certificates',
          ]}
          cta={signedIn
            ? { label: 'Your current access', href: null }
            : { label: 'Create a free account', href: '/auth?mode=signup' }}
          primaryColor={primaryColor}
        />

        {plans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            months={selected}
            featured={index === 0}
            hFont={hFont}
            primaryColor={primaryColor}
            accentColor={accentColor}
            buyHref={buyHref}
            buyLabel={buyLabel}
          />
        ))}

        <TierCard
          name="Teams"
          tagline="For organisations"
          price="Coming soon"
          priceNote="Talk to us about group access"
          hFont={hFont}
          bullets={['Everything in the paid plan', 'Seats for your whole team', 'Group progress reporting']}
          cta={supportEmail
            ? { label: 'Register interest', href: `mailto:${supportEmail}?subject=Teams%20plan` }
            : { label: 'Coming soon', href: null }}
          primaryColor={primaryColor}
          muted
        />
      </div>

      {/* ---------- comparison ---------- */}
      <ComparisonTable plans={plans} free={free} months={selected} hFont={hFont} primaryColor={primaryColor} />
    </section>
  );
}

function TierCard({
  name, tagline, price, priceNote, bullets, cta, hFont, primaryColor, muted,
}: {
  name: string; tagline: string; price: string; priceNote: string; bullets: string[];
  cta: { label: string; href: string | null }; hFont?: string; primaryColor: string; muted?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 h-full flex flex-col" style={{ boxShadow: '0 1px 3px rgba(16,24,40,0.08)' }}>
      <p className="text-xl font-bold" style={{ fontFamily: hFont, color: '#101828' }}>{name}</p>
      <p className="text-xs mt-1" style={{ color: '#667085' }}>{tagline}</p>
      <p className="mt-5 text-3xl font-bold" style={{ fontFamily: hFont, color: muted ? '#667085' : '#101828' }}>{price}</p>
      <p className="text-xs mt-1" style={{ color: '#667085' }}>{priceNote}</p>
      {cta.href ? (
        <Link
          href={cta.href}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold"
          style={{ border: `1px solid ${primaryColor}`, color: primaryColor }}
        >
          {cta.label}
        </Link>
      ) : (
        <span
          className="mt-5 inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-bold"
          style={{ background: '#F2F4F7', color: '#667085' }}
        >
          {cta.label}
        </span>
      )}
      <ul className="mt-6 space-y-2.5">
        {bullets.map(line => (
          <li key={line} className="flex items-start gap-2 text-sm" style={{ color: '#344054' }}>
            <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: primaryColor }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({
  plan, months, featured, hFont, primaryColor, accentColor, buyHref, buyLabel,
}: {
  plan: PricingPlan; months: number | null; featured: boolean; hFont?: string;
  primaryColor: string; accentColor: string; buyHref: string; buyLabel: string;
}) {
  const price = plan.prices.find(row => row.durationMonths === months) ?? null;
  const comparison = price ? comparePlanPrice(price, plan.prices) : null;

  return (
    <div
      className="relative rounded-2xl bg-white p-6 h-full flex flex-col"
      style={{ boxShadow: featured ? '0 8px 28px rgba(16,24,40,0.14)' : '0 1px 3px rgba(16,24,40,0.08)' }}
    >
      {featured && (
        <span
          className="absolute -top-3 left-6 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ background: primaryColor, color: '#FFFFFF' }}
        >
          Most popular
        </span>
      )}
      <p className="text-xl font-bold" style={{ fontFamily: hFont, color: '#101828' }}>{plan.name}</p>
      <p className="text-xs mt-1" style={{ color: '#667085' }}>
        {plan.description || 'Full access while your plan runs'}
      </p>

      {price ? (
        <>
          <p className="mt-5 text-3xl font-bold" style={{ fontFamily: hFont, color: '#101828' }}>
            {money(price.currency, price.amount)}
          </p>
          <p className="text-xs mt-1" style={{ color: '#667085' }}>
            {money(price.currency, comparison?.perMonth ?? 0)} a month, for {durationLabel(price.durationMonths)}
          </p>
          {(comparison?.savingPercent ?? 0) > 0 && (
            <span
              className="mt-2 self-start rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: accentColor, color: '#101828' }}
            >
              save {comparison?.savingPercent}%
            </span>
          )}
        </>
      ) : (
        <p className="mt-5 text-sm" style={{ color: '#667085' }}>
          Not sold for this length. Pick another above.
        </p>
      )}

      <Link
        href={buyHref}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold"
        style={{ background: primaryColor, color: '#FFFFFF' }}
      >
        {buyLabel} <ArrowRight className="w-4 h-4" />
      </Link>

      <ul className="mt-6 space-y-2.5">
        {CONTENT_KINDS.filter(kind => plan.coverage[kind] > 0).map(kind => (
          <li key={kind} className="flex items-start gap-2 text-sm" style={{ color: '#344054' }}>
            <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: primaryColor }} />
            <span>{plan.coverage[kind]} {KIND_LABEL[kind].toLowerCase()}</span>
          </li>
        ))}
        <li className="flex items-start gap-2 text-sm" style={{ color: '#344054' }}>
          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: primaryColor }} />
          <span>Access ends on the date shown. It does not renew automatically.</span>
        </li>
      </ul>
    </div>
  );
}

function ComparisonTable({
  plans, free, months, hFont, primaryColor,
}: {
  plans: PricingPlan[]; free: ContentCounts; months: number | null;
  hFont?: string; primaryColor: string;
}) {
  const columns = [
    { key: 'starter', name: 'Starter', note: 'Free' },
    ...plans.map(plan => {
      const price = plan.prices.find(row => row.durationMonths === months);
      return {
        key: plan.id,
        name: plan.name,
        note: price ? money(price.currency, price.amount) : 'Not sold for this length',
      };
    }),
    { key: 'teams', name: 'Teams', note: 'Coming soon' },
  ];

  const cellFor = (columnKey: string, kind: PurchasableContentTable) => {
    if (columnKey === 'starter') return free[kind] > 0 ? `${free[kind]} free` : null;
    if (columnKey === 'teams') return null;
    const plan = plans.find(row => row.id === columnKey);
    return plan && plan.coverage[kind] > 0 ? String(plan.coverage[kind]) : null;
  };

  return (
    <div className="mt-14">
      <h3 className="text-lg font-bold text-center" style={{ fontFamily: hFont, color: '#101828' }}>
        What each plan includes
      </h3>
      {/* Wide on a phone, so the table scrolls in its own box rather than the page going sideways. */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left py-3 pr-4 font-bold" style={{ color: '#101828', fontFamily: hFont }}>
                Included
              </th>
              {columns.map(column => (
                <th key={column.key} className="py-3 px-3 text-center" style={{ borderBottom: '1px solid #E4E7EC' }}>
                  <span className="block font-bold" style={{ color: '#101828', fontFamily: hFont }}>{column.name}</span>
                  <span className="block text-xs font-normal mt-0.5" style={{ color: '#667085' }}>{column.note}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONTENT_KINDS.map(kind => (
              <tr key={kind}>
                <td className="py-3 pr-4" style={{ color: '#344054', borderBottom: '1px solid #F2F4F7' }}>
                  {KIND_LABEL[kind]}
                </td>
                {columns.map(column => {
                  const value = cellFor(column.key, kind);
                  return (
                    <td
                      key={column.key}
                      className="py-3 px-3 text-center"
                      style={{ borderBottom: '1px solid #F2F4F7', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {value ? (
                        <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: '#101828' }}>
                          <Check className="w-4 h-4" style={{ color: primaryColor }} />
                          {value}
                        </span>
                      ) : (
                        <Minus className="w-4 h-4 mx-auto" style={{ color: '#98A2B3' }} aria-label="Not included" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
