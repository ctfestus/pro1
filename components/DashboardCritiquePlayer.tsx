'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Loader2, UploadIcon, Eye, EyeOff, RotateCcw, CheckCircle2, Zap, Download, Lightbulb } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadStructuredReviewPdf } from '@/lib/downloadReviewPdf';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import AiStructuredReviewReport from '@/components/AiStructuredReviewReport';
import AiReviewWorkspaceHeader from '@/components/AiReviewWorkspaceHeader';

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
interface RubricGrade {
  criterion: string;
  passed: boolean;
  comment: string;
}
interface Audit {
  overallScore: number;
  executiveSummary: string;
  categories: AuditCategory[];
  topRecommendations: string[];
  rubricGrades?: RubricGrade[];
}
interface CritiqueResult { elements: CritiqueElement[]; audit?: Audit; }

interface Props {
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

export default function DashboardCritiquePlayer({ reqId, isDark, accentColor, completed, savedResult, savedImageUrl, rubric, minScore, reviewsUsed = 0, maxReviews, showAttemptCount, onReviewStart, onReviewError, onComplete }: Props) {
  const atLimit = maxReviews !== undefined && reviewsUsed >= maxReviews;
  const shouldLock = maxReviews === undefined || atLimit || reviewsUsed === 0;
  // Offer Reset (try again) only while attempts remain. Once a submission is terminal -- completed
  // with no per-question retry budget (direct/VE assignments) -- hide it so the student can't clear
  // the saved report into an empty locked state.
  const showReset = !atLimit && !(completed && maxReviews === undefined);
  const [imageDataUrl, setImageDataUrl] = useState<string>(savedImageUrl ?? '');
  const [result, setResult]             = useState<CritiqueResult | null>(savedResult ?? null);
  const [analyzing, setAnalyzing]       = useState(false);
  const [error, setError]               = useState('');
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
    setResult(null);
    setAnalyzing(true);
    onReviewStart?.();

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setImageDataUrl(dataUrl);

      // Strip the data:image/...;base64, prefix
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type;

      try {
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
        if (json.error) throw new Error(json.error);
        setResult(json);
        const score = (json as CritiqueResult).audit?.overallScore ?? 100;
        const passed = !minScore || score >= minScore;
        onComplete(json, dataUrl, passed);
      } catch (err: any) {
        setError(err.message || 'The AI review service is busy right now. Please wait a moment and try again. Your work has not been lost.');
        onReviewError?.();
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  }, [onComplete, onReviewStart, onReviewError, rubric, minScore]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = () => {
    setImageDataUrl('');
    setResult(null);
    setError('');
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
        reportLabel: 'AI DASHBOARD INTELLIGENCE',
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

  const bg   = isDark ? '#0f0f0f' : '#f8fafc';
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

  // Saved report with no screenshot: assignment/VE store the report only (not the base64 image),
  // and the course flow no longer persists the image either. Render the holistic report without
  // the interactive overlay so students and instructors still see the saved feedback on reload.
  if (result && !imageDataUrl) {
    return (
      <div className="space-y-3">
        <AiReviewDisclaimer isDark={isDark} />
        {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
          <p style={{ fontSize: 11, fontWeight: 600, color: muted }}>Attempt {reviewsUsed} of {maxReviews}</p>
        )}
        <div className="flex justify-end">
          <button onClick={downloadPdf} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: `${accentColor}15`, color: accentColor }}>
            <Download className="h-3 w-3" /> PDF
          </button>
        </div>
        {result.audit ? (
          <AuditReport audit={result.audit} elements={result.elements ?? []} accentColor={accentColor} isDark={isDark} />
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
    return (
      <div className="space-y-3">
      <AiReviewWorkspaceHeader icon={<Eye className="w-5 h-5" />} title="Review your dashboard" description="Upload a dashboard screenshot to receive visual, element-level coaching and rubric feedback." accentColor={accentColor} isDark={isDark} reviewsUsed={reviewsUsed} maxReviews={maxReviews} />
      <AiReviewDisclaimer isDark={isDark} />
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-2xl flex flex-col items-center justify-center gap-3 py-14 px-6 transition-all hover:-translate-y-px"
        style={{
          border: `1.5px dashed ${dragging ? accentColor : isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`,
          background: dragging ? `${accentColor}08` : isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
          boxShadow: dragging ? `0 0 0 4px ${accentColor}12` : isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}15` }}>
          <UploadIcon className="w-6 h-6" style={{ color: accentColor }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: text }}>Drop your dashboard screenshot here</p>
          <p className="text-xs mt-1" style={{ color: muted }}>or click to browse | PNG or JPG</p>
        </div>
        {error && <p className="text-xs font-medium text-red-400">{error}</p>}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      </div>
      </div>
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

  // Interactive result state
  return (
    <div className="space-y-3">
      <AiReviewDisclaimer isDark={isDark} />
      {showAttemptCount && maxReviews !== undefined && reviewsUsed > 0 && (
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
          {result && (
            <button
              onClick={downloadPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: `${accentColor}15`, color: accentColor }}
            >
              <Download className="w-3 h-3" /> PDF
            </button>
          )}
          {showReset && (
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
      {result && (() => {
        const score = result.audit?.overallScore ?? 100;
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
      {result?.audit && <AuditReport audit={result.audit} elements={result.elements ?? []} accentColor={accentColor} isDark={isDark} />}
    </div>
  );
}



const CATEGORY_ICONS: Record<string, React.ReactElement> = {
  'Layout & Structure': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  'Visual Design': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    </svg>
  ),
  'Data Clarity': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-7"/>
    </svg>
  ),
  'Insight & Storytelling': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6L15 17H9l-.7-2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/>
      <path d="M9 21h6M10 17v4M14 17v4"/>
    </svg>
  ),
};

function scoreBarColor(score: number) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

export function AuditReport({ audit, elements, accentColor, isDark }: { audit: Audit; elements: CritiqueElement[]; accentColor: string; isDark: boolean }) {
  const legacyReportEnabled = false as boolean;
  const card    = isDark ? '#272727' : '#ffffff';
  const inner   = isDark ? '#303030' : '#f7f7f9';
  const text    = isDark ? '#f0f0f0' : '#0a0a0a';
  const sub     = isDark ? '#777'    : '#6b6b7b';
  const dim     = isDark ? '#2e2e2e' : '#e2e2e8';
  const shadow  = isDark ? 'none'    : '0 2px 16px rgba(0,0,0,0.06)';

  return (
    <div className="space-y-3">

      <AiStructuredReviewReport
        reportLabel="AI dashboard intelligence"
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
      />

      {legacyReportEnabled && <>
      {/* Legacy result sections retained temporarily for backward-safe data rendering. */}
      {audit.rubricGrades && audit.rubricGrades.length > 0 && (() => {
        const passed     = audit.rubricGrades.filter(g => g.passed).length;
        const total      = audit.rubricGrades.length;
        const pct        = Math.round((passed / total) * 100);
        const trackColor = pct === 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
        return (
          <div style={{ background: card, borderRadius: 20, boxShadow: shadow }}>
            <div style={{ padding: '22px 28px 16px' }} className="flex items-center gap-4">
              <p className="flex-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: sub }}>
                Assignment Rubric
              </p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="h-1 rounded-full overflow-hidden" style={{ width: 80, background: dim }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: trackColor }} />
                </div>
                <span className="text-[13px] font-bold tabular-nums" style={{ color: text }}>
                  {passed}<span className="font-normal" style={{ color: sub }}>/{total}</span>
                </span>
              </div>
            </div>
            <div style={{ padding: '0 16px 16px' }} className="space-y-2">
              {audit.rubricGrades.map((grade, i) => (
                <div key={i} className="flex items-start gap-4"
                  style={{ background: inner, borderRadius: 14, padding: '16px 18px' }}>
                  <div className="flex-shrink-0 mt-[5px] w-[7px] h-[7px] rounded-full"
                    style={{ background: grade.passed ? '#22c55e' : dim }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold leading-snug" style={{ color: text }}>
                      {grade.criterion}
                    </p>
                    <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: sub }}>
                      {grade.comment}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-[11px] font-bold tracking-wide mt-0.5"
                    style={{ color: grade.passed ? '#22c55e' : sub }}>
                    {grade.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Category Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {audit.categories.map(cat => {
          const barColor = scoreBarColor(cat.score);
          const icon     = CATEGORY_ICONS[cat.name] ?? CATEGORY_ICONS['Data Clarity'];
          const rec      = cat.gaps[0] ?? cat.strengths[0] ?? cat.summary;
          const status   = cat.score >= 80 ? 'Excellent' : cat.score >= 60 ? 'Good' : cat.score >= 40 ? 'Needs Work' : 'Critical';
          return (
            <div key={cat.name} className="flex flex-col"
              style={{ background: card, borderRadius: 20, boxShadow: shadow }}>
              <div style={{ padding: '22px 22px 0' }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: inner, color: barColor }}>
                      {icon}
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: text }}>{cat.name}</p>
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: barColor }}>{status}</span>
                </div>
                <div className="flex items-end gap-1.5 mb-3">
                  <span style={{ fontSize: 36, fontWeight: 900, lineHeight: 1, color: text, letterSpacing: '-0.02em' }}>
                    {cat.score}
                  </span>
                  <span className="mb-1 text-[13px] font-medium" style={{ color: dim }}>/100</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden mb-5" style={{ background: dim }}>
                  <div className="h-full rounded-full" style={{ width: `${cat.score}%`, background: barColor }} />
                </div>
              </div>
              <div className="flex-1" style={{ padding: '0 22px 18px' }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: sub }}>
                  Key Observation
                </p>
                <p className="text-[13px] leading-[1.65]" style={{ color: sub }}>{cat.summary}</p>
              </div>
              <div style={{ padding: '0 14px 14px' }}>
                <div style={{ background: inner, borderRadius: 14, padding: '14px 16px' }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: sub }}>
                    Recommendation
                  </p>
                  <p className="text-[13px] leading-[1.65]" style={{ color: text }}>{rec}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top Priority Actions */}
      {audit.topRecommendations.length > 0 && (
        <div style={{ background: card, borderRadius: 20, padding: '22px 28px 28px', boxShadow: shadow }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-6" style={{ color: accentColor }}>
            Top Priority Actions
          </p>
          <ol className="space-y-5">
            {audit.topRecommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-4">
                <span style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 8,
                  background: accentColor, color: '#ffffff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, marginTop: 1,
                }}>{i + 1}</span>
                <p className="text-[13.5px] leading-[1.65]" style={{ color: text }}>{r}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      </>}
    </div>
  );
}
