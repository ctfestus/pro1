'use client';

import React, { useState, useRef } from 'react';
import { Loader2, CheckCircle2, Zap, RotateCcw, Code2, Download, Upload, FileCode, Lock, ChevronDown, ShieldCheck, TriangleAlert, Lightbulb, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadCodeReviewPdf } from '@/lib/downloadReviewPdf';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';

const LANGUAGES = ['Python', 'SQL', 'JavaScript', 'TypeScript', 'R', 'Java', 'C#', 'Other'];
const SQL_DIALECTS = ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server'];

interface RubricGrade { criterion: string; passed: boolean; comment: string; }
interface LineIssue {
  lines: string;
  severity: 'error' | 'warning' | 'suggestion';
  title: string;
  detail: string;
  fix: string;
}
interface CategoryScore {
  name: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}
interface ReviewResult {
  overallScore: number;
  executiveSummary: string;
  issues: LineIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
  language?: string;
  dialect?: string;
}

interface Props {
  reqId: string;
  isDark: boolean;
  accentColor: string;
  completed: boolean;
  savedResult?: ReviewResult;
  reviewsUsed?: number;
  rubric?: string[];
  schema?: string;
  minScore?: number;
  reviewLanguage?: string;
  maxReviews?: number;
  showAttemptCount?: boolean;
  onReviewStart?: () => void;
  onReviewError?: () => void;
  onComplete: (result: ReviewResult, passed: boolean) => void;
}

function severityColor(s: LineIssue['severity']) {
  if (s === 'error')      return '#ef4444';
  if (s === 'warning')    return '#f59e0b';
  return '#3b82f6';
}
function severityLabel(s: LineIssue['severity']) {
  if (s === 'error')   return 'Error';
  if (s === 'warning') return 'Warning';
  return 'Suggestion';
}
function scoreColor(n: number) {
  if (n >= 80) return '#22c55e';
  if (n >= 60) return '#f59e0b';
  return '#ef4444';
}

