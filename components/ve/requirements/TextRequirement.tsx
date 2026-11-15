'use client';

import { CheckCircle2, Circle, Loader2, Download, AlertTriangle, PenLine, Sparkles } from 'lucide-react';
import AiReviewUpgradePrompt, { AiReviewUpgradeNote, AiReviewDailyLimitNotice } from '@/components/AiReviewUpgradePrompt';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';
import { refreshAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import type { RequirementProps } from './types';
import { TaskHeader, TaskButton, AiNote, taskTheme, fieldStyle, TASK_FIELD } from './TaskCard';

function isAnswerCorrect(studentAnswer: string, expectedAnswer: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(studentAnswer) === normalize(expectedAnswer);
}

/** Short answer, with AI review or an exact-match check. */
export function TextRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, config, formId, authHeader, currentLes,
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
      : null);
  const fbErrored = !!feedback?.errored;
  // The box stays editable/retryable whenever the LAST review errored - keyed off the
  // PERSISTED marker, not the transient banner. The banner clears on the first keystroke
  // (fbErrored -> false); if the editable/"done" look were keyed off it, that first edit
  // would re-lock the field. Progression is never blocked (completed stays true); this
  // only governs the editable/"done" presentation, which a successful resubmit restores.
  const showDone  = done && !progress[req.id]?.aiErrored;

  if (req.aiReview) {
    // --- AI Review path ---
    const handleSubmitAi = async () => {
      if (!noteVal.trim() || reviewing || showDone) return;
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
          setAiFeedback(prev => ({ ...prev, [req.id]: { passed: json.passed, feedback: json.feedback, score: json.score } }));
          setProgress(prev => {
            const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: undefined, aiFeedback: undefined } };
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
          disabled={showDone && !reviewMode}
          placeholder="Write your answer"
          aria-label="Write your answer"
          rows={4}
          className={`${TASK_FIELD} w-full text-[14px] px-3 py-2.5 resize-y`}
          style={fieldStyle(t, showDone ? 'done' : 'normal')}
        />
        {!showDone && entitlement.locked && (
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
        {!showDone && !entitlement.locked && entitlement.exhausted && (
          <AiReviewDailyLimitNotice accentColor={accentColor} isDark={isDark} resetsInSeconds={entitlement.resetsInSeconds} priceLabel={entitlement.priceLabel} limit={entitlement.limit} canUpgrade={entitlement.canUpgrade} upgradeUrl={entitlement.upgradeUrl} />
        )}
        {!showDone && (
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
        {/* AI feedback panel */}
        {feedback && !fbErrored && (
          <div className="rounded-xl p-4 space-y-2"
            style={{
              background: feedback.passed ? 'rgba(16,185,129,0.07)' : 'rgba(245,158,11,0.07)',
              border: `1px solid ${feedback.passed ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {feedback.passed
                  ? <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />
                  : <Circle className="w-4 h-4" style={{ color: '#f59e0b' }} />}
                <span className="text-[13px] font-bold" style={{ color: feedback.passed ? '#10b981' : '#f59e0b' }}>
                  {feedback.passed ? 'Passed' : 'Not quite there yet'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded-full"
                  style={{ background: feedback.passed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: feedback.passed ? '#10b981' : '#f59e0b' }}>
                  {feedback.score}/100
                </span>
                <button
                  onClick={async () => {
                    const { jsPDF } = await import('jspdf');
                    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
                    const margin = 48;
                    const pageW  = doc.internal.pageSize.getWidth();
                    const maxW   = pageW - margin * 2;
                    let y = margin;

                    const addText = (text: string, size: number, bold: boolean, color: [number, number, number], gap: number) => {
                      doc.setFontSize(size);
                      doc.setFont('helvetica', bold ? 'bold' : 'normal');
                      doc.setTextColor(...color);
                      const lines = doc.splitTextToSize(text, maxW);
                      doc.text(lines, margin, y);
                      y += lines.length * (size * 1.4) + gap;
                    };

                    const ve   = [config.company, config.role].filter(Boolean).join(' - ');
                    const task = req.label || req.description || 'Task';

                    if (ve) addText(ve, 10, false, [120, 120, 120], 4);
                    addText('AI Review Feedback', 18, true, [17, 24, 39], 20);
                    addText(task, 13, true, [55, 65, 81], 6);
                    if (currentLes?.title) addText(currentLes.title, 10, false, [120, 120, 120], 16);

                    addText('Your Answer', 11, true, [100, 100, 100], 6);
                    addText(noteVal, 12, false, [55, 65, 81], 20);

                    addText(`Score: ${feedback.score}/100  |  ${feedback.passed ? 'Passed' : 'Not yet passed'}`, 11, true, feedback.passed ? [16, 185, 129] : [245, 158, 11], 8);
                    addText(feedback.feedback, 12, false, [55, 65, 81], 0);

                    const slug = (task).replace(/\s+/g, '-').toLowerCase().slice(0, 40);
                    doc.save(`ai-review-${slug}.pdf`);
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                  style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#aaa' : '#666' }}>
                  <Download className="w-3 h-3" /> PDF
                </button>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: isDark ? '#ccc' : '#444' }}>{feedback.feedback}</p>
          </div>
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
      {wrongAnswer && (
        <p className="text-[13px] font-semibold" style={{ color: t.bad }}>Not quite. Try again.</p>
      )}
    </div>
  );
}
