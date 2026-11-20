'use client';

// New cohort / Edit details, Delete cohort, and a general confirm pop-up for the Cohorts page.

import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { DateField } from '@/components/DatePicker';
import { supabase } from '@/lib/supabase';
import { classesEndDateError } from '@/lib/cohort-dates';
import type { ThemeColors } from '@/lib/theme';
import { sendJson } from '../subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { palette } from '../subscriptions/ui';

function Field({ label, children, C }: { label: string; children: ReactNode; C: ThemeColors }) {
  return (
    <div>
      <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{label}</span>
      {children}
    </div>
  );
}

function Footer({ onCancel, children, C }: { onCancel: () => void; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
      <button type="button" onClick={onCancel} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
      {children}
    </div>
  );
}

/** A square tick box in the selection blue. */
export function Tick({ on, C }: { on: boolean; C: ThemeColors }) {
  const P = palette(C);
  return (
    <span aria-hidden className="w-[18px] h-[18px] rounded-md grid place-items-center flex-shrink-0" style={on ? { background: P.sel, color: P.onSel } : { boxShadow: `inset 0 0 0 2px ${C.faint}` }}>
      {on && <Check className="w-3 h-3" strokeWidth={3} />}
    </span>
  );
}

/** New cohort when `cohort` is null, Edit details otherwise. */
export function CohortFormModal({ cohort, onClose, onSaved, C }: { cohort: any | null; onClose: () => void; onSaved: (row: any) => void; C: ThemeColors }) {
  const [form, setForm] = useState({
    name: cohort?.name ?? '',
    description: cohort?.description ?? '',
    start_date: cohort?.start_date ?? '',
    end_date: cohort?.end_date ?? '',
    classes_end_date: cohort?.classes_end_date ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const valid = form.name.trim() && (cohort || form.start_date);

  async function save() {
    const datesError = classesEndDateError(form.start_date, form.classes_end_date, form.end_date);
    if (datesError) { setError(datesError); return; }
    setBusy(true);
    setError('');
    try {
      const fields = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (cohort) {
        const json = await sendJson(`/api/cohorts/${cohort.id}`, 'PATCH', { ...fields, classes_end_date: form.classes_end_date || null }, 'Failed to update cohort.');
        onSaved(json.cohort);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error: insertError } = await supabase.from('cohorts')
          // Classes end only sent when set, so creating a cohort still works where migration 223 has not run.
          .insert({ ...fields, ...(form.classes_end_date ? { classes_end_date: form.classes_end_date } : {}), created_by: user!.id })
          .select().single();
        if (insertError) throw insertError;
        onSaved(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save the cohort.');
      setBusy(false);
    }
  }

  return (
    <Modal title={cohort ? 'Edit details' : 'New cohort'} eyebrow={cohort ? cohort.name : 'A bootcamp group with its own dates and content'} onClose={onClose} C={C} error={error}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) save(); }}>
        <Field label="Name" C={C}>
          <input autoFocus value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="For example, SQL Bootcamp, Cohort 2" className={FIELD} style={inputStyle(C)} />
        </Field>
        <Field label="Description (optional)" C={C}>
          <input value={form.description} onChange={(e) => set('description')(e.target.value)} placeholder="What the cohort covers" className={FIELD} style={inputStyle(C)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Start date" C={C}><DateField label="Start date" value={form.start_date} onChange={set('start_date')} clearable={!!cohort} C={C} /></Field>
          <Field label="End date (optional)" C={C}><DateField label="End date" value={form.end_date} onChange={set('end_date')} C={C} /></Field>
        </div>
        <Field label="Classes end (optional)" C={C}>
          <DateField label="Classes end date" value={form.classes_end_date} onChange={set('classes_end_date')} C={C} />
          <p className="text-xs mt-2" style={{ color: C.muted }}>
            Last day of teaching. The time from here to the end date is the catch-up period learners get to finish their work.
          </p>
        </Field>
        <Footer onCancel={onClose} C={C}>
          <button type="submit" disabled={busy || !valid} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
            {busy ? 'Saving...' : cohort ? 'Save changes' : 'Create cohort'}
          </button>
        </Footer>
      </form>
    </Modal>
  );
}

export type DeleteTarget = { id: string; name: string; losses: string[]; members: number; held: number; holdWarning: string | null; fingerprint: string };

/** Shown when the server lists what deleting a cohort would destroy, before anything is touched. */
export function DeleteCohortModal({ target, busy, onDelete, onClose, C }: {
  target: DeleteTarget; busy: boolean; onDelete: (alsoMembers: boolean) => void; onClose: () => void; C: ThemeColors;
}) {
  const P = palette(C);
  const [alsoMembers, setAlsoMembers] = useState(false);
  return (
    <Modal title="Delete cohort?" eyebrow={target.name} onClose={onClose} C={C}>
      <div className="grid gap-4">
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: P.warnSoft, color: P.warn }}>
          This cannot be undone{target.losses.length ? ', and any money recorded against this cohort leaves payment reporting.' : '.'}
        </div>
        {target.losses.length > 0 ? (
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: C.text }}>This permanently deletes:</p>
            <ul className="list-disc pl-5 grid gap-1 text-sm" style={{ color: C.muted }}>
              {target.losses.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : (
          <p className="text-sm" style={{ color: C.muted }}>{target.members ? 'Nothing else is attached to this cohort.' : 'Nothing is attached to this cohort.'}</p>
        )}
        {target.members > 0 && (
          <button type="button" role="checkbox" aria-checked={alsoMembers} onClick={() => setAlsoMembers((v) => !v)} className="flex items-start gap-3 text-left">
            <span className="mt-0.5"><Tick on={alsoMembers} C={C} /></span>
            <span>
              <span className="block text-sm font-semibold" style={{ color: C.text }}>
                Also delete the {target.members} learner account{target.members === 1 ? '' : 's'}
              </span>
              <span className="block text-xs mt-1" style={{ color: C.muted }}>
                {alsoMembers ? 'Their logins, submissions, grades and certificates go with them.' : 'Otherwise they keep their accounts, with no cohort until you add them to one.'}
                {target.held > 0 ? ` Includes ${target.held} held over an unpaid balance.` : ''}
              </span>
              {!alsoMembers && target.holdWarning && <span className="block text-xs mt-2 font-semibold" style={{ color: P.bad }}>{target.holdWarning}</span>}
            </span>
          </button>
        )}
      </div>
      <Footer onCancel={onClose} C={C}>
        <button type="button" disabled={busy} onClick={() => onDelete(alsoMembers)} className={BUTTON} style={{ background: P.badSoft, color: P.bad }}>
          {busy ? 'Deleting...' : alsoMembers ? 'Delete cohort and learners' : 'Delete cohort'}
        </button>
      </Footer>
    </Modal>
  );
}

/** A yes-or-no question in the page's pop-up style, in place of the browser's confirm box. */
export function ConfirmModal({ title, eyebrow, body, action, danger, busy, onConfirm, onClose, C }: {
  title: string; eyebrow?: string; body: string; action: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void; C: ThemeColors;
}) {
  const P = palette(C);
  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onClose} C={C}>
      <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{body}</p>
      <Footer onCancel={onClose} C={C}>
        <button type="button" disabled={busy} onClick={onConfirm} className={BUTTON} style={danger ? { background: P.badSoft, color: P.bad } : { background: C.cta, color: C.ctaText }}>
          {busy ? 'Working...' : action}
        </button>
      </Footer>
    </Modal>
  );
}
