'use client';

// The payment terms and reference fields shared by Assign a subscription and the subscriber actions.

import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { DURATION_OPTIONS, earliestDeadline, type PaymentDraft } from './drafts';
import { FIELD, NUMBER_FIELD, inputStyle } from './Modal';

type Update = (change: Partial<PaymentDraft>) => void;

export function TermsFields({ payment, update, showDeadline, C }: { payment: PaymentDraft; update: Update; showDeadline: boolean; C: ThemeColors }) {
  const label = 'text-xs font-semibold';
  return (
    <div className={`grid ${showDeadline ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-3`}>
      <label className={label} style={{ color: C.muted }}>
        Access duration
        <div className="mt-2">
          <MenuSelect field label="Access duration" value={payment.durationMonths} options={DURATION_OPTIONS} onChange={(durationMonths) => update({ durationMonths })} C={C} />
        </div>
      </label>
      <label className={label} style={{ color: C.muted }}>
        Amount
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={payment.amount}
          onChange={(e) => update({ amount: e.target.value })}
          placeholder="0.00"
          className={`${NUMBER_FIELD} mt-2`}
          style={inputStyle(C)}
        />
      </label>
      <label className={label} style={{ color: C.muted }}>
        Currency
        <input value={payment.currency} onChange={(e) => update({ currency: e.target.value.toUpperCase() })} className={`${FIELD} mt-2`} style={inputStyle(C)} />
      </label>
      {showDeadline && (
        <label className={label} style={{ color: C.muted }}>
          Payment deadline
          <input type="date" min={earliestDeadline()} value={payment.dueDate} onChange={(e) => update({ dueDate: e.target.value })} className={`${FIELD} mt-2`} style={inputStyle(C)} />
        </label>
      )}
    </div>
  );
}

export function ReferenceFields({ payment, update, C }: { payment: PaymentDraft; update: Update; C: ThemeColors }) {
  const label = 'text-xs font-semibold';
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <label className={label} style={{ color: C.muted }}>
        Payment method
        <input value={payment.paymentMethod} onChange={(e) => update({ paymentMethod: e.target.value })} placeholder="Mobile Money, bank transfer" className={`${FIELD} mt-2`} style={inputStyle(C)} />
      </label>
      <label className={label} style={{ color: C.muted }}>
        Reference
        <input value={payment.paymentReference} onChange={(e) => update({ paymentReference: e.target.value })} placeholder="Transaction ID" className={`${FIELD} mt-2`} style={inputStyle(C)} />
      </label>
      <label className={`sm:col-span-2 ${label}`} style={{ color: C.muted }}>
        Internal notes
        <textarea value={payment.notes} onChange={(e) => update({ notes: e.target.value })} className={`${FIELD} mt-2 min-h-20`} style={inputStyle(C)} />
      </label>
    </div>
  );
}

/** Whether a draft can be sent: an amount, a currency and, for a request, a deadline. */
export function paymentReady(payment: PaymentDraft, needsDeadline: boolean) {
  return Number(payment.amount) > 0 && Boolean(payment.currency.trim()) && (!needsDeadline || Boolean(payment.dueDate));
}
