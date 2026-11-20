'use client';

// The pop-ups opened from an enrollment's row: record a payment, see and correct the payments
// made, and change the fee, plan and due dates.

import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { DateField } from '@/components/DatePicker';
import type { ThemeColors } from '@/lib/theme';
import { getPayments, postPayments } from '../subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { DISPLAY_FONT, Pill, dateLabel, palette } from '../subscriptions/ui';
import { amountText, owed } from './shared';

const label = 'block text-xs font-semibold';
const today = () => new Date().toISOString().slice(0, 10);

function Summary({ row, C }: { row: any; C: ThemeColors }) {
  const P = palette(C);
  const balance = owed(row);
  return (
    <div className="grid grid-cols-3 rounded-xl" style={{ background: C.page }}>
      {[
        ['Fee', amountText(row.currency, row.total_fee), C.text],
        ['Paid', amountText(row.currency, row.paid_total), P.good],
        ['Balance', row.access_status === 'waived' ? 'Waived' : balance > 0 ? amountText(row.currency, balance) : 'Settled', balance > 0 ? P.bad : P.good],
      ].map(([name, value, color], i) => (
        <div key={name} className="p-3 min-w-0" style={i ? { borderLeft: `1px solid ${C.divider}` } : undefined}>
          <p className="text-xs" style={{ color: C.muted }}>{name}</p>
          <p className="text-base font-semibold tabular-nums truncate" style={{ color, fontFamily: DISPLAY_FONT }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function AmountInput({ currency, value, onChange, C, autoFocus }: { currency: string; value: string; onChange: (v: string) => void; C: ThemeColors; autoFocus?: boolean }) {
  return (
    <div className="flex items-center gap-2 h-11 px-3 rounded-[10px]" style={inputStyle(C)}>
      {currency && <b className="text-xs font-semibold" style={{ color: C.muted }}>{currency}</b>}
      <input
        autoFocus={autoFocus}
        type="number"
        inputMode="decimal"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full bg-transparent outline-none focus-visible:!outline-none text-sm tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        style={{ color: C.text }}
      />
    </div>
  );
}

export function RecordPaymentModal({ row, onClose, onDone, C }: { row: any; onClose: () => void; onDone: (message: string) => void; C: ThemeColors }) {
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!(Number(amount) > 0)) { setError('Enter the amount received.'); return; }
    setSaving(true);
    setError('');
    try {
      await postPayments({
        action: 'record-payment', enrollmentId: row.enrollment_id, amount: Number(amount),
        paidAt: paidAt || undefined, method: method || undefined, reference: reference || undefined, notes: notes || undefined,
      }, 'Failed to record payment');
      onDone(`${amountText(row.currency, Number(amount))} recorded for ${row.student_name || row.email}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Record payment" eyebrow={row.student_name || row.email} onClose={onClose} C={C} error={error}>
      <div className="grid gap-4">
        <Summary row={row} C={C} />
        <div className="grid sm:grid-cols-2 gap-3">
          <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Amount</span><AmountInput autoFocus currency={row.currency} value={amount} onChange={setAmount} C={C} /></div>
          <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Date paid</span><DateField label="Date paid" value={paidAt} onChange={setPaidAt} clearable={false} C={C} /></div>
          <label className={label} style={{ color: C.muted }}>Method<input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Cash, Mobile Money, bank transfer" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
          <label className={label} style={{ color: C.muted }}>Reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt or transaction ID" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
        </div>
        <label className={label} style={{ color: C.muted }}>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{saving ? 'Saving...' : 'Record payment'}</button>
      </div>
    </Modal>
  );
}

/** Every payment on an enrollment, each one correctable or removable. */
export function PaymentHistoryModal({ row, onClose, onChanged, onRecordNew, C }: {
  row: any;
  onClose: () => void;
  /** A payment was changed or removed: the balance and access may have moved. */
  onChanged: () => void;
  onRecordNew: () => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [payments, setPayments] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => getPayments(`action=history&enrollmentId=${row.enrollment_id}`, 'Failed to load payment history')
    .then((data) => setPayments(data.payments ?? []))
    .catch((err) => setError(err.message));
  useEffect(() => {
    getPayments(`action=history&enrollmentId=${row.enrollment_id}`, 'Failed to load payment history')
      .then((data) => setPayments(data.payments ?? []))
      .catch((err) => setError(err.message));
  }, [row.enrollment_id]);

  async function act(task: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await task();
      setEditing(null);
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = () => {
    if (!(Number(editing.amount) > 0)) { setError('Enter the amount.'); return; }
    act(() => postPayments({
      action: 'edit-payment', paymentId: editing.id, amount: Number(editing.amount), paidAt: editing.paid_at || undefined,
      method: editing.method || null, reference: editing.reference || null, notes: editing.notes || null,
    }, 'Failed to update the payment'));
  };
  const remove = (p: any) => {
    if (!confirm("Delete this payment? The learner's balance and access are worked out again.")) return;
    act(() => postPayments({ action: 'delete-payment', paymentId: p.id }, 'Failed to delete the payment'));
  };
  const set = (change: any) => setEditing((v: any) => ({ ...v, ...change }));

  return (
    <Modal title="Payment history" eyebrow={row.student_name || row.email} onClose={onClose} C={C} error={error}>
      <div className="grid gap-4">
        <Summary row={row} C={C} />
        {payments === null ? (
          !error && <p className="text-sm text-center py-8" style={{ color: C.muted }}>Loading payments...</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: C.muted }}>No payments recorded yet.</p>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
            {payments.map((p, index) => (
              <div key={p.id} style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                {editing?.id === p.id ? (
                  <div className="grid gap-3 p-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Amount</span><AmountInput currency={row.currency} value={editing.amount} onChange={(amount) => set({ amount })} C={C} /></div>
                      <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Date paid</span><DateField label="Date paid" value={editing.paid_at ?? ''} onChange={(paid_at) => set({ paid_at })} C={C} /></div>
                      <label className={label} style={{ color: C.muted }}>Method<input value={editing.method} onChange={(e) => set({ method: e.target.value })} className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
                      <label className={label} style={{ color: C.muted }}>Reference<input value={editing.reference} onChange={(e) => set({ reference: e.target.value })} className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
                    </div>
                    <label className={label} style={{ color: C.muted }}>Notes<input value={editing.notes} onChange={(e) => set({ notes: e.target.value })} className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(null)} className={BUTTON} style={{ background: C.card, color: C.text }}>Cancel</button>
                      <button type="button" onClick={saveEdit} disabled={busy} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
                        <Check className="w-4 h-4" />
                        {busy ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{amountText(row.currency, p.amount)}</p>
                      <p className="text-xs" style={{ color: C.muted }}>{[p.paid_at ? dateLabel(p.paid_at) : null, p.method, p.reference].filter(Boolean).join(', ') || 'No details'}</p>
                      {p.notes && <p className="text-xs mt-1" style={{ color: C.faint }}>{p.notes}</p>}
                    </div>
                    <button
                      type="button"
                      aria-label="Edit payment"
                      disabled={busy}
                      onClick={() => setEditing({ id: p.id, amount: String(p.amount), paid_at: p.paid_at ? String(p.paid_at).slice(0, 10) : '', method: p.method ?? '', reference: p.reference ?? '', notes: p.notes ?? '' })}
                      className="w-8 h-8 rounded-[10px] grid place-items-center"
                      style={{ background: C.card, color: C.muted }}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Delete payment" disabled={busy} onClick={() => remove(p)} className="w-8 h-8 rounded-[10px] grid place-items-center" style={{ background: P.badSoft, color: P.bad }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs" style={{ color: C.muted }}>Deleting a payment works the balance and access out again.</p>
      </div>
      <div className="flex justify-end mt-6">
        <button type="button" onClick={onRecordNew} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4" />
          Record new payment
        </button>
      </div>
    </Modal>
  );
}

const PLANS = [['flexible', 'Flexible'], ['full', 'Full'], ['sponsored', 'Sponsored'], ['waived', 'Waived']] as const;

/** Fee, deposit, payment plan and the installment due dates. */
export function EditEnrollmentModal({ row, onClose, onChanged, onDone, C }: {
  row: any;
  onClose: () => void;
  onChanged: () => void;
  onDone: (message: string) => void;
  C: ThemeColors;
}) {
  const [fee, setFee] = useState(String(row.total_fee ?? ''));
  const [deposit, setDeposit] = useState(String(row.deposit_required ?? ''));
  const [plan, setPlan] = useState<string>(row.payment_plan ?? 'flexible');
  const [installments, setInstallments] = useState<any[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (row.is_presignup || !row.enrollment_id) return;
    getPayments(`action=installments&enrollmentId=${row.enrollment_id}`, 'Failed to load the due dates')
      .then((data) => {
        setInstallments(data.installments ?? []);
        setDates(Object.fromEntries((data.installments ?? []).map((i: any) => [i.id, i.due_date ?? ''])));
      })
      .catch((err) => setError(err.message));
  }, [row.enrollment_id, row.is_presignup]);

  async function saveDate(inst: any) {
    setSavingDate(inst.id);
    setError('');
    try {
      await postPayments({ action: 'edit-installment', installmentId: inst.id, due_date: dates[inst.id] }, 'Failed to save the due date');
      setInstallments((list) => list.map((i) => (i.id === inst.id ? { ...i, due_date: dates[inst.id] } : i)));
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDate(null);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await postPayments({
        action: 'edit-enrollment', enrollmentId: row.enrollment_id, total_fee: Number(fee), deposit_required: Number(deposit), payment_plan: plan,
      }, 'Failed to save the enrollment');
      onDone(`Enrollment for ${row.student_name || row.email} saved.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit enrollment" eyebrow={row.student_name || row.email} onClose={onClose} C={C} error={error}>
      <div className="grid gap-4">
        <h4 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Payment terms</h4>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Total fee</span><AmountInput currency={row.currency} value={fee} onChange={setFee} C={C} /></div>
          <div><span className={`${label} mb-2`} style={{ color: C.muted }}>Deposit required</span><AmountInput currency={row.currency} value={deposit} onChange={setDeposit} C={C} /></div>
        </div>
        <div>
          <span className={`${label} mb-2`} style={{ color: C.muted }}>Payment plan</span>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: C.pill }} role="radiogroup" aria-label="Payment plan">
            {PLANS.map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={plan === value}
                onClick={() => setPlan(value)}
                className="flex-1 h-9 rounded-[10px] text-xs font-semibold"
                style={plan === value ? { background: C.card, color: C.text, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } : { color: C.muted }}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {installments.length > 0 && (
          <>
            <h4 className="text-base font-semibold mt-2" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Due dates</h4>
            <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
              {installments.map((inst, i) => {
                const paid = inst.status === 'paid';
                const changed = (dates[inst.id] ?? '') !== (inst.due_date ?? '');
                return (
                  <div key={inst.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                    <div className="min-w-[96px] flex-1">
                      <p className="text-sm font-semibold" style={{ color: C.text }}>{i === 0 ? 'Deposit' : `Installment ${i}`}</p>
                      {paid && <p className="text-xs" style={{ color: C.muted }}>{dateLabel(inst.due_date)}</p>}
                    </div>
                    {!paid && (
                      <DateField className="w-44" compact label={i === 0 ? 'Deposit due date' : `Installment ${i} due date`} value={dates[inst.id] ?? ''} onChange={(d) => setDates((v) => ({ ...v, [inst.id]: d }))} clearable={false} C={C} />
                    )}
                    {!paid && changed && (
                      <button type="button" onClick={() => saveDate(inst)} disabled={savingDate === inst.id || !dates[inst.id]} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
                        {savingDate === inst.id ? 'Saving...' : 'Save date'}
                      </button>
                    )}
                    <Pill tone={paid ? 'good' : inst.status === 'partial' ? 'warn' : 'mute'} dot={paid} C={C}>
                      {paid ? 'Paid' : inst.status === 'partial' ? 'Part paid' : 'Not paid'}
                    </Pill>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{saving ? 'Saving...' : 'Save changes'}</button>
      </div>
    </Modal>
  );
}
