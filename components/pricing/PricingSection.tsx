'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Loader2, Minus } from 'lucide-react';
import { comparePlanPrice } from '@/lib/plan-price-comparison';
import { promotionHeading } from '@/lib/subscription-discount';
import { startPlanCheckout } from '@/lib/start-plan-checkout';
import { DEFAULT_VE_ACCENT } from '@/lib/ve-accent';
import { durationLabel, formatMoney as money } from '@/lib/pricing-offer';
import {
  CONTENT_KINDS,
  type ContentCounts,
  type PricingPageData,
  type PricingPlan,
} from '@/lib/pricing-contract';
import type { PurchasableContentTable } from '@/lib/subscription-plan-access';

const RECOMMENDED_BORDER = '#FF9933';

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

const KIND_NOUN: Record<PurchasableContentTable, [string, string]> = {
  courses: ['course', 'courses'],
  learning_paths: ['learning path', 'learning paths'],
  virtual_experiences: ['virtual experience', 'virtual experiences'],
  certifications: ['certification', 'certifications'],
};

/** "14 courses", one line per kind the plan or free tier opens. The page data is at most a minute old. */
function countLines(coverage: ContentCounts): string[] {
  return CONTENT_KINDS.filter(kind => coverage[kind] > 0)
    .map(kind => `${coverage[kind]} ${KIND_NOUN[kind][coverage[kind] === 1 ? 0 : 1]}`);
}

/** The plan's price at the chosen length, or at the length it is sold at closest to it. */
function priceForLength(prices: PricingPlan['prices'], months: number | null) {
  if (!prices.length) return null;
  if (months === null) return prices[0];
  return prices.find(row => row.durationMonths === months)
    ?? [...prices].sort((a, b) => Math.abs(a.durationMonths - months) - Math.abs(b.durationMonths - months) || a.durationMonths - b.durationMonths)[0];
}

/** An offer that is running and has an end date still ahead. */
function offerEnd(price: PricingPlan['prices'][number] | null, now: number | null): number | null {
  if (!price?.discountEndsAt || now === null || !(price.listAmount && price.listAmount > price.amount)) return null;
  const end = Date.parse(price.discountEndsAt);
  return Number.isFinite(end) && end > now ? end : null;
}

/**
 * The time on the viewer's clock, ticking each second, or null on the server and the first render.
 * Dates and the countdown wait for it, so the server and the browser never disagree about them.
 */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Read the clock once mounted, then every second for the countdown.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  return now;
}

const endDate = (end: number) => new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export interface PricingSectionProps extends PricingPageData {
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  signedIn: boolean;
  /** Whether a card checkout can be opened from here at all. */
  paystackEnabled: boolean;
  selectedDuration: number | null;
  /** Arrived from a locked item: only its plans are listed, so say which item, and offer the rest. */
  forItem?: { title: string; contentTable: string; contentId: string; onShowAll: () => void } | null;
  /** Shown between the plans and the comparison (the tools section). */
  children?: React.ReactNode;
}

