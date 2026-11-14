'use client';

import { CheckCircle2 } from 'lucide-react';
import type { RequirementProps } from './types';

/** Multiple choice question card. */
export function McqRequirement({ req, qi, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, currentModId, currentLesId, progress, setProgress, saveProgress,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const selectedAnswer = progress[req.id]?.selectedAnswer;

  return (
    <div style={rowStyle} className="px-3 sm:px-8 py-4 sm:py-5 space-y-3">
      {/* Question header */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
          style={{ background: `${accentColor}15`, color: accentColor }}>Q{qi + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14.5px] font-semibold leading-snug" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
            {req.label}
          </p>
          {req.description && (
            <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>
          )}
        </div>
        {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {(req.options || []).map((opt, oi) => {
          const letter      = oi + 1;
          const isSelected  = selectedAnswer === opt;
          const isCorrect   = opt === req.correctAnswer;
          const showCorrect = done && isCorrect;
          const showWrong   = isSelected && !done && !isCorrect;

          return (
            <button key={oi}
              onClick={() => {
                if (done) return;
                const correct = opt === req.correctAnswer;
                setProgress(prev => {
                  const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: correct } };
                  if (correct) saveProgress(next, currentModId, currentLesId);
                  return next;
                });
              }}
              disabled={done}
              className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left text-[14px] transition-all disabled:cursor-default"
              style={{
                background: showCorrect
                  ? `${accentColor}12`
                  : showWrong
                    ? 'rgba(239,68,68,0.07)'
                    : isSelected
                      ? `${accentColor}08`
                      : isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
                border: 'none',
                color: showCorrect ? accentColor : showWrong ? '#ef4444' : isDark ? '#e0e0e0' : '#222',
              }}>
              <span className="flex-1 text-[14.5px]">{opt}</span>
              {showCorrect && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />}
              {showWrong && <span className="text-[12.5px] flex-shrink-0" style={{ color: '#ef4444' }}>Try again</span>}
              <span className="text-[13px] font-bold flex-shrink-0 tabular-nums" style={{ color: showCorrect ? accentColor : showWrong ? '#ef4444' : isSelected ? accentColor : (isDark ? '#888' : '#999') }}>{letter}</span>
            </button>
          );
        })}
      </div>

      {done && (
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg w-fit"
          style={{ background: `${accentColor}10`, color: accentColor }}>
          <CheckCircle2 className="w-3 h-3"/> Correct. Well done!
        </div>
      )}
    </div>
  );
}
