'use client';

// Issue credentials (typed in, or from a CSV) and Edit credential.

import { useRef, useState } from 'react';
import { Award, Loader2, Plus, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { DateField } from '@/components/DatePicker';
import { MenuSelect } from '@/components/MenuSelect';
import { FIELD, Label, SwitchRow, inputStyle } from '@/components/create/EditorKit';
import { BUTTON } from '@/components/dashboard/subscriptions/Modal';
import { IconChip, btnSmClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { Footer, ISSUE_MODES, Notice, type OpenCert, type Program } from './shared';

type ManualRow = { name: string; email: string; date: string };

function parseCsv(text: string): ManualRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('name') || first.includes('email') || first.includes('date');
  return (hasHeader ? lines.slice(1) : lines).map(line => {
    const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    return { name: parts[0] ?? '', email: parts[1] ?? '', date: parts[2] ?? '' };
  }).filter(r => r.name);
}

export function IssuePanel({ programs, initialProgram, onDone, onCancel, C }: {
  programs: Program[]; initialProgram: Program | null;
  onDone: (certs: OpenCert[]) => void; onCancel: () => void; C: ThemeColors;
}) {
  const P = palette(C);
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgram?.id ?? '');
  const [tab, setTab]               = useState<'manual' | 'csv'>('manual');
  const [manualRows, setManualRows] = useState<ManualRow[]>([{ name: '', email: '', date: '' }]);
  const [csvRows, setCsvRows]       = useState<ManualRow[]>([]);
  const [sendEmail, setSendEmail]   = useState(false);
  const [issuing, setIssuing]       = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const program    = programs.find(p => p.id === selectedProgramId) ?? null;
  const recipients = (tab === 'manual' ? manualRows : csvRows).filter(r => r.name.trim());
  const setRow = (i: number, patch: Partial<ManualRow>) => setManualRows(p => p.map((r, j) => j === i ? { ...r, ...patch } : r));

  const handleCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setCsvRows(parseCsv(e.target?.result as string));
    reader.readAsText(file);
  };

  const issue = async () => {
    setError(''); setSuccess('');
    if (!program)             { setError('Select a programme first.'); return; }
    if (!recipients.length)   { setError('Add at least one recipient.'); return; }
    setIssuing(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const today = new Date().toISOString().split('T')[0];
      const res   = await fetch('/api/open-certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          program_id:   program.id,
          program_name: program.name,
          send_email:   sendEmail,
          recipients:   recipients.map(r => ({ name: r.name.trim(), email: r.email.trim() || undefined, issued_date: r.date || today })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to issue credentials.'); return; }
      setSuccess(`${plural(data.count, 'credential')} issued.`);
      setTimeout(() => onDone(data.data ?? []), 1400);
    } finally { setIssuing(false); }
  };

  const blocked = issuing || !program || recipients.length === 0;

  return (
    <div className="grid gap-5">
      {!initialProgram ? (
        <div>
          <Label C={C}>Programme</Label>
          <MenuSelect field searchable label="Programme" placeholder="Choose a programme" value={selectedProgramId} onChange={setSelectedProgramId}
            options={programs.map(p => ({ value: p.id, label: p.name }))} C={C} />
        </div>
      ) : (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: C.page }}>
          {initialProgram.badge_image_url
            ? <img src={initialProgram.badge_image_url} alt="" className="w-9 h-9 object-contain rounded-lg" />
            : <IconChip color={C.muted} background={C.card}><Award className="w-4 h-4" /></IconChip>}
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: C.text }}>{initialProgram.name}</p>
            <p className="text-xs" style={{ color: C.muted }}>{ISSUE_MODES.find(m => m.value === initialProgram.issue_mode)?.label}</p>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="How to add recipients" className="inline-flex w-fit max-w-full gap-1 p-1 rounded-[14px]" style={{ background: C.page }}>
        {(['manual', 'csv'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className="h-9 px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
            style={tab === t ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
            {t === 'manual' ? 'Type them in' : 'Upload a CSV'}
          </button>
        ))}
      </div>

      {tab === 'manual' && (
        <div className="grid gap-3">
          <div className="hidden sm:grid grid-cols-[1fr_1fr_150px_32px] gap-2 text-xs font-semibold" style={{ color: C.muted }}>
            <span>Name</span><span>Email</span><span>Date</span><span />
          </div>
          <div className="grid gap-3 sm:gap-2 max-h-[280px] overflow-y-auto">
            {manualRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_32px] sm:grid-cols-[1fr_1fr_150px_32px] gap-2 items-center">
                <input aria-label={`Row ${i + 1} name`} placeholder="Full name" value={row.name} onChange={e => setRow(i, { name: e.target.value })} className={FIELD} style={inputStyle(C)} />
                <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => setManualRows(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                  className="w-8 h-8 rounded-[10px] grid place-items-center sm:order-last" style={{ background: C.pill, color: C.muted }}>
                  <X className="w-4 h-4" />
                </button>
                <input aria-label={`Row ${i + 1} email`} placeholder="Email (optional)" value={row.email} onChange={e => setRow(i, { email: e.target.value })} className={`${FIELD} col-span-2 sm:col-span-1`} style={inputStyle(C)} />
                <div className="col-span-2 sm:col-span-1">
                  <DateField compact label={`Row ${i + 1} date`} value={row.date} onChange={date => setRow(i, { date })} C={C} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setManualRows(p => [...p, { name: '', email: '', date: '' }])} className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>
            <Plus className="w-3.5 h-3.5" /> Add recipient
          </button>
        </div>
      )}

      {tab === 'csv' && (
        <div className="grid gap-3">
          <button type="button"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsv(f); }}
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-xl px-5 py-6 text-center grid justify-items-center gap-1"
            style={{ background: C.page, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
            <Upload className="w-6 h-6" style={{ color: C.faint }} />
            <span className="text-sm font-semibold" style={{ color: C.text }}>Drop a CSV or click to browse</span>
            <span className="text-xs" style={{ color: C.muted }}>Columns: name, email (optional), date (optional)</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); }} />
          {csvRows.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
              <p className="px-4 py-2.5 text-xs font-semibold" style={{ color: C.muted, borderBottom: `1px solid ${C.divider}` }}>{plural(csvRows.length, 'recipient')} found</p>
              <div className="max-h-[200px] overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {csvRows.map((r, i) => (
                      <tr key={i} style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <td className="px-4 py-2 font-semibold" style={{ color: C.text }}>{r.name}</td>
                        <td className="px-4 py-2" style={{ color: C.muted }}>{r.email || '-'}</td>
                        <td className="px-4 py-2" style={{ color: C.muted }}>{r.date || 'today'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <SwitchRow C={C} title="Email recipients" sub="Send each recipient the link to their credential" on={sendEmail} onChange={setSendEmail} />

      {error && <Notice C={C}>{error}</Notice>}
      {success && <Notice ok C={C}>{success}</Notice>}

      <Footer onCancel={onCancel} C={C}>
        <button type="button" onClick={issue} disabled={blocked} className={BUTTON} style={btnStyle('pri', C)}>
          {issuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
          Issue {recipients.length > 0 ? plural(recipients.length, 'credential') : 'credentials'}
        </button>
      </Footer>
    </div>
  );
}

export function EditCertForm({ cert, C, hdrs, onCancel, onSave }: {
  cert: OpenCert; C: ThemeColors; hdrs: HeadersInit;
  onCancel: () => void; onSave: (updated: OpenCert) => void;
}) {
  const [name, setName]     = useState(cert.recipient_name);
  const [email, setEmail]   = useState(cert.recipient_email ?? '');
  const [date, setDate]     = useState(cert.issued_date);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/open-certificates/${cert.id}`, {
        method: 'PATCH', headers: hdrs,
        body: JSON.stringify({ recipient_name: name.trim(), recipient_email: email.trim() || null, issued_date: date || cert.issued_date }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to update.'); return; }
      onSave({ ...cert, recipient_name: name.trim(), recipient_email: email.trim() || null, issued_date: date || cert.issued_date });
    } finally { setSaving(false); }
  };

  return (
    <div className="grid gap-5">
      <div>
        <Label C={C}>Recipient name</Label>
        <input value={name} onChange={e => setName(e.target.value)} className={FIELD} style={inputStyle(C)} />
      </div>
      <div>
        <Label C={C}>Email</Label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Optional" className={FIELD} style={inputStyle(C)} />
      </div>
      <div>
        <Label C={C}>Issue date</Label>
        <DateField label="Issue date" value={date} onChange={setDate} C={C} />
      </div>
      {error && <Notice C={C}>{error}</Notice>}
      <Footer onCancel={onCancel} C={C}>
        <button type="button" onClick={save} disabled={saving} className={BUTTON} style={btnStyle('pri', C)}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save changes
        </button>
      </Footer>
    </div>
  );
}
