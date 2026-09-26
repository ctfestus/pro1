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

  const filtered = useMemo(() => submissions.filter(item => {
    const matchesQuery = !query || `${item.email} ${item.reference}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!stageFilter || item.stageId === stageFilter);
  }), [submissions, query, stageFilter]);

  async function update(patch: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/application-submissions/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(patch),
      });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not update the application.');
      setSubmissions(previous => previous.map(item => item.id === value.submission.id ? value.submission : item));
      setNote('');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function pickPreset(type: keyof typeof MESSAGE_PRESETS) {
    setMessageType(type); setSubject(MESSAGE_PRESETS[type].subject); setBody(MESSAGE_PRESETS[type].body);
  }

  function stageName(item: any): string {
    return form.config.stages.find(stage => stage.id === item.stageId)?.name ?? item.stageId;
  }

  function stageForMessage(type: keyof typeof MESSAGE_PRESETS): string | undefined {
    const aliases: Record<keyof typeof MESSAGE_PRESETS, string[]> = {
      interview: ['interview'], acceptance: ['accepted', 'acceptance', 'admitted'],
      waitlist: ['waitlisted', 'waitlist'], decline: ['declined', 'decline', 'rejected'],
    };
    return form.config.stages.find(stage => aliases[type].some(alias =>
      [stage.id, stage.name, stage.applicantLabel].some(value => value.toLowerCase().includes(alias)),
    ))?.id;
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
      <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
        <div className="rounded-2xl p-4" style={{ background: C.card }}>
          <div className="space-y-2 mb-3"><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3" style={{ color: C.faint }} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search email or reference" style={{ ...input, paddingLeft: 34 }} /></div><select value={stageFilter} onChange={event => setStageFilter(event.target.value)} style={input}><option value="">All stages</option>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">{filtered.length === 0 ? <p className="text-sm text-center py-8" style={{ color: C.faint }}>No applications found.</p> : filtered.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} className="w-full text-left rounded-xl p-3" style={{ background: item.id === selectedId ? C.lime : C.input }}><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.email}</p><span className="text-[10px] rounded-full px-2 py-1" style={{ background: C.card, color: C.successText }}>{stageName(item)}</span></div><p className="text-xs mt-1" style={{ color: C.faint }}>{item.reference} - Status: {stageName(item)}</p></button>)}</div>
        </div>

        <div className="rounded-2xl p-5 sm:p-6 min-h-80" style={{ background: C.card }}>
          {!selected ? <div className="py-20 text-center text-sm" style={{ color: C.faint }}>Select an application to review.</div> : <div className="space-y-7">
            <div><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold" style={{ color: C.text }}>{selected.email}</h3><p className="text-xs mt-1" style={{ color: C.faint }}>{selected.reference} - submitted {selected.submittedAt ? new Date(selected.submittedAt).toLocaleString() : 'Not submitted'}</p></div><span className="text-xs px-3 py-1.5 rounded-full h-fit" style={{ background: C.successBg, color: C.successText }}>{form.config.stages.find(stage => stage.id === selected.stageId)?.name ?? selected.stageId}</span></div></div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Stage</label><select value={selected.stageId} onChange={event => void update({ stageId: event.target.value })} disabled={busy} style={input}>{form.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Reviewer</label><select value={selected.assignedReviewerId} onChange={event => { const reviewer = reviewers.find(item => item.id === event.target.value); void update({ assignedReviewerId: event.target.value, assignedReviewerEmail: reviewer?.email ?? '' }); }} disabled={busy || reviewers.length === 0} style={input}><option value="">Unassigned</option>{reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.full_name || reviewer.email}</option>)}</select></div>
              <div><label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Score (optional)</label><input type="number" min="0" max="100" value={selected.score ?? ''} onChange={event => setSubmissions(previous => previous.map(item => item.id === selected.id ? { ...item, score: event.target.value === '' ? null : Number(event.target.value) } : item))} onBlur={() => void update({ score: selected.score })} style={input} /></div>
            </div>

            <div><h4 className="text-sm font-bold mb-3" style={{ color: C.text }}>Answers</h4><div className="space-y-2">{form.config.questions.map(question => <div key={question.id} className="rounded-xl p-3" style={{ background: C.input }}><p className="text-xs font-semibold" style={{ color: C.faint }}>{question.label}</p><div className="text-sm mt-1 whitespace-pre-wrap break-words" style={{ color: C.text }}>{displayAnswer(selected.answers?.[question.id])}</div></div>)}</div></div>

            <div><h4 className="text-sm font-bold mb-2" style={{ color: C.text }}>Private notes</h4><p className="text-xs mb-3" style={{ color: C.faint }}>Only staff with review access can see these notes.</p><div className="space-y-2 mb-3">{selected.privateNotes?.map((item: any) => <div key={item.id} className="rounded-xl p-3" style={{ background: C.input }}><p className="text-sm whitespace-pre-wrap" style={{ color: C.text }}>{item.body}</p><p className="text-[10px] mt-2" style={{ color: C.faint }}>{item.authorEmail} - {new Date(item.createdAt).toLocaleString()}</p></div>)}</div><textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Add a private note" style={{ ...input, resize: 'vertical' }} /><button disabled={busy || !note.trim()} onClick={() => void update({ note })} className="mt-2 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" style={{ background: C.pill, color: C.text }}>Add note</button></div>

            <div><h4 className="text-sm font-bold mb-2" style={{ color: C.text }}>Send applicant message</h4><div className="flex flex-wrap gap-2 mb-3">{(Object.keys(MESSAGE_PRESETS) as (keyof typeof MESSAGE_PRESETS)[]).map(type => <button key={type} onClick={() => pickPreset(type)} className="px-3 py-1.5 rounded-full text-xs font-semibold capitalize" style={{ background: messageType === type ? C.cta : C.pill, color: messageType === type ? C.ctaText : C.muted }}>{type}</button>)}</div><div className="space-y-2"><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject" style={input} /><textarea rows={5} value={body} onChange={event => setBody(event.target.value)} placeholder="Message" style={{ ...input, resize: 'vertical' }} /><button disabled={busy || !subject.trim() || !body.trim()} onClick={() => void update({ stageId: stageForMessage(messageType), message: { type: messageType, subject, body } })} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send message</button></div>{selected.messages?.length > 0 && <p className="text-xs mt-3 flex items-center gap-1" style={{ color: C.faint }}><Mail className="w-3.5 h-3.5" /> {selected.messages.length} message{selected.messages.length === 1 ? '' : 's'} sent</p>}</div>
          </div>}
        </div>
      </div>
    </div>
  );
}
