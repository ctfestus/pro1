'use client';

// The Admissions section of a cohort: who was admitted and what they paid at admission, with the
// Admit student and Import admissions pop-ups.

import { useState, type ReactNode } from 'react';
import { Plus, Upload } from 'lucide-react';
import { DateField } from '@/components/DatePicker';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { sendJson } from '../subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { Bar, Card, Money, Pill, btnClass, btnStyle, palette, plural, shortDate } from '../subscriptions/ui';
import { amountText } from '../payments/shared';
import { accountStatus } from '../students/shared';
import { PLANS } from './shared';

const PLAN_OPTIONS = PLANS.map(([value, label]) => ({ value, label }));
const planLabel = (plan: string | null) => PLANS.find(([id]) => id === plan)?.[1] ?? 'Flexible';

/** The account status of an admitted learner, or what is known when there is no account yet. */
function admissionStatus(row: any) {
  if (row.student) return accountStatus(row.student);
  return { label: row.student_id ? 'Account linked' : 'Admission only', tone: 'mute' as const };
}

/** Rows from a pasted or uploaded CSV with an email column, or from a plain list of emails. */
function parseRows(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  if (lines[0].toLowerCase().includes('email') && lines.length >= 2) {
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]));
    }).filter((r) => r.email);
  }
  return lines.map((l) => l.trim().toLowerCase()).filter((l) => l.includes('@')).map((email) => ({ email }));
}

function Field({ label, children, C }: { label: string; children: ReactNode; C: ThemeColors }) {
  return (
    <div>
      <span className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{label}</span>
      {children}
    </div>
  );
}

function MoneyInput({ value, onChange, currency, placeholder, C }: { value: string; onChange: (v: string) => void; currency: string; placeholder: string; C: ThemeColors }) {
  return (
    <span className="field-shell flex items-center gap-2 h-11 px-3 rounded-[10px]" style={inputStyle(C)}>
      {currency && <span className="text-xs font-semibold" style={{ color: C.muted }}>{currency}</span>}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-transparent outline-none text-sm w-full min-w-0" style={{ color: C.text }} />
    </span>
  );
}

const BLANK = { email: '', full_name: '', total_fee: '', payment_plan: 'flexible', amount_paid: '', paid_at: '', payment_method: '', payment_reference: '', notes: '' };

