'use client';

// The Payment terms section of a cohort: its dates, plan, fee and installments.

import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { DateField } from '@/components/DatePicker';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { sendJson } from '../subscriptions/api';
import { Card, DISPLAY_FONT, btnClass, btnStyle, palette } from '../subscriptions/ui';
import { amountText } from '../payments/shared';
import { PLANS } from './shared';

type Terms = {
  start_date: string; end_date: string; payment_plan: string; total_fee: string; currency: string;
  deposit_percent: string; installment_count: string; grace_period_days: string; post_bootcamp_access_months: string;
};

function termsFrom(cohort: any, settings: any): Terms {
  const text = (value: unknown, fallback: string) => (value != null ? String(value) : fallback);
  return {
    start_date: cohort.start_date ?? '',
    end_date: cohort.end_date ?? '',
    payment_plan: settings?.payment_plan ?? 'flexible',
    total_fee: text(settings?.total_fee, ''),
    // Never a guessed currency: empty until one is saved.
    currency: settings?.currency ?? '',
    deposit_percent: text(settings?.deposit_percent, '50'),
    installment_count: text(settings?.installment_count, '3'),
    grace_period_days: text(settings?.grace_period_days, ''),
    post_bootcamp_access_months: text(settings?.post_bootcamp_access_months, '3'),
  };
}

function Group({ title, children, C }: { title: string; children: ReactNode; C: ThemeColors }) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-3" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h4>
      {children}
    </div>
  );
}

/** A labelled number box with its unit inside it, and a line under it. */
function UnitField({ label, value, onChange, before, after, placeholder, hint, C }: {
  label: string; value: string; onChange: (v: string) => void; before?: string; after?: string; placeholder?: string; hint?: string; C: ThemeColors;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{label}</span>
      <span className="field-shell flex items-center gap-2 h-11 px-3 rounded-[10px]" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
        {before && <span className="text-xs font-semibold" style={{ color: C.muted }}>{before}</span>}
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-transparent outline-none text-sm w-full min-w-0" style={{ color: C.text }} />
        {after && <span className="text-xs font-semibold" style={{ color: C.muted }}>{after}</span>}
      </span>
      {hint && <span className="block text-xs mt-2" style={{ color: C.muted }}>{hint}</span>}
    </label>
  );
}

export function PaymentTermsTab({ cohort, settings, onSaved, notify, C }: {
  cohort: any;
  settings: any;
  onSaved: (settings: any, dates: { start_date: string; end_date: string | null }) => void;
  notify: (ok: boolean, text: string) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [saved, setSaved] = useState(() => termsFrom(cohort, settings));
  const [terms, setTerms] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof Terms) => (value: string) => setTerms((t) => ({ ...t, [key]: value }));
  const dirty = JSON.stringify(terms) !== JSON.stringify(saved);
  const currency = terms.currency.trim().toUpperCase();
  const deposit = (Number(terms.total_fee) * Number(terms.deposit_percent)) / 100;

  async function save() {
    if (!terms.start_date) { setError('Choose a start date, so installment due dates can be worked out.'); return; }
    if (!(Number(terms.total_fee) > 0)) { setError('Enter the total fee.'); return; }
    if (!currency) { setError('Enter the currency, for example USD or NGN.'); return; }
    setBusy(true);
    setError('');
    try {
      const next = { ...terms, currency };
      const [json, dates] = await Promise.all([
        sendJson('/api/admissions', 'POST', { action: 'save-settings', cohortId: cohort.id, settings: next }, 'Failed to save payment terms.'),
        supabase.from('cohorts').update({ start_date: next.start_date, end_date: next.end_date || null, updated_at: new Date().toISOString() }).eq('id', cohort.id),
      ]);
      if (dates.error) throw dates.error;
      setSaved(next);
      setTerms(next);
      onSaved(json.settings, { start_date: next.start_date, end_date: next.end_date || null });
      notify(true, 'Payment terms saved');
    } catch (err: any) {
      setError(err.message || 'Failed to save payment terms.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card C={C}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <h3 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Payment terms</h3>
        <p className="text-xs mt-1" style={{ color: C.muted }}>Applied to new admissions. Learners already signed up keep their own schedule.</p>
      </div>
      <div className="p-5 grid gap-6">
        <Group title="Dates" C={C}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Start date</span><DateField label="Start date" value={terms.start_date} onChange={set('start_date')} clearable={false} C={C} /></div>
            <div><span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>End date</span><DateField label="End date" value={terms.end_date} onChange={set('end_date')} C={C} /></div>
          </div>
          <p className="text-xs mt-2" style={{ color: C.muted }}>Changing the start date moves the due dates of learners who have not signed up yet. For those who have, edit their schedule in Payments.</p>
        </Group>
        <Group title="Plan" C={C}>
          <div role="radiogroup" aria-label="Plan" className="grid grid-cols-2 sm:flex gap-1 p-1 rounded-xl max-w-[560px]" style={{ background: C.pill }}>
            {PLANS.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={terms.payment_plan === id} onClick={() => set('payment_plan')(id)} className="flex-1 h-9 px-3 rounded-[10px] text-xs font-semibold whitespace-nowrap"
                style={terms.payment_plan === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: C.muted }}>{PLANS.find(([id]) => id === terms.payment_plan)?.[2]}</p>
        </Group>
        <Group title="Fee" C={C}>
          <div className="grid sm:grid-cols-2 gap-3">
            <UnitField label="Total fee" value={terms.total_fee} onChange={set('total_fee')} before={currency || undefined} placeholder="0" C={C} />
            <label className="block">
              <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Currency</span>
              <input value={terms.currency} onChange={(e) => set('currency')(e.target.value)} maxLength={3} placeholder="Currency code" className="field-focus w-full h-11 rounded-[10px] px-3 text-sm outline-none uppercase" style={{ background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` }} />
              <span className="block text-xs mt-2" style={{ color: C.muted }}>Three-letter code, for example USD or NGN.</span>
            </label>
          </div>
        </Group>
        <Group title="Installments" C={C}>
          <div className="grid sm:grid-cols-3 gap-3">
            <UnitField label="Deposit" value={terms.deposit_percent} onChange={set('deposit_percent')} after="%" hint={deposit > 0 ? `${amountText(currency, deposit)} up front` : undefined} C={C} />
            <UnitField label="Installments" value={terms.installment_count} onChange={set('installment_count')} hint="At least 3" C={C} />
            <UnitField label="Grace period" value={terms.grace_period_days} onChange={set('grace_period_days')} after="days" placeholder="None" hint="Before access is paused" C={C} />
          </div>
        </Group>
        <Group title="After the bootcamp" C={C}>
          <div className="grid sm:grid-cols-3 gap-3">
            <UnitField label="Extra access" value={terms.post_bootcamp_access_months} onChange={set('post_bootcamp_access_months')} after="months" C={C} />
          </div>
        </Group>
        {error && <div role="alert" className="rounded-xl px-4 py-3 text-sm" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>{error}</div>}
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.divider}` }}>
        <button type="button" disabled={!dirty || busy} onClick={() => { setTerms(saved); setError(''); }} className={btnClass} style={btnStyle('ghost', C)}>Discard changes</button>
        <button type="button" disabled={busy} onClick={save} className={btnClass} style={btnStyle('pri', C)}>
          <Check className="w-4 h-4" />
          {busy ? 'Saving...' : 'Save payment terms'}
        </button>
      </div>
    </Card>
  );
}
