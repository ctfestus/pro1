'use client';

// The prices and promotion sections shared by the Create plan builder and the Plan details pop-up.
// The primary colour is kept for buttons only: switches, choices and the calendar use the text colour.

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { DateTimeField } from '@/components/DatePicker';
import { durationLabel } from '@/lib/pricing-offer';
import { effectiveSubscriptionPrice, promotionHeading, PROMOTION_NAME_MAX } from '@/lib/subscription-discount';
import type { ThemeColors } from '@/lib/theme';
import { DISPLAY_FONT, money, palette, Pill } from './ui';

export type PlanPriceDraft = { durationMonths: string; amount: string; currency: string; isActive: boolean; sortOrder: number };

export type PlanDiscountDraft = {
  type: '' | 'percentage' | 'fixed';
  value: string;
  /** "YYYY-MM-DDTHH:mm", in UTC. */
  startsAt: string;
  endsAt: string;
  label: string;
};

export function planDiscountStatus(discount: PlanDiscountDraft) {
  if (!discount.type) return null;
  const now = Date.now();
  const startsAt = discount.startsAt ? Date.parse(`${discount.startsAt}:00.000Z`) : null;
  const endsAt = discount.endsAt ? Date.parse(`${discount.endsAt}:00.000Z`) : null;
  if (startsAt !== null && startsAt > now) return 'Scheduled';
  if (endsAt !== null && endsAt <= now) return 'Ended';
  return 'Live';
}