function AdmitStudentModal({ cohort, settings, onAdmitted, onClose, C }: { cohort: any; settings: any; onAdmitted: (who: string) => Promise<void>; onClose: () => void; C: ThemeColors }) {
  const P = palette(C);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<{ email: string; name: string; added: boolean }[]>([]);
  const set = (key: keyof typeof BLANK) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const currency = settings?.currency ?? '';
  const valid = /^\S+@\S+\.\S+$/.test(form.email.trim());

  async function admit(closeAfter: boolean) {
    setBusy(true);
    setError('');
    const row: Record<string, string> = { email: form.email.trim().toLowerCase() };
    for (const key of ['full_name', 'total_fee', 'payment_plan', 'amount_paid', 'paid_at', 'payment_method', 'payment_reference', 'notes'] as const) {
      if (form[key].trim()) row[key] = form[key].trim();
    }
    try {
      const res = await sendJson('/api/admissions', 'POST', { cohortId: cohort.id, rows: [row] }, 'Failed to save. Please try again.');
      if (res.errors?.length) throw new Error(res.errors[0].error);
      await onAdmitted(row.full_name || row.email);
      if (closeAfter) { onClose(); return; }
      setLog((prev) => [{ email: row.email, name: row.full_name ?? '', added: res.inserted > 0 }, ...prev]);
      setForm(BLANK);
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="Admit student" eyebrow="Creates their account and sends the setup email" onClose={onClose} C={C} error={error}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) admit(true); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Email" C={C}><input autoFocus type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder="learner@example.com" className={FIELD} style={inputStyle(C)} /></Field>
          <Field label="Full name" C={C}><input value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="Learner's full name" className={FIELD} style={inputStyle(C)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Total fee" C={C}>
            <MoneyInput value={form.total_fee} onChange={set('total_fee')} currency={currency} placeholder={settings?.total_fee != null ? `${Number(settings.total_fee).toLocaleString()} (cohort fee)` : 'Cohort fee'} C={C} />
          </Field>
          <Field label="Plan" C={C}><MenuSelect field label="Plan" value={form.payment_plan} options={PLAN_OPTIONS} onChange={set('payment_plan')} C={C} /></Field>
        </div>
        <p className="text-base font-semibold" style={{ color: C.text }}>Payment already made (optional)</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Amount paid" C={C}><MoneyInput value={form.amount_paid} onChange={set('amount_paid')} currency={currency} placeholder="0" C={C} /></Field>
          <Field label="Date paid" C={C}><DateField label="Date paid" value={form.paid_at} onChange={set('paid_at')} placeholder="Pick a date" C={C} /></Field>
          <Field label="Method" C={C}><input value={form.payment_method} onChange={(e) => set('payment_method')(e.target.value)} placeholder="For example, bank transfer" className={FIELD} style={inputStyle(C)} /></Field>
          <Field label="Reference" C={C}><input value={form.payment_reference} onChange={(e) => set('payment_reference')(e.target.value)} placeholder="Transaction reference" className={FIELD} style={inputStyle(C)} /></Field>
        </div>
        <Field label="Notes (optional)" C={C}>
          <textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={2} className={`${FIELD} resize-none`} style={inputStyle(C)} />
        </Field>
        {log.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: C.muted }}>Admitted in this pop-up ({log.length})</p>
            {log.map((entry, i) => (
              <div key={`${entry.email}-${i}`} className="flex items-center justify-between gap-3 py-2" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                <span className="min-w-0">
                  <span className="block text-sm truncate" style={{ color: C.text }}>{entry.email}</span>
                  {entry.name && <span className="block text-xs" style={{ color: C.muted }}>{entry.name}</span>}
                </span>
                <span className="text-xs font-semibold" style={{ color: entry.added ? P.good : C.muted }}>{entry.added ? 'Added' : 'Updated'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
          <button type="button" disabled={busy || !valid} onClick={() => admit(false)} className={BUTTON} style={btnStyle('sec', C)}>Save and add another</button>
          <button type="submit" disabled={busy || !valid} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Saving...' : 'Admit and send setup email'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ cohort, admissions, onImported, onClose, C }: { cohort: any; admissions: any[]; onImported: (ok: boolean, text: string) => Promise<void>; onClose: () => void; C: ThemeColors }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = parseRows(text);
  const known = new Set(admissions.map((a) => String(a.student?.email || a.email || '').toLowerCase()));
  const updates = rows.filter((r) => known.has(r.email.toLowerCase())).length;

  async function importRows() {
    setBusy(true);
    setError('');
    try {
      const res = await sendJson('/api/admissions', 'POST', { cohortId: cohort.id, rows }, 'Import failed. Please try again.');
      const errors: any[] = res.errors ?? [];
      const summary = `Import complete: ${res.inserted ?? 0} added, ${res.updated ?? 0} updated, ${plural(res.provisioned ?? 0, 'setup link')} prepared, ${plural(res.setupEmailsSent ?? 0, 'email')} sent.`;
      await onImported(!errors.length, errors.length ? `${summary} ${errors.length} failed: ${errors.map((e) => e.email).join(', ')}` : summary);
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Import admissions" eyebrow="One row per learner, from a CSV file" onClose={onClose} C={C} error={error}>
      <div className="grid gap-4">
        <label className="grid place-items-center gap-1 rounded-xl px-4 py-5 text-center cursor-pointer" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
          <Upload className="w-6 h-6" />
          <span className="text-sm font-semibold mt-1" style={{ color: C.text }}>Choose a CSV file</span>
          <span className="text-xs">or paste rows below</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => setText(String(ev.target?.result ?? ''));
            reader.readAsText(file);
            e.target.value = '';
          }} />
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="CSV rows"
          placeholder={'email,full_name,total_fee,payment_plan,amount_paid\nstudent@example.com,Jane Doe,3000,flexible,1500'}
          className={`${FIELD} font-mono text-xs resize-none`} style={inputStyle(C)} />
        <p className="text-xs" style={{ color: C.muted }}>
          Needs an email column. Optional: full_name, total_fee, payment_plan, amount_paid, paid_at, payment_method, payment_reference, notes. Missing fees and plans use this cohort&apos;s payment terms.
        </p>
        {rows.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block text-sm font-semibold" style={{ color: C.text }}>{plural(rows.length, 'row')} ready</span>
                <span className="block text-xs" style={{ color: C.muted }}>{rows.length - updates} new{updates ? `, ${updates} already admitted will be updated` : ''}</span>
              </span>
              <Pill tone="good" dot C={C}>Checked</Pill>
            </div>
            <div className="overflow-x-auto" style={{ borderTop: `1px solid ${C.divider}` }}>
              <table className="w-full text-xs">
                <thead><tr>{Object.keys(rows[0]).map((h) => <th key={h} className="text-left px-4 py-2 font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.divider}` }}>
                      {Object.values(r).map((v, j) => <td key={j} className="px-4 py-2 whitespace-nowrap" style={{ color: C.text }}>{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && <p className="px-4 py-2 text-xs" style={{ color: C.muted, borderTop: `1px solid ${C.divider}` }}>And {plural(rows.length - 5, 'more row')}</p>}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" disabled={busy || !rows.length} onClick={importRows} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
          {busy ? 'Importing...' : rows.length ? `Import ${plural(rows.length, 'learner')}` : 'Import'}
        </button>
      </div>
    </Modal>
  );
}

export function AdmissionsTab({ cohort, admissions, loading, settings, reload, notify, C }: {
  cohort: any;
  admissions: any[];
  loading: boolean;
  settings: any;
  /** Reads admissions and the roster again after a change. */
  reload: () => Promise<void>;
  notify: (ok: boolean, text: string) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [admitting, setAdmitting] = useState(false);
  const [importing, setImporting] = useState(false);

  const paid = (row: any) => {
    const amount = Number(row.amount_paid_initial ?? 0);
    const total = Number(row.total_fee ?? 0);
    return { amount, total, pct: total ? (amount / total) * 100 : 0 };
  };
  const paidLine = (row: any) => {
    const p = paid(row);
    return (
      <div className="grid gap-2">
        <span className="text-sm whitespace-nowrap">
          <Money C={C}>{amountText(row.currency, p.amount)}</Money>
          <span className="text-xs" style={{ color: C.muted }}> of {p.total.toLocaleString()}, {planLabel(row.payment_plan).toLowerCase()}</span>
        </span>
        <Bar parts={[{ pct: p.pct, color: P.good }]} C={C} />
      </div>
    );
  };
  const name = (row: any) => row.student?.full_name || row.full_name || 'No name';
  const email = (row: any) => row.student?.email || row.email || '';
  const lastSignIn = (row: any) => row.student?.last_login_at ? shortDate(row.student.last_login_at) : 'Never';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: C.muted }}>Learners admitted to this cohort, with what they paid at admission.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImporting(true)} className={btnClass} style={btnStyle('sec', C)}><Upload className="w-4 h-4" />Import CSV</button>
          <button type="button" onClick={() => setAdmitting(true)} className={btnClass} style={btnStyle('pri', C)}><Plus className="w-4 h-4" />Admit student</button>
        </div>
      </div>
      <Card C={C} className="overflow-hidden">
        {loading && !admissions.length ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>Loading admissions...</p>
        ) : !admissions.length ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No admissions yet. Admit or import learners to create their accounts and send setup emails.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm table-fixed">
                <colgroup><col style={{ width: '30%' }} /><col style={{ width: '26%' }} /><col style={{ width: '18%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /></colgroup>
                <thead><tr>{['Learner', 'Paid at admission', 'Account', 'Last sign-in', 'Admitted'].map((h) => <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                <tbody>
                  {admissions.map((row) => {
                    const status = admissionStatus(row);
                    return (
                      <tr key={row.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                        <td className="px-4 py-3">
                          <p className="font-semibold truncate" style={{ color: C.text }}>{name(row)}</p>
                          <p className="text-xs truncate" style={{ color: C.muted }}>{email(row)}</p>
                        </td>
                        <td className="px-4 py-3">{paidLine(row)}</td>
                        <td className="px-4 py-3"><Pill tone={status.tone} dot C={C}>{status.label}</Pill></td>
                        <td className="px-4 py-3 text-xs" style={{ color: row.student?.last_login_at ? C.text : C.muted }}>{lastSignIn(row)}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: C.text }}>{shortDate(row.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {admissions.map((row, i) => {
                const status = admissionStatus(row);
                return (
                  <div key={row.id} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{name(row)}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>Admitted {shortDate(row.created_at)}</p>
                      </div>
                      <Pill tone={status.tone} dot C={C}>{status.label}</Pill>
                    </div>
                    {paidLine(row)}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
      {admitting && <AdmitStudentModal cohort={cohort} settings={settings} onAdmitted={async (who) => { await reload(); notify(true, `${who} admitted to ${cohort.name}`); }} onClose={() => setAdmitting(false)} C={C} />}
      {importing && <ImportModal cohort={cohort} admissions={admissions} onImported={async (ok, text) => { await reload(); notify(ok, text); }} onClose={() => setImporting(false)} C={C} />}
    </div>
  );
}
