'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Loader2, Mail, Search, Send } from 'lucide-react';
import type { ApplicationFormRecord } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

const MESSAGE_PRESETS = {
  interview: { subject: 'Interview invitation', body: 'We would like to invite you to an interview. Please reply to this email to confirm your availability.' },
  acceptance: { subject: 'Application accepted', body: 'Congratulations. We are pleased to let you know that your application has been accepted.' },
  waitlist: { subject: 'Application waitlist update', body: 'Your application remains under consideration and has been placed on our waitlist.' },
  decline: { subject: 'Application decision', body: 'Thank you for your interest. We are unable to offer you a place at this time.' },
} as const;

type MessagePresetType = keyof typeof MESSAGE_PRESETS;
type ApplicationMessageType = MessagePresetType | 'custom';

function displayAnswer(value: any): React.ReactNode {
  if (value === null || value === undefined || value === '') return 'Not answered';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object' && value.url) return <a href={value.url} target="_blank" rel="noopener noreferrer" className="underline">{value.name || 'View file'}</a>;
  return String(value);
}

export function ApplicationReviewPanel({ form, token, reviewers, C, onBack }: {
  form: ApplicationFormRecord;
  token: string;
  reviewers: { id: string; email: string; full_name?: string; role: string }[];
  C: ThemeColors;
  onBack: () => void;
}) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [note, setNote] = useState('');
  const [messageType, setMessageType] = useState<keyof typeof MESSAGE_PRESETS>('interview');
  const [subject, setSubject] = useState<string>(MESSAGE_PRESETS.interview.subject);
  const [body, setBody] = useState<string>(MESSAGE_PRESETS.interview.body);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStageId, setBulkStageId] = useState(form.config.stages[0]?.id ?? '');
  const [bulkSendEmail, setBulkSendEmail] = useState(false);
  const [bulkMessageType, setBulkMessageType] = useState<ApplicationMessageType>('custom');
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState('');
  const selected = submissions.find(item => item.id === selectedId);
  const input = { width: '100%', background: C.input, color: C.text, border: `1px solid ${C.inputBorder}`, borderRadius: 10, padding: '10px 11px', outline: 'none' };

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/application-forms/${form.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not load applications.');
      setSubmissions(value.submissions ?? []);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [form.id]);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkStageId(form.config.stages[0]?.id ?? '');
    setBulkResult('');
  }, [form.id, form.config.stages]);

  const filtered = useMemo(() => submissions.filter(item => {
    const matchesQuery = !query || `${item.email} ${item.reference}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!stageFilter || item.stageId === stageFilter);
  }), [submissions, query, stageFilter]);

  const selectableFiltered = useMemo(() => filtered.filter(item => item.state === 'submitted'), [filtered]);
  const allVisibleSelected = selectableFiltered.length > 0 && selectableFiltered.every(item => selectedIds.has(item.id));

  async function patchSubmission(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/application-submissions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(patch),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not update the application.');
    return value.submission;
  }

  async function update(patch: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const updated = await patchSubmission(selected.id, patch);
      setSubmissions(previous => previous.map(item => item.id === updated.id ? updated : item));
      setNote('');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function pickPreset(type: MessagePresetType) {
    setMessageType(type); setSubject(MESSAGE_PRESETS[type].subject); setBody(MESSAGE_PRESETS[type].body);
  }

  function stageName(item: any): string {
    return form.config.stages.find(stage => stage.id === item.stageId)?.name ?? item.stageId;
  }

  function stageForMessage(type: MessagePresetType): string | undefined {
    const aliases: Record<MessagePresetType, string[]> = {
      interview: ['interview'], acceptance: ['accepted', 'acceptance', 'admitted'],
      waitlist: ['waitlisted', 'waitlist'], decline: ['declined', 'decline', 'rejected'],
    };
    return form.config.stages.find(stage => aliases[type].some(alias =>
      [stage.id, stage.name, stage.applicantLabel].some(value => value.toLowerCase().includes(alias)),
    ))?.id;
  }

  function toggleSelected(id: string) {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setBulkResult('');
  }

  function toggleAllVisible() {
    setSelectedIds(previous => {
      const next = new Set(previous);
      for (const item of selectableFiltered) {
        if (allVisibleSelected) next.delete(item.id); else next.add(item.id);
      }
      return next;
    });
    setBulkResult('');
  }

  function pickBulkPreset(type: MessagePresetType) {
    setBulkMessageType(type);
    setBulkSubject(MESSAGE_PRESETS[type].subject);
    setBulkBody(MESSAGE_PRESETS[type].body);
    const matchingStage = stageForMessage(type);
    if (matchingStage) setBulkStageId(matchingStage);
  }

  async function applyBulkUpdate() {
    const targets = submissions.filter(item => selectedIds.has(item.id) && item.state === 'submitted');
    if (!targets.length) return;
    if (!bulkStageId) { setError('Select a stage for the bulk update.'); return; }
    if (bulkSendEmail && (!bulkSubject.trim() || !bulkBody.trim())) {
      setError('Add an email subject and message before sending.');
      return;
    }
    const stage = form.config.stages.find(item => item.id === bulkStageId);
    const confirmation = bulkSendEmail
      ? `Move ${targets.length} application${targets.length === 1 ? '' : 's'} to ${stage?.name ?? 'the selected stage'} and email each applicant?`
      : `Move ${targets.length} application${targets.length === 1 ? '' : 's'} to ${stage?.name ?? 'the selected stage'}?`;
    if (!window.confirm(confirmation)) return;

    setBusy(true); setError(''); setBulkResult('');
    setBulkProgress({ current: 0, total: targets.length });
    const updatedById = new Map<string, any>();
    const failures: Array<{ id: string; email: string; message: string }> = [];
    for (let index = 0; index < targets.length; index += 1) {
      const item = targets[index];
      setBulkProgress({ current: index + 1, total: targets.length });
      try {
        const updated = await patchSubmission(item.id, {
          stageId: bulkStageId,
          ...(bulkSendEmail ? { message: { type: bulkMessageType, subject: bulkSubject.trim(), body: bulkBody.trim() } } : {}),
        });
        updatedById.set(updated.id, updated);
      } catch (reason) {
        failures.push({ id: item.id, email: item.email, message: (reason as Error).message });
      }
    }
    setSubmissions(previous => previous.map(item => updatedById.get(item.id) ?? item));
    setSelectedIds(new Set(failures.map(item => item.id)));
    const completed = targets.length - failures.length;
    setBulkResult(`${completed} application${completed === 1 ? '' : 's'} updated${bulkSendEmail ? ' and emailed' : ''}.${failures.length ? ` ${failures.length} failed and remain selected.` : ''}`);
    if (failures.length) setError(`Could not update ${failures.map(item => item.email).slice(0, 3).join(', ')}${failures.length > 3 ? ' and others' : ''}. ${failures[0].message}`);
    setBulkProgress(null); setBusy(false);
  }

  async function exportCsv() {
    setExporting(true); setError('');
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (query.trim()) params.set('q', query.trim());
      if (stageFilter) params.set('stage', stageFilter);
      const response = await fetch(`/api/application-forms/${form.id}/submissions?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error || 'Could not export applications.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `${form.slug}-applications.csv`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (reason) { setError((reason as Error).message); }
    finally { setExporting(false); }
  }

  if (loading) return <div className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: C.cta }} /></div>;
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm font-semibold flex items-center gap-1" style={{ color: C.muted }}><ArrowLeft className="w-4 h-4" /> Back to forms</button>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold" style={{ color: C.text }}>{form.config.title}</h2><p className="text-sm mt-1" style={{ color: C.faint }}>{submissions.filter(item => item.state === 'submitted').length} submitted applications</p></div><button onClick={() => void exportCsv()} disabled={exporting} className="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: C.pill, color: C.text }}>{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export CSV</button></div>
      {error && <div className="rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}
      {bulkResult && <div className="rounded-xl p-3 text-sm font-semibold" style={{ background: C.successBg, color: C.successText }}>{bulkResult}</div>}
      {selectedIds.size > 0 && (
        <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-sm font-bold" style={{ color: C.text }}>Bulk update</h3><p className="mt-1 text-xs" style={{ color: C.faint }}>{selectedIds.size} submitted application{selectedIds.size === 1 ? '' : 's'} selected</p></div>
            <button type="button" disabled={busy} onClick={() => setSelectedIds(new Set())} className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: C.pill, color: C.muted }}>Clear selection</button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(190px,0.7fr)_minmax(240px,1fr)]">
            <div>
              <label className="mb-1 block text-xs font-semibold" style={{ color: C.muted }}>Move selected applications to</label>
              <select value={bulkStageId} onChange={event => setBulkStageId(event.target.value)} disabled={busy} style={input}>
                {form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3" style={{ background: C.input, color: C.text }}>
              <input type="checkbox" checked={bulkSendEmail} onChange={event => setBulkSendEmail(event.target.checked)} disabled={busy} style={{ accentColor: C.cta }} />
              <span><span className="block text-sm font-semibold">Email every selected applicant</span><span className="mt-0.5 block text-[11px]" style={{ color: C.faint }}>Each email receives its own secure application-status link.</span></span>
            </label>
          </div>
          {bulkSendEmail && (
            <div className="mt-4 rounded-xl p-4" style={{ background: C.input }}>
              <div className="mb-3 flex flex-wrap gap-2">
                {(Object.keys(MESSAGE_PRESETS) as MessagePresetType[]).map(type => <button key={type} type="button" disabled={busy} onClick={() => pickBulkPreset(type)} className="rounded-full px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-50" style={{ background: bulkMessageType === type ? C.cta : C.card, color: bulkMessageType === type ? C.ctaText : C.muted }}>{type}</button>)}
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(200px,0.7fr)_minmax(280px,1.3fr)]">
                <input value={bulkSubject} onChange={event => { setBulkMessageType('custom'); setBulkSubject(event.target.value); }} disabled={busy} placeholder="Email subject" style={{ ...input, background: C.card }} />
                <textarea rows={3} value={bulkBody} onChange={event => { setBulkMessageType('custom'); setBulkBody(event.target.value); }} disabled={busy} placeholder="Choose a template or write the email message" style={{ ...input, background: C.card, resize: 'vertical' }} />
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px]" style={{ color: C.faint }}>{bulkSendEmail ? 'Status and email delivery are recorded for every application.' : 'Applicants will not be emailed for this update.'}</p>
            <button type="button" disabled={busy || !bulkStageId || (bulkSendEmail && (!bulkSubject.trim() || !bulkBody.trim()))} onClick={() => void applyBulkUpdate()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : bulkSendEmail ? <Send className="h-4 w-4" /> : null}{bulkProgress ? `Updating ${bulkProgress.current} of ${bulkProgress.total}` : `${bulkSendEmail ? 'Update and email' : 'Update'} ${selectedIds.size}`}</button>
          </div>
        </section>
      )}
      <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
        <div className="rounded-2xl p-4" style={{ background: C.card }}>
          <div className="space-y-2 mb-3"><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3" style={{ color: C.faint }} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search email or reference" style={{ ...input, paddingLeft: 34 }} /></div><select value={stageFilter} onChange={event => setStageFilter(event.target.value)} style={input}><option value="">All stages</option>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
          <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold" style={{ background: C.input, color: C.muted }}><input type="checkbox" checked={allVisibleSelected} disabled={selectableFiltered.length === 0 || busy} onChange={toggleAllVisible} style={{ accentColor: C.cta }} /><span>{allVisibleSelected ? 'Clear visible selection' : `Select all visible (${selectableFiltered.length})`}</span></label>
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">{filtered.length === 0 ? <p className="text-sm text-center py-8" style={{ color: C.faint }}>No applications found.</p> : filtered.map(item => <div key={item.id} className="flex items-stretch overflow-hidden rounded-xl" style={{ background: item.id === selectedId ? C.lime : C.input }}><label className="grid cursor-pointer place-items-center px-3" title={item.state === 'submitted' ? 'Select for bulk update' : 'Only submitted applications can be selected'}><input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.state !== 'submitted' || busy} onChange={() => toggleSelected(item.id)} style={{ accentColor: C.cta }} /></label><button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 p-3 pl-0 text-left"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold" style={{ color: C.text }}>{item.email}</p><span className="rounded-full px-2 py-1 text-[10px]" style={{ background: C.card, color: C.successText }}>{stageName(item)}</span></div><p className="mt-1 text-xs" style={{ color: C.faint }}>{item.reference} - Status: {stageName(item)}</p></button></div>)}</div>
        </div>

        <div className="rounded-2xl p-5 sm:p-6 min-h-80" style={{ background: C.card }}>
          {!selected ? <div className="py-20 text-center text-sm" style={{ color: C.faint }}>Select an application to review.</div> : <div className="space-y-7">
            <div><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold" style={{ color: C.text }}>{selected.email}</h3><p className="text-xs mt-1" style={{ color: C.faint }}>{selected.reference} - submitted {selected.submittedAt ? new Date(selected.submittedAt).toLocaleString() : 'Not submitted'}</p></div><span className="text-xs px-3 py-1.5 rounded-full h-fit" style={{ background: C.successBg, color: C.successText }}>{form.config.stages.find(stage => stage.id === selected.stageId)?.name ?? selected.stageId}</span></div></div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Stage</label><select value={selected.stageId} onChange={event => void update({ stageId: event.target.value })} disabled={busy} style={input}>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Reviewer</label><select value={selected.assignedReviewerId} onChange={event => { const reviewer = reviewers.find(item => item.id === event.target.value); void update({ assignedReviewerId: event.target.value, assignedReviewerEmail: reviewer?.email ?? '' }); }} disabled={busy || reviewers.length === 0} style={input}><option value="">Unassigned</option>{reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.full_name || reviewer.email}</option>)}</select></div>
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Score (optional)</label><input type="number" min="0" max="100" value={selected.score ?? ''} onChange={event => setSubmissions(previous => previous.map(item => item.id === selected.id ? { ...item, score: event.target.value === '' ? null : Number(event.target.value) } : item))} onBlur={() => void update({ score: selected.score })} style={input} /></div>
            </div>

            <div><h4 className="text-sm font-bold mb-3" style={{ color: C.text }}>Answers</h4><div className="space-y-2">{form.config.questions.filter(question => question.type !== 'text_block').map(question => <div key={question.id} className="rounded-xl p-3" style={{ background: C.input }}><p className="text-xs font-semibold" style={{ color: C.faint }}>{question.label}</p><div className="text-sm mt-1 whitespace-pre-wrap break-words" style={{ color: C.text }}>{displayAnswer(selected.answers?.[question.id])}</div></div>)}</div></div>

            <div><h4 className="text-sm font-bold mb-2" style={{ color: C.text }}>Private notes</h4><p className="text-xs mb-3" style={{ color: C.faint }}>Only staff with review access can see these notes.</p><div className="space-y-2 mb-3">{selected.privateNotes?.map((item: any) => <div key={item.id} className="rounded-xl p-3" style={{ background: C.input }}><p className="text-sm whitespace-pre-wrap" style={{ color: C.text }}>{item.body}</p><p className="text-[10px] mt-2" style={{ color: C.faint }}>{item.authorEmail} - {new Date(item.createdAt).toLocaleString()}</p></div>)}</div><textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Add a private note" style={{ ...input, resize: 'vertical' }} /><button disabled={busy || !note.trim()} onClick={() => void update({ note })} className="mt-2 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" style={{ background: C.pill, color: C.text }}>Add note</button></div>

            <div><h4 className="text-sm font-bold mb-2" style={{ color: C.text }}>Send applicant message</h4><div className="flex flex-wrap gap-2 mb-3">{(Object.keys(MESSAGE_PRESETS) as (keyof typeof MESSAGE_PRESETS)[]).map(type => <button key={type} onClick={() => pickPreset(type)} className="px-3 py-1.5 rounded-full text-xs font-semibold capitalize" style={{ background: messageType === type ? C.cta : C.pill, color: messageType === type ? C.ctaText : C.muted }}>{type}</button>)}</div><div className="space-y-2"><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject" style={input} /><textarea rows={5} value={body} onChange={event => setBody(event.target.value)} placeholder="Message" style={{ ...input, resize: 'vertical' }} /><button disabled={busy || !subject.trim() || !body.trim()} onClick={() => void update({ stageId: stageForMessage(messageType), message: { type: messageType, subject, body } })} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send message</button></div>{selected.messages?.length > 0 && <p className="text-xs mt-3 flex items-center gap-1" style={{ color: C.faint }}><Mail className="w-3.5 h-3.5" /> {selected.messages.length} message{selected.messages.length === 1 ? '' : 's'} sent</p>}</div>
          </div>}
        </div>
      </div>
    </div>
  );
}