const fieldStyle = (C: ThemeColors) => ({ background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` });
const field = 'w-full h-11 rounded-[10px] px-3 text-sm outline-none';

function Section({ title, sub, action, children, C }: { title: string; sub: string; action?: ReactNode; children: ReactNode; C: ThemeColors }) {
  return (
    <section className="pt-5 mt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h4 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h4>
          <p className="text-xs mt-1" style={{ color: C.muted }}>{sub}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Switch({ on, onChange, label, C }: { on: boolean; onChange: (on: boolean) => void; label: string; C: ThemeColors }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative w-10 h-6 rounded-full flex-shrink-0 transition-colors"
      style={{ background: on ? palette(C).sel : C.pill, boxShadow: on ? 'none' : `inset 0 0 0 1px ${C.divider}` }}
    >
      <span
        className="absolute top-1 left-1 w-4 h-4 rounded-full transition-transform"
        style={{ background: '#FFFFFF', transform: on ? 'translateX(16px)' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
      />
    </button>
  );
}

export function PlanPriceFields({ prices, setPrices, discount, C }: {
  prices: PlanPriceDraft[];
  setPrices: Dispatch<SetStateAction<PlanPriceDraft[]>>;
  discount: PlanDiscountDraft;
  C: ThemeColors;
}) {
  const P = palette(C);
  const currency = (prices.find((price) => price.isActive) ?? prices[0])?.currency || '';
  const mixed = new Set(prices.filter((price) => price.isActive).map((price) => price.currency)).size > 1;
  const offerOn = Boolean(discount.type) && Number(discount.value) > 0 && planDiscountStatus(discount) !== 'Ended';
  const update = (index: number, change: Partial<PlanPriceDraft>) =>
    setPrices((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <Section
      title="Prices"
      sub="Switch on the lengths learners can buy. Typing an amount switches it on."
      C={C}
      action={
        <label className="flex items-center gap-2 h-9 px-3 rounded-xl flex-shrink-0 text-xs" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.muted }}>
          Currency
          <input
            value={currency}
            maxLength={3}
            onChange={(e) => {
              const next = e.target.value.toUpperCase();
              setPrices((current) => current.map((row) => ({ ...row, currency: next })));
            }}
            aria-label="Currency for every price"
            className="w-10 bg-transparent outline-none text-sm font-semibold"
            style={{ color: C.text }}
          />
        </label>
      }
    >
      <div className="rounded-2xl overflow-hidden" style={{ background: C.page }}>
        {prices.map((price, index) => {
          const months = Number(price.durationMonths);
          const amount = Number(price.amount);
          const on = price.isActive;
          const perMonth = amount > 0 ? `${money(price.currency, amount / months)} a month` : '';
          const offer = on && offerOn && amount > 0
            ? effectiveSubscriptionPrice(price.amount, { discount_type: discount.type || null, discount_value: discount.value })
            : null;
          return (
            <div
              key={price.durationMonths}
              className="grid grid-cols-[40px_minmax(0,1fr)] sm:grid-cols-[40px_96px_minmax(0,220px)_minmax(0,1fr)] gap-x-3 gap-y-2 items-center px-4 py-3"
              style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}
            >
              <Switch on={on} onChange={(isActive) => update(index, { isActive })} label={`Sell ${durationLabel(months)}`} C={C} />
              <span className="text-base font-semibold" style={{ color: on ? C.text : C.faint, fontFamily: DISPLAY_FONT }}>
                {durationLabel(months)}
              </span>
              <label
                className="col-start-2 sm:col-start-auto flex items-center gap-2 h-10 px-3 rounded-[10px]"
                style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}
              >
                <b className="text-xs font-semibold" style={{ color: C.muted }}>{price.currency}</b>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={price.amount}
                  onChange={(e) => update(index, { amount: e.target.value, isActive: Number(e.target.value) > 0 ? true : price.isActive })}
                  placeholder="0.00"
                  aria-label={`${durationLabel(months)} price`}
                  className="w-full bg-transparent outline-none text-right text-sm font-semibold tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ color: C.text }}
                />
              </label>
              <span className="col-start-2 sm:col-start-auto text-xs sm:text-right" style={{ color: C.muted }}>
                {!on ? 'Not sold' : offer?.discountActive ? (
                  <>
                    <span className="font-semibold" style={{ color: P.warn }}>{money(price.currency, offer.amount)}</span> during the offer
                    <s className="block" style={{ color: C.faint }}>{perMonth}</s>
                  </>
                ) : perMonth || 'Add a price'}
              </span>
            </div>
          );
        })}
      </div>
      {mixed && (
        <p className="text-xs mt-2" style={{ color: P.warn }}>These prices use different currencies. Set one currency above to use it for every price.</p>
      )}
    </Section>
  );
}

export function PlanDiscountFields({ discount, setDiscount, prices, C }: {
  discount: PlanDiscountDraft;
  setDiscount: Dispatch<SetStateAction<PlanDiscountDraft>>;
  prices: PlanPriceDraft[];
  C: ThemeColors;
}) {
  const P = palette(C);
  const on = Boolean(discount.type);
  const example = prices.find((price) => price.isActive && Number(price.amount) > 0);
  const preview = example && on && Number(discount.value) > 0
    ? effectiveSubscriptionPrice(example.amount, { discount_type: discount.type || null, discount_value: discount.value })
    : null;
  const status = planDiscountStatus(discount);
  const set = (change: Partial<PlanDiscountDraft>) => setDiscount((value) => ({ ...value, ...change }));

  return (
    <Section
      title="Promotion"
      sub="A discount on every price, for a set time."
      C={C}
      action={
        <span className="flex items-center gap-3 flex-shrink-0">
          {status && <Pill tone={status === 'Live' ? 'good' : status === 'Scheduled' ? 'warn' : 'mute'} dot C={C}>{status}</Pill>}
          <Switch on={on} onChange={(next) => set({ type: next ? 'percentage' : '' })} label="Run a promotion" C={C} />
        </span>
      }
    >
      {!on ? (
        <p className="text-sm" style={{ color: C.muted }}>No promotion is running. Switch it on to add one.</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: C.pill }} role="radiogroup" aria-label="Offer type">
            {([['percentage', 'Percentage off'], ['fixed', 'Fixed amount off']] as const).map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={discount.type === value}
                onClick={() => set({ type: value })}
                className="flex-1 h-9 rounded-[10px] text-xs font-semibold"
                style={discount.type === value
                  ? { background: C.card, color: C.text, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' }
                  : { color: C.muted }}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Discount</span>
              <span className="relative block">
                <input
                  type="number"
                  min="0.01"
                  max={discount.type === 'percentage' ? '99.99' : undefined}
                  step="0.01"
                  inputMode="decimal"
                  value={discount.value}
                  onChange={(e) => set({ value: e.target.value })}
                  placeholder={discount.type === 'percentage' ? '15' : '50.00'}
                  className={`${field} pr-12 font-semibold tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  style={fieldStyle(C)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: C.muted }}>
                  {discount.type === 'percentage' ? '%' : example?.currency || prices[0]?.currency}
                </span>
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>
                Name <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
              </span>
              <input
                value={discount.label}
                maxLength={PROMOTION_NAME_MAX}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="Black Friday"
                className={field}
                style={fieldStyle(C)}
              />
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Starts</span><DateTimeField label="Starts" value={discount.startsAt} onChange={(startsAt) => set({ startsAt })} placeholder="Starts now" defaultTime="00:00" utc C={C} /></div>
            <div><span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Ends</span><DateTimeField label="Ends" value={discount.endsAt} onChange={(endsAt) => set({ endsAt })} placeholder="No end date" defaultTime="23:59" utc C={C} /></div>
          </div>
          <p className="text-xs -mt-2" style={{ color: C.faint }}>Times are UTC.</p>
          {preview?.discountActive && example && (
            <div className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4" style={{ background: C.page }}>
              <div>
                <p className="text-xs" style={{ color: C.muted }}>Learners see, on the {durationLabel(Number(example.durationMonths))} price</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Pill tone="warn" C={C}>{promotionHeading(discount.label, 'Special offer')}</Pill>
                  <Pill tone="warn" C={C}>
                    {discount.type === 'percentage' ? `${preview.discountValue}% off` : `${money(example.currency, preview.discountAmount)} off`}
                  </Pill>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[28px] leading-9 font-semibold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
                  {money(example.currency, preview.amount)}
                </span>
                <s className="text-sm ml-2" style={{ color: C.faint }}>{money(example.currency, preview.listAmount)}</s>
                <p className="text-xs font-semibold" style={{ color: P.good }}>Save {money(example.currency, preview.discountAmount)}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
