'use client';

// AI Written Response: the student types a free-text answer and the AI grades it against the
// author's rubric, returning the same structured report the other course AI reviews use.
//
// Sibling of DocumentReviewPlayer (upload) and CodeReviewPlayer (paste code): same attempt-budget,
// saved-report, retry, and export behaviour -- the only difference is the submission is typed here.
// Read-only reuse (instructor view via ReviewReportView) passes `completed` with a `savedResult`.

import React, { useState } from 'react';
import { Loader2, CheckCircle2, Zap, RotateCcw, PenLine, Download, TriangleAlert } from 'lucide-react';
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
export interface WrittenReviewResult {
  overallScore: number;
  executiveSummary: string;
  sections: SectionIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
}

// Mirrors MAX_ANSWER_CHARS in app/api/written-review/route.ts.
const MAX_ANSWER_CHARS = 6000;

interface Props {
  reqId: string;
  isDark: boolean;
  accentColor: string;
  completed: boolean;
  savedResult?: WrittenReviewResult;
  savedAnswer?: string;
  reviewsUsed?: number;
  question?: string;
  context?: string;
  rubric?: string[];
  expectedAnswer?: string;
  minScore?: number;
  maxWords?: number;   // word ceiling; 0/undefined = no limit
  maxReviews?: number;
  showAttemptCount?: boolean;
  onComplete: (result: WrittenReviewResult, passed: boolean, answerText: string) => void;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function WrittenResponsePlayer({
  reqId, isDark, accentColor, completed, savedResult, savedAnswer, reviewsUsed = 0,
  question, context, rubric, expectedAnswer, minScore, maxWords, maxReviews, showAttemptCount, onComplete,
}: Props) {
  const atLimit    = maxReviews !== undefined && reviewsUsed >= maxReviews;
  const shouldLock = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget -- hide it so the student cannot clear the saved report into
  // an empty locked state.
  const showReset  = !atLimit && !(completed && maxReviews === undefined);
  const limit      = Math.max(0, Math.floor(maxWords ?? 0));

  const [answer, setAnswer]       = useState(savedAnswer ?? '');
  const [result, setResult]       = useState<WrittenReviewResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]         = useState('');

  const card   = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text   = isDark ? '#f0f0f0' : '#111';
  const muted  = isDark ? '#888' : '#666';
  const inner  = isDark ? '#222' : '#f3f4f6';

  const words     = countWords(answer);
  const overBy    = limit > 0 ? Math.max(0, words - limit) : 0;
  const canSubmit = words > 0 && overBy === 0;

  async function handleSubmit() {
    if (!canSubmit) {
      setError(overBy > 0
        ? `Trim your answer to ${limit} words or fewer. ${overBy} over.`
        : 'Please write your answer first.');
      return;
    }
    setError('');
    setAnalyzing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/written-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          depth: 'full',
          question,
          context,
          rubric,
          expectedAnswer,
          // So the reviewer does not ask for more depth than the word ceiling allows.
          maxWords: limit || undefined,
          studentAnswer: answer.slice(0, MAX_ANSWER_CHARS),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResult(json);

      const passed = !minScore || json.overallScore >= minScore;
      onComplete(json, passed, answer.slice(0, MAX_ANSWER_CHARS));
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setResult(null); setError(''); }

  async function downloadPdf() {
    try {
      if (!result) return;
      await downloadStructuredReviewPdf({
        overallScore: result.overallScore,
        executiveSummary: result.executiveSummary,
        reportLabel: 'AI WRITTEN RESPONSE REVIEW',
        reportTitle: 'Your written response review',
        reportKicker: 'WRITTEN RESPONSE',
        sourceLabel: 'Submitted answer',
        findingsTitle: 'Findings in your answer',
        locationLabel: 'PART',
        severityLabels: { error: 'Critical', warning: 'Improvement', suggestion: 'Suggestion' },
        metricLabels: { errors: 'Critical', warnings: 'Improvements' },
        issues: (result.sections ?? []).map(section => ({
          lines: section.name,
          severity: section.severity === 'critical' ? 'error' : section.severity === 'improvement' ? 'warning' : 'suggestion',
          title: section.title,
          detail: section.detail,
          fix: section.recommendation,
        })),
        categories: result.categories ?? [],
        topRecommendations: result.topRecommendations ?? [],
        rubricGrades: result.rubricGrades,
      }, `written-response-review-${Date.now()}.pdf`, accentColor);
    } catch (err: any) {
      setError(err?.message ?? 'PDF export failed. Please try again.');
    }
  }

