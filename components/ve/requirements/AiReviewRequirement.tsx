'use client';

import { Sparkles } from 'lucide-react';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import { buildReviewNotes, parseReviewNotes, isFullReport } from '@/lib/reviewRecord';
import type { RequirementProps } from './types';
import { TaskHeader, AiNote, taskTheme } from './TaskCard';

const REVIEW_KIND: Record<string, string> = {
  dashboard_critique: 'Dashboard', code_review: 'Code', excel_review: 'Excel', document_review: 'Document',
};

/** Dashboard critique, code review, Excel review and document review cards. */
export function AiReviewRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, formId, currentModId, currentLesId, progress, setProgress, saveProgress,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const t = taskTheme(isDark, accentColor);
  // Done reads as the score where there is one. A manual document review is marked by a person,
  // so it only says it was submitted.
  const savedReport = parseReviewNotes(progress[req.id]?.notes)?.report;
  const rawScore = savedReport?.overallScore ?? savedReport?.audit?.overallScore;
  const manual = req.type === 'document_review' && req.documentReviewMode === 'manual';
  const doneText = !done ? null
    : manual ? 'Submitted'
    : typeof rawScore === 'number' && Number.isFinite(rawScore) ? `Reviewed ${Math.round(rawScore)} / 100`
    : 'Reviewed';
  const header = (
    <>
      <TaskHeader t={t} icon={<Sparkles className="w-3.5 h-3.5" />}
        label={manual ? `${REVIEW_KIND[req.type] || ''} review`.trim() : `AI review - ${REVIEW_KIND[req.type] || 'work'}`}
        title={req.label} description={req.description} done={doneText} />
      {!manual && <AiNote t={t} />}
    </>
  );

  // Dashboard Critique
  if (req.type === 'dashboard_critique') {
    const saved = progress[req.id];
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
        {header}
        <DashboardCritiquePlayer hideWorkspaceHeader
          reqId={req.id}
          isDark={isDark ?? false}
          accentColor={accentColor}
          completed={done}
          savedResult={parseReviewNotes(saved?.notes)?.report}
          savedImageUrl={undefined}
          rubric={(req as any).rubric}
          onComplete={(result, _imageDataUrl) => {
            setProgress(prev => {
              // Store only the analysis JSON in notes (not the base64 image: too large for DB)
              const next = { ...prev, [req.id]: { completed: true, notes: buildReviewNotes('dashboard_critique', result, prev[req.id]?.notes) } };
              saveProgress(next, currentModId, currentLesId);
              return next;
            });
          }}
        />
      </div>
    );
  }

  // Code Review
  if (req.type === 'code_review') {
    const saved = progress[req.id];
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
        {header}
        <CodeReviewPlayer hideWorkspaceHeader
          reqId={req.id}
          isDark={isDark ?? false}
          accentColor={accentColor}
          completed={done}
          savedResult={(() => { const rep = parseReviewNotes(saved?.notes)?.report; return isFullReport('code_review', rep) ? rep : undefined; })()}
          rubric={req.rubric}
          schema={req.schema}
          reviewLanguage={req.reviewLanguage}
          minScore={req.minScore}
          onComplete={(result, passed) => {
            setProgress(prev => {
              const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('code_review', result, prev[req.id]?.notes) } };
              saveProgress(next, currentModId, currentLesId);
              return next;
            });
          }}
        />
      </div>
    );
  }

  // Excel Review
  if (req.type === 'excel_review') {
    const saved = progress[req.id];
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
        {header}
        <ExcelReviewPlayer hideWorkspaceHeader
          reqId={req.id}
          isDark={isDark ?? false}
          accentColor={accentColor}
          completed={done}
          savedResult={(() => { const rep = parseReviewNotes(saved?.notes)?.report; return isFullReport('excel_review', rep) ? rep : undefined; })()}
          context={req.context}
          reviewSheetNames={req.reviewSheetNames}
          reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }}
          rubric={req.rubric}
          minScore={req.minScore}
          onComplete={(result, passed) => {
            setProgress(prev => {
              const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('excel_review', result, prev[req.id]?.notes) } };
              saveProgress(next, currentModId, currentLesId);
              return next;
            });
          }}
        />
      </div>
    );
  }

  if (req.type === 'document_review') {
    const saved = progress[req.id];
    const report = parseReviewNotes(saved?.notes)?.report;
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
        {header}
        <DocumentReviewPlayer hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={done}
          savedResult={isFullReport('document_review', report) ? report as any : undefined} context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
          onComplete={(result, passed) => setProgress(prev => { const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('document_review', result, prev[req.id]?.notes) } }; saveProgress(next, currentModId, currentLesId); return next; })} />
      </div>
    );
  }

  return null;
}
