'use client';

import React, { useState, useRef, useContext } from 'react';
import { ArrowCounterClockwise, CheckCircle, Code, DownloadSimple, FileCode, Lightning, Lock, UploadSimple, Warning } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase';
import { reviewGate, reviewPassed } from '@/lib/review-gate';
import type { ReviewTarget } from '@/lib/review-target';
import AiStructuredReviewReport, { ReviewInMailContext } from '@/components/AiStructuredReviewReport';
import RubricReviewReport, { isRubricReport } from '@/components/RubricReviewReport';
import type { RubricGrade } from '@/lib/review-gate';
import { downloadCodeReviewPdf } from '@/lib/downloadReviewPdf';
import { CODE_FILE_EXTENSIONS } from '@/lib/rubric-criteria';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import { AiReviewSubmitButton } from '@/components/AiReviewUpload';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';
import AiReviewUpgradePrompt from '@/components/AiReviewUpgradePrompt';
import AiReviewLockOverlay from '@/components/AiReviewLockOverlay';
import { useAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';
import { CODE_REVIEW_LANGUAGES } from '@/lib/code-review-languages';

const LANGUAGES: readonly string[] = CODE_REVIEW_LANGUAGES;
const SQL_DIALECTS = ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server'];

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
  minScore?: number;
  rubricScore?: number | null;
  executiveSummary: string;
  issues: LineIssue[];
  categories: CategoryScore[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
  language?: string;
  dialect?: string;
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
  rubric?: string[];
  schema?: string;
  minScore?: number;
  // The saved step being reviewed. The server grades on its rubric and pass mark, not on the props.
  reviewTarget?: ReviewTarget;
  reviewLanguage?: string;
  maxReviews?: number;
  showAttemptCount?: boolean;
  onReviewStart?: () => void;
  onReviewError?: () => void;
  onComplete: (result: ReviewResult, passed: boolean) => void;
}


export default function CodeReviewPlayer({ reqId, isDark, accentColor, hideWorkspaceHeader, completed, savedResult, reviewsUsed = 0, rubric, schema, minScore, reviewTarget, reviewLanguage, maxReviews, showAttemptCount, onReviewStart, onReviewError, onComplete }: Props) {
  // Inside a virtual experience email the email says the review is done, so the closing line is left out.
  const inMail = useContext(ReviewInMailContext) !== null;
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
  // A task that comes with a database schema is a SQL task, so start on SQL rather than Python.
  const [language, setLanguage] = useState(lockedLanguage ?? (schema?.trim() ? 'SQL' : 'Python'));
  const [dialect, setDialect]   = useState('PostgreSQL');
  // Show the saved report on mount whenever one exists. When retries remain, the result view's
  // Reset button (rendered while !atLimit) lets the student start another attempt.
  const [result, setResult]     = useState<ReviewResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]       = useState('');
  const [upgradeUrl, setUpgradeUrl] = useState('');
  const entitlement = useAiReviewEntitlement('codeReview');
  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const card   = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text   = isDark ? '#f0f0f0' : '#111';
  const muted  = isDark ? '#888' : '#666';
  const input  = isDark ? '#111' : '#f9fafb';
  const inner  = isDark ? '#222' : '#f3f4f6';

  async function handleSubmit() {
    if (!code.trim()) { setError(inputMode === 'upload' ? 'Please upload a file before submitting.' : 'Please paste your code before submitting.'); return; }
    setError('');
    setUpgradeUrl('');
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
          ...(reviewTarget ? { reviewTarget } : {}),
        }),
      });
      const json = await res.json();
      if (res.status === 402 || json.code === 'paid_plan_required') {
        setUpgradeUrl(String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL));
        throw new Error(json.error || 'This AI reviewer requires an active paid plan.');
      }
      if (json.error) throw new Error(json.error);
      const enriched: ReviewResult = { ...json, language, ...(language === 'SQL' ? { dialect } : {}) };
      setResult(enriched);
      const passed = reviewPassed(enriched, enriched.minScore ?? minScore, rubric?.length);
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
    setUpgradeUrl('');
    setUploadedFileName('');
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
        <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
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
          <Lock weight="duotone" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: text }}>Review limit reached</p>
            <p className="text-xs mt-0.5" style={{ color: muted }}>You have used all {maxReviews} allowed review attempts for this question.</p>
          </div>
        </div>
      );
    }
    // Locked before the work rather than after the submission. The workspace stays visible behind
    // the card so they can see what the plan buys; the server gate is still what enforces it.
    return (
      <AiReviewLockOverlay
        locked={entitlement.locked}
        accentColor={accentColor}
        isDark={isDark}
        planName={entitlement.planName}
        upgradeUrl={entitlement.upgradeUrl}
        priceLabel={entitlement.priceLabel}
        message="Code reviews are part of a paid plan. Upgrade to submit your code and get line-level feedback."
      >
      <div className="space-y-3">
        {!hideWorkspaceHeader && (<>
          <AiReviewWorkspaceHeader icon={<FileCode weight="duotone" className="w-5 h-5" />} title="Review your code" description="Paste code or upload a source file to receive structured, rubric-aware feedback." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing={analyzing} />
        </>)}
        {/* Language selector -- locked when instructor specified a language */}
        {lockedLanguage ? (
          // The instructor fixed the language: show it, with nothing to switch and nothing to explain.
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" title="Language for this task"
              style={{ background: accentColor, color: '#fff' }}>
              {lockedLanguage}
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
        <div className="focus-frame" style={{ border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`, borderRadius: 16, overflow: 'hidden', background: isDark ? '#111' : '#fff', boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)', ['--focus-frame' as string]: accentColor, ['--focus-frame-ring' as string]: `${accentColor}29` }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: inner, borderColor: border }}>
            <div className="flex items-center gap-2">
              <Code weight="bold" className="w-3.5 h-3.5" style={{ color: muted }} />
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
                  {mode === 'paste' ? <><Code weight="bold" className="w-3 h-3" />Paste</> : <><UploadSimple weight="bold" className="w-3 h-3" />Upload</>}
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
                accept={[...CODE_FILE_EXTENSIONS, '.txt'].join(',')} />
              {uploadedFileName ? (
                <>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${accentColor}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileCode weight="duotone" className="w-5 h-5" style={{ color: accentColor }} />
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
                    <UploadSimple weight="bold" className="w-5 h-5" style={{ color: muted }} />
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

        {upgradeUrl && <AiReviewUpgradePrompt accentColor={accentColor} isDark={isDark} planName={entitlement.planName} priceLabel={entitlement.priceLabel} canUpgrade={entitlement.canUpgrade} message={error} upgradeUrl={upgradeUrl} />}
        {error && !upgradeUrl && <p className="text-xs text-red-400 font-medium">{error}</p>}

        <AiReviewSubmitButton isDark={isDark} accentColor={accentColor} disabled={!code.trim()} busy={analyzing} onClick={handleSubmit}>
          <Lightning weight="duotone" className="w-4 h-4" /> Submit for AI review
        </AiReviewSubmitButton>
      </div>
      </AiReviewLockOverlay>
    );
  }

  // Result state
  // The pass mark the server graded with; the prop covers a report saved before it was returned.
  const passMark = result.minScore ?? minScore;
  const metadata = `${result.language ?? language}${result.language === 'SQL' && result.dialect ? ` | ${result.dialect}` : ''}${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`;

  if (isRubricReport(result)) {
    return (
      <div className="space-y-4">
        {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
        <RubricReviewReport
          reportLabel="Code review"
          metadata={metadata}
          workNoun="code"
          summary={result.executiveSummary}
          grades={result.rubricGrades ?? []}
          legacyFindings={result.issues.map(issue => ({ title: issue.title, location: issue.lines, fix: issue.fix }))}
          score={reviewGate(result, rubric?.length).score}
          minScore={passMark}
          attemptsLeft={showAttemptCount && maxReviews !== undefined ? Math.max(0, maxReviews - reviewsUsed) : null}
          isDark={isDark}
          accentColor={accentColor}
          onExport={downloadPdf}
          onRetry={showReset ? reset : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
      <AiStructuredReviewReport
        reportLabel="Code review"
        title="Your code review"
        metadata={metadata}
        score={result.overallScore}
        summary={result.executiveSummary}
        findings={result.issues.map(issue => ({ location: issue.lines, severity: issue.severity, title: issue.title, detail: issue.detail, fix: issue.fix }))}
        findingsTitle="Findings in your code"
        locationLabel="Line"
        severityLabels={{ error: 'Error', warning: 'Warning', suggestion: 'Suggestion' }}
        categories={result.categories}
        recommendations={result.topRecommendations}
        rubricGrades={result.rubricGrades}
        accentColor={accentColor}
        isDark={isDark}
        passed={passMark ? reviewPassed(result, passMark, rubric?.length) : undefined}
        actions={<>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: card, color: text }}><DownloadSimple weight="bold" className="h-3.5 w-3.5" /> Export</button>
          {showReset && <button onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: `${accentColor}18`, color: accentColor }}><ArrowCounterClockwise weight="bold" className="h-3.5 w-3.5" /> Try again</button>}
        </>}
      />

      {/* Completion / gate */}
      {passMark && !reviewPassed(result, passMark, rubric?.length) ? (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <Warning weight="duotone" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Minimum score not reached | {reviewGate(result, rubric?.length).score.toFixed(1)}/100 | Required: {passMark}/100
            </p>
            <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>Use the improvement path above, revise your code, and submit another review.</p>
          </div>
        </div>
      ) : inMail ? null : (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3.5" style={{ background: `${accentColor}10` }}>
          <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
            Review complete | {result.issues.length} finding{result.issues.length !== 1 ? 's' : ''} identified
          </p>
        </div>
      )}
    </div>
  );
}
