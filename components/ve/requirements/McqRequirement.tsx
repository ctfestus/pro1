'use client';

import { HelpCircle } from 'lucide-react';
import type { RequirementProps } from './types';
import { TaskHeader, TaskOption, taskTheme } from './TaskCard';

/** Multiple choice question card. */
export function McqRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, currentModId, currentLesId, progress, setProgress, saveProgress,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const selectedAnswer = progress[req.id]?.selectedAnswer;
  const t = taskTheme(isDark, accentColor);
  // The editor keeps a fixed number of option slots, so unused ones are saved empty. Skip them.
  const options = (req.options || []).filter(o => String(o ?? '').trim());

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
        {options.map((opt, oi) => {
          const isRight  = done && opt === req.correctAnswer;
          const isMissed = !done && selectedAnswer === opt && opt !== req.correctAnswer;
          return (
            <TaskOption key={oi} t={t} letter={String.fromCharCode(65 + oi)} role="radio" checked={selectedAnswer === opt}
              state={isRight ? 'right' : isMissed ? 'missed' : done ? 'faded' : 'idle'} note="Not this one. Try again."
              onClick={() => choose(opt)} disabled={done}>
              {opt}
            </TaskOption>
          );
        })}
      </div>
    </div>
  );
}
