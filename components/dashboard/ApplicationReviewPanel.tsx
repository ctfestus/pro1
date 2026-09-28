'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Send,
  SlidersHorizontal,
  StickyNote,
  UserRound,
  Users,
  X,
} from 'lucide-react';
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
type ReviewTab = 'answers' | 'review' | 'notes' | 'messages';

const REVIEW_TABS = [
  { id: 'answers' as const, label: 'Answers', icon: ClipboardList },
  { id: 'review' as const, label: 'Review', icon: SlidersHorizontal },
  { id: 'notes' as const, label: 'Notes', icon: StickyNote },
  { id: 'messages' as const, label: 'Messages', icon: MessageSquare },
];

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
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ReviewTab>('answers');
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
    setBulkPanelOpen(false);
    setActiveTab('answers');
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

  function openSubmission(id: string) {
    setSelectedId(id);
    setActiveTab('answers');
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
    setBulkPanelOpen(failures.length > 0);
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

  if (loading) return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: C.cta }} /></div>;
  const submittedCount = submissions.filter(item => item.state === 'submitted').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: C.card, color: C.muted }} aria-label="Back to forms"><ArrowLeft className="h-4 w-4" /></button>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.cta }}><Inbox className="h-5 w-5" /></div>
          <div className="min-w-0"><h2 className="truncate text-lg font-bold" style={{ color: C.text }}>{form.config.title}</h2><p className="mt-0.5 text-xs" style={{ color: C.faint }}>{submittedCount} submitted application{submittedCount === 1 ? '' : 's'}</p></div>
        </div>
        <button type="button" onClick={() => void exportCsv()} disabled={exporting} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: C.card, color: C.text }}>{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV</button>
      </div>

      {error && <div className="flex items-start justify-between gap-3 rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}
      {bulkResult && <div className="flex items-center gap-2 rounded-xl p-3 text-sm font-semibold" style={{ background: C.successBg, color: C.successText }}><CheckCircle2 className="h-4 w-4" /> {bulkResult}</div>}

      {selectedIds.size > 0 && (
        <div className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 shadow-lg" style={{ background: C.card }}>
          <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold" style={{ background: C.cta, color: C.ctaText }}>{selectedIds.size}</span><div><p className="text-xs font-bold" style={{ color: C.text }}>Applications selected</p><p className="text-[10px]" style={{ color: C.faint }}>Update their stage or notify them together.</p></div></div>
          <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={() => { setSelectedIds(new Set()); setBulkPanelOpen(false); }} className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ color: C.muted }}>Clear</button><button type="button" disabled={busy} onClick={() => setBulkPanelOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}><Users className="h-3.5 w-3.5" /> Bulk update</button></div>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-xl" style={{ background: C.card }}>
          <div className="p-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.faint }} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search applications" style={{ ...input, paddingLeft: 34 }} /></div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><select value={stageFilter} onChange={event => setStageFilter(event.target.value)} style={input}><option value="">All stages</option>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select><label className="grid min-w-10 cursor-pointer place-items-center rounded-lg" style={{ background: C.input }} title={allVisibleSelected ? 'Clear visible selection' : 'Select all visible applications'}><input type="checkbox" checked={allVisibleSelected} disabled={selectableFiltered.length === 0 || busy} onChange={toggleAllVisible} style={{ accentColor: C.cta }} /><span className="sr-only">Select all visible applications</span></label></div>
            <div className="mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}><span>{filtered.length} shown</span><span>{selectedIds.size ? `${selectedIds.size} selected` : 'Select for bulk actions'}</span></div>
          </div>
          <div className="max-h-[68vh] space-y-1.5 overflow-y-auto px-2 pb-2">
            {filtered.length === 0 ? <div className="py-14 text-center"><Search className="mx-auto h-5 w-5" style={{ color: C.faint }} /><p className="mt-2 text-xs" style={{ color: C.faint }}>No applications found.</p></div> : filtered.map(item => (
              <div key={item.id} className="flex items-stretch overflow-hidden rounded-lg" style={{ background: item.id === selectedId ? C.pill : 'transparent', boxShadow: item.id === selectedId ? `inset 3px 0 0 ${C.cta}` : 'none' }}>
                <label className="grid cursor-pointer place-items-center px-3" title={item.state === 'submitted' ? 'Select for bulk update' : 'Only submitted applications can be selected'}><input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.state !== 'submitted' || busy} onChange={() => toggleSelected(item.id)} style={{ accentColor: C.cta }} /></label>
                <button type="button" onClick={() => openSubmission(item.id)} className="flex min-w-0 flex-1 items-center gap-2 py-3 pr-2 text-left">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" style={{ color: C.text }}>{item.email}</p><div className="mt-1 flex items-center gap-2"><span className="truncate text-[10px]" style={{ color: C.faint }}>{item.reference}</span><span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: C.card, color: C.successText }}>{stageName(item)}</span></div></div>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.faint }} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <main id="application-review-details" className="min-h-[520px] overflow-hidden rounded-xl" style={{ background: C.card }}>
          {!selected ? (
            <div className="grid min-h-[520px] place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl" style={{ background: C.pill, color: C.cta }}><UserRound className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-bold" style={{ color: C.text }}>Choose an application</h3><p className="mx-auto mt-1 max-w-xs text-xs leading-5" style={{ color: C.faint }}>Select an applicant from the queue to review answers, record a decision, add notes, or send an update.</p></div></div>
          ) : (
            <>
              <header className="sticky top-0 z-10 px-5 pt-5 sm:px-6 sm:pt-6" style={{ background: C.card }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold" style={{ background: C.pill, color: C.cta }}>{String(selected.email || '?').slice(0, 1).toUpperCase()}</div><div className="min-w-0"><h3 className="truncate text-base font-bold" style={{ color: C.text }}>{selected.email}</h3><p className="mt-1 text-[11px]" style={{ color: C.faint }}>{selected.reference} | {selected.submittedAt ? `Submitted ${new Date(selected.submittedAt).toLocaleString()}` : 'Not submitted'}</p></div></div>
                  <span className="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: C.card, color: C.successText }}>{stageName(selected)}</span>
                </div>
                <nav className="mt-5 grid grid-cols-4 gap-1 rounded-lg p-1" style={{ background: C.input }} aria-label="Application review sections">{REVIEW_TABS.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-label={tab.label} aria-current={active ? 'page' : undefined} className="flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-[11px] font-semibold transition" style={{ background: active ? C.card : 'transparent', color: active ? C.text : C.faint, boxShadow: active ? '0 4px 14px rgba(0,0,0,0.06)' : 'none' }}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline">{tab.label}</span></button>; })}</nav>
              </header>

              <div className="p-5 sm:p-6">
                {activeTab === 'answers' && <div><div className="mb-4"><h4 className="text-sm font-bold" style={{ color: C.text }}>Application answers</h4><p className="mt-1 text-xs" style={{ color: C.faint }}>Review the information submitted by this applicant.</p></div><div className="space-y-2">{form.config.questions.filter(question => question.type !== 'text_block').map((question, index) => <div key={question.id} className="grid gap-2 rounded-lg p-4 sm:grid-cols-[28px_minmax(0,1fr)]" style={{ background: C.input }}><span className="grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold" style={{ background: C.card, color: C.cta }}>{index + 1}</span><div className="min-w-0"><p className="text-[11px] font-semibold" style={{ color: C.faint }}>{question.label}</p><div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6" style={{ color: C.text }}>{displayAnswer(selected.answers?.[question.id])}</div></div></div>)}</div></div>}

                {activeTab === 'review' && <div><div className="mb-4"><h4 className="text-sm font-bold" style={{ color: C.text }}>Review decision</h4><p className="mt-1 text-xs" style={{ color: C.faint }}>Assign ownership, record a score, and move the application forward.</p></div><div className="grid gap-3 sm:grid-cols-3"><div><label className="mb-1.5 block text-[11px] font-semibold" style={{ color: C.muted }}>Stage</label><select value={selected.stageId} onChange={event => void update({ stageId: event.target.value })} disabled={busy} style={input}>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><div><label className="mb-1.5 block text-[11px] font-semibold" style={{ color: C.muted }}>Reviewer</label><select value={selected.assignedReviewerId} onChange={event => { const reviewer = reviewers.find(item => item.id === event.target.value); void update({ assignedReviewerId: event.target.value, assignedReviewerEmail: reviewer?.email ?? '' }); }} disabled={busy || reviewers.length === 0} style={input}><option value="">Unassigned</option>{reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.full_name || reviewer.email}</option>)}</select></div><div><label className="mb-1.5 block text-[11px] font-semibold" style={{ color: C.muted }}>Score (optional)</label><input type="number" min="0" max="100" value={selected.score ?? ''} onChange={event => setSubmissions(previous => previous.map(item => item.id === selected.id ? { ...item, score: event.target.value === '' ? null : Number(event.target.value) } : item))} onBlur={() => void update({ score: selected.score })} disabled={busy} style={input} /></div></div><div className="mt-4 flex items-start gap-3 rounded-lg p-4" style={{ background: C.pill }}><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C.cta }} /><div><p className="text-xs font-semibold" style={{ color: C.text }}>Current applicant-facing status</p><p className="mt-1 text-xs" style={{ color: C.faint }}>{form.config.stages.find(stage => stage.id === selected.stageId)?.applicantLabel ?? stageName(selected)}</p></div></div></div>}

                {activeTab === 'notes' && <div><div className="mb-4"><h4 className="text-sm font-bold" style={{ color: C.text }}>Private notes</h4><p className="mt-1 text-xs" style={{ color: C.faint }}>Only staff with review access can see these notes.</p></div><div className="mb-4 space-y-2">{(selected.privateNotes ?? []).length === 0 ? <div className="rounded-lg p-5 text-center text-xs" style={{ background: C.input, color: C.faint }}>No private notes yet.</div> : selected.privateNotes.map((item: any) => <div key={item.id} className="rounded-lg p-4" style={{ background: C.input }}><p className="whitespace-pre-wrap text-sm leading-6" style={{ color: C.text }}>{item.body}</p><p className="mt-2 text-[10px]" style={{ color: C.faint }}>{item.authorEmail} | {new Date(item.createdAt).toLocaleString()}</p></div>)}</div><textarea rows={4} value={note} onChange={event => setNote(event.target.value)} placeholder="Write a private note about this application" style={{ ...input, resize: 'vertical' }} /><div className="mt-2 flex justify-end"><button type="button" disabled={busy || !note.trim()} onClick={() => void update({ note })} className="rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Saving...' : 'Add note'}</button></div></div>}

                {activeTab === 'messages' && <div><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-bold" style={{ color: C.text }}>Applicant message</h4><p className="mt-1 text-xs" style={{ color: C.faint }}>The email includes a secure link to the latest application status.</p></div>{selected.messages?.length > 0 && <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: C.faint }}><Mail className="h-3.5 w-3.5" /> {selected.messages.length} sent</span>}</div><div className="mb-3 flex flex-wrap gap-2">{(Object.keys(MESSAGE_PRESETS) as MessagePresetType[]).map(type => <button key={type} type="button" onClick={() => pickPreset(type)} className="rounded-full px-3 py-1.5 text-xs font-semibold capitalize" style={{ background: messageType === type ? C.cta : C.pill, color: messageType === type ? C.ctaText : C.muted }}>{type}</button>)}</div><div className="space-y-2"><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Email subject" style={input} /><textarea rows={6} value={body} onChange={event => setBody(event.target.value)} placeholder="Write the applicant message" style={{ ...input, resize: 'vertical' }} /><div className="flex justify-end"><button type="button" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void update({ stageId: stageForMessage(messageType), message: { type: messageType, subject, body } })} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send email</button></div></div>{selected.messages?.length > 0 && <div className="mt-6"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>Message history</p><div className="space-y-2">{[...selected.messages].reverse().map((item: any) => <div key={item.id} className="rounded-lg p-3" style={{ background: C.input }}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold" style={{ color: C.text }}>{item.subject}</p><span className="text-[9px] uppercase" style={{ color: C.faint }}>{item.type}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-5" style={{ color: C.muted }}>{item.body}</p><p className="mt-1 text-[9px]" style={{ color: C.faint }}>{new Date(item.sentAt).toLocaleString()}</p></div>)}</div></div>}</div>}
              </div>
            </>
          )}
        </main>
      </div>

      {bulkPanelOpen && selectedIds.size > 0 && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setBulkPanelOpen(false); }}>
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl shadow-2xl" style={{ background: C.card }} role="dialog" aria-modal="true" aria-labelledby="bulk-update-title">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 p-5" style={{ background: C.card }}><div><h3 id="bulk-update-title" className="text-base font-bold" style={{ color: C.text }}>Update {selectedIds.size} application{selectedIds.size === 1 ? '' : 's'}</h3><p className="mt-1 text-xs" style={{ color: C.faint }}>Choose a stage and decide whether applicants should be notified.</p></div><button type="button" disabled={busy} onClick={() => setBulkPanelOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40" style={{ background: C.input, color: C.muted }} aria-label="Close bulk update"><X className="h-4 w-4" /></button></div>
            <div className="space-y-4 px-5 pb-5">
              <div><label className="mb-1.5 block text-[11px] font-semibold" style={{ color: C.muted }}>Move selected applications to</label><select value={bulkStageId} onChange={event => setBulkStageId(event.target.value)} disabled={busy} style={input}>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg p-4" style={{ background: C.input, color: C.text }}><input type="checkbox" checked={bulkSendEmail} onChange={event => setBulkSendEmail(event.target.checked)} disabled={busy} style={{ accentColor: C.cta }} /><span><span className="block text-sm font-semibold">Email every selected applicant</span><span className="mt-0.5 block text-[11px]" style={{ color: C.faint }}>Each recipient gets an individual secure status link.</span></span></label>
              {bulkSendEmail && <div className="rounded-lg p-4" style={{ background: C.input }}><div className="mb-3 flex flex-wrap gap-2">{(Object.keys(MESSAGE_PRESETS) as MessagePresetType[]).map(type => <button key={type} type="button" disabled={busy} onClick={() => pickBulkPreset(type)} className="rounded-full px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-50" style={{ background: bulkMessageType === type ? C.cta : C.card, color: bulkMessageType === type ? C.ctaText : C.muted }}>{type}</button>)}</div><div className="space-y-2"><input value={bulkSubject} onChange={event => { setBulkMessageType('custom'); setBulkSubject(event.target.value); }} disabled={busy} placeholder="Email subject" style={{ ...input, background: C.card }} /><textarea rows={5} value={bulkBody} onChange={event => { setBulkMessageType('custom'); setBulkBody(event.target.value); }} disabled={busy} placeholder="Choose a template or write the email message" style={{ ...input, background: C.card, resize: 'vertical' }} /></div></div>}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1"><p className="text-[10px] leading-5" style={{ color: C.faint }}>{bulkSendEmail ? 'Every successful email and status change is recorded.' : 'This changes the status without emailing applicants.'}</p><div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={() => setBulkPanelOpen(false)} className="rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50" style={{ color: C.muted }}>Cancel</button><button type="button" disabled={busy || !bulkStageId || (bulkSendEmail && (!bulkSubject.trim() || !bulkBody.trim()))} onClick={() => void applyBulkUpdate()} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : bulkSendEmail ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{bulkProgress ? `Updating ${bulkProgress.current} of ${bulkProgress.total}` : bulkSendEmail ? 'Update and email' : 'Update status'}</button></div></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
