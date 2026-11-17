'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, UploadIcon, Eye, EyeOff, RotateCcw, CheckCircle2, Zap, Download, Lightbulb } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reviewGate, reviewPassed } from '@/lib/review-gate';
import type { RubricGrade } from '@/lib/review-gate';
import { downloadStructuredReviewPdf } from '@/lib/downloadReviewPdf';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import { AiReviewDropzone, AiReviewSubmitButton } from '@/components/AiReviewUpload';
import AiStructuredReviewReport from '@/components/AiStructuredReviewReport';
import RubricReviewReport, { isRubricReport } from '@/components/RubricReviewReport';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';
import AiReviewUpgradePrompt from '@/components/AiReviewUpgradePrompt';
import AiReviewLockOverlay from '@/components/AiReviewLockOverlay';
import { useAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

interface Bounds { x: number; y: number; w: number; h: number; }
interface CritiqueElement {
  id: string;
  label: string;
  elementType: string;
  bounds: Bounds;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}
interface AuditCategory {
  name: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}
interface Audit {
  overallScore: number;
  rubricScore?: number | null;
  executiveSummary: string;
  categories: AuditCategory[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
}
interface CritiqueResult { elements: CritiqueElement[]; audit?: Audit; }

interface Props {
  /** Leave out the workspace header and its disclaimer: the host card already shows both. */
  hideWorkspaceHeader?: boolean;
  reqId: string;
  isDark: boolean;
  accentColor: string;
  completed: boolean;
  savedResult?: CritiqueResult;
  savedImageUrl?: string;
  rubric?: string[];
  minScore?: number;
  reviewsUsed?: number;
  maxReviews?: number;
  showAttemptCount?: boolean;
  onReviewStart?: () => void;
  onReviewError?: () => void;
  onComplete: (result: CritiqueResult, imageDataUrl: string, passed: boolean) => void;
}

const MAX_DASHBOARD_LONG_EDGE = 1600;

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image.'));
    image.src = dataUrl;
  });
}

async function prepareDashboardImage(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (longEdge <= MAX_DASHBOARD_LONG_EDGE) {
    return { dataUrl: originalDataUrl, mimeType: file.type };
  }

  const scale = MAX_DASHBOARD_LONG_EDGE / longEdge;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not resize the image.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // Keep dashboard text lossless after resizing so labels and legends remain readable.
  return { dataUrl: canvas.toDataURL('image/png'), mimeType: 'image/png' };
}

const TYPE_COLORS: Record<string, string> = {
  HEADER:         '#f59e0b',
  KPI_CARD:       '#3b82f6',
  BAR_CHART:      '#8b5cf6',
  LINE_CHART:     '#06b6d4',
  PIE_CHART:      '#ec4899',
  STACKED_CHART:  '#a855f7',
  SCATTER_CHART:  '#14b8a6',
  TABLE:          '#10b981',
  FILTER:         '#f97316',
  LEGEND:         '#6366f1',
  SECTION_TITLE:  '#f59e0b',
  TITLE:          '#f59e0b',
  NAVIGATION:     '#64748b',
  ANNOTATION:     '#ef4444',
  OTHER:          '#94a3b8',
};

