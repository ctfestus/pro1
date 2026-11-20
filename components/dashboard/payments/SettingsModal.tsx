'use client';

import { useState } from 'react';
import { MenuSelect } from '@/components/MenuSelect';
import { isIndividualCohort } from '@/lib/cohort-kind';
import type { ThemeColors } from '@/lib/theme';
import { postPayments } from '../subscriptions/api';
import { BUTTON, Modal } from '../subscriptions/Modal';

/** Where learners who miss a payment go, and how long each bootcamp waits before moving them. */
export function SettingsModal({ cohorts, outstandingCohortId, gracePeriods, onClose, onSaved, C }: {
  cohorts: any[];
  outstandingCohortId: string;
  gracePeriods: Record<string, number | null>;
  onClose: () => void;
  onSaved: () => void;
  C: ThemeColors;
}) {
  const bootcamps = cohorts.filter((c) => c.cohort_kind === 'bootcamp');
  const [outstanding, setOutstanding] = useState(outstandingCohortId);
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(bootcamps.map((c) => [c.id, gracePeriods[c.id] == null ? '' : String(gracePeriods[c.id])])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (outstanding !== outstandingCohortId) {
        await postPayments({ action: 'save-payment-config', outstandingCohortId: outstanding || null }, 'Failed to save the outstanding cohort');
      }
      for (const c of bootcamps) {
        const before = gracePeriods[c.id] == null ? '' : String(gracePeriods[c.id]);
        if (days[c.id] !== before) {
          await postPayments({ action: 'save-grace-period', cohortId: c.id, gracePeriodDays: days[c.id] }, `Failed to save the grace period for ${c.name}`);
        }
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Payment settings" eyebrow="What happens when a payment is missed" onClose={onClose} C={C} error={error}>
      <div className="grid gap-5">
        <div>
          <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Outstanding cohort</span>
          <MenuSelect
            field
            label="Outstanding cohort"
            placeholder="Choose the outstanding cohort"
            value={outstanding}
            options={cohorts.filter((c) => !isIndividualCohort(c.cohort_kind)).map((c) => ({ value: c.id as string, label: c.name as string }))}
            onChange={setOutstanding}
            C={C}
          />
          <p className="text-xs mt-2" style={{ color: C.muted }}>Learners moved here lose course access until they pay.</p>
        </div>
        <div>
          <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Grace period after a missed installment</span>
          {bootcamps.length === 0 ? (
            <p className="text-sm" style={{ color: C.muted }}>No bootcamp cohorts yet.</p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
              {bootcamps.map((c, i) => (
                <label key={c.id} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <span className="min-w-0 flex-1 text-sm font-semibold" style={{ color: C.text }}>{c.name}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={days[c.id] ?? ''}
                    onChange={(e) => setDays((v) => ({ ...v, [c.id]: e.target.value }))}
                    placeholder="None"
                    aria-label={`Grace days for ${c.name}`}
                    className="field-focus w-20 h-10 rounded-[10px] px-3 text-sm outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{ background: C.card, color: C.text, border: `1px solid ${C.inputBorder}` }}
                  />
                  <span className="text-xs" style={{ color: C.muted }}>days</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{saving ? 'Saving...' : 'Save settings'}</button>
      </div>
    </Modal>
  );
}
