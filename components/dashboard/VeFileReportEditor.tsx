'use client';

// Instructor report on one uploaded file in the VE Review panel. The instructor drafts it with AI
// (or starts blank), edits every field, and can preview exactly what the student will see. Nothing
// is saved here: the parent sends all reports with the review on Submit Review.

import { useState } from 'react';
import { Eye, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import InstructorFileReportView from '@/components/InstructorFileReportView';
import {
  emptyInstructorReport, INSTRUCTOR_SEVERITY_LABELS, REPORT_COUNTS, REPORT_LIMITS, isReportStale, normalizeInstructorReport,
  type InstructorFileReport, type InstructorFindingSeverity, type InstructorReportDraft,
} from '@/lib/ve-instructor-report';

// One entry per line; blank lines are kept while typing and dropped on save and in the preview.
const toLines = (list: string[]) => list.join('\n');
// Capped at the server's per-list limit, so a line past it cannot be typed and then silently dropped.
const fromLines = (text: string) => text.split('\n').slice(0, REPORT_COUNTS.listItems);

export default function VeFileReportEditor({ attemptId, reqId, fileUrl, title, report, onChange, onDraftingChange, onFileReplaced, isDark }: {
  attemptId: string;
  // The uploaded file the panel is showing. Drafts and new reports are tied to it.
  fileUrl: string;
  reqId: string;
  title: string;
  report: InstructorReportDraft | null;
  onChange: (report: InstructorReportDraft | null) => void;
  // Lets the panel hold Submit Review while a draft is in flight.
  onDraftingChange: (drafting: boolean) => void;
  // The server refused because the student uploaded a newer file; the panel reloads it.
  onFileReplaced: () => void;
  isDark: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  // What the last AI draft could and could not read (for example skipped worksheets). Not saved.
  const [notices, setNotices] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);

  const textPrim = isDark ? 'text-white' : 'text-[#111]';
  const textMut  = isDark ? 'text-zinc-400' : 'text-[#666]';
  const field    = `w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDark ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-[rgba(0,0,0,0.1)] text-[#111]'}`;
  const label    = `block text-[11px] font-semibold mb-1 ${textMut}`;
  const subtle   = `inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 ${isDark ? 'bg-zinc-700 text-zinc-200' : 'bg-white text-[#333] border border-[rgba(0,0,0,0.1)]'}`;
  const panel    = `rounded-lg p-3 space-y-2 ${isDark ? 'bg-zinc-900/60' : 'bg-white'}`;

  const draft = async () => {
    if (report && !window.confirm('Replace the current report with a new AI draft?')) return;
    setDrafting(true);
    onDraftingChange(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ve-instructor-review/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ attemptId, reqId, fileUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) onFileReplaced();
      if (!res.ok || !json.report) { setError(json.error || 'Could not draft the report. Please try again.'); return; }
      onChange(json.report);
      setNotices(Array.isArray(json.notices) ? json.notices : []);
      setPreview(false);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setDrafting(false);
      onDraftingChange(false);
    }
  };

  if (!report) {
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={draft} disabled={drafting}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-60"
            style={{ background: '#00b95c' }}>
            {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {drafting ? 'Drafting report' : 'Draft report with AI'}
          </button>
          <button onClick={() => onChange({ ...emptyInstructorReport(), fileUrl })} disabled={drafting} className={subtle}>
            <Pencil className="w-3.5 h-3.5" /> Write report
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  const set = (patch: Partial<InstructorReportDraft>) => onChange({ ...report, ...patch });
  const setFinding = (i: number, patch: Partial<InstructorFileReport['findings'][number]>) =>
    set({ findings: report.findings.map((f, j) => j === i ? { ...f, ...patch } : f) });
  const setCategory = (i: number, patch: Partial<InstructorFileReport['categories'][number]>) =>
    set({ categories: report.categories.map((c, j) => j === i ? { ...c, ...patch } : c) });

  return (
    <div className={`mt-3 rounded-xl p-3 space-y-3 ${isDark ? 'bg-zinc-900/40' : 'bg-[#eef0ec]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-semibold ${textPrim}`}>
          File report{report.aiDrafted ? <span className={`ml-1.5 font-normal ${textMut}`}>AI draft, check before submitting</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreview(p => !p)} className={subtle}>
            {preview ? <><Pencil className="w-3.5 h-3.5" /> Edit</> : <><Eye className="w-3.5 h-3.5" /> Preview</>}
          </button>
          <button onClick={draft} disabled={drafting} className={subtle}>
            {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Redraft
          </button>
          <button onClick={() => { if (window.confirm('Remove this report?')) { onChange(null); setNotices([]); } }} className={subtle} aria-label="Remove report">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {isReportStale(report, fileUrl) && (
        <div className={`rounded-lg px-3 py-2 text-xs space-y-2 ${isDark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-800'}`}>
          <p>This report was written for an earlier version of the file. The student has since uploaded a new one, and sees this report marked as being about their earlier file.</p>
          <p>Redraft it for the new file, or check the new file yourself and keep the report for it.</p>
          <button onClick={() => onChange({ ...report, fileUrl })} disabled={drafting} className={subtle}>
            I checked the new file, keep this report for it
          </button>
        </div>
      )}
      {notices.length > 0 && (
        <div className={`rounded-lg px-3 py-2 text-xs space-y-1 ${isDark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-800'}`}>
          {notices.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {preview ? (
        // Run through the server's own normalizer, so Preview shows exactly what will be saved:
        // trimmed text, blank rows dropped, and nothing past the row limits.
        <InstructorFileReportView report={normalizeInstructorReport({ ...report, score: report.score ?? 0 })!} title={title} accentColor="#00b95c" isDark={isDark} />
      ) : (
        // Locked while a redraft runs: it replaces the report, so edits made meanwhile would be lost.
        <fieldset disabled={drafting} className="space-y-4 disabled:opacity-60">
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <div>
              <label className={label}>File score (0 - 100)</label>
              <input type="number" min={0} max={100} value={report.score ?? ''} placeholder="Required"
                onChange={e => set({ score: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={field} />
            </div>
            <div>
              <label className={label}>Summary for the student</label>
              <textarea rows={3} value={report.summary} maxLength={REPORT_LIMITS.summary} onChange={e => set({ summary: e.target.value })} className={`${field} resize-y`} />
            </div>
          </div>

          {/* Findings */}
          <div className="space-y-2">
            <p className={`text-[11px] font-bold uppercase tracking-widest ${textMut}`}>Findings</p>
            {report.findings.map((f, i) => (
              <div key={i} className={panel}>
                <div className="flex gap-2">
                  <select value={f.severity} onChange={e => setFinding(i, { severity: e.target.value as InstructorFindingSeverity })} className={`${field} w-36 flex-shrink-0`}>
                    {(Object.keys(INSTRUCTOR_SEVERITY_LABELS) as InstructorFindingSeverity[]).map(s => <option key={s} value={s}>{INSTRUCTOR_SEVERITY_LABELS[s]}</option>)}
                  </select>
                  <input value={f.location} maxLength={REPORT_LIMITS.location} onChange={e => setFinding(i, { location: e.target.value })} placeholder="Where, e.g. Slide 3" className={field} />
                  <button onClick={() => set({ findings: report.findings.filter((_, j) => j !== i) })} className={`flex-shrink-0 px-1 ${textMut}`} aria-label="Remove finding"><X className="w-4 h-4" /></button>
                </div>
                <input value={f.title} maxLength={REPORT_LIMITS.title} onChange={e => setFinding(i, { title: e.target.value })} placeholder="Title" className={field} />
                <textarea rows={2} value={f.detail} maxLength={REPORT_LIMITS.detail} onChange={e => setFinding(i, { detail: e.target.value })} placeholder="What is wrong or notable" className={`${field} resize-y`} />
                <textarea rows={2} value={f.fix} maxLength={REPORT_LIMITS.fix} onChange={e => setFinding(i, { fix: e.target.value })} placeholder="Recommended action" className={`${field} resize-y`} />
              </div>
            ))}
            <button onClick={() => set({ findings: [...report.findings, { location: '', severity: 'warning', title: '', detail: '', fix: '' }] })}
              disabled={report.findings.length >= REPORT_COUNTS.findings} className={`${subtle} disabled:opacity-50`}>
              <Plus className="w-3.5 h-3.5" /> {report.findings.length >= REPORT_COUNTS.findings ? `Limit of ${REPORT_COUNTS.findings} findings reached` : 'Add finding'}
            </button>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <p className={`text-[11px] font-bold uppercase tracking-widest ${textMut}`}>Quality by dimension</p>
            {report.categories.map((c, i) => (
              <div key={i} className={panel}>
                <div className="flex gap-2">
                  <input value={c.name} maxLength={REPORT_LIMITS.categoryName} onChange={e => setCategory(i, { name: e.target.value })} placeholder="Dimension, e.g. Accuracy" className={field} />
                  <input type="number" min={0} max={100} value={c.score} aria-label="Dimension score"
                    onChange={e => setCategory(i, { score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`${field} w-20 flex-shrink-0`} />
                  <button onClick={() => set({ categories: report.categories.filter((_, j) => j !== i) })} className={`flex-shrink-0 px-1 ${textMut}`} aria-label="Remove dimension"><X className="w-4 h-4" /></button>
                </div>
                <input value={c.summary} maxLength={REPORT_LIMITS.categorySummary} onChange={e => setCategory(i, { summary: e.target.value })} placeholder="One-sentence summary" className={field} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={label}>Strengths (one per line, up to {REPORT_COUNTS.listItems})</label>
                    <textarea rows={3} value={toLines(c.strengths)} onChange={e => setCategory(i, { strengths: fromLines(e.target.value) })} className={`${field} resize-y`} />
                  </div>
                  <div>
                    <label className={label}>Gaps (one per line, up to {REPORT_COUNTS.listItems})</label>
                    <textarea rows={3} value={toLines(c.gaps)} onChange={e => setCategory(i, { gaps: fromLines(e.target.value) })} className={`${field} resize-y`} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => set({ categories: [...report.categories, { name: '', score: 0, summary: '', strengths: [], gaps: [] }] })}
              disabled={report.categories.length >= REPORT_COUNTS.categories} className={`${subtle} disabled:opacity-50`}>
              <Plus className="w-3.5 h-3.5" /> {report.categories.length >= REPORT_COUNTS.categories ? `Limit of ${REPORT_COUNTS.categories} dimensions reached` : 'Add dimension'}
            </button>
          </div>

          <div>
            <label className={label}>Next steps (one per line, up to {REPORT_COUNTS.listItems})</label>
            <textarea rows={3} value={toLines(report.recommendations)} onChange={e => set({ recommendations: fromLines(e.target.value) })} className={`${field} resize-y`} />
          </div>
        </fieldset>
      )}
    </div>
  );
}