export function PricingSection({
  plans,
  free,
  primaryColor,
  headingFont,
  bodyFont,
  signedIn,
  paystackEnabled,
  selectedDuration,
  forItem,
  children,
}: PricingSectionProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  const [busyPriceId, setBusyPriceId] = useState('');
  const now = useNow();

  const buy = async (price: PricingPlan['prices'][number]) => {
    setBusyPriceId(price.id);
    const outcome = await startPlanCheckout(price.id, {
      paystackEnabled,
      quotedAmount: price.amount,
      quotedCurrency: price.currency,
      forItem: forItem && { contentTable: forItem.contentTable, contentId: forItem.contentId },
    });
    if (outcome.kind !== 'redirecting') window.location.href = outcome.href;
  };

  // The countdown follows the first plan (recommended first) whose chosen length is on an offer
  // that ends at a known time.
  const countdown = plans
    .map(plan => {
      const price = priceForLength(plan.prices, selectedDuration);
      const end = offerEnd(price, now);
      return price && end ? { plan, price, end } : null;
    })
    .find(Boolean) ?? null;

  return (
    <section id="pricing-plans" className="relative z-20 -mt-16 scroll-mt-24" style={{ fontFamily: bFont }}>
      {countdown && now !== null && (
        <OfferCountdown plan={countdown.plan} price={countdown.price} end={countdown.end} now={now} hFont={hFont} />
      )}

      {forItem && (
        <p className={`${countdown ? 'mt-4' : ''} rounded-2xl bg-white px-5 py-4 text-sm leading-6`} style={{ color: '#5F6B7A' }}>
          {plans.length === 1 ? 'The plan that includes' : 'Plans that include'}{' '}
          <span className="font-bold" style={{ color: '#101828' }}>{forItem.title}</span>.{' '}
          <button type="button" onClick={forItem.onShowAll} className="font-bold underline-offset-4 hover:underline" style={{ color: primaryColor }}>
            See all plans
          </button>
        </p>
      )}

      <div className={`${countdown || forItem ? 'mt-4' : ''} grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3`}>
        {/* The free tier does not open a locked item, so it is not offered as one of its plans. */}
        {!forItem && <FreePlanCard free={free} signedIn={signedIn} hFont={hFont} />}
        {plans.map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            months={selectedDuration}
            afterFree={!forItem}
            now={now}
            hFont={hFont}
            primaryColor={primaryColor}
            busy={busyPriceId}
            onBuy={buy}
          />
        ))}
      </div>

      {plans.length === 0 && (
        <div className="mt-4 rounded-2xl bg-white p-6 text-center">
          <p className="font-bold" style={{ color: '#344054' }}>Paid access is not available yet.</p>
          <p className="mt-1 text-sm" style={{ color: '#667085' }}>Start free and check back soon.</p>
        </div>
      )}

      {paystackEnabled && plans.length > 0 && (
        <p className="mt-4 text-center text-xs" style={{ color: '#667085' }}>Secure checkout by Paystack.</p>
      )}

      {children}

      <ComparisonTable plans={plans} free={free} months={selectedDuration} hFont={hFont} />
    </section>
  );
}

