'use client';

import React, { useRef, useState } from 'react';
import { CheckCircle2, Zap, RotateCcw, FileText, Download, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reviewGate, reviewPassed } from '@/lib/review-gate';
import type { ReviewTarget } from '@/lib/review-target';
import type { RubricGrade } from '@/lib/review-gate';
import { downloadStructuredReviewPdf } from '@/lib/downloadReviewPdf';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import { AiReviewDropzone, AiReviewSubmitButton } from '@/components/AiReviewUpload';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';
import AiStructuredReviewReport from '@/components/AiStructuredReviewReport';
import RubricReviewReport, { isRubricReport } from '@/components/RubricReviewReport';
import AiReviewUpgradePrompt from '@/components/AiReviewUpgradePrompt';
import AiReviewLockOverlay from '@/components/AiReviewLockOverlay';
import { useAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

interface SectionIssue {
  name: string;
  severity: 'critical' | 'improvement' | 'suggestion';
  title: string;
  detail: string;
  recommendation: string;
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
  minScore?: number;
  rubricScore?: number | null;
  executiveSummary: string;
  sections: SectionIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
  warning?: string;
}

interface Props {
  /** Leave out the workspace header and its disclaimer: the host card already shows both. */
  hideWorkspaceHeader?: boolean;
  reqId: string;
  isDark: boolean;
  accentColor: string;
  completed: boolean;
  savedResult?: ReviewResult;
  reviewsUsed?: number;
  context?: string;
  rubric?: string[];
  minScore?: number;
  // The saved step being reviewed. The server grades on its rubric and pass mark, not on the props.
  reviewTarget?: ReviewTarget;
  maxReviews?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  showAttemptCount?: boolean;
  onComplete: (result: ReviewResult, passed: boolean) => void;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;


export default function DocumentReviewPlayer({
  reqId, isDark, accentColor, hideWorkspaceHeader, completed, savedResult, reviewsUsed = 0,
  context, rubric, minScore, reviewTarget, maxReviews, documentReviewMode = 'ai_only', showAttemptCount, onComplete,
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
  const [upgradeUrl, setUpgradeUrl] = useState('');
  const entitlement = useAiReviewEntitlement('documentReview');
  const inputRef   = useRef<HTMLInputElement>(null);

  const card   = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text   = isDark ? '#f0f0f0' : '#111';
  const muted  = isDark ? '#888' : '#666';

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
    if (f.size > MAX_DOCUMENT_BYTES) {
      setFile(null);
      setError('File too large. Maximum size is 10 MB.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFile(f);
    setError('');
  }

  async function handleSubmit() {
    if (!file) { setError('Please upload your document first.'); return; }
    setError('');
    setUpgradeUrl('');
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
      if (reviewTarget) fd.append('reviewTarget', JSON.stringify(reviewTarget));

      const res = await fetch('/api/document-review', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: fd,
      });
      const json = await res.json();
      if (res.status === 402 || json.code === 'paid_plan_required') {
        setUpgradeUrl(String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL));
        throw new Error(json.error || 'This AI reviewer requires an active paid plan.');
      }
      if (json.error) throw new Error(json.error);
      setResult(json);

      const passed = reviewPassed(json, json.minScore ?? minScore, rubric?.length);
      onComplete(json, passed);
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setFile(null); setResult(null); setError(''); setUpgradeUrl(''); }

  async function downloadPdf() {
    try {
      if (!result) return;
      await downloadStructuredReviewPdf({
        overallScore: result.overallScore,
        executiveSummary: [result.warning, result.executiveSummary].filter(Boolean).join('\n\n'),
        reportLabel: 'DOCUMENT REVIEW',
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
      <AiReviewLockOverlay
        // Manual mode is excluded on purpose: that path sends the document to an instructor and
        // never calls the AI route, so a paid plan has nothing to do with it.
        locked={!isManual && entitlement.locked}
        accentColor={accentColor}
        isDark={isDark}
        planName={entitlement.planName}
        upgradeUrl={entitlement.upgradeUrl}
        priceLabel={entitlement.priceLabel}
        message="Document reviews are part of a paid plan. Upgrade to submit your report and get feedback."
      >
      <div className="space-y-3">
        {!hideWorkspaceHeader && (<>
          <AiReviewWorkspaceHeader icon={<FileText className="w-5 h-5" />} title={isManual ? 'Submit your document' : 'Review your document'} description={isManual ? 'Upload the finished document for instructor review.' : 'Upload your report for structured feedback against the assignment rubric.'} accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing={analyzing} />
        </>)}
        <AiReviewDropzone isDark={isDark} accentColor={accentColor} icon={<FileText className="w-5 h-5" />}
          title="Drop your document here" hint="PDF, DOCX, DOC or TXT" fileName={file?.name}
          dragging={dragging} onDragChange={setDragging} onDropFile={onDrop} onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
        </AiReviewDropzone>

        {upgradeUrl && <AiReviewUpgradePrompt accentColor={accentColor} isDark={isDark} planName={entitlement.planName} priceLabel={entitlement.priceLabel} canUpgrade={entitlement.canUpgrade} message={error} upgradeUrl={upgradeUrl} />}
        {error && !upgradeUrl && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <AiReviewSubmitButton isDark={isDark} accentColor={accentColor} disabled={!file} busy={analyzing} busyLabel={isManual ? 'Submitting...' : 'Reviewing...'} onClick={handleSubmit}>
          {isManual
            ? <><FileText className="w-4 h-4" /> Submit for instructor review</>
            : <><Zap className="w-4 h-4" /> {isHybrid ? 'Submit for AI and instructor review' : 'Submit for AI review'}</>}
        </AiReviewSubmitButton>
      </div>
      </AiReviewLockOverlay>
    );
  }


  // The pass mark the server graded with; the prop covers a report saved before it was returned.
  const passMark = result.minScore ?? minScore;
  const warningNotice = result?.warning ? (
    <div role="alert" className="flex items-start gap-2 rounded-lg p-3" style={{ background: card, color: text }}>
      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm">{result.warning}</p>
    </div>
  ) : null;

  if (isRubricReport(result)) {
    return (
      <div className="space-y-4">
        {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
        <RubricReviewReport
          reportLabel="Document review"
          metadata={`Submitted document${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
          workNoun="document"
          summary={result.executiveSummary}
          grades={result.rubricGrades ?? []}
          legacyFindings={result.sections.map(section => ({ title: section.title, location: section.name, fix: section.recommendation }))}
          score={reviewGate(result, rubric?.length).score}
          minScore={passMark}
          attemptsLeft={showAttemptCount && maxReviews !== undefined ? Math.max(0, maxReviews - reviewsUsed) : null}
          isDark={isDark}
          accentColor={accentColor}
          onExport={downloadPdf}
          onRetry={showReset ? reset : undefined}>
          {warningNotice}
        </RubricReviewReport>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
      {warningNotice}

      <AiStructuredReviewReport
        reportLabel="Document review"
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
        passed={passMark ? reviewPassed(result, passMark, rubric?.length) : undefined}
        actions={<>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: card, color: text }}><Download className="w-3.5 h-3.5" /> Export</button>
          {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: `${accentColor}18`, color: accentColor }}><RotateCcw className="w-3.5 h-3.5" /> Try again</button>}
        </>}
      />


      {/* Pass/fail gate */}
      {passMark && !reviewPassed(result, passMark, rubric?.length) ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Minimum score not reached | {reviewGate(result, rubric?.length).score.toFixed(1)}/100 | Required: {passMark}/100
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the improvement path above, revise your document, and submit another review.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            Review complete | {result.sections.length} section note{result.sections.length !== 1 ? 's' : ''} identified
          </p>
        </div>
      )}
    </div>
  );
}
