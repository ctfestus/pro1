'use client';

import React, { useRef, useState } from 'react';
import { ArrowCounterClockwise, CheckCircle, DownloadSimple, FileXls, Lightning, Warning } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase';
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
import { reviewGate, reviewPassed } from '@/lib/review-gate';
import type { RubricGrade } from '@/lib/review-gate';
import type { ExcelReviewTarget } from '@/lib/excel-review-config';

interface SheetIssue {
  cell: string;
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
  issues: SheetIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
  rubricScore?: number | null;
  rubricCriteriaCount?: number;
  rubricUngraded?: number;
  reviewedSheetNames?: string[];
  partiallyReviewedSheetNames?: string[];
  extractionTruncated?: boolean;
  passed?: boolean;
  minScore?: number;
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
  reviewSheetNames?: string[];
  reviewTarget?: ExcelReviewTarget;
  rubric?: string[];
  minScore?: number;
  maxReviews?: number;
  showAttemptCount?: boolean;
  onReviewStart?: () => void;
  onReviewError?: () => void;
  onComplete: (result: ReviewResult, passed: boolean) => void;
}


export default function ExcelReviewPlayer({ reqId, isDark, accentColor, hideWorkspaceHeader, completed, savedResult, reviewsUsed = 0, context, reviewSheetNames, reviewTarget, rubric, minScore, maxReviews, showAttemptCount, onReviewStart, onReviewError, onComplete }: Props) {
  const atLimit = maxReviews !== undefined && reviewsUsed >= maxReviews;
  const shouldLock = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget (direct/VE assignments) -- hide it so the student can't clear
  // the saved report into an empty locked state.
  const showReset = !atLimit && !(completed && maxReviews === undefined);
  const [file, setFile]         = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // Show the saved report on mount whenever one exists. When retries remain, the result view's
  // Reset button (rendered while !atLimit) lets the student start another attempt.
  const [result, setResult]     = useState<ReviewResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]       = useState('');
  const [upgradeUrl, setUpgradeUrl] = useState('');
  const entitlement = useAiReviewEntitlement('excelReview');
  const inputRef  = useRef<HTMLInputElement>(null);

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
    if (ext !== 'xlsx') {
      setError('Only .xlsx files are supported.');
      return;
    }
    setFile(f);
    setError('');
  }

  async function handleSubmit() {
    if (!file) { setError('Please upload your Excel file first.'); return; }
    if (!reviewTarget) { setError('Save this activity before running its Excel review.'); return; }
    setError('');
    setUpgradeUrl('');
    setAnalyzing(true);
    onReviewStart?.();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('reviewTarget', JSON.stringify(reviewTarget));

      const res = await fetch('/api/excel-review', {
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
      // The route decides the gate from the config it loaded; the local fallback only covers a
      // response from before it sent one.
      const passed = typeof json.passed === 'boolean'
        ? json.passed
        : reviewPassed(json, minScore, json.rubricCriteriaCount ?? rubric?.length ?? 0);
      onComplete(json, passed);
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
      onReviewError?.();
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() { setFile(null); setResult(null); setError(''); setUpgradeUrl(''); }

  async function downloadPdf() {
    try {
      if (!result) return;
      await downloadStructuredReviewPdf({
        ...result,
        reportLabel: 'WORKBOOK REVIEW',
        reportTitle: 'Your workbook review',
        reportKicker: 'EXCEL REVIEW',
        sourceLabel: 'Excel workbook',
        findingsTitle: 'Findings in your workbook',
        locationLabel: 'CELL',
        issues: result.issues.map(issue => ({ ...issue, lines: issue.cell })),
      }, `excel-review-${Date.now()}.pdf`, accentColor);
    } catch (err: any) {
      setError(err?.message ?? 'PDF export failed. Please try again.');
    }
  }

  // Already completed but the saved report isn't available (e.g. older data) -- show locked state
  if (!result && completed && shouldLock) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}25` }}>
        <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <p className="text-sm font-medium" style={{ color: accentColor }}>
          Excel review already submitted for this question.
        </p>
      </div>
    );
  }

  if (!result) {
    if (atLimit) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${border}` }}>
          <FileXls weight="duotone" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: text }}>Review limit reached</p>
            <p className="text-xs mt-0.5" style={{ color: muted }}>You have used all {maxReviews} allowed review attempts for this question.</p>
          </div>
        </div>
      );
    }
    // Locked before the work rather than after the upload. The workspace stays visible behind the
    // card so they can see what the plan buys; the server gate is still what enforces it.
    return (
      <AiReviewLockOverlay
        locked={entitlement.locked}
        accentColor={accentColor}
        isDark={isDark}
        planName={entitlement.planName}
        upgradeUrl={entitlement.upgradeUrl}
        priceLabel={entitlement.priceLabel}
        message="Excel reviews are part of a paid plan. Upgrade to submit your workbook and get feedback."
      >
      <div className="space-y-3">
        {!hideWorkspaceHeader && (<>
          <AiReviewWorkspaceHeader icon={<FileXls weight="duotone" className="w-5 h-5" />} title="Review your workbook" description="Upload the completed Excel workbook for an evidence-based review against the assignment rubric." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing={analyzing} />
        </>)}
        {reviewSheetNames && reviewSheetNames.length > 0 && (
          <div className="px-4 py-3" style={{ background: isDark ? 'rgba(255,255,255,0.045)' : '#f8fafc', borderLeft: `3px solid ${accentColor}` }}>
            <p className="text-xs font-semibold" style={{ color: text }}>Required worksheets</p>
            <p className="text-xs mt-1" style={{ color: muted }}>{reviewSheetNames.join(', ')}</p>
          </div>
        )}
        <AiReviewDropzone isDark={isDark} accentColor={accentColor} icon={<FileXls weight="duotone" className="w-5 h-5" />}
          title="Drop your Excel file here" hint="Excel workbook (.xlsx)" fileName={file?.name}
          dragging={dragging} onDragChange={setDragging} onDropFile={onDrop} onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
        </AiReviewDropzone>

        {upgradeUrl && <AiReviewUpgradePrompt accentColor={accentColor} isDark={isDark} planName={entitlement.planName} priceLabel={entitlement.priceLabel} canUpgrade={entitlement.canUpgrade} message={error} upgradeUrl={upgradeUrl} />}
        {error && !upgradeUrl && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <AiReviewSubmitButton isDark={isDark} accentColor={accentColor} disabled={!file} busy={analyzing} onClick={handleSubmit}>
          <Lightning weight="duotone" className="w-4 h-4" /> Submit for AI review
        </AiReviewSubmitButton>
      </div>
      </AiReviewLockOverlay>
    );
  }


  // Where the instructor set criteria, the share of them met is both the score and the gate.
  // Criteria count, not grade count: a criterion the AI skipped still counts against the pass
  // mark, so the denominator has to be what the instructor set. `rubricCriteriaCount` comes back
  // with the review; the `rubric` prop covers a report saved before the route sent it.
  const criteriaCount = result.rubricCriteriaCount ?? rubric?.length ?? 0;
  const gate = reviewGate(result, criteriaCount);
  const effectiveMinScore = result.minScore ?? minScore;
  const rubricTotal = Math.max(criteriaCount, result.rubricGrades?.length ?? 0);
  const rubricPassedCount = result.rubricGrades?.filter(g => g.passed).length ?? 0;
  // The AI occasionally skips a criterion or grades another twice despite being told not to, and
  // the route retries once when it does. Where it persists, those criteria come back as explicit
  // failures and the count below says so, rather than a pass mark that quietly dropped them.
  const ungradedCriteria = gate.fromRubric
    ? result.rubricUngraded ?? Math.max(0, criteriaCount - (result.rubricGrades?.length ?? 0))
    : 0;
  const gradedCount = rubricTotal - ungradedCriteria;

  // The review still decides a pass or fail; it says so when part of the workbook was too large to
  // read, so a student can see which sheets the verdict was based on.
  const truncationNotice = result.extractionTruncated ? (
      <div className="flex items-start gap-3 px-4 py-3" style={{ background: isDark ? 'rgba(245,158,11,0.10)' : '#fffbeb', borderLeft: '3px solid #f59e0b' }}>
        <Warning weight="duotone" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: text }}>Part of your workbook was too large to read</p>
          <p className="text-xs mt-1" style={{ color: muted }}>
            This result is based only on the parts that could be read.
            {result.partiallyReviewedSheetNames?.length ? ` Read in part: ${result.partiallyReviewedSheetNames.join(', ')}.` : ''}
          </p>
        </div>
      </div>
  ) : null;

  if (isRubricReport(result)) {
    return (
      <div className="space-y-4">
        {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
        <RubricReviewReport
          reportLabel="Workbook review"
          metadata={`Excel workbook${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
          workNoun="workbook"
          summary={result.executiveSummary}
          grades={result.rubricGrades ?? []}
          legacyFindings={result.issues.map(issue => ({ title: issue.title, location: issue.cell, fix: issue.fix }))}
          score={gate.score}
          minScore={effectiveMinScore}
          attemptsLeft={showAttemptCount && maxReviews !== undefined ? Math.max(0, maxReviews - reviewsUsed) : null}
          isDark={isDark}
          accentColor={accentColor}
          onExport={downloadPdf}
          onRetry={showReset ? reset : undefined}>
          {truncationNotice}
        </RubricReviewReport>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
      {truncationNotice}

      <AiStructuredReviewReport
        reportLabel="Workbook review"
        title="Your workbook review"
        metadata={`Excel workbook${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
        score={result.overallScore}
        summary={result.executiveSummary}
        findings={result.issues.map(issue => ({ location: issue.cell, severity: issue.severity, title: issue.title, detail: issue.detail, fix: issue.fix }))}
        findingsTitle="Findings in your workbook"
        locationLabel="Cell"
        severityLabels={{ error: 'Error', warning: 'Warning', suggestion: 'Idea' }}
        categories={result.categories}
        recommendations={result.topRecommendations}
        rubricGrades={result.rubricGrades}
        accentColor={accentColor}
        isDark={isDark}
        passed={effectiveMinScore ? gate.score >= effectiveMinScore : undefined}
        actions={<>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: card, color: text }}><DownloadSimple weight="bold" className="w-3.5 h-3.5" /> Export</button>
          {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: `${accentColor}18`, color: accentColor }}><ArrowCounterClockwise weight="bold" className="w-3.5 h-3.5" /> Try again</button>}
        </>}
      />


      {/* Completion / gate */}
      {effectiveMinScore && gate.score < effectiveMinScore ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <Warning weight="duotone" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              {gate.fromRubric
                ? `Rubric not met | ${rubricPassedCount} of ${rubricTotal} criteria passed (${gate.score.toFixed(1)}/100) | Required: ${effectiveMinScore}/100`
                : `Minimum score not reached | ${gate.score.toFixed(1)}/100 | Required: ${effectiveMinScore}/100`}
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the improvement path above, update your workbook, and submit another review.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            {gate.fromRubric
              ? `Review complete | ${rubricPassedCount} of ${rubricTotal} criteria passed | ${result.issues.length} finding${result.issues.length !== 1 ? 's' : ''} identified`
              : `Review complete | ${result.issues.length} finding${result.issues.length !== 1 ? 's' : ''} identified`}
          </p>
        </div>
      )}
      {ungradedCriteria > 0 && (
        <p style={{ fontSize: 11, color: muted }}>
          The AI graded {gradedCount} of {criteriaCount} rubric criteria. Criteria it did not grade count as not met.
        </p>
      )}
    </div>
  );
}
