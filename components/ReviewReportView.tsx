'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { inferReviewType, isFullReport } from '@/lib/reviewRecord';

// AI review players, embedded read-only so instructors see the full saved report.
const CodeReviewPlayer        = dynamic(() => import('@/components/CodeReviewPlayer'), { ssr: false });
const ExcelReviewPlayer       = dynamic(() => import('@/components/ExcelReviewPlayer'), { ssr: false });
const DocumentReviewPlayer    = dynamic(() => import('@/components/DocumentReviewPlayer'), { ssr: false });
const DashboardCritiquePlayer = dynamic(() => import('@/components/DashboardCritiquePlayer'), { ssr: false });
const WrittenResponsePlayer   = dynamic(() => import('@/components/WrittenResponsePlayer'), { ssr: false });

export const REVIEW_TYPES = ['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];
export const REVIEW_LABELS: Record<string, string> = {
  code_review: 'AI Code Review',
  excel_review: 'AI Excel Review',
  dashboard_critique: 'AI Dashboard Critique',
  document_review: 'AI Document Review',
  written_response: 'AI Written Response',
};

// Renders a saved AI review report read-only (no further attempts) by reusing the student player.
// `rec` is a parsed review record: { type?, count?, report, imageUrl?, documentReviewMode? }.
// The type is taken from the record when present and inferred from the report shape otherwise
// (legacy data). Shows an "Attempt N" badge for instructors when the record carries a count.
// Falls back to a compact summary for legacy/incomplete data so it can never crash a player.
export function ReviewReportView({ rec, isDark }: { rec: any; isDark: boolean }) {
  if (!rec) return null;
  const accent = '#22c55e';
  const type = rec.type ?? inferReviewType(rec.report);
  const textPrim = isDark ? 'text-zinc-200' : 'text-[#111]';
  const textMut  = isDark ? 'text-zinc-400' : 'text-[#666]';
  const countBadge = (typeof rec.count === 'number' && rec.count > 0)
    ? <p className={`text-[11px] font-semibold mb-1.5 ${textMut}`}>Attempt {rec.count}</p>
    : null;

  let body: React.ReactNode = null;
  if (!isFullReport(type, rec.report)) {
    body = <LegacyReviewSummary lean={rec.report} isDark={isDark} textPrim={textPrim} textMut={textMut} />;
  } else {
    const base = { reqId: 'admin', isDark, accentColor: accent, completed: true, reviewsUsed: 1, maxReviews: 1, onComplete: () => {} };
    if (type === 'code_review')             body = <CodeReviewPlayer {...base} savedResult={rec.report} />;
    else if (type === 'excel_review')       body = <ExcelReviewPlayer {...base} savedResult={rec.report} />;
    // Renders the holistic report even without a screenshot (assignment/VE store report-only).
    else if (type === 'dashboard_critique') body = <DashboardCritiquePlayer {...base} savedResult={rec.report} savedImageUrl={rec.imageUrl} />;
    else if (type === 'document_review')    body = <DocumentReviewPlayer {...base} savedResult={rec.report} documentReviewMode={rec.documentReviewMode ?? 'ai_only'} />;
    // Shows the submitted text above the report, so staff read the answer that was graded.
    else if (type === 'written_response')   body = <WrittenResponsePlayer {...base} savedResult={rec.report} savedAnswer={rec.answerText} />;
  }

  return <>{countBadge}{body}</>;
}

// Fallback for older submissions saved before full reports were stored (lean summary only).
export function LegacyReviewSummary({ lean, isDark, textPrim, textMut }: { lean: any; isDark: boolean; textPrim: string; textMut: string }) {
  const box = `rounded-xl px-4 py-3 border ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-[rgba(0,0,0,0.06)] bg-[#f8f8f5]'}`;
  if (!lean || (typeof lean.overallScore !== 'number' && !lean.executiveSummary)) {
    return <div className={box}><span className={`text-xs ${textMut}`}>AI review details not available for this submission.</span></div>;
  }
  const gaps: string[] = lean.gaps ?? [];
  const recs: string[] = lean.topRecommendations ?? [];
  return (
    <div className={box}>
      <div className="flex items-start justify-between gap-3 mb-2">
        {lean.executiveSummary && <p className={`text-xs leading-relaxed ${textPrim}`}>{lean.executiveSummary}</p>}
        {typeof lean.overallScore === 'number' && lean.overallScore > 0 && (
          <span className="font-black flex-shrink-0" style={{ fontSize: 24, lineHeight: 1, color: '#22c55e' }}>{lean.overallScore.toFixed(1)}</span>
        )}
      </div>
      {gaps.length > 0 && (
        <div className="mt-2">
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${textMut}`}>Areas to Improve</p>
          {gaps.slice(0, 3).map((g, i) => <p key={i} className={`text-xs ${textPrim}`}>• {g}</p>)}
        </div>
      )}
      {recs.length > 0 && (
        <div className="mt-2">
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${textMut}`}>Top Recommendations</p>
          {recs.map((r, i) => <p key={i} className={`text-xs ${textPrim}`}>{i + 1}. {r}</p>)}
        </div>
      )}
    </div>
  );
}
