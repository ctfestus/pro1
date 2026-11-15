'use client';

import { HelpCircle } from 'lucide-react';
import type { RequirementProps } from './types';
import { TaskHeader, taskTheme } from './TaskCard';

/** Multiple choice question card. */
export function McqRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, currentModId, currentLesId, progress, setProgress, saveProgress,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const selectedAnswer = progress[req.id]?.selectedAnswer;
  const t = taskTheme(isDark, accentColor);

  // A right answer completes and saves; a wrong one is remembered for this visit only, so the
  // learner sees which one missed and tries again. Same rule as before the redesign.
  const choose = (opt: string) => {
    if (done) return;
    const correct = opt === req.correctAnswer;
    setProgress(prev => {
      const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: correct } };
      if (correct) saveProgress(next, currentModId, currentLesId);
      return next;
    });
  };

  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <TaskHeader t={t} icon={<HelpCircle className="w-3.5 h-3.5" />} label="Question" title={req.label}
        description={req.description} done={done ? 'Correct' : null} />
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={req.label}>
        {(req.options || []).map((opt, oi) => {
          const letter    = String.fromCharCode(65 + oi);
          const isRight   = done && opt === req.correctAnswer;
          const isMissed  = !done && selectedAnswer === opt && opt !== req.correctAnswer;
          return (
            <button key={oi} type="button" role="radio" aria-checked={selectedAnswer === opt}
              onClick={() => choose(opt)} disabled={done}
              className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[14px] transition-colors disabled:cursor-default"
              style={{
                background: isRight ? `${accentColor}1a` : isMissed ? `${t.bad}14` : t.soft,
                color: t.text,
                opacity: done && !isRight ? 0.55 : 1,
              }}>
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[12px] font-bold"
                style={{
                  background: isRight ? accentColor : isDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
                  color: isRight ? (isDark ? '#111' : '#fff') : isMissed ? t.bad : t.muted,
                }}>
                {letter}
              </span>
              <span className="flex-1 min-w-0">{opt}</span>
              {isMissed && <span className="flex-shrink-0 text-[12.5px] font-semibold" style={{ color: t.bad }}>Not this one. Try again.</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
