'use client';

import React, { useRef, useState } from 'react';
import { Loader2, CheckCircle2, Zap, RotateCcw, FileText, Download, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadStructuredReviewPdf } from '@/lib/downloadReviewPdf';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';
import AiStructuredReviewReport from '@/components/AiStructuredReviewReport';

interface SectionIssue {
  name: string;
  severity: 'critical' | 'improvement' | 'suggestion';
  title: string;
  detail: string;
  recommendation: string;
}
interface RubricGrade { criterion: string; passed: boolean; comment: string; }
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
  sections: SectionIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
}

interface Props {
  reqId: string;
  isDark: boolean;
  accentColor: string;
  completed: boolean;
  savedResult?: ReviewResult;
  reviewsUsed?: number;
  context?: string;
  rubric?: string[];
  minScore?: number;
  maxReviews?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  showAttemptCount?: boolean;
  onComplete: (result: ReviewResult, passed: boolean) => void;
}

function severityColor(s: SectionIssue['severity']) {
  if (s === 'critical')    return '#ef4444';
  if (s === 'improvement') return '#f59e0b';
  return '#3b82f6';
}
function severityLabel(s: SectionIssue['severity']) {
  if (s === 'critical')    return 'Critical';
  if (s === 'improvement') return 'Improvement';
  return 'Suggestion';
}
function scoreColor(n: number) {
  if (n >= 80) return '#22c55e';
  if (n >= 60) return '#f59e0b';
  return '#ef4444';
}