function OfferCountdown({ plan, price, end, now, hFont }: {
  plan: PricingPlan;
  price: PricingPlan['prices'][number];
  end: number;
  now: number;
  hFont?: string;
}) {
  const left = Math.max(0, end - now);
  const parts = [
    { value: Math.floor(left / 86_400_000), unit: 'days' },
    { value: Math.floor(left / 3_600_000) % 24, unit: 'hrs' },
    { value: Math.floor(left / 60_000) % 60, unit: 'min' },
    { value: Math.floor(left / 1000) % 60, unit: 'sec' },
  ];
  const saving = price.discountType === 'percentage'
    ? `${price.discountValue}% off`
    : `${money(price.currency, price.discountAmount ?? 0)} off`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white px-5 py-4" style={{ boxShadow: 'inset 0 0 0 2px #F5D77A, 0 14px 45px rgba(16,24,40,0.08)' }}>
      <div>
        <p className="text-base font-black" style={{ color: '#101828', fontFamily: hFont }}>
          {promotionHeading(price.discountLabel, 'Offer')}: {saving} {plan.name}
        </p>
        <p className="mt-1 text-sm" style={{ color: '#667085' }}>
          <span className="line-through" style={{ color: '#98A2B3' }}>{money(price.currency, price.listAmount ?? price.amount)}</span>{' '}
          <span className="font-bold" style={{ color: '#101828' }}>{money(price.currency, price.amount)}</span> for {durationLabel(price.durationMonths)}
        </p>
      </div>
      <div className="flex items-center gap-2" role="timer" aria-label={`Offer ends in ${parts[0].value} days ${parts[1].value} hours`}>
        <span className="mr-1 text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: '#667085' }}>Ends in</span>
        {parts.map(part => (
          <span key={part.unit} className="min-w-12 rounded-lg px-2 py-1 text-center" style={{ background: '#101828', color: '#FFFFFF' }}>
            <span className="block text-[22px] leading-7 font-black tabular-nums">{String(part.value).padStart(2, '0')}</span>
            <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.72)' }}>{part.unit}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, months, afterFree, now, hFont, primaryColor, busy, onBuy }: {
  plan: PricingPlan;
  months: number | null;
  /** The Starter card is shown first, so this card lists what it adds to it. */
  afterFree: boolean;
  now: number | null;
  hFont?: string;
  primaryColor: string;
  busy: string;
  onBuy: (price: PricingPlan['prices'][number]) => void;
}) {
  const price = priceForLength(plan.prices, months);
  // Not sold at the chosen length: the card shows the length it is sold at, with its own button.
  const otherLength = price !== null && months !== null && price.durationMonths !== months;
  const comparison = price ? comparePlanPrice(price, plan.prices) : null;
  const promotion = Boolean(price?.listAmount && price.listAmount > price.amount);
  const end = offerEnd(price, now);
  // The price a day, a month counted as 30 days, always to the cent, as on the course pages.
  const perDay = price ? `${price.currency || 'GHS'} ${(price.amount / (price.durationMonths * 30)).toFixed(2)}` : '';
  const lines = countLines(plan.coverage);

  return (
    <article
      className="relative flex flex-col rounded-[20px] bg-white p-6 sm:p-7"
      style={plan.recommended
        // The recommended plan's border: a fixed orange, so it stands apart from the primary-coloured button.
        ? { borderTop: `4px solid ${RECOMMENDED_BORDER}`, boxShadow: `inset 0 0 0 2px ${RECOMMENDED_BORDER}, 0 18px 48px rgba(16,24,40,0.14)` }
        : { borderTop: '4px solid #E4E7EC' }}
    >
      {plan.recommended && (
        // The seller's own pick, and openly that. Not "most popular", which is a claim about
        // other buyers that nobody here can check.
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.06em]" style={{ background: '#F5D77A', color: '#3d2e00' }}>
          Best Value
        </span>
      )}
      <p className="text-[22px] leading-7 font-black tracking-tight" style={{ fontFamily: hFont, color: '#101828' }}>{plan.name}</p>
      <p className="mt-2 min-h-10 text-sm leading-5" style={{ color: '#667085' }}>
        {plan.description || 'Full access while your selected term runs.'}
      </p>

      {price ? (
        <div className="mt-5">
          <p className="text-sm" style={{ color: '#667085' }}>
            <span className="mr-1 text-4xl leading-[44px] font-black tracking-[-0.03em]" style={{ fontFamily: hFont, color: '#101828' }}>{money(price.currency, price.amount)}</span>
            for {durationLabel(price.durationMonths)}
          </p>
          {otherLength && months !== null ? (
            <p className="mt-2 text-xs font-semibold" style={{ color: '#475467' }}>
              Not sold for {durationLabel(months)}. Shown for {durationLabel(price.durationMonths)}.
            </p>
          ) : (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" style={{ color: '#667085' }}>
              <span>
                Only{' '}
                <span className="relative inline-block pb-[3px] font-black" style={{ color: '#101828' }}>
                  {perDay}
                  <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none" className="absolute bottom-[-3px] left-0 h-[7px] w-full overflow-visible">
                    <path d="M2 7 C 25 1, 70 1, 98 5" fill="none" stroke={DEFAULT_VE_ACCENT} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                </span>{' '}
                a day
              </span>
              {(comparison?.savingPercent ?? 0) > 0 && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black" style={{ color: '#16A34A', boxShadow: '0 0 0 1px rgba(22,163,74,0.25)' }}>
                  Save {comparison?.savingPercent}%
                </span>
              )}
            </p>
          )}

          <button
            type="button"
            onClick={() => onBuy(price)}
            disabled={!!busy}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-all duration-200 hover:-translate-y-0.5 hover:brightness-105 disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none"
            style={plan.recommended
              ? { background: primaryColor, color: '#FFFFFF', boxShadow: `0 10px 24px color-mix(in srgb, ${primaryColor} 22%, transparent)` }
              : { background: '#EEF1F5', color: '#101828' }}
          >
            {busy === price.id
              ? <>Opening checkout <Loader2 className="h-4 w-4 animate-spin" /></>
              : <>Enroll with {plan.name} <ArrowRight className="h-4 w-4" /></>}
          </button>
          <p className="mt-3 text-xs leading-5" style={{ color: '#667085' }}>
            {promotion && <>Usually <span className="line-through">{money(price.currency, price.listAmount ?? price.amount)}</span>{end ? `, offer ends ${endDate(end)}` : ''}. </>}
            Pay once, no automatic renewal.
          </p>
        </div>
      ) : (
        <span className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-black" style={{ background: '#E9EDF2', color: '#98A2B3' }}>
          Unavailable for this term
        </span>
      )}

      {lines.length > 0 && (
        <div className="mt-6 border-t pt-5" style={{ borderColor: '#E8ECF1' }}>
          <p className="text-xs font-bold" style={{ color: '#667085' }}>{afterFree ? 'Everything in Starter, plus:' : 'Includes:'}</p>
          <ul className="mt-3 space-y-2">
            {lines.map(line => <CheckLine key={line} text={line} />)}
          </ul>
        </div>
      )}
    </article>
  );
}

