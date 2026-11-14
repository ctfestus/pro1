'use client';

import { CheckCircle2 } from 'lucide-react';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import { buildReviewNotes, parseReviewNotes, isFullReport } from '@/lib/reviewRecord';
import type { RequirementProps } from './types';

/** Dashboard critique, code review, Excel review and document review cards. */
export function AiReviewRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, formId, currentModId, currentLesId, progress, setProgress, saveProgress,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  // Dashboard Critique
  if (req.type === 'dashboard_critique') {
    const saved = progress[req.id];
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
            style={{ background: `${accentColor}18`, color: accentColor }}>AI Critique</span>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
            {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
          </div>
          {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
        </div>
        <DashboardCritiquePlayer
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
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
            style={{ background: `${accentColor}18`, color: accentColor }}>AI Code Review</span>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
            {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
          </div>
          {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
        </div>
        <CodeReviewPlayer
          reqId={req.id}
          isDark={isDark ?? false}
          accentColor={accentColor}
          completed={done}
          savedResult={(() => { const rep = parseReviewNotes(saved?.notes)?.report; return isFullReport('code_review', rep) ? rep : undefined; })()}
          rubric={req.rubric}
          schema={req.schema}
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
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
            style={{ background: `rgba(34,197,94,0.12)`, color: '#22c55e' }}>AI Excel Review</span>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
            {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
          </div>
          {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
        </div>
        <ExcelReviewPlayer
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
        <div className="flex items-start gap-2"><span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5" style={{ background: `${accentColor}18`, color: accentColor }}>AI Document Review</span><div className="flex-1"><p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>{req.description && <p className="text-[12.5px] mt-0.5" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}</div></div>
        <DocumentReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={done}
          savedResult={isFullReport('document_review', report) ? report as any : undefined} context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
          onComplete={(result, passed) => setProgress(prev => { const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('document_review', result, prev[req.id]?.notes) } }; saveProgress(next, currentModId, currentLesId); return next; })} />
      </div>
    );
  }

  return null;
}
