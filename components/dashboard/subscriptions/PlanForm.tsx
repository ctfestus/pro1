'use client';

// The prices and promotion sections shared by the Create plan builder and the Plan details pop-up.
// The primary colour is kept for buttons only: switches, choices and the calendar use the text colour.

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
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
          <h4 className="text-base font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h4>
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
      style={{ background: on ? C.text : C.pill, boxShadow: on ? 'none' : `inset 0 0 0 1px ${C.divider}` }}
    >
      <span
        className="absolute top-1 left-1 w-4 h-4 rounded-full transition-transform"
        style={{ background: on ? C.card : '#FFFFFF', transform: on ? 'translateX(16px)' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
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

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`).concat('23:59');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** A date from a calendar and a time from a menu, held as "YYYY-MM-DDTHH:mm" in UTC. Empty is allowed. */
function DateTimeField({ label, value, onChange, emptyText, defaultTime, C }: {
  label: string; value: string; onChange: (value: string) => void; emptyText: string; defaultTime: string; C: ThemeColors;
}) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || defaultTime;
  const [open, setOpen] = useState(false);
  // Opens upward when there is no room below, as near the foot of a pop-up.
  const [up, setUp] = useState(false);
  const [view, setView] = useState(() => {
    const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() };
  });
  const today = ymd(new Date());
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const shown = date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
  const move = (step: number) => setView(({ year, month }) => {
    const next = new Date(Date.UTC(year, month + step, 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
  });
  const pick = (day: string) => { onChange(`${day}T${time}`); setOpen(false); };
  const times = TIMES.includes(time) ? TIMES : [...TIMES, time].sort();

  return (
    <div>
      <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
          <div className="flex items-center h-11 rounded-[10px]" style={{ ...fieldStyle(C), borderColor: open ? C.faint : C.inputBorder }}>
            <button
              type="button"
              onClick={(e) => {
                setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 360);
                setOpen((o) => !o);
              }}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={`${label}: ${shown ?? emptyText}`}
              className="flex-1 min-w-0 h-full flex items-center gap-2 px-3 text-left text-sm"
            >
              <CalendarDays className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} />
              <span className="truncate" style={{ color: shown ? C.text : C.faint, fontWeight: shown ? 500 : 400 }}>{shown ?? emptyText}</span>
            </button>
            {date && (
              <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`} className="w-8 h-8 mr-1 grid place-items-center rounded-lg" style={{ color: C.faint }}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {open && (
            <div
              role="dialog"
              aria-label={`Choose ${label.toLowerCase()} date`}
              className={`absolute left-0 z-40 w-72 rounded-2xl p-3 ${up ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"}`}
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 16px 40px rgba(15,23,42,0.18)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="w-8 h-8 grid place-items-center rounded-lg" style={{ color: C.muted }}>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <b className="text-sm font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{MONTHS[view.month]} {view.year}</b>
                <button type="button" onClick={() => move(1)} aria-label="Next month" className="w-8 h-8 grid place-items-center rounded-lg" style={{ color: C.muted }}>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                  <span key={d} className="text-[11px] font-semibold py-1" style={{ color: C.faint }}>{d}</span>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <span key={`e${i}`} />;
                  const key = ymd(new Date(Date.UTC(view.year, view.month, day)));
                  const selected = key === date;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pick(key)}
                      aria-pressed={selected}
                      className="h-8 rounded-lg text-xs tabular-nums transition-colors"
                      style={{
                        background: selected ? C.text : 'transparent',
                        color: selected ? C.card : C.text,
                        fontWeight: selected ? 700 : 400,
                        boxShadow: key === today && !selected ? `inset 0 0 0 1px ${C.faint}` : 'none',
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${C.divider}` }}>
                <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-xs font-semibold" style={{ color: C.text }}>{emptyText}</button>
                <button type="button" onClick={() => pick(today)} className="text-xs font-semibold" style={{ color: C.text }}>Today</button>
              </div>
            </div>
          )}
        </div>
        <TimeMenu label={`${label} time`} value={time} options={times} disabled={!date} onChange={(t) => onChange(`${date}T${t}`)} C={C} />
      </div>
    </div>
  );
}

/** A short list of times that opens on the chosen one, upward when there is no room below. */
function TimeMenu({ label, value, options, disabled, onChange, C }: {
  label: string; value: string; options: string[]; disabled: boolean; onChange: (value: string) => void; C: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 280);
          setOpen((o) => !o);
        }}
        className="w-full h-11 flex items-center gap-2 px-3 rounded-[10px] text-sm disabled:opacity-50"
        style={{ ...fieldStyle(C), borderColor: open ? C.faint : C.inputBorder }}
      >
        <Clock3 className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} />
        <span className="flex-1 text-left tabular-nums">{value}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.faint }} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={`absolute right-0 z-40 w-32 max-h-60 overflow-y-auto rounded-2xl p-1 ${up ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
          style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 16px 40px rgba(15,23,42,0.18)' }}
        >
          {options.map((t) => {
            const selected = t === value;
            return (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={selected}
                ref={selected ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(t); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm tabular-nums"
                style={{ background: selected ? C.pill : 'transparent', color: C.text, fontWeight: selected ? 600 : 400 }}
              >
                {t}
                {selected && <Check className="w-4 h-4" style={{ color: C.text }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
            <DateTimeField label="Starts" value={discount.startsAt} onChange={(startsAt) => set({ startsAt })} emptyText="Starts now" defaultTime="00:00" C={C} />
            <DateTimeField label="Ends" value={discount.endsAt} onChange={(endsAt) => set({ endsAt })} emptyText="No end date" defaultTime="23:59" C={C} />
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
                <span className="text-[28px] leading-9 font-bold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
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
