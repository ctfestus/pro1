'use client';

import { Loader2, AlertTriangle, PenLine, Sparkles } from 'lucide-react';
import AiReviewUpgradePrompt, { AiReviewUpgradeNote, AiReviewDailyLimitNotice } from '@/components/AiReviewUpgradePrompt';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';
import { refreshAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import ShortAnswerReviewResult, { savedShortAnswerResult, shortAnswerProgressFields, shortAnswerResultOf } from '@/components/ShortAnswerReviewResult';
import type { RequirementProps } from './types';
import { TaskHeader, TaskButton, AiNote, taskTheme, fieldStyle, TASK_FIELD } from './TaskCard';

function isAnswerCorrect(studentAnswer: string, expectedAnswer: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(studentAnswer) === normalize(expectedAnswer);
}

/** Short answer, with AI review or an exact-match check. */
export function TextRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, formId, authHeader,
    currentModId, currentLesId, reviewMode, entitlement, progress, setProgress, saveProgress,
    noteValues, setNoteValues, aiReviewing, setAiReviewing, aiFeedback, setAiFeedback,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const t = taskTheme(isDark, accentColor);

  const noteVal   = noteValues[req.id] ?? (progress[req.id]?.notes || '');
  const reviewing = !!aiReviewing[req.id];
  // Fall back to a persisted error marker so a reload rebuilds the "could not
  // review" state (with retry) rather than silently showing the answer as done.
  const feedback  = aiFeedback[req.id] !== undefined
    ? aiFeedback[req.id]
    : (progress[req.id]?.aiErrored
      ? { passed: false, feedback: progress[req.id]?.aiFeedback || 'We could not complete an AI review of your response. Please try again.', score: 0, errored: true }
      : savedShortAnswerResult(progress[req.id]));
  const fbErrored = !!feedback?.errored;
  // The box stays editable/retryable whenever the LAST review errored - keyed off the
  // PERSISTED marker, not the transient banner. The banner clears on the first keystroke
  // (fbErrored -> false); if the editable/"done" look were keyed off it, that first edit
  // would re-lock the field. Progression is never blocked (completed stays true); this
  // only governs the editable/"done" presentation, which a successful resubmit restores.
  const showDone  = done && !progress[req.id]?.aiErrored;
  // A reviewed answer that did not pass stays open, so the student can improve it and send it again.
  const locked    = showDone && !(feedback && !fbErrored && !feedback.passed);

  if (req.aiReview) {
    // --- AI Review path ---
    const handleSubmitAi = async () => {
      if (!noteVal.trim() || reviewing || locked) return;
      setAiReviewing(prev => ({ ...prev, [req.id]: true }));
      setAiFeedback(prev => ({ ...prev, [req.id]: null }));
      // A fault keeps progression open, so a flaky reviewer can never trap a student.
      // A spent free-tier credit does not: that is the limit working, and marking it
      // done would let a learner clear every AI step by burning one review.
      const saveErrored = (msg: string, upgradeUrl?: string) => {
        setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: msg, score: 0, errored: true, upgradeUrl } }));
        setProgress(prev => {
          const entry = upgradeUrl
            ? { ...prev[req.id], notes: noteVal }
            : { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiFeedback: msg };
          const next = { ...prev, [req.id]: entry };
          saveProgress(next, currentModId, currentLesId);
          return next;
        });
      };
      try {
        const res = await fetch('/api/ve-answer-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ veId: formId, reqId: req.id, studentAnswer: noteVal }),
        });
        const json = await res.json().catch(() => ({}));
        refreshAiReviewEntitlement();
        if (!res.ok) {
          saveErrored(
            json.error || 'We could not complete an AI review right now. Please try again.',
            json.code === 'daily_limit_reached' ? String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL) : undefined,
          );
        } else {
          const result = shortAnswerResultOf(json);
          setAiFeedback(prev => ({ ...prev, [req.id]: result }));
          setProgress(prev => {
            const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: undefined, ...shortAnswerProgressFields(result) } };
            saveProgress(next, currentModId, currentLesId);
            return next;
          });
        }
      } catch {
        saveErrored('Network error. Please check your connection and try again.');
      } finally {
        setAiReviewing(prev => ({ ...prev, [req.id]: false }));
      }
    };

    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
        <TaskHeader t={t} icon={<Sparkles className="w-3.5 h-3.5" />} label="Written answer" title={req.label}
          description={req.description}
          done={showDone ? (feedback && !fbErrored ? `Reviewed ${feedback.score} / 100` : 'Reviewed') : null} />
        <textarea
          value={noteVal}
          onChange={e => {
            if (e.target.value.length > 2000) return;
            setNoteValues(prev => ({ ...prev, [req.id]: e.target.value }));
            if (feedback && !showDone) setAiFeedback(prev => ({ ...prev, [req.id]: null }));
          }}
          disabled={locked && !reviewMode}
          placeholder="Write your answer"
          aria-label="Write your answer"
          rows={4}
          className={`${TASK_FIELD} w-full text-[14px] px-3 py-2.5 resize-y`}
          style={fieldStyle(t, locked ? 'done' : 'normal')}
        />
        {!locked && entitlement.locked && (
          <AiReviewUpgradePrompt
            accentColor={accentColor}
            isDark={isDark ?? false}
            planName={entitlement.planName}
            priceLabel={entitlement.priceLabel}
            canUpgrade={entitlement.canUpgrade}
            upgradeUrl={entitlement.upgradeUrl}
            title="AI review is not part of your plan"
            message="You can still write and send your answer. It just will not be reviewed by AI."
          />
        )}
        {!locked && !entitlement.locked && entitlement.exhausted && (
          <AiReviewDailyLimitNotice accentColor={accentColor} isDark={isDark} resetsInSeconds={entitlement.resetsInSeconds} priceLabel={entitlement.priceLabel} limit={entitlement.limit} canUpgrade={entitlement.canUpgrade} upgradeUrl={entitlement.upgradeUrl} />
        )}
        {!locked && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <AiNote t={t} />
              <span className="text-[11.5px] tabular-nums" style={{ color: noteVal.length >= 1920 ? t.bad : t.faint }}>{noteVal.length} / 2000</span>
            </span>
            <TaskButton t={t} onClick={handleSubmitAi}
              disabled={noteVal.trim().length === 0 || reviewing || (entitlement.exhausted && !entitlement.locked)}>
              {reviewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {reviewing ? 'Reviewing...' : 'Send for review'}
            </TaskButton>
          </div>
        )}
        {/* Distinct error state: the review never ran, so no pass/fail, no score. */}
        {feedback && fbErrored && (
          <div className="rounded-xl p-3 flex items-start gap-2"
            style={{ background: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)', border: `1px solid ${isDark ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.40)'}` }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: isDark ? '#cbd5e1' : '#64748b' }} />
            <div className="min-w-0">
              <p className="text-[13px] font-bold" style={{ color: isDark ? '#cbd5e1' : '#64748b' }}>Review unavailable</p>
              <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: isDark ? '#ccc' : '#444' }}>{feedback.feedback}</p>
              {feedback.upgradeUrl && entitlement.canUpgrade && <AiReviewUpgradeNote accentColor={accentColor} upgradeUrl={feedback.upgradeUrl} priceLabel={entitlement.priceLabel} />}
            </div>
          </div>
        )}
        {feedback && !fbErrored && (
          <ShortAnswerReviewResult result={feedback} isDark={!!isDark} accentColor={accentColor} />
        )}
      </div>
    );
  }

  // --- Exact match path (original behaviour) ---
  const submitted   = !!progress[req.id]?.notes;
  const isCorrect   = submitted && req.expectedAnswer
    ? isAnswerCorrect(progress[req.id]?.notes || '', req.expectedAnswer)
    : submitted && !req.expectedAnswer;
  const wrongAnswer = submitted && req.expectedAnswer && !isCorrect;
  // Same rule as before: compare against the expected answer, or accept anything when there is none.
  const checkExact = () => {
    if (noteVal.trim().length === 0) return;
    const correct = req.expectedAnswer ? isAnswerCorrect(noteVal, req.expectedAnswer) : true;
    setProgress(prev => {
      const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: correct } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
  };
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <TaskHeader t={t} icon={<PenLine className="w-3.5 h-3.5" />} label="Short answer" title={req.label}
        description={req.description} done={done ? 'Correct' : null} />
      {done && !reviewMode ? (
        // Answered: the answer as plain text on the soft panel, so it no longer reads as a field.
        <p className="rounded-[10px] px-3 py-2.5 text-[14px]" style={{ background: t.soft, color: t.text }}>{noteVal}</p>
      ) : (
      <div className="flex flex-col sm:flex-row gap-2.5">
      <input
        value={noteVal}
        onChange={e => {
          setNoteValues(prev => ({ ...prev, [req.id]: e.target.value }));
          if (submitted && !done) {
            setProgress(prev => {
              const next = { ...prev, [req.id]: { ...prev[req.id], notes: '', completed: false } };
              return next;
            });
          }
        }}
        disabled={done && !reviewMode}
        placeholder="Your answer"
        aria-label="Your answer"
        className={`${TASK_FIELD} flex-1 min-w-0 text-[14px] px-3 py-2.5`}
        style={fieldStyle(t, wrongAnswer ? 'bad' : done ? 'done' : 'normal')}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); checkExact(); } }}
      />
      {!done && (
        <TaskButton t={t} onClick={() => checkExact()} disabled={noteVal.trim().length === 0}>Check answer</TaskButton>
      )}
      </div>
      )}
      {wrongAnswer && (
        <p className="text-[13px] font-semibold" style={{ color: t.bad }}>Not quite. Try again.</p>
      )}
    </div>
  );
}