export default function CodeReviewPlayer({ reqId, isDark, accentColor, completed, savedResult, reviewsUsed = 0, rubric, schema, minScore, reviewLanguage, maxReviews, showAttemptCount, onReviewStart, onReviewError, onComplete }: Props) {
  const atLimit = maxReviews !== undefined && reviewsUsed >= maxReviews;
  // Lock the "already completed" views only when: no per-question limit (VE/assignment), at limit,
  // or state was lost on page reload (no saved report and no further attempts).
  const shouldLock = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget (direct/VE assignments) -- hide it so the student can't clear
  // the saved report into an empty locked state.
  const showReset = !atLimit && !(completed && maxReviews === undefined);
  // Normalize authored language to match the LANGUAGES display array
  const lockedLanguage = reviewLanguage
    ? (LANGUAGES.find(l => l.toLowerCase() === reviewLanguage.toLowerCase()) ?? null)
    : null;

  const [code, setCode]         = useState('');
  const [language, setLanguage] = useState(lockedLanguage ?? 'Python');
  const [dialect, setDialect]   = useState('PostgreSQL');
  // Show the saved report on mount whenever one exists. When retries remain, the result view's
  // Reset button (rendered while !atLimit) lets the student start another attempt.
  const [result, setResult]     = useState<ReviewResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]       = useState('');
  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [issueFilter, setIssueFilter] = useState<'all' | LineIssue['severity']>('all');
  const [expandedIssues, setExpandedIssues] = useState<Set<number>>(() => new Set([0]));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bg     = isDark ? '#0f0f0f' : '#f8fafc';
  const card   = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text   = isDark ? '#f0f0f0' : '#111';
  const muted  = isDark ? '#888' : '#666';
  const input  = isDark ? '#111' : '#f9fafb';
  const inner  = isDark ? '#222' : '#f3f4f6';
  const reportSurface = isDark ? '#12151b' : '#f8fafc';
  const reportInner = isDark ? '#22272f' : '#f7f8fa';

  async function handleSubmit() {
    if (!code.trim()) { setError(inputMode === 'upload' ? 'Please upload a file before submitting.' : 'Please paste your code before submitting.'); return; }
    setError('');
    setAnalyzing(true);
    onReviewStart?.();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/code-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          code: code.trim(),
          language,
          ...(language === 'SQL' ? { dialect } : {}),
          ...(schema?.trim() ? { schema: schema.trim() } : {}),
          ...(rubric?.length ? { rubric } : {}),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const enriched: ReviewResult = { ...json, language, ...(language === 'SQL' ? { dialect } : {}) };
      setResult(enriched);
      const passed = !minScore || enriched.overallScore >= minScore;
      onComplete(enriched, passed);
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
      onReviewError?.();
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() {
    setCode('');
    setResult(null);
    setError('');
    setUploadedFileName('');
    setIssueFilter('all');
    setExpandedIssues(new Set([0]));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setCode(text ?? '');
      setUploadedFileName(file.name);
      setError('');
    };
    reader.onerror = () => setError('Could not read file. Please try again.');
    reader.readAsText(file);
    e.target.value = '';
  }

  async function downloadPdf() {
    try {
      if (!result) return;
      await downloadCodeReviewPdf(result, `code-review-${Date.now()}.pdf`, accentColor);
    } catch (err: any) {
      setError(err?.message ?? 'PDF export failed. Please try again.');
    }
  }

  // Already completed but the saved report isn't available (e.g. older data) -- show locked state
  if (!result && completed && shouldLock) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}25` }}>
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <p className="text-sm font-medium" style={{ color: accentColor }}>
          Code review already submitted for this question.
        </p>
      </div>
    );
  }

  // Input state
  if (!result) {
    if (atLimit) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${border}` }}>
          <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: text }}>Review limit reached</p>
            <p className="text-xs mt-0.5" style={{ color: muted }}>You have used all {maxReviews} allowed review attempts for this question.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <AiReviewWorkspaceHeader icon={<FileCode className="w-5 h-5" />} title="Review your code" description="Paste code or upload a source file to receive structured, rubric-aware feedback." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing={analyzing} />
        <AiReviewDisclaimer isDark={isDark} />
        {/* Language selector -- locked when instructor specified a language */}
        {lockedLanguage ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: accentColor, color: '#fff' }}>
              {lockedLanguage}
            </span>
            <span className="flex items-center gap-1 text-xs" style={{ color: muted }}>
              <Lock className="w-3 h-3" /> Language set by instructor
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {LANGUAGES.map(lang => (
              <button key={lang} onClick={() => setLanguage(lang)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: language === lang ? accentColor : inner, color: language === lang ? '#fff' : muted }}>
                {lang}
              </button>
            ))}
          </div>
        )}

        {/* SQL dialect selector */}
        {language === 'SQL' && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Dialect</p>
            <div className="flex items-center gap-2 flex-wrap">
              {SQL_DIALECTS.map(d => (
                <button key={d} onClick={() => setDialect(d)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ background: dialect === d ? `${accentColor}18` : inner,
                    color: dialect === d ? accentColor : muted,
                    border: `1px solid ${dialect === d ? `${accentColor}40` : border}`,
                    borderRadius: 6 }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Code input -- paste or upload */}
        <div style={{ border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`, borderRadius: 16, overflow: 'hidden', background: isDark ? '#111' : '#fff', boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: inner, borderColor: border }}>
            <div className="flex items-center gap-2">
              <Code2 className="w-3.5 h-3.5" style={{ color: muted }} />
              <span className="text-xs font-semibold" style={{ color: muted }}>
                {language}{language === 'SQL' ? ` | ${dialect}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1" style={{ background: isDark ? '#0a0a0a' : '#e5e7eb', borderRadius: 6, padding: 3 }}>
              {(['paste', 'upload'] as const).map(mode => (
                <button key={mode} onClick={() => setInputMode(mode)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    borderRadius: 4,
                    background: inputMode === mode ? (isDark ? '#1e1e1e' : '#fff') : 'transparent',
                    color: inputMode === mode ? text : muted,
                    boxShadow: inputMode === mode ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                  }}>
                  {mode === 'paste' ? <><Code2 className="w-3 h-3" />Paste</> : <><Upload className="w-3 h-3" />Upload</>}
                </button>
              ))}
            </div>
          </div>

          {inputMode === 'paste' ? (
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={`Paste your ${language} code here...`}
              rows={14}
              spellCheck={false}
              className="w-full resize-none outline-none text-[13px] font-mono px-4 py-3"
              style={{ background: input, color: text, lineHeight: 1.7 }}
            />
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
              style={{ minHeight: 200, background: input, padding: '32px 24px' }}
            >
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange}
                accept=".py,.js,.ts,.jsx,.tsx,.sql,.r,.R,.java,.cs,.c,.cpp,.go,.rs,.rb,.php,.swift,.kt,.scala,.txt" />
              {uploadedFileName ? (
                <>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${accentColor}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileCode className="w-5 h-5" style={{ color: accentColor }} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold" style={{ color: text }}>{uploadedFileName}</p>
                    <p className="text-xs mt-1" style={{ color: muted }}>
                      {code.split('\n').length} lines loaded -- click to replace
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: isDark ? '#1e1e1e' : '#f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${border}` }}>
                    <Upload className="w-5 h-5" style={{ color: muted }} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold" style={{ color: text }}>Click to upload your file</p>
                    <p className="text-xs mt-1" style={{ color: muted }}>
                      .py .js .ts .sql .r .java .cs and more
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <button onClick={handleSubmit} disabled={analyzing}
          className="flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          style={{ background: accentColor, color: '#fff', borderRadius: 12 }}>
          {analyzing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Reviewing...</>
            : <><Zap className="w-4 h-4" /> Submit for AI Review</>}
        </button>
      </div>
    );
  }

  // Result state
  const errors      = result.issues.filter(i => i.severity === 'error');
  const warnings    = result.issues.filter(i => i.severity === 'warning');
  const suggestions = result.issues.filter(i => i.severity === 'suggestion');
  const filteredIssues = issueFilter === 'all' ? result.issues : result.issues.filter(issue => issue.severity === issueFilter);
  const rubricPassed = result.rubricGrades?.filter(grade => grade.passed).length ?? 0;
  const rubricTotal = result.rubricGrades?.length ?? 0;
  const strengths = result.categories.reduce((count, category) => count + category.strengths.length, 0);
  const opportunities = result.categories.reduce((count, category) => count + category.gaps.length, 0);
  const verdict = result.overallScore >= 80 ? 'Production ready' : result.overallScore >= 60 ? 'Solid foundation' : 'Needs another pass';
  const verdictColor = scoreColor(result.overallScore);

  function toggleIssue(index: number) {
    setExpandedIssues(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      <AiReviewDisclaimer isDark={isDark} />
      <section className="overflow-hidden rounded-[24px]" style={{ background: reportSurface }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6" style={{ borderBottom: `1px solid ${border}` }}>
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="absolute h-3 w-3 animate-ping rounded-full opacity-25 motion-reduce:animate-none" style={{ background: accentColor }} />
              <span className="relative h-2 w-2 rounded-full" style={{ background: accentColor }} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: accentColor }}>AI code intelligence</p>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: muted }}>
                {result.language ?? language}{result.language === 'SQL' && result.dialect ? ` | ${result.dialect}` : ''}
                {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-transform active:scale-95" style={{ background: card, color: text }}><Download className="h-3.5 w-3.5" /> Export</button>
            {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-transform active:scale-95" style={{ background: `${accentColor}18`, color: accentColor }}><RotateCcw className="h-3.5 w-3.5" /> Try again</button>}
          </div>
        </div>

        <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ background: `${verdictColor}16`, color: verdictColor }}>{verdict}</span>
              <span className="text-[11px] font-semibold" style={{ color: muted }}>{result.issues.length} findings detected</span>
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-[-0.02em] sm:text-2xl" style={{ color: text }}>Your code review</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: muted }}>{result.executiveSummary}</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: card }}>
            <div className="flex items-end justify-between gap-3">
              <div><span className="text-4xl font-extrabold leading-none tabular-nums" style={{ color: text }}>{result.overallScore.toFixed(1)}</span><span className="ml-1 text-xs font-semibold" style={{ color: muted }}>/100</span></div>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: verdictColor }}>Overall</span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#e4e9ef' }}>
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${result.overallScore}%`, background: accentColor, boxShadow: `0 0 16px ${accentColor}55` }} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: border }}>
          {[
            { label: 'Strengths', value: strengths, icon: ShieldCheck, color: '#22c55e' },
            { label: 'Risks', value: errors.length + warnings.length, icon: TriangleAlert, color: '#f59e0b' },
            { label: 'Opportunities', value: opportunities, icon: Lightbulb, color: '#3b82f6' },
            { label: 'Rubric passed', value: rubricTotal ? `${rubricPassed}/${rubricTotal}` : 'N/A', icon: CheckCircle2, color: accentColor },
          ].map(metric => (
            <div key={metric.label} className="flex items-center gap-3 px-4 py-4 sm:px-5" style={{ background: card }}>
              <metric.icon className="h-4 w-4 shrink-0" style={{ color: metric.color }} />
              <div className="min-w-0"><span className="block text-lg font-bold leading-none tabular-nums" style={{ color: text }}>{metric.value}</span><span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: muted }}>{metric.label}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Diagnostic feed</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Findings in your code</h3></div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['all', 'All', result.issues.length],
              ['error', 'Errors', errors.length],
              ['warning', 'Warnings', warnings.length],
              ['suggestion', 'Ideas', suggestions.length],
            ] as const).map(([value, label, count]) => (
              <button key={value} onClick={() => setIssueFilter(value)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors" style={{ background: issueFilter === value ? accentColor : reportInner, color: issueFilter === value ? '#fff' : muted }}>{label} {count}</button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {filteredIssues.length === 0 ? (
            <div className="grid min-h-28 place-items-center rounded-2xl text-center" style={{ background: reportInner }}><div><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" /><p className="mt-2 text-xs font-semibold" style={{ color: muted }}>No findings in this category</p></div></div>
          ) : filteredIssues.map(issue => {
            const originalIndex = result.issues.indexOf(issue);
            const color = severityColor(issue.severity);
            const expanded = expandedIssues.has(originalIndex);
            return (
              <article key={originalIndex} className="overflow-hidden rounded-2xl" style={{ background: reportInner }}>
                <button onClick={() => toggleIssue(originalIndex)} className="flex w-full items-center gap-3 p-3.5 text-left sm:p-4" aria-expanded={expanded}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0 4px ${color}14` }} />
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-[0.11em]" style={{ color }}>{severityLabel(issue.severity)}</span>{issue.lines && <span className="text-[10px] font-medium" style={{ color: muted, fontFamily: 'var(--font-mono)' }}>Line {issue.lines}</span>}</div><p className="mt-1 truncate text-[13px] font-semibold" style={{ color: text }}>{issue.title}</p></div>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: muted }} />
                </button>
                {expanded && (
                  <div className="px-4 pb-4 sm:pl-[43px]">
                    <p className="text-[12.5px] leading-relaxed" style={{ color: muted }}>{issue.detail}</p>
                    {issue.fix && <div className="mt-3 rounded-xl p-3.5" style={{ background: card }}><p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: accentColor }}><ArrowUpRight className="h-3 w-3" /> Recommended fix</p><p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: text }}>{issue.fix}</p></div>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {result.rubricGrades && result.rubricGrades.length > 0 && (
          <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
            <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Rubric signal</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Requirements check</h3></div><span className="text-sm font-bold tabular-nums" style={{ color: text }}>{rubricPassed}<span style={{ color: muted }}>/{rubricTotal}</span></span></div>
            <div className="mt-4 space-y-2">
              {result.rubricGrades.map((grade, index) => (
                <div key={index} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: reportInner }}>
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black" style={{ background: grade.passed ? '#22c55e' : isDark ? '#343943' : '#dfe4ea', color: grade.passed ? '#fff' : muted }}>{grade.passed ? 'Y' : '-'}</span>
                  <div className="min-w-0"><p className="text-[11.5px] font-semibold" style={{ color: text }}>{grade.criterion}</p><p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: muted }}>{grade.comment}</p></div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Performance matrix</p>
          <h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Quality by dimension</h3>
          <div className="mt-4 space-y-4">
            {result.categories.map(category => (
              <div key={category.name}>
                <div className="flex items-center justify-between gap-3"><p className="truncate text-[12px] font-semibold" style={{ color: text }}>{category.name}</p><span className="text-[12px] font-bold tabular-nums" style={{ color: scoreColor(category.score) }}>{category.score}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: reportInner }}><div className="h-full rounded-full" style={{ width: `${category.score}%`, background: scoreColor(category.score) }} /></div>
                <p className="mt-2 text-[11px] leading-relaxed" style={{ color: muted }}>{category.summary}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {result.topRecommendations.length > 0 && (
        <section className="rounded-[22px] p-4 sm:p-5" style={{ background: reportSurface }}>
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Next best actions</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Your improvement path</h3></div>
            <Zap className="h-5 w-5" style={{ color: accentColor }} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.topRecommendations.map((recommendation, index) => (
              <div key={index} className="rounded-2xl p-4" style={{ background: card }}>
                <span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-black" style={{ background: accentColor, color: '#fff' }}>{index + 1}</span>
                <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: text }}>{recommendation}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completion / gate */}
      {minScore && result.overallScore < minScore ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Minimum score not reached | {result.overallScore.toFixed(1)}/100 | Required: {minScore}/100
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the improvement path above, revise your code, and submit another review.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            Review complete | {result.issues.length} finding{result.issues.length !== 1 ? 's' : ''} identified
          </p>
        </div>
      )}
    </div>
  );
}