  // Completed but the saved report is not available (older data) -- show a locked state.
  if (!result && completed && shouldLock) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}25` }}>
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <p className="text-sm font-medium" style={{ color: accentColor }}>Written response already submitted for this question.</p>
      </div>
    );
  }

  if (!result) {
    if (atLimit) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${border}` }}>
          <PenLine className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: text }}>Review limit reached</p>
            <p className="text-xs mt-0.5" style={{ color: muted }}>You have used all {maxReviews} allowed review attempts for this question.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <AiReviewWorkspaceHeader
          icon={<PenLine className="w-5 h-5" />}
          title="Write your response"
          description={limit > 0
            ? `Answer in your own words, in ${limit} words or fewer. You get structured feedback against the rubric.`
            : 'Answer in your own words. You get structured feedback against the rubric.'}
          accentColor={accentColor}
          isDark={isDark}
          reviewsUsed={reviewsUsed}
          maxReviews={maxReviews}
          analyzing={analyzing}
        />
        <AiReviewDisclaimer isDark={isDark} />

        <textarea
          id={`written-response-${reqId}`}
          value={answer}
          maxLength={MAX_ANSWER_CHARS}
          onChange={e => { setAnswer(e.target.value); if (error) setError(''); }}
          placeholder="Type your response here..."
          className="w-full min-h-[220px] resize-y rounded-2xl px-4 py-3.5 text-sm leading-relaxed outline-none"
          style={{ background: inner, color: text, border: `1px solid ${overBy > 0 ? '#ef4444' : border}`, fontFamily: 'inherit' }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs tabular-nums" style={{ color: overBy > 0 ? '#ef4444' : muted }}>
            {words} word{words === 1 ? '' : 's'}
            {limit > 0 && ` of ${limit} maximum`}
            {answer.length > MAX_ANSWER_CHARS - 500 && ` | ${MAX_ANSWER_CHARS - answer.length} characters left`}
          </p>
          {limit > 0 && (
            overBy > 0
              ? <p className="text-xs font-semibold" style={{ color: '#ef4444' }}>{overBy} word{overBy === 1 ? '' : 's'} over the limit</p>
              : <p className="text-xs font-medium" style={{ color: muted }}>{limit - words} word{limit - words === 1 ? '' : 's'} left</p>
          )}
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <button onClick={handleSubmit} disabled={analyzing || !canSubmit}
          className="flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-45"
          style={{ background: accentColor, color: '#fff', borderRadius: 12 }}>
          {analyzing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Reviewing...</>
            : <><Zap className="w-4 h-4" /> Submit for AI Review</>}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      <AiReviewDisclaimer isDark={isDark} />
      {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
        <p style={{ fontSize: 11, fontWeight: 600, color: muted }}>Attempt {reviewsUsed} of {maxReviews}</p>
      )}

      {answer.trim() && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${border}` }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: muted }}>Your answer</p>
          </div>
          <p style={{ padding: '14px 20px', fontSize: 13, lineHeight: 1.7, color: text, whiteSpace: 'pre-wrap' }}>{answer}</p>
        </div>
      )}

      <AiStructuredReviewReport
        reportLabel="AI written response review"
        title="Your written response review"
        metadata={`Submitted answer${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
        score={result.overallScore}
        summary={result.executiveSummary}
        findings={(result.sections ?? []).map(section => ({
          location: section.name,
          severity: section.severity === 'critical' ? 'error' : section.severity === 'improvement' ? 'warning' : 'suggestion',
          title: section.title,
          detail: section.detail,
          fix: section.recommendation,
        }))}
        findingsTitle="Findings in your answer"
        locationLabel="Part"
        severityLabels={{ error: 'Critical', warning: 'Improvement', suggestion: 'Suggestion' }}
        metricLabels={{ risks: 'Needs attention' }}
        categories={result.categories ?? []}
        recommendations={result.topRecommendations ?? []}
        rubricGrades={result.rubricGrades}
        accentColor={accentColor}
        isDark={isDark}
        actions={<>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: card, color: text }}><Download className="w-3.5 h-3.5" /> Export</button>
          {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: `${accentColor}18`, color: accentColor }}><RotateCcw className="w-3.5 h-3.5" /> Try again</button>}
        </>}
      />

      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

      {minScore && result.overallScore < minScore ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Minimum score not reached &middot; {result.overallScore.toFixed(1)}/100 &middot; Required: {minScore}/100
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the feedback above, revise your answer, and submit another review.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            Review complete &middot; {(result.sections ?? []).length} note{(result.sections ?? []).length !== 1 ? 's' : ''} on your answer
          </p>
        </div>
      )}
    </div>
  );
}
