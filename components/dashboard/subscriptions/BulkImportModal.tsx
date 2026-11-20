'use client';

import { useState } from 'react';
import { BadgeCheck, Clock3, Download, ShieldCheck, Upload, UserPlus } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { parseSubscriptionImportText } from '@/lib/subscription-import';
import type { ThemeColors } from '@/lib/theme';
import { postPayments } from './api';
import { DURATION_OPTIONS, earliestDeadline, freshPayment } from './drafts';
import { BUTTON, FIELD, Modal, NUMBER_FIELD, inputStyle } from './Modal';
import { OptionCard, plural } from './ui';
import { DateField } from '@/components/DatePicker';

function downloadTemplate() {
  const blob = new Blob([String.fromCharCode(0xfeff) + 'email,full_name\r\nlearner@example.com,Ama Mensah\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'subscription-learners-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Many learners onto one plan, from pasted emails or a CSV. Stays open to show what happened. */
export function BulkImportModal({ initialPlan, activePlans, currency, onClose, onImported, C }: {
  initialPlan: any;
  activePlans: any[];
  currency: string;
  onClose: () => void;
  onImported: (message: string, planId: string) => void;
  C: ThemeColors;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [mode, setMode] = useState<'request' | 'paid'>('request');
  // One batch id for the life of this pop-up, so the server can tell a retry from a new import.
  const [batchId] = useState(() => crypto.randomUUID());
  const [terms, setTerms] = useState(() => freshPayment(currency));
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const label = 'text-xs font-semibold';

  const reset = () => { setResult(null); setError(''); };
  function updateText(value: string) {
    setText(value);
    setRows(parseSubscriptionImportText(value));
    reset();
  }
  function readFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateText(String(reader.result ?? ''));
    reader.onerror = () => setError('Could not read this CSV file.');
    reader.readAsText(file);
  }

  async function importRows() {
    setBusy(true);
    reset();
    try {
      const data = await postPayments({
        action: 'bulk-subscription-payment-requests',
        mode,
        batchId,
        planId: plan.id,
        rows,
        defaults: {
          durationMonths: Number(terms.durationMonths),
          amount: Number(terms.amount),
          currency: terms.currency,
          dueDate: terms.dueDate,
          paymentMethod: terms.paymentMethod,
          paymentReference: terms.paymentReference,
          notes: terms.notes,
        },
      }, 'Failed to import students');
      setResult(data);
      onImported(
        mode === 'request'
          ? `${plural(data.requested, 'payment request')} created for ${plan.name}.`
          : `${plural(data.activated, 'learner')} activated on ${plan.name}.`,
        plan.id,
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (change: Partial<typeof terms>) => setTerms((value) => ({ ...value, ...change }));
  const ready = rows.length > 0 && rows.length <= 500 && Number(terms.amount) > 0 && Boolean(terms.currency.trim()) && (mode === 'paid' || Boolean(terms.dueDate));

  return (
    <Modal title="Bulk add learners" eyebrow="Paste emails or a CSV for one plan" onClose={onClose} C={C} wide>
      <div className="space-y-6">
        <label className={label} style={{ color: C.muted }}>
          Access plan
          <div className="mt-2">
            <MenuSelect
              field
              label="Access plan"
              value={plan.id as string}
              options={activePlans.map((p) => ({ value: p.id as string, label: p.name as string }))}
              onChange={(id) => {
                const next = activePlans.find((p) => p.id === id);
                if (next) { setPlan(next); reset(); }
              }}
              C={C}
            />
          </div>
          <span className="block font-normal mt-2" style={{ color: C.faint }}>Every learner in this import will be assigned to this plan.</span>
        </label>
        <div className="pt-3">
          <p className="text-sm font-semibold mb-3" style={{ color: C.text }}>How should payment be handled?</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <OptionCard selected={mode === 'request'} onClick={() => { setMode('request'); reset(); }} icon={<Clock3 className="w-4 h-4" />} title="Request payment" sub="Learners confirm payment before an admin approves access." C={C} />
            <OptionCard selected={mode === 'paid'} onClick={() => { setMode('paid'); reset(); }} icon={<BadgeCheck className="w-4 h-4" />} title="Already paid" sub="Record verified payments and activate access immediately." C={C} />
          </div>
        </div>
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
          <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: C.text }}>{mode === 'request' ? 'Payment approval controls access' : 'Access begins immediately'}</p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
              {mode === 'request'
                ? 'Each learner receives a payment request. Their subscription becomes active only after their payment confirmation is approved.'
                : 'Use this only for payments you have already verified. Each learner is activated as soon as the import succeeds.'}
            </p>
          </div>
        </div>

        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: C.text }}>1. Add learners</p>
              <p className="text-xs mt-1" style={{ color: C.faint }}>Upload a .csv file or paste CSV rows or one email per line.</p>
            </div>
            <div className="flex flex-wrap gap-2 self-start">
              <button type="button" onClick={downloadTemplate} className={BUTTON} style={{ background: C.pill, color: C.text }}>
                <Download className="w-4 h-4" />
                Download template
              </button>
              <label className={`${BUTTON} cursor-pointer`} style={{ background: C.pill, color: C.text }}>
                <Upload className="w-4 h-4" />Upload CSV
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { readFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
              </label>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(event) => updateText(event.target.value)}
            className={`${FIELD} min-h-44 font-mono text-xs leading-relaxed`}
            style={inputStyle(C)}
            placeholder={'email,full_name\nada@example.com,Ada Mensah\nkwame@example.com,Kwame Asare'}
          />
          <p className="text-[11px] mt-2" style={{ color: C.faint }}>Required: email. Optional: full_name. The payment terms below apply to every learner in this batch.</p>
        </div>

        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: C.text }}>2. Default payment terms</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className={label} style={{ color: C.muted }}>Duration<div className="mt-2"><MenuSelect field label="Duration" value={terms.durationMonths} options={DURATION_OPTIONS} onChange={(durationMonths) => set({ durationMonths })} C={C} /></div></label>
            <label className={label} style={{ color: C.muted }}>Amount<input type="number" inputMode="decimal" min="0.01" step="0.01" value={terms.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" className={`${NUMBER_FIELD} mt-2`} style={inputStyle(C)} /></label>
            <label className={label} style={{ color: C.muted }}>Currency<input value={terms.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
            {mode === 'request' ? (
              <label className={label} style={{ color: C.muted }}>Payment deadline<DateField className="mt-2" label="Payment deadline" value={terms.dueDate} onChange={(dueDate) => set({ dueDate })} min={earliestDeadline()} clearable={false} utc C={C} /></label>
            ) : (
              <label className={label} style={{ color: C.muted }}>Payment method<input value={terms.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })} placeholder="Bank transfer" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
            )}
          </div>
          {mode === 'paid' && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <label className={label} style={{ color: C.muted }}>Payment reference<input value={terms.paymentReference} onChange={(e) => set({ paymentReference: e.target.value })} placeholder="Optional shared reference" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
              <label className={label} style={{ color: C.muted }}>Notes<input value={terms.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional internal note" className={`${FIELD} mt-2`} style={inputStyle(C)} /></label>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.divider}` }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.page }}>
              <p className="text-sm font-semibold" style={{ color: C.text }}>3. Review learners</p>
              <span className="text-xs font-semibold rounded-full px-3 py-1" style={{ background: C.pill, color: C.text }}>{rows.length} parsed</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {rows.slice(0, 12).map((row, index) => (
                <div key={`${row.email}-${index}`} className="grid sm:grid-cols-[36px_1fr_1fr] gap-2 px-4 py-3 text-xs" style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <span style={{ color: C.faint }}>{index + 1}</span>
                  <span className="truncate font-semibold" style={{ color: C.text }}>{row.email}</span>
                  <span className="truncate" style={{ color: C.muted }}>{row.full_name || 'Name not provided'}</span>
                </div>
              ))}
              {rows.length > 12 && <p className="px-4 py-3 text-xs text-center" style={{ color: C.faint }}>And {rows.length - 12} more learners</p>}
            </div>
          </div>
        )}

        {error && <div className="rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                [mode === 'request' ? 'Requests' : 'Activated', mode === 'request' ? result.requested : result.activated],
                ['New accounts', result.newAccounts],
                ['Existing', result.existingStudents],
                ['Emails sent', result.paymentEmailsSent],
                ['Errors', result.errors?.length || 0],
              ].map(([name, value]) => (
                <div key={String(name)} className="rounded-xl p-3" style={{ background: C.page }}>
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>{name}</p>
                  <p className="text-[22px] font-semibold mt-1 leading-7" style={{ color: C.text }}>{value}</p>
                </div>
              ))}
            </div>
            {result.errors?.length > 0 && (
              <div className="rounded-xl p-3" style={{ background: C.errorBg, color: C.errorText }}>
                <p className="text-xs font-semibold mb-2">Rows needing attention</p>
                {result.errors.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs mt-1">Row {item.row}: {item.email || 'No email'} - {item.error}</p>)}
              </div>
            )}
            {result.warnings?.length > 0 && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(217,119,6,0.10)', color: '#b45309' }}>
                {result.warnings.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs">Row {item.row}: {item.warning}</p>)}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>{result ? 'Close' : 'Cancel'}</button>
          <button onClick={importRows} disabled={busy || !ready} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
            <UserPlus className="w-4 h-4" />
            {busy
              ? mode === 'request' ? 'Creating requests...' : 'Activating learners...'
              : mode === 'request'
                ? `Create ${rows.length || ''} payment request${rows.length === 1 ? '' : 's'}`
                : `Activate ${rows.length || ''} learner${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
