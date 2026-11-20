'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { postPayments } from './api';
import { planDiscountFromRow, planDiscountPayload, planPriceDrafts, pricesPayload } from './drafts';
import { BUTTON, FIELD, Modal, UnsavedChangesDialog, inputStyle } from './Modal';
import { PlanDiscountFields, PlanPriceFields } from './PlanForm';
import { DISPLAY_FONT } from './ui';

/** A plan's name, description, prices and promotion. Asks before closing with unsaved edits. */
export function EditPlanModal({ plan, currency, onClose, onSaved, C }: {
  plan: any;
  currency: string;
  onClose: () => void;
  onSaved: (message: string, planId: string) => void;
  C: ThemeColors;
}) {
  const [initial] = useState(() => ({
    name: String(plan.name ?? ''),
    description: String(plan.description ?? ''),
    prices: planPriceDrafts(plan, currency),
    discount: planDiscountFromRow(plan),
  }));
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [prices, setPrices] = useState(initial.prices);
  const [discount, setDiscount] = useState(initial.discount);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty = name.trim() !== initial.name.trim()
    || description.trim() !== initial.description.trim()
    || JSON.stringify(prices) !== JSON.stringify(initial.prices)
    || JSON.stringify(planDiscountPayload(discount)) !== JSON.stringify(planDiscountPayload(initial.discount));

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  async function save() {
    if (!name.trim()) return;
    setConfirmClose(false);
    setBusy(true);
    setError('');
    try {
      await postPayments({ action: 'update-subscription-plan', planId: plan.id, name: name.trim(), description: description.trim() }, 'Failed to update plan');
      await postPayments({
        action: 'save-subscription-plan-prices',
        planId: plan.id,
        prices: pricesPayload(prices),
        discount: planDiscountPayload(discount),
      }, 'Failed to update plan prices');
      onSaved('Plan details updated.', plan.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="Plan details" eyebrow="Name, prices and offer" onClose={requestClose} C={C} error={error} wide>
        <section>
          <h4 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>About this plan</h4>
          <p className="text-xs mt-1 mb-4" style={{ color: C.muted }}>What learners see on the pricing page.</p>
          <label className="block text-xs font-semibold" style={{ color: C.muted }}>
            Plan name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Professional" className={`${FIELD} mt-2 font-semibold`} style={inputStyle(C)} />
          </label>
          <label className="block text-xs font-semibold mt-4" style={{ color: C.muted }}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={240}
              placeholder="Describe who this plan is for"
              className={`${FIELD} mt-2 min-h-20 resize-none`}
              style={inputStyle(C)}
            />
            <span className="block text-right text-xs mt-1 font-normal" style={{ color: C.faint }}>{description.length}/240</span>
          </label>
        </section>

        <PlanPriceFields prices={prices} setPrices={setPrices} discount={discount} C={C} />
        <PlanDiscountFields discount={discount} setDiscount={setDiscount} prices={prices} C={C} />

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-5 mt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
          <button onClick={requestClose} disabled={busy} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
            <Check className="w-4 h-4" />
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </Modal>
      {confirmClose && (
        <UnsavedChangesDialog
          creating={false}
          busy={busy}
          canSave={Boolean(name.trim())}
          onDiscard={onClose}
          onKeepEditing={() => setConfirmClose(false)}
          onSave={save}
          C={C}
        />
      )}
    </>
  );
}