export default function DocumentReviewPlayer({
  reqId, isDark, accentColor, completed, savedResult, reviewsUsed = 0,
  context, rubric, minScore, maxReviews, documentReviewMode = 'ai_only', showAttemptCount, onComplete,
}: Props) {
  const isManual = documentReviewMode === 'manual';
  const isHybrid = documentReviewMode === 'hybrid';
  const atLimit     = maxReviews !== undefined && reviewsUsed >= maxReviews;
  const shouldLock  = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget (direct/VE assignments) -- hide it so the student can't clear
  // the saved report into an empty locked state.
  const showReset   = !atLimit && !(completed && maxReviews === undefined);
  const [file, setFile]         = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // Show the saved report on mount whenever one exists. When retries remain, the result view's
  // Reset button (rendered while !atLimit) lets the student start another attempt.
  const [result, setResult]     = useState<ReviewResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]       = useState('');
  const inputRef   = useRef<HTMLInputElement>(null);

  const bg     = isDark ? '#0f0f0f' : '#f8fafc';
  const card   = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text   = isDark ? '#f0f0f0' : '#111';
  const muted  = isDark ? '#888' : '#666';
  const inner  = isDark ? '#222' : '#f3f4f6';

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  function pickFile(f: File) {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext ?? '')) {
      setError('Only PDF, DOCX, DOC, and TXT files are supported.');
      return;
    }
    setFile(f);
    setError('');
  }

  async function handleSubmit() {
    if (!file) { setError('Please upload your document first.'); return; }
    setError('');
    setAnalyzing(true);
    try {
      // Manual mode: no AI call -- just mark submitted (no report to store)
      if (isManual) {
        onComplete({ overallScore: 0, executiveSummary: '', sections: [], categories: [], topRecommendations: [] }, true);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append('file', file);
      if (context?.trim()) fd.append('context', context.trim());
      if (rubric?.length) fd.append('rubric', JSON.stringify(rubric));

      const res = await fetch('/api/document-review', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: fd,
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResult(json);

      const passed = !minScore || json.overallScore >= minScore;
      onComplete(json, passed);
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setFile(null); setResult(null); setError(''); }

  async function downloadPdf() {
    try {
      if (!result) return;
      await downloadStructuredReviewPdf({
        overallScore: result.overallScore,
        executiveSummary: result.executiveSummary,
        reportLabel: 'AI DOCUMENT INTELLIGENCE',
        reportTitle: 'Your document review',
        reportKicker: 'DOCUMENT REVIEW',
        sourceLabel: 'Submitted document',
        findingsTitle: 'Findings in your document',
        locationLabel: 'SECTION',
        severityLabels: { error: 'Critical', warning: 'Improvement', suggestion: 'Suggestion' },
        metricLabels: { errors: 'Critical', warnings: 'Improvements' },
        issues: result.sections.map(section => ({
          lines: section.name,
          severity: section.severity === 'critical' ? 'error' : section.severity === 'improvement' ? 'warning' : 'suggestion',
          title: section.title,
          detail: section.detail,
          fix: section.recommendation,
        })),
        categories: result.categories,
        topRecommendations: result.topRecommendations,
        rubricGrades: result.rubricGrades,
      }, `document-review-${Date.now()}.pdf`, accentColor);
    } catch (err: any) {
      setError(err?.message ?? 'PDF export failed. Please try again.');
    }
  }

  // Already completed but the saved report isn't available (manual mode, or older data) -- show locked state
  if (!result && completed && shouldLock) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}25` }}>
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <p className="text-sm font-medium" style={{ color: accentColor }}>
          {isManual ? 'Report submitted for instructor review.' : 'Document review already submitted for this question.'}
        </p>
      </div>
    );
  }

  if (!result) {
    if (atLimit) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${border}` }}>
          <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: text }}>Review limit reached</p>
            <p className="text-xs mt-0.5" style={{ color: muted }}>You have used all {maxReviews} allowed review attempts for this question.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <AiReviewWorkspaceHeader icon={<FileText className="w-5 h-5" />} title={isManual ? 'Submit your document' : 'Review your document'} description={isManual ? 'Upload the finished document for instructor review.' : 'Upload your report for structured feedback against the assignment rubric.'} accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing={analyzing} />
        <AiReviewDisclaimer isDark={isDark} />
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 cursor-pointer transition-all hover:-translate-y-px"
          style={{
            border: `1.5px dashed ${dragging || file ? accentColor : border}`,
            borderRadius: 16,
            padding: '42px 24px',
            background: dragging || file ? `${accentColor}08` : inner,
            boxShadow: dragging ? `0 0 0 4px ${accentColor}12` : 'none',
          }}>
          <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
          <span className="inline-flex w-12 h-12 items-center justify-center rounded-xl" style={{ color: file ? '#22c55e' : accentColor, background: file ? 'rgba(34,197,94,0.10)' : `${accentColor}14` }}><FileText className="w-6 h-6" /></span>
          {file
            ? <p style={{ fontSize: 13, fontWeight: 600, color: text }}>{file.name}</p>
            : <>
                <p style={{ fontSize: 13, fontWeight: 600, color: text }}>Drop your report here</p>
                <p style={{ fontSize: 12, color: muted }}>or click to browse &middot; PDF, DOCX, DOC, TXT</p>
              </>
          }
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <button onClick={handleSubmit} disabled={analyzing || !file}
          className="flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-45"
          style={{ background: accentColor, color: '#fff', borderRadius: 12 }}>
          {analyzing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {isManual ? 'Submitting...' : 'Reviewing...'}</>
            : isManual
              ? <><FileText className="w-4 h-4" /> Submit for Instructor Review</>
              : <><Zap className="w-4 h-4" /> {isHybrid ? 'Submit for AI + Instructor Review' : 'Submit for AI Review'}</>}
        </button>
      </div>
    );
  }

  const legacyReportEnabled = false as boolean;

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      <AiReviewDisclaimer isDark={isDark} />
      {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
        <p style={{ fontSize: 11, fontWeight: 600, color: muted }}>Attempt {reviewsUsed} of {maxReviews}</p>
      )}

      <AiStructuredReviewReport
        reportLabel="AI document intelligence"
        title="Your document review"
        metadata={`Submitted document${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
        score={result.overallScore}
        summary={result.executiveSummary}
        findings={result.sections.map(section => ({
          location: section.name,
          severity: section.severity === 'critical' ? 'error' : section.severity === 'improvement' ? 'warning' : 'suggestion',
          title: section.title,
          detail: section.detail,
          fix: section.recommendation,
        }))}
        findingsTitle="Findings in your document"
        locationLabel="Section"
        severityLabels={{ error: 'Critical', warning: 'Improvement', suggestion: 'Suggestion' }}
        metricLabels={{ risks: 'Needs attention' }}
        categories={result.categories}
        recommendations={result.topRecommendations}
        rubricGrades={result.rubricGrades}
        accentColor={accentColor}
        isDark={isDark}
        actions={<>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: card, color: text }}><Download className="w-3.5 h-3.5" /> Export</button>
          {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: `${accentColor}18`, color: accentColor }}><RotateCcw className="w-3.5 h-3.5" /> Try again</button>}
        </>}
      />

      {result && legacyReportEnabled && <>
      {/* Legacy result sections retained temporarily for backward-safe data rendering. */}
      {result.sections.length > 0 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${border}` }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: muted }}>Section Feedback</p>
          </div>
          {result.sections.map((issue, i) => {
            const color = severityColor(issue.severity);
            return (
              <div key={i} style={{ display: 'flex', borderBottom: i < result.sections.length - 1 ? `1px solid ${border}` : 'none' }}>
                <div style={{ width: 3, flexShrink: 0, background: color }} />
                <div style={{ flex: 1, padding: '16px 20px' }}>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em',
                      padding: '3px 8px', background: `${color}15`, color, borderRadius: 3 }}>
                      {severityLabel(issue.severity)}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.name}</span>
                    <p style={{ fontSize: 13, fontWeight: 700, color: text }}>{issue.title}</p>
                  </div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.6, color: muted, marginBottom: issue.recommendation ? 12 : 0 }}>{issue.detail}</p>
                  {issue.recommendation && (
                    <div style={{ background: isDark ? 'rgba(37,99,235,0.08)' : '#eff6ff', borderLeft: '2px solid #3b82f6', padding: '10px 14px' }}>
                      <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#3b82f6', marginBottom: 5 }}>Recommendation</p>
                      <p style={{ fontSize: 12.5, color: isDark ? '#93c5fd' : '#1e40af', lineHeight: 1.6 }}>{issue.recommendation}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rubric */}
      {result.rubricGrades && result.rubricGrades.length > 0 && (() => {
        const passed = result.rubricGrades!.filter(g => g.passed).length;
        const total  = result.rubricGrades!.length;
        const pct    = Math.round((passed / total) * 100);
        const trackColor = pct === 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
        return (
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, overflow: 'hidden' }}>
            <div className="flex items-center justify-between" style={{ padding: '12px 20px', borderBottom: `1px solid ${border}` }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: muted }}>Assignment Rubric</p>
              <div className="flex items-center gap-3">
                <div style={{ width: 80, height: 2, background: border, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: trackColor }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: text, fontVariantNumeric: 'tabular-nums' }}>
                  {passed}<span style={{ fontWeight: 400, color: muted }}>/{total}</span>
                </span>
              </div>
            </div>
            {result.rubricGrades!.map((grade, i) => (
              <div key={i} className="flex items-start gap-4"
                style={{ padding: '14px 20px', borderBottom: i < result.rubricGrades!.length - 1 ? `1px solid ${border}` : 'none' }}>
                <div style={{ width: 2, alignSelf: 'stretch', flexShrink: 0, background: grade.passed ? '#22c55e' : border, marginTop: 2, marginBottom: 2 }} />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, fontWeight: 600, color: text, marginBottom: 4 }}>{grade.criterion}</p>
                  <p style={{ fontSize: 12, color: muted, lineHeight: 1.6 }}>{grade.comment}</p>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', flexShrink: 0, marginTop: 2, color: grade.passed ? '#22c55e' : muted }}>
                  {grade.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Category scores */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${border}` }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: muted }}>Score Breakdown</p>
        </div>
        {result.categories.map((cat, i) => (
          <div key={cat.name} className="flex items-start gap-5"
            style={{ padding: '16px 20px', borderBottom: i < result.categories.length - 1 ? `1px solid ${border}` : 'none' }}>
            <div style={{ width: 36, flexShrink: 0, textAlign: 'center' }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: scoreColor(cat.score), lineHeight: 1, display: 'block', fontVariantNumeric: 'tabular-nums' }}>{cat.score}</span>
              <span style={{ fontSize: 9, color: muted }}>/100</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="flex items-center justify-between mb-1.5">
                <p style={{ fontSize: 13, fontWeight: 700, color: text }}>{cat.name}</p>
                <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(cat.score), textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {cat.score >= 80 ? 'Excellent' : cat.score >= 60 ? 'Good' : cat.score >= 40 ? 'Needs Work' : 'Critical'}
                </span>
              </div>
              <div style={{ height: 2, background: border, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${cat.score}%`, background: scoreColor(cat.score) }} />
              </div>
              <p style={{ fontSize: 12, color: muted, lineHeight: 1.5, marginBottom: 6 }}>{cat.summary}</p>
              {cat.strengths.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {cat.strengths.map((s, si) => (
                    <span key={si} style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(34,197,94,0.1)', color: '#22c55e', borderRadius: 4 }}>{s}</span>
                  ))}
                </div>
              )}
              {cat.gaps.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cat.gaps.map((g, gi) => (
                    <span key={gi} style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 4 }}>{g}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Top recommendations */}
      {result.topRecommendations.length > 0 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}` }}>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: accentColor }}>Priority Actions</p>
          </div>
          {result.topRecommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-4"
              style={{ padding: '16px 20px', borderBottom: i < result.topRecommendations.length - 1 ? `1px solid ${border}` : 'none' }}>
              <span style={{ flexShrink: 0, width: 22, height: 22, background: accentColor, color: '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, borderRadius: 7 }}>
                {i + 1}
              </span>
              <p style={{ fontSize: 13, lineHeight: 1.65, color: text }}>{r}</p>
            </div>
          ))}
        </div>
      )}
      </>}

      {/* Pass/fail gate */}
      {minScore && result.overallScore < minScore ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Minimum score not reached &middot; {result.overallScore.toFixed(1)}/100 &middot; Required: {minScore}/100
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the improvement path above, revise your document, and submit another review.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            Review complete &middot; {result.sections.length} section note{result.sections.length !== 1 ? 's' : ''} identified
          </p>
        </div>
      )}
    </div>
  );
}