export default function DashboardCritiquePlayer({ reqId, isDark, accentColor, hideWorkspaceHeader, completed, savedResult, savedImageUrl, rubric, minScore, reviewsUsed = 0, maxReviews, showAttemptCount, onReviewStart, onReviewError, onComplete }: Props) {
  const atLimit = maxReviews !== undefined && reviewsUsed >= maxReviews;
  const shouldLock = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget (direct/VE assignments) -- hide it so the student can't clear
  // the saved report into an empty locked state.
  const showReset = !atLimit && !(completed && maxReviews === undefined);
  const [imageDataUrl, setImageDataUrl] = useState<string>(savedImageUrl ?? '');
  const [result, setResult]             = useState<CritiqueResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing]       = useState(false);
  // The screenshot chosen but not yet sent for review.
  const [pendingFile, setPendingFile]   = useState<File | null>(null);
  const [error, setError]               = useState('');
  const [upgradeUrl, setUpgradeUrl]     = useState('');
  const entitlement                     = useAiReviewEntitlement('dashboardReview');
  const [hoveredId, setHoveredId]       = useState<string | null>(null);
  const [mousePos, setMousePos]         = useState({ x: 0, y: 0 });
  const [zonesVisible, setZonesVisible] = useState(true);
  const [dragging, setDragging]         = useState(false);
  const inputRef   = useRef<HTMLInputElement>(null);
  const imgRef     = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file (PNG or JPG).'); return; }
    setError('');
    setUpgradeUrl('');
    setResult(null);
    setAnalyzing(true);
    onReviewStart?.();

    try {
      const { dataUrl, mimeType } = await prepareDashboardImage(file);
      setImageDataUrl(dataUrl);

      // Strip the data:image/...;base64, prefix
      const base64 = dataUrl.split(',')[1];
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/dashboard-critique', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ imageBase64: base64, mimeType, ...(rubric?.length ? { rubric } : {}) }),
      });
      const json = await res.json();
      if (res.status === 402 || json.code === 'paid_plan_required') {
        // The screenshot stays. Clearing it threw away work the learner would have to redo after
        // upgrading, and dropped the component back into the empty-dropzone branch.
        setUpgradeUrl(String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL));
        throw new Error(json.error || 'This AI reviewer requires an active paid plan.');
      }
      if (json.error) throw new Error(json.error);
      setResult(json);
      const passed = reviewPassed(json.audit ?? { overallScore: 0 }, minScore, rubric?.length);
      onComplete(json, dataUrl, passed);
    } catch (err: any) {
      setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
      onReviewError?.();
    } finally {
      setAnalyzing(false);
    }
  }, [onComplete, onReviewStart, onReviewError, rubric, minScore]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setPendingFile(file);
  }, []);

  const reset = () => {
    setImageDataUrl('');
    setPendingFile(null);
    setResult(null);
    setError('');
    setUpgradeUrl('');
    setHoveredId(null);
  };

  async function downloadPdf() {
    try {
      if (!result) return;
      const audit = result.audit;
      const elements = result.elements ?? [];
      await downloadStructuredReviewPdf({
        overallScore: audit?.overallScore ?? 100,
        executiveSummary: audit?.executiveSummary ?? `${elements.length} dashboard elements were analysed.`,
        reportLabel: 'DASHBOARD REVIEW',
        reportTitle: 'Your dashboard review',
        reportKicker: 'DASHBOARD REVIEW',
        sourceLabel: 'Dashboard screenshot',
        findingsTitle: 'Element-level findings',
        locationLabel: 'ELEMENT',
        severityLabels: { warning: 'Needs attention', suggestion: 'Opportunity' },
        metricLabels: { errors: 'Critical', warnings: 'Risks' },
        issues: elements.map(element => ({
          lines: `${element.elementType} / ${element.label}`,
          severity: element.weaknesses.length > 0 ? 'warning' : 'suggestion',
          title: element.label,
          detail: element.weaknesses.length > 0 ? element.weaknesses.join(' ') : element.strengths.join(' '),
          fix: element.recommendation,
        })),
        categories: audit?.categories ?? [],
        topRecommendations: audit?.topRecommendations ?? elements.map(element => element.recommendation).filter(Boolean),
        rubricGrades: audit?.rubricGrades,
      }, `dashboard-critique-${Date.now()}.pdf`, accentColor);
    } catch (err: any) {
      setError(err?.message ?? 'PDF export failed. Please try again.');
    }
  }

  const hovered = hoveredId ? result?.elements.find(el => el.id === hoveredId) : null;
  const typeColor = hovered ? (TYPE_COLORS[hovered.elementType] ?? TYPE_COLORS.OTHER) : accentColor;

  const card = isDark ? '#1a1a1a' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text = isDark ? '#f0f0f0' : '#111';
  const muted = isDark ? '#888' : '#666';

  // Already completed but saved data not available (e.g. after page reload) -- show locked state
  if (completed && !imageDataUrl && !result && shouldLock) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}25` }}>
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
        <p className="text-sm font-medium" style={{ color: accentColor }}>
          Dashboard critique already submitted for this question.
        </p>
      </div>
    );
  }

  // A rubric review shows the rubric report, which carries its own export, retry and pass or fail,
  // so the toolbar buttons, attempt line and score banner below give way to it.
  const rubricMode = isRubricReport(result?.audit);
  const rubricReport = rubricMode && result?.audit ? (
    <RubricReviewReport
      reportLabel="Dashboard review"
      metadata={`Dashboard screenshot${showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 ? ` | Attempt ${reviewsUsed} of ${maxReviews}` : ''}`}
      workNoun="dashboard"
      summary={result.audit.executiveSummary}
      grades={result.audit.rubricGrades ?? []}
      score={reviewGate(result.audit, rubric?.length).score}
      minScore={minScore}
      attemptsLeft={showAttemptCount && maxReviews !== undefined ? Math.max(0, maxReviews - reviewsUsed) : null}
      isDark={isDark}
      accentColor={accentColor}
      onExport={downloadPdf}
      onRetry={showReset ? reset : undefined}
    />
  ) : null;

  // Saved report with no screenshot: assignment/VE store the report only (not the base64 image),
  // and the course flow no longer persists the image either. Render the holistic report without
  // the interactive overlay so students and instructors still see the saved feedback on reload.
  if (result && !imageDataUrl && rubricReport) {
    return (
      <div className="space-y-3">
        {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
        {rubricReport}
      </div>
    );
  }
  if (result && !imageDataUrl) {
    return (
      <div className="space-y-3">
        {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
        {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
          <p style={{ fontSize: 11, fontWeight: 600, color: muted }}>Attempt {reviewsUsed} of {maxReviews}</p>
        )}
        <div className="flex justify-end">
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: `${accentColor}15`, color: accentColor }}>
            <Download className="h-3 w-3" /> PDF
          </button>
        </div>
        {result.audit ? (
          <AuditReport audit={result.audit} elements={result.elements ?? []} accentColor={accentColor} isDark={isDark} passed={minScore ? reviewGate(result.audit, rubric?.length).score >= minScore : undefined} />
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            <p className="text-xs font-medium" style={{ color: accentColor }}>
              {result.elements?.length ?? 0} elements analysed
            </p>
          </div>
        )}
      </div>
    );
  }

  // Upload state
  if (!imageDataUrl) {
    if (atLimit) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
          <Eye className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: muted }} />
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
        priceLabel={entitlement.priceLabel}
        canUpgrade={entitlement.canUpgrade}
        upgradeUrl={entitlement.upgradeUrl}
        message="Dashboard reviews are part of a paid plan. Upgrade to submit your screenshot and get element-level coaching."
      >
      <div className="space-y-3">
      {!hideWorkspaceHeader && (<>
        <AiReviewWorkspaceHeader icon={<Eye className="w-5 h-5" />} title="Review your dashboard" description="Upload a dashboard screenshot to receive visual, element-level coaching and rubric feedback." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} />
        <AiReviewDisclaimer isDark={isDark} />
      </>)}
      <AiReviewDropzone isDark={isDark} accentColor={accentColor} icon={<UploadIcon className="w-5 h-5" />}
        title="Drop your dashboard screenshot here" hint="PNG or JPG" fileName={pendingFile?.name}
        dragging={dragging} onDragChange={setDragging} onDropFile={handleDrop} onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) setPendingFile(f); e.target.value = ''; }} />
      </AiReviewDropzone>
      {error && <p className="text-xs font-medium text-red-400">{error}</p>}
      {/* The same rule as the other reviews: choose the file, then send it. */}
      <AiReviewSubmitButton isDark={isDark} accentColor={accentColor} disabled={!pendingFile} onClick={() => { if (pendingFile) processFile(pendingFile); }}>
        <Zap className="w-4 h-4" /> Submit for AI review
      </AiReviewSubmitButton>
      </div>
      </AiReviewLockOverlay>
    );
  }

  // Analyzing state
  if (analyzing) {
    return (
      <div className="space-y-3">
      <AiReviewWorkspaceHeader icon={<Eye className="w-5 h-5" />} title="Reviewing your dashboard" description="The reviewer is mapping visual elements and generating coaching feedback." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} analyzing />
      <div className="rounded-2xl flex flex-col items-center justify-center gap-4 py-16" style={{ background: card, border: `1px solid ${border}` }}>
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl overflow-hidden">
            <img src={imageDataUrl} alt="" className="w-full h-full object-cover opacity-40" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin absolute -bottom-1 -right-1" style={{ color: accentColor }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: text }}>Analyzing your dashboard...</p>
          <p className="text-xs mt-1" style={{ color: muted }}>Detecting elements and generating coaching feedback</p>
        </div>
      </div>
      </div>
    );
  }

  // A paywall answer while the screenshot is still held. The interactive view below has nothing
  // to draw without a report, so show the lock instead -- the image stays in state, so upgrading
  // and submitting again does not cost them the upload.
  if (!result && upgradeUrl) {
    return (
      <AiReviewUpgradePrompt
        accentColor={accentColor}
        isDark={isDark}
        planName={entitlement.planName}
        priceLabel={entitlement.priceLabel}
        canUpgrade={entitlement.canUpgrade}
        message={error}
        upgradeUrl={upgradeUrl}
      />
    );
  }

  // Interactive result state
  return (
    <div className="space-y-3">
      {!hideWorkspaceHeader && <AiReviewDisclaimer isDark={isDark} />}
      {!rubricMode && showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
        <p style={{ fontSize: 11, fontWeight: 600, color: muted }}>Attempt {reviewsUsed} of {maxReviews}</p>
      )}
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" style={{ color: accentColor }} />
          <p className="text-xs font-semibold" style={{ color: muted }}>
            Hover over the highlighted zones below to receive element-specific coaching.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZonesVisible(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: zonesVisible ? accentColor : isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: zonesVisible ? '#fff' : muted }}
          >
            {zonesVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {zonesVisible ? 'Zones Visible' : 'Zones Hidden'}
          </button>
          {result && !rubricMode && (
            <button
              onClick={downloadPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: `${accentColor}15`, color: accentColor }}
            >
              <Download className="w-3 h-3" /> PDF
            </button>
          )}
          {showReset && !rubricMode && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', color: muted }}
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Image + overlay container: no overflow-hidden so zones aren't clipped */}
      <div
        ref={containerRef}
        className="relative rounded-2xl select-none"
        style={{ border: `1px solid ${border}` }}
        onMouseMove={e => setMousePos({ x: e.clientX, y: e.clientY })}
      >
        <img
          ref={imgRef}
          src={imageDataUrl}
          alt="Dashboard"
          className="w-full block rounded-2xl"
          style={{ opacity: hoveredId ? 0.55 : 1, transition: 'opacity 0.2s' }}
        />

        {/* Overlay zones */}
        {zonesVisible && result?.elements.map(el => {
          const isHovered = hoveredId === el.id;
          const color = TYPE_COLORS[el.elementType] ?? TYPE_COLORS.OTHER;
          return (
            <div
              key={el.id}
              onMouseEnter={() => setHoveredId(el.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="absolute cursor-pointer transition-all"
              style={{
                left:   `${el.bounds.x * 100}%`,
                top:    `${el.bounds.y * 100}%`,
                width:  `${el.bounds.w * 100}%`,
                height: `${el.bounds.h * 100}%`,
                border: `2px solid ${color}`,
                borderRadius: 6,
                background: isHovered ? `${color}25` : `${color}08`,
                boxShadow: isHovered ? `0 0 0 1px ${color}` : 'none',
                zIndex: isHovered ? 20 : 10,
              }}
            >
              <span
                className="absolute top-0 left-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-br"
                style={{ background: color, color: '#fff', lineHeight: 1.6 }}
              >
                {el.elementType}
              </span>
            </div>
          );
        })}
      </div>

      {/* Fixed tooltip: rendered at viewport level, never clipped */}
      {hovered && (() => {
        const TIP_W = 320;
        const OFFSET = 16;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const left = mousePos.x + OFFSET + TIP_W > vw
          ? mousePos.x - TIP_W - OFFSET
          : mousePos.x + OFFSET;
        const top = Math.min(mousePos.y - 20, vh - 400);
        return (
          <div
            className="fixed z-[9999] pointer-events-none rounded-2xl shadow-2xl"
            style={{ left, top, width: TIP_W, background: '#ffffff', border: '1px solid rgba(0,0,0,0.10)' }}
          >
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-gray-900 leading-snug">{hovered.label}</p>
                  <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
                    style={{ background: `${typeColor}15`, color: typeColor }}>
                    {hovered.elementType}
                  </span>
                </div>
                <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full"
                  style={{ background: `${accentColor}15` }}>
                  <Zap className="w-3 h-3" style={{ color: accentColor }} />
                </div>
              </div>

              {/* Strengths */}
              {hovered.strengths.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#16a34a' }}>
                    Effective
                  </p>
                  <ul className="space-y-1">
                    {hovered.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#16a34a' }} />
                        <p className="text-[12px] text-gray-600 leading-snug">{s}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses */}
              {hovered.weaknesses.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#dc2626' }}>
                    Needs Improvement
                  </p>
                  <ul className="space-y-1">
                    {hovered.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#dc2626' }} />
                        <p className="text-[12px] text-gray-600 leading-snug">{w}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendation */}
              {hovered.recommendation && (
                <div className="rounded-xl p-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1 inline-flex items-center gap-1.5" style={{ color: '#2563eb' }}>
                    <Lightbulb className="w-3 h-3" /> Actionable Insight
                  </p>
                  <p className="text-[12px] text-gray-700 leading-snug">{hovered.recommendation}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Completion / gate */}
      {result && !rubricMode && (() => {
        const score = reviewGate(result.audit ?? { overallScore: 0 }, rubric?.length).score;
        const failed = !!minScore && score < minScore;
        return failed ? (
          <div className="flex items-start gap-3 px-4 py-3" style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '2px solid #ef4444' }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 6, height: 6, background: '#ef4444', borderRadius: '50%' }} />
              </div>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
                Score {score.toFixed(1)}/100 | Below the {minScore}/100 minimum -- no point awarded
              </p>
              <p style={{ fontSize: 12, color: '#ef4444', opacity: 0.8 }}>You can continue or try again with a revised dashboard.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            <p className="text-xs font-medium" style={{ color: accentColor }}>
              {result.elements.length} elements analysed | hover each zone to explore the feedback
            </p>
          </div>
        );
      })()}
      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

      {/* Holistic Audit Report */}
      {rubricReport}
      {result?.audit && !rubricMode && <AuditReport audit={result.audit} elements={result.elements ?? []} accentColor={accentColor} isDark={isDark} passed={minScore ? reviewGate(result.audit, rubric?.length).score >= minScore : undefined} />}
    </div>
  );
}



export function AuditReport({ audit, elements, accentColor, isDark, passed }: { audit: Audit; elements: CritiqueElement[]; accentColor: string; isDark: boolean; passed?: boolean }) {

  return (
    <div className="space-y-3">

      <AiStructuredReviewReport
        reportLabel="Dashboard review"
        title="Your dashboard review"
        metadata="Dashboard screenshot"
        score={audit.overallScore}
        summary={audit.executiveSummary}
        findings={elements.map(element => ({
          location: `${element.elementType} / ${element.label}`,
          severity: element.weaknesses.length > 0 ? 'warning' : 'suggestion',
          title: element.label,
          detail: element.weaknesses.length > 0 ? element.weaknesses.join(' ') : element.strengths.join(' '),
          fix: element.recommendation,
        }))}
        findingsTitle="Element-level findings"
        locationLabel="Element"
        severityLabels={{ warning: 'Needs attention', suggestion: 'Opportunity' }}
        metricLabels={{ risks: 'Needs attention' }}
        categories={audit.categories}
        recommendations={audit.topRecommendations}
        rubricGrades={audit.rubricGrades}
        accentColor={accentColor}
        isDark={isDark}
        passed={passed}
      />

    </div>
  );
}
