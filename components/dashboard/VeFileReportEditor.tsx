'use client';

// Instructor report on one uploaded file in the VE Review panel. The instructor drafts it with AI
// (or starts blank), edits every field, and can preview exactly what the student will see. Nothing
// is saved here: the parent sends all reports with the review on Submit Review.

import { useState } from 'react';
import { Eye, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
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

  // Plain surface: the editor sits on the submission card with no background of its own. Fields
  // carry the only outlines. Widths are set per field, never in the shared class, so a fixed-width
  // field (a score) cannot be overridden by a full-width one.
  const textPrim = isDark ? 'text-zinc-100' : 'text-[#111]';
  const textMut  = isDark ? 'text-zinc-400' : 'text-[#5f6368]';
  const field    = `px-3.5 py-2.5 rounded-xl border text-[15px] leading-relaxed outline-none transition-colors focus:border-[#00b95c] ${isDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500' : 'bg-white border-[#e3e5e8] text-[#111] placeholder:text-[#9aa0a6]'}`;
  const label    = `block text-[13px] font-medium mb-1.5 ${textMut}`;
  const heading  = `text-[15px] font-semibold ${textPrim}`;
  const action   = `inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 ${textMut}`;
  const addLink  = 'inline-flex items-center gap-1.5 text-[14px] font-semibold transition-opacity hover:opacity-70 disabled:opacity-40';
  const divider  = isDark ? 'border-zinc-800' : 'border-[#ebedf0]';
  const SEVERITY_COLORS: Record<InstructorFindingSeverity, string> = { error: '#ef4444', warning: '#f59e0b', suggestion: '#3b82f6' };

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
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={draft} disabled={drafting}
            className="inline-flex items-center gap-2 text-[14px] font-semibold px-4 py-2.5 rounded-xl text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            style={{ background: '#00b95c' }}>
            {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {drafting ? 'Drafting report' : 'Draft report with AI'}
          </button>
          <button onClick={() => onChange({ ...emptyInstructorReport(), fileUrl })} disabled={drafting}
            className={`inline-flex items-center gap-2 text-[14px] font-semibold px-4 py-2.5 rounded-xl border transition-opacity hover:opacity-70 disabled:opacity-40 ${isDark ? 'border-zinc-700 text-zinc-200' : 'border-[#e3e5e8] text-[#333]'}`}>
            <Pencil className="w-4 h-4" /> Write report
          </button>
        </div>
        {error && <p role="alert" className="text-[13px] text-red-500">{error}</p>}
      </div>
    );
  }

  const set = (patch: Partial<InstructorReportDraft>) => onChange({ ...report, ...patch });
  const setFinding = (i: number, patch: Partial<InstructorFileReport['findings'][number]>) =>
    set({ findings: report.findings.map((f, j) => j === i ? { ...f, ...patch } : f) });
  const setCategory = (i: number, patch: Partial<InstructorFileReport['categories'][number]>) =>
    set({ categories: report.categories.map((c, j) => j === i ? { ...c, ...patch } : c) });
  const notice = `rounded-xl px-4 py-3 text-[13px] leading-relaxed space-y-2 ${isDark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-900'}`;

  return (
    <div className={`mt-5 pt-5 border-t space-y-5 ${divider}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={heading}>File report</p>
          {report.aiDrafted && <p className={`text-[13px] mt-0.5 ${textMut}`}>AI draft. Check it before submitting.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => setPreview(p => !p)} className={action}>
            {preview ? <><Pencil className="w-4 h-4" /> Edit</> : <><Eye className="w-4 h-4" /> Preview</>}
          </button>
          <button onClick={draft} disabled={drafting} className={action}>
            {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Redraft
          </button>
          <button onClick={() => { if (window.confirm('Remove this report?')) { onChange(null); setNotices([]); } }} className={action} aria-label="Remove report">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-[13px] text-red-500">{error}</p>}
      {isReportStale(report, fileUrl) && (
        <div className={notice}>
          <p>This report was written for an earlier version of the file. The student has since uploaded a new one, and sees this report marked as being about their earlier file.</p>
          <p>Redraft it for the new file, or check the new file yourself and keep the report for it.</p>
          <button onClick={() => onChange({ ...report, fileUrl })} disabled={drafting} className="font-semibold underline underline-offset-2">
            I checked the new file, keep this report for it
          </button>
        </div>
      )}
      {notices.length > 0 && (
        <div className={notice}>
          {notices.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {preview ? (
        // Run through the server's own normalizer, so Preview shows exactly what will be saved:
        // trimmed text, blank rows dropped, and nothing past the row limits.
        <InstructorFileReportView report={normalizeInstructorReport({ ...report, score: report.score ?? 0 })!} title={title} accentColor="#00b95c" isDark={isDark} />
      ) : (
        // Locked while a redraft runs: it replaces the report, so edits made meanwhile would be lost.
        <fieldset disabled={drafting} className="min-w-0 space-y-7 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <div>
              <label className={label}>File score (0 - 100)</label>
              <input type="number" min={0} max={100} value={report.score ?? ''} placeholder="Required"
                onChange={e => set({ score: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`${field} w-full`} />
            </div>
            <div className="min-w-0">
              <label className={label}>Summary for the student</label>
              <textarea rows={3} value={report.summary} maxLength={REPORT_LIMITS.summary} onChange={e => set({ summary: e.target.value })}
                placeholder="How well the file meets the brief, in two or three sentences" className={`${field} w-full resize-y`} />
            </div>
          </div>

          {/* Findings */}
          <section className="space-y-3">
            <p className={heading}>Findings</p>
            {report.findings.map((f, i) => (
              <div key={i} className={`space-y-3 pb-5 border-b ${divider}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Severity">
                    {(Object.keys(INSTRUCTOR_SEVERITY_LABELS) as InstructorFindingSeverity[]).map(sev => {
                      const on = f.severity === sev;
                      const color = SEVERITY_COLORS[sev];
                      return (
                        <button key={sev} type="button" role="radio" aria-checked={on} onClick={() => setFinding(i, { severity: sev })}
                          className="text-[13px] font-semibold px-3 py-1 rounded-full border transition-colors"
                          style={on ? { background: color, borderColor: color, color: '#fff' } : { borderColor: isDark ? '#3f3f46' : '#e3e5e8', color: isDark ? '#a1a1aa' : '#5f6368' }}>
                          {INSTRUCTOR_SEVERITY_LABELS[sev]}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => set({ findings: report.findings.filter((_, j) => j !== i) })} className={action} aria-label="Remove finding">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* Labelled, not placeholder-only: a placeholder disappears once the field is filled. */}
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <div className="min-w-0">
                    <label className={label}>Title</label>
                    <input value={f.title} maxLength={REPORT_LIMITS.title} onChange={e => setFinding(i, { title: e.target.value })}
                      placeholder="e.g. Revenue total is hard-coded" className={`${field} w-full font-medium`} />
                  </div>
                  <div className="min-w-0">
                    <label className={label}>Where in the file</label>
                    <input value={f.location} maxLength={REPORT_LIMITS.location} onChange={e => setFinding(i, { location: e.target.value })}
                      placeholder="e.g. Slide 3" className={`${field} w-full`} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={label}>What is wrong</label>
                    <textarea rows={3} value={f.detail} maxLength={REPORT_LIMITS.detail} onChange={e => setFinding(i, { detail: e.target.value })}
                      className={`${field} w-full resize-y`} />
                  </div>
                  <div className="min-w-0">
                    <label className={label}>How to fix it</label>
                    <textarea rows={3} value={f.fix} maxLength={REPORT_LIMITS.fix} onChange={e => setFinding(i, { fix: e.target.value })}
                      className={`${field} w-full resize-y`} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => set({ findings: [...report.findings, { location: '', severity: 'warning', title: '', detail: '', fix: '' }] })}
              disabled={report.findings.length >= REPORT_COUNTS.findings} className={addLink} style={{ color: '#00b95c' }}>
              <Plus className="w-4 h-4" /> {report.findings.length >= REPORT_COUNTS.findings ? `Limit of ${REPORT_COUNTS.findings} findings reached` : 'Add finding'}
            </button>
          </section>

          {/* Quality dimensions */}
          <section className="space-y-3">
            <div>
              <p className={heading}>Quality by dimension</p>
              <p className={`text-[13px] mt-0.5 ${textMut}`}>Score each area of the work separately, for example Accuracy or Presentation.</p>
            </div>
            {report.categories.map((c, i) => (
              <div key={i} className={`space-y-3 pb-5 border-b ${divider}`}>
                <div className="flex items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label className={label}>Dimension</label>
                    <input value={c.name} maxLength={REPORT_LIMITS.categoryName} onChange={e => setCategory(i, { name: e.target.value })}
                      placeholder="e.g. Accuracy" className={`${field} w-full font-medium`} />
                  </div>
                  <div className="w-24 shrink-0">
                    <label className={label}>Score</label>
                    <input type="number" min={0} max={100} value={c.score}
                      onChange={e => setCategory(i, { score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`${field} w-full`} />
                  </div>
                  <button onClick={() => set({ categories: report.categories.filter((_, j) => j !== i) })} className={`${action} mb-1`} aria-label="Remove dimension">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className={label}>Summary</label>
                  <textarea rows={2} value={c.summary} maxLength={REPORT_LIMITS.categorySummary} onChange={e => setCategory(i, { summary: e.target.value })}
                    placeholder="One sentence on this area of the work" className={`${field} w-full resize-y`} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={label}>Strengths, one per line (up to {REPORT_COUNTS.listItems})</label>
                    <textarea rows={3} value={toLines(c.strengths)} onChange={e => setCategory(i, { strengths: fromLines(e.target.value) })} className={`${field} w-full resize-y`} />
                  </div>
                  <div className="min-w-0">
                    <label className={label}>Gaps, one per line (up to {REPORT_COUNTS.listItems})</label>
                    <textarea rows={3} value={toLines(c.gaps)} onChange={e => setCategory(i, { gaps: fromLines(e.target.value) })} className={`${field} w-full resize-y`} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => set({ categories: [...report.categories, { name: '', score: 0, summary: '', strengths: [], gaps: [] }] })}
              disabled={report.categories.length >= REPORT_COUNTS.categories} className={addLink} style={{ color: '#00b95c' }}>
              <Plus className="w-4 h-4" /> {report.categories.length >= REPORT_COUNTS.categories ? `Limit of ${REPORT_COUNTS.categories} dimensions reached` : 'Add dimension'}
            </button>
          </section>

          <section>
            <p className={`${heading} mb-1.5`}>Next steps</p>
            <label className={label}>One per line, up to {REPORT_COUNTS.listItems}</label>
            <textarea rows={3} value={toLines(report.recommendations)} onChange={e => set({ recommendations: fromLines(e.target.value) })} className={`${field} w-full resize-y`} />
          </section>
        </fieldset>
      )}
    </div>
  );
}