function CheckLine({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm" style={{ color: '#344054' }}>
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: '#ECFDF3', color: '#16A34A' }}>
        <Check className="h-3 w-3" />
      </span>
      <span>{text}</span>
    </li>
  );
}

function FreePlanCard({ free, signedIn, hFont }: {
  free: ContentCounts;
  signedIn: boolean;
  hFont?: string;
}) {
  const lines = [...countLines(free), 'Verifiable certificates you earn stay yours'];

  return (
    <article className="relative flex flex-col rounded-[20px] bg-white p-6 sm:p-7" style={{ borderTop: '4px solid #E4E7EC' }}>
      <p className="text-[22px] leading-7 font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont }}>Starter</p>
      <p className="mt-2 min-h-10 text-sm leading-5" style={{ color: '#667085' }}>Free forever. Upgrade only when you are ready.</p>
      <div className="mt-5">
        <p className="text-4xl leading-[44px] font-black tracking-[-0.03em]" style={{ color: '#101828', fontFamily: hFont }}>Free</p>
        <p className="mt-2 text-sm" style={{ color: '#667085' }}>No card needed</p>
      </div>
      {/* Nothing is said about what a signed-in learner is on. This card only ever has an action
          for someone who has no account yet. */}
      {!signedIn && (
        <Link href="/auth?mode=signup" className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black" style={{ color: '#101828', background: '#EEF1F5', fontFamily: hFont }}>
          Create a free account <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      <div className="mt-6 border-t pt-5" style={{ borderColor: '#E8ECF1' }}>
        <p className="text-xs font-bold" style={{ color: '#667085' }}>Includes:</p>
        <ul className="mt-3 space-y-2">
          {lines.map(line => <CheckLine key={line} text={line} />)}
        </ul>
      </div>
    </article>
  );
}

function ComparisonTable({ plans, free, months, hFont }: {
  plans: PricingPlan[];
  free: ContentCounts;
  months: number | null;
  hFont?: string;
}) {
  const [open, setOpen] = useState(false);
  const columns = [
    { key: 'starter', name: 'Starter', note: 'Free', coverage: free },
    ...plans.map(plan => {
      const price = priceForLength(plan.prices, months);
      const note = !price ? 'Unavailable'
        : price.durationMonths === months ? money(price.currency, price.amount)
        : `${money(price.currency, price.amount)} / ${durationLabel(price.durationMonths)}`;
      return { key: plan.id, name: plan.name, note, coverage: plan.coverage };
    }),
  ];

  return (
    <section className="mt-6" aria-label="Compare all plans">
      <button type="button" aria-expanded={open} aria-controls="plan-comparison" onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-black" style={{ color: '#101828', fontFamily: hFont }}>
        Compare all plans <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id="plan-comparison" className="mt-3 overflow-hidden rounded-[26px] bg-white" style={{ boxShadow: '0 14px 45px rgba(16,24,40,0.07)' }}>
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
                        {column.coverage[kind] > 0
                          ? <span className="text-base font-black tabular-nums" style={{ color: '#101828' }}>{column.coverage[kind]}</span>
                          : <Minus className="mx-auto h-4 w-4" style={{ color: '#C1C7D0' }} aria-label="Not included" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
