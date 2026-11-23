'use client';

import { ArrowBendUpLeft, CheckCircle, Circle, CircleNotch, LinkSimple, PaperPlaneRight, Paperclip, Warning } from '@phosphor-icons/react';
import AiReviewUpgradePrompt, { AiReviewDailyLimitNotice } from '@/components/AiReviewUpgradePrompt';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import { MailCard, MailThreadMsg, MailTypingRow, MailComposer, MailStatusChip, type MailAttachment } from '@/components/ve/MailCard';
import { AttachmentCard, firstNameOf, workStamp, anchorZone } from '@/components/ve/workplace';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';
import { applyNameTags } from '@/lib/merge-tags';
import { buildReviewNotes, parseReviewNotes, isFullReport } from '@/lib/reviewRecord';
import { sanitizeRichText, sanitizeEmailContent } from '@/lib/sanitize';
import { refreshAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import { repairVeSubmissionUrl, VE_SUBMISSION_ACCEPT } from '@/lib/ve-upload';
import ShortAnswerReviewResult, { savedShortAnswerResult, shortAnswerProgressFields, shortAnswerResultOf } from '@/components/ShortAnswerReviewResult';
import type { RequirementProps } from './types';
import { AiNote, TaskButton, TaskOption, taskTheme } from './TaskCard';

/** Any assessment requirement with emailFrame set, shown as a manager email thread.
 * The player only renders this for types it handles (see emailFrameHandles). */
export function EmailFramedRequirement({ req, qi, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, config, manager, meEmail, studentName,
    formId, authHeader, flatIdx, currentModId, currentLesId, reviewMode, entitlement, progress,
    setProgress, saveProgress, noteValues, setNoteValues, setNote, handleFileUpload, uploadingReq,
    uploadErrors, openReplies, setOpenReplies, efReviewing, setEfReviewing, efTyping, setEfTyping,
    efRounds, setEfRounds, efPending, setEfPending, aiReviewing, setAiReviewing, aiFeedback,
    setAiFeedback,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const selectedAnswer = progress[req.id]?.selectedAnswer;
  // Unused option slots are saved empty; they are not options.
  const mcqOptions     = (req.options || []).filter(o => String(o ?? '').trim());
  const isMcq          = req.type === 'mcq' && mcqOptions.length > 0;

  const t = taskTheme(isDark, accentColor);
  const efManager = manager.name;
  const efSubject = req.label || 'Task Assignment';
  const efStamp = workStamp(flatIdx, qi, req.id);
  const efAttachments: MailAttachment[] = (req.attachments || []).map(a => ({ name: a.name, url: a.url }));
  const efCard = (children: React.ReactNode) => (
    <div style={rowStyle} className="px-4 sm:px-8 py-5">
      <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={efSubject}
        sender={manager} toName={studentName} toEmail={meEmail} stamp={efStamp}
        bodyHtml={(req.emailBody || req.description) ? sanitizeEmailContent(applyNameTags(req.emailBody || req.description || '', studentName)) : undefined}
        attachments={efAttachments.length ? efAttachments : undefined}
        company={config.company} done={done} muteArrival={reviewMode}>
        {children}
      </MailCard>
    </div>
  );

  // MCQ: options as reply choices
  if (isMcq) {
    const isWrong = !!selectedAnswer && selectedAnswer !== req.correctAnswer;
    return efCard(
      !done ? (
        <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 4px' }}>Reply with your answer</p>
          {mcqOptions.map((opt, oi) => (
            <TaskOption key={oi} t={t} letter={String.fromCharCode(65 + oi)}
              state={selectedAnswer === opt && isWrong ? 'missed' : 'idle'} note="Not this one. Try again."
              onClick={() => {
                if (done) return;
                const correct = opt === req.correctAnswer;
                setProgress(prev => {
                  const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: correct } };
                  if (correct) saveProgress(next, currentModId, currentLesId);
                  return next;
                });
                anchorZone(req.id);
              }}>
              {opt}
            </TaskOption>
          ))}
        </div>
      ) : (
        <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MailThreadMsg isDark={isDark} from="me" meName={studentName}
            receipt={`Seen by ${firstNameOf(manager.name)} just now`}>
            {selectedAnswer}
          </MailThreadMsg>
          <div><MailStatusChip accent={accentColor}>Correct</MailStatusChip></div>
        </div>
      )
    );
  }

  // Text / Reflection: reply-composer thread with optional AI evaluation
  if (req.type === 'text' || req.type === 'reflection') {
    const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');
    const hasContent = noteVal.replace(/<[^>]*>/g, '').trim().length > 0;
    const rounds = efRounds[req.id] || [];
    const replyOpen = done || openReplies.has(req.id) || hasContent || rounds.length > 0;
    const needsEval = !!(req.aiReview || req.expectedAnswer);
    // Evaluation always completes the requirement (pass or fail is never a
    // gate), so `done` alone can't tell us whether to show the verdict or a
    // fresh composer. This flag lets a student who clicked "Reply" after
    // seeing feedback bypass the permanently-true `done` state.
    const wantsNewReply = needsEval && openReplies.has(req.id);
    const isTyping = efTyping[req.id];
    const isReviewing = efReviewing[req.id];
    // AI verdict is persisted (aiPassed/aiFeedback/aiScore) so a reload can
    // rebuild the feedback block and its Reply button - without this, a
    // refreshed page only knows "completed", not what the manager said.
    const persistedFeedback = progress[req.id]?.aiErrored
      // No upgradeUrl on a rebuild: the daily cap is about today, and an upsell
      // restored from yesterday's saved state would be telling them to buy their
      // way out of a limit that has already reset.
      ? { passed: false, feedback: progress[req.id]?.aiFeedback || 'We could not complete an AI review of your response. Please try again.', score: 0, errored: true, upgradeUrl: undefined }
      : savedShortAnswerResult(progress[req.id]);
    const feedback = aiFeedback[req.id] !== undefined ? aiFeedback[req.id] : persistedFeedback;
    const fbErrored = !!feedback?.errored;
    // Neutral tone for a review that never ran; green/amber only for a real verdict.
    const fbTone = !feedback ? null : fbErrored
      ? { bg: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)', border: isDark ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.40)', color: isDark ? '#cbd5e1' : '#64748b', label: 'Review unavailable' }
      : feedback.passed
      ? { bg: `${accentColor}12`, border: `${accentColor}40`, color: accentColor, label: 'Correct' }
      : { bg: `${t.bad}12`, border: `${t.bad}40`, color: t.bad, label: 'Incorrect' };
    const evaluating = !!aiReviewing[req.id];
    // What the thread shows as "sent": the in-flight attempt first, then saved notes
    const sentText = efPending[req.id] || progress[req.id]?.notes || noteValues[req.id] || '';
    const efMeReply = (
      <div style={{ marginBottom: 18 }}>
        <MailThreadMsg isDark={isDark} from="me" meName={studentName}>
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(sentText) }} />
        </MailThreadMsg>
      </div>
    );
    const handleSend = () => {
      if (!hasContent) return;
      if (!needsEval) {
        setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
        anchorZone(req.id);
        return;
      }
      const delay = 2000 + Math.floor(Math.random() * 2001);
      setEfTyping(prev => ({ ...prev, [req.id]: true }));
      setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; });
      anchorZone(req.id);
      if (req.aiReview) {
        // AI evaluation path: always marks done (informational feedback)
        // Save note immediately so the thread shows the sent text during the delay
        setProgress(prev => ({ ...prev, [req.id]: { ...prev[req.id], notes: noteVal } }));
        setAiReviewing(prev => ({ ...prev, [req.id]: true }));
        setAiFeedback(prev => ({ ...prev, [req.id]: null }));
        fetch('/api/ve-answer-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ veId: formId, reqId: req.id, studentAnswer: noteVal }),
        })
        .then(async r => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
        .then(({ ok, json }) => {
          refreshAiReviewEntitlement();
          if (ok) {
            // A real verdict from the model - record it (pass or fail) and clear
            // any prior error marker.
            const result = shortAnswerResultOf(json);
            setAiFeedback(prev => ({ ...prev, [req.id]: result }));
            setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: undefined, ...shortAnswerProgressFields(result) } }; saveProgress(next, currentModId, currentLesId); return next; });
          } else {
            // A review that never ran. Three different things land here and they must not
            // be treated alike. A fault -- reviewer down, bad request, timeout -- is not
            // the student's doing, so it still marks the step done rather than trapping
            // them. A spent free-tier credit is the rule working as intended; marking that
            // done would hand a learner every remaining AI step the moment they burn one.
            const fb = json.error || 'We could not complete an AI review of your response right now. Please edit your answer if needed and try again.';
            const up = json.code === 'daily_limit_reached' ? String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL) : undefined;
            setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true, upgradeUrl: up } }));
            setProgress(prev => {
              // Out of credit: keep their draft, leave the step as it was. None of this
              // refusal is worth persisting -- the cap resets, the message would not.
              const entry = up
                ? { ...prev[req.id], notes: noteVal }
                : { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined };
              const next = { ...prev, [req.id]: entry };
              saveProgress(next, currentModId, currentLesId);
              return next;
            });
          }
        })
        .catch(() => {
          // Network/parse failure - same distinct error state; progression stays open.
          const fb = 'We could not complete an AI review of your response right now due to a temporary issue. Please try again.';
          setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true } }));
          setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined } }; saveProgress(next, currentModId, currentLesId); return next; });
        })
        .finally(() => setAiReviewing(prev => ({ ...prev, [req.id]: false })));
        setTimeout(() => {
          setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
          setEfReviewing(prev => ({ ...prev, [req.id]: true }));
          anchorZone(req.id);
        }, delay);
      } else {
        // Manual comparison: compare against expectedAnswer locally, no answer revealed.
        // A wrong attempt stays in the thread as a sent reply + manager response,
        // and a fresh empty composer opens below - never edit the old message.
        const attempt = noteVal;
        const normalize = (s: string) => s.replace(/<[^>]*>/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
        const studentNorm = normalize(attempt);
        const expectedNorm = normalize(req.expectedAnswer || '');
        const passed = studentNorm === expectedNorm || studentNorm.includes(expectedNorm) || expectedNorm.includes(studentNorm);
        setEfPending(prev => ({ ...prev, [req.id]: attempt }));
        setNote(req.id, '');
        setTimeout(() => {
          setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
          setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
          if (passed) {
            setEfReviewing(prev => ({ ...prev, [req.id]: true }));
            setAiFeedback(prev => ({ ...prev, [req.id]: { passed: true, score: 100, feedback: `That is correct, ${firstNameOf(studentName)}. Well done.` } }));
            setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: attempt, completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
          } else {
            setEfRounds(prev => ({ ...prev, [req.id]: [...(prev[req.id] || []), { me: attempt, feedback: `That is not quite right, ${firstNameOf(studentName)}. Take another look at the question and send me a new reply.`, passed: false }] }));
          }
          anchorZone(req.id);
        }, delay);
      }
    };
    const efHistory = rounds.length > 0 ? (
      <div style={{ padding: '16px 22px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {rounds.map((r, ri) => (
          <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <MailThreadMsg isDark={isDark} from="me" meName={studentName} time="Earlier">
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(r.me) }} />
            </MailThreadMsg>
            <MailThreadMsg isDark={isDark} from={manager} time="Earlier">
              <div style={{ borderRadius: 10, padding: '12px 16px', background: r.passed ? `${accentColor}12` : `${t.bad}12`, border: `1px solid ${r.passed ? `${accentColor}40` : `${t.bad}40`}` }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: r.passed ? accentColor : t.bad, marginBottom: 8 }}>
                  {r.passed ? <CheckCircle weight="fill" className="w-4 h-4" /> : <Circle weight="bold" className="w-4 h-4" />}
                  {r.passed ? 'Correct' : 'Incorrect'}
                </div>
                <p style={{ fontSize: 13.5, color: isDark ? '#ddd' : '#333', margin: 0, lineHeight: 1.6 }}>{r.feedback}</p>
              </div>
            </MailThreadMsg>
          </div>
        ))}
      </div>
    ) : null;
    return efCard(
      <>
      {efHistory}
      {isTyping ? (
        <div style={{ padding: '16px 22px 20px' }}>
          {efMeReply}
          <MailTypingRow isDark={isDark} person={manager} />
        </div>
      ) : (isReviewing || (done && needsEval && !wantsNewReply)) ? (
        <div style={{ padding: '16px 22px 20px' }}>
          {efMeReply}
          {/* Manager: received */}
          <div style={{ marginBottom: feedback ? 18 : 0 }}>
            <MailThreadMsg isDark={isDark} from={manager}>
              <p style={{ margin: '0 0 10px' }}>Thanks for your response, {firstNameOf(studentName)}. Let me review what you have written.</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: evaluating ? (isDark ? '#2a2a2a' : '#f0f0f0') : `${accentColor}12`, color: evaluating ? (isDark ? '#888' : '#666') : accentColor, border: `1px solid ${evaluating ? 'transparent' : accentColor + '30'}`, fontSize: 12.5 }}>
                {evaluating ? <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" style={{ display: 'inline' }} /> : fbErrored ? <Warning weight="duotone" className="w-3.5 h-3.5" style={{ display: 'inline' }} /> : <CheckCircle weight="fill" className="w-3.5 h-3.5" style={{ display: 'inline' }} />}
                {evaluating ? 'Reviewing your answer...' : fbErrored ? 'Could not review' : 'Reviewed'}
              </div>
            </MailThreadMsg>
          </div>
          {/* Manager: feedback reply */}
          {feedback && fbTone && (
            <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, paddingTop: 18 }}>
              {feedback.upgradeUrl ? (
                <AiReviewDailyLimitNotice accentColor={accentColor} isDark={isDark} resetsInSeconds={entitlement.resetsInSeconds} priceLabel={entitlement.priceLabel} limit={entitlement.limit} canUpgrade={entitlement.canUpgrade} upgradeUrl={feedback.upgradeUrl} />
              ) : (
              <MailThreadMsg isDark={isDark} from={manager}>
                <p style={{ margin: '0 0 12px' }}>{fbErrored ? 'I could not review your response just now:' : 'Hi, here is my feedback on your response:'}</p>
                {/* An AI verdict is the structured review; a manual comparison and a review that never ran keep the note. */}
                {req.aiReview && !fbErrored ? (
                  <ShortAnswerReviewResult result={feedback} isDark={!!isDark} accentColor={accentColor} />
                ) : (
                  <div style={{ borderRadius: 10, padding: '12px 16px', background: fbTone.bg, border: `1px solid ${fbTone.border}` }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: fbTone.color, marginBottom: 8 }}>
                      {fbErrored ? <Warning weight="duotone" className="w-4 h-4" /> : feedback.passed ? <CheckCircle weight="fill" className="w-4 h-4" /> : <Circle weight="bold" className="w-4 h-4" />}
                      {fbTone.label}
                    </div>
                    <p style={{ fontSize: 13.5, color: isDark ? '#ddd' : '#333', margin: 0, lineHeight: 1.6 }}>{feedback.feedback}</p>
                  </div>
                )}
              </MailThreadMsg>
              )}
              {/* A wrong answer or a failed review both get a way back to the composer;
                  only a real pass moves the mission on. */}
              {!evaluating && !reviewMode && !feedback.passed && (
                <button
                  onClick={() => {
                    // A real wrong answer is archived into the thread as a graded round
                    // and its text cleared; an errored (never-reviewed) attempt is neither,
                    // so the student keeps their draft to fix and resend.
                    if (!fbErrored) {
                      setEfRounds(prev => ({ ...prev, [req.id]: [...(prev[req.id] || []), { me: sentText, feedback: feedback.feedback, passed: feedback.passed }] }));
                      setNoteValues(prev => ({ ...prev, [req.id]: '' }));
                    }
                    setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                    // Reset the "received/reviewing" state too - otherwise the render
                    // stays locked on the Reviewed chip and the composer never opens.
                    setEfReviewing(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                    setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                    setOpenReplies(prev => new Set([...prev, req.id]));
                  }}
                  style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                  <ArrowBendUpLeft weight="bold" className="w-4 h-4" /> {fbErrored ? 'Try again' : 'Reply'}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (done && !wantsNewReply) ? (
        // Simple done (no evaluation)
        <div style={{ padding: '16px 22px 20px' }}>
          {efMeReply}
          <MailStatusChip accent={accentColor}>Reply sent to {efManager}</MailStatusChip>
        </div>
      ) : !replyOpen ? (
        <div style={{ padding: '14px 22px' }}>
          {!reviewMode && (
            <TaskButton t={t} onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}><ArrowBendUpLeft weight="bold" className="w-4 h-4" /> Reply</TaskButton>
          )}
        </div>
      ) : (
        <div style={{ padding: '14px 22px 18px' }}>
          {/* Not part of this plan at all. Said before they write, not after they send. */}
          {req.aiReview && entitlement.locked && (
            <div style={{ marginBottom: 12 }}>
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
            </div>
          )}
          {req.aiReview && !entitlement.locked && entitlement.exhausted && (
            <div style={{ marginBottom: 12 }}>
              <AiReviewDailyLimitNotice accentColor={accentColor} isDark={isDark} resetsInSeconds={entitlement.resetsInSeconds} priceLabel={entitlement.priceLabel} limit={entitlement.limit} canUpgrade={entitlement.canUpgrade} upgradeUrl={entitlement.upgradeUrl} />
            </div>
          )}
          <MailComposer isDark={isDark} accent={accentColor} to={manager} subject={efSubject}
            value={noteVal} onChange={(html) => setNote(req.id, html)} canSend={hasContent && !(req.aiReview && entitlement.exhausted && !entitlement.locked)} onSend={handleSend}
            placeholder={rounds.length ? 'Write a new reply...' : 'Write your reply...'}
            maxChars={req.aiReview ? 2000 : undefined}
            onDiscard={() => { setNote(req.id, ''); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
        </div>
      )}
      </>
    );
  }

  // Upload / Task / Deliverable: Reply attachment thread
  if (req.type === 'upload' || req.type === 'task' || req.type === 'deliverable') {
    const fileUrl = progress[req.id]?.fileUrl || '';
    const linkUrl = progress[req.id]?.linkUrl || '';
    const uploaded = !!(fileUrl || linkUrl);
    const replyOpen = openReplies.has(req.id) || uploaded;
    const uploading = uploadingReq === req.id;
    const isTyping = efTyping[req.id];
    const showReply = !isTyping && (efReviewing[req.id] || done);
    const isTask = req.type === 'task';
    const isDeliverable = req.type === 'deliverable';
    const efManagerReply = isTask
      ? `Got it, ${firstNameOf(studentName)} - noted. I have recorded that you have completed this task.`
      : isDeliverable
      ? `Thanks, ${firstNameOf(studentName)}. I will review your deliverable and get back to you shortly.`
      : `Thanks for the submission, ${firstNameOf(studentName)}. It is under review - I will get back to you shortly.`;
    const efMeThread = (
      <div style={{ marginBottom: 18 }}>
        <MailThreadMsg isDark={isDark} from="me" meName={studentName}
          receipt={showReply ? `Seen by ${firstNameOf(manager.name)} just now` : undefined}>
          {isTask
            ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'}`, fontSize: 12.5, color: isDark ? '#ddd' : '#334155' }}><CheckCircle weight="fill" className="w-3 h-3" /> Task marked as done</div>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {fileUrl && (
                  <AttachmentCard isDark={isDark} href={repairVeSubmissionUrl(fileUrl)}
                    name={(() => { try { return decodeURIComponent(fileUrl.split('/').pop()?.split('?')[0] || ''); } catch { return ''; } })() || (isDeliverable ? 'Deliverable' : 'Attachment')} />
                )}
                {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'}`, fontSize: 12.5, color: isDark ? '#ddd' : '#334155', textDecoration: 'none' }}><LinkSimple weight="bold" className="w-3 h-3" /> {linkUrl.slice(0, 40)}{linkUrl.length > 40 ? '...' : ''}</a>}
              </div>
            )
          }
        </MailThreadMsg>
      </div>
    );
    const handleEfSend = () => {
      setEfTyping(prev => ({ ...prev, [req.id]: true }));
      anchorZone(req.id);
      const delay = 2000 + Math.floor(Math.random() * 2001);
      setTimeout(() => {
        setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
        setEfReviewing(prev => ({ ...prev, [req.id]: true }));
        if (!reviewMode) setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
        anchorZone(req.id);
      }, delay);
    };
    return efCard(
      !done && !isTyping && !efReviewing[req.id] ? (
        // Task: single "I am done" button -- no attachment needed
        isTask ? (
          <div style={{ padding: '14px 22px' }}>
            {!reviewMode && (
              <TaskButton t={t} onClick={handleEfSend}><CheckCircle weight="fill" className="w-4 h-4" /> I am done with this task</TaskButton>
            )}
          </div>
        ) : !replyOpen ? (
          // Upload / Deliverable: show open-compose button
          <div style={{ padding: '14px 22px' }}>
            {!reviewMode && (
              <TaskButton t={t} onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}><Paperclip weight="bold" className="w-4 h-4" /> {isDeliverable ? 'Submit deliverable' : 'Attach your work'}</TaskButton>
            )}
          </div>
        ) : (
          // Compose: attach file / paste link
          <div style={{ padding: '14px 22px 18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="ve-file-label relative" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 16px', borderRadius: 10, border: `1.5px dashed ${fileUrl ? `${accentColor}80` : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)'}`, background: t.soft, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13.5, color: t.muted }}>
                {uploading ? <CircleNotch weight="bold" className="w-4 h-4 animate-spin" style={{ color: accentColor }} /> : <Paperclip weight="bold" className="w-4 h-4" />}
                <span>{uploading ? 'Uploading...' : fileUrl ? <b style={{ color: t.text, fontWeight: 600 }}>File attached. Choose another to replace it</b> : <><b style={{ color: t.text, fontWeight: 600 }}>Choose a file</b> to attach</>}</span>
                <input type="file" accept={VE_SUBMISSION_ACCEPT} className="sr-only" disabled={uploading} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  await handleFileUpload(req.id, file, true);
                  e.target.value = '';
                }} />
              </label>
              {uploadErrors[req.id] && <p role="alert" style={{ margin: 0, color: t.bad, fontSize: 12.5 }}>{uploadErrors[req.id]}</p>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 10, background: t.soft }}>
                <LinkSimple weight="bold" className="w-3.5 h-3.5" style={{ color: t.faint, flexShrink: 0 }} />
                <input type="url" value={linkUrl} onChange={e => setProgress(prev => ({ ...prev, [req.id]: { ...prev[req.id], linkUrl: e.target.value } }))}
                  placeholder="Or paste a link (Google Drive, GitHub...)" aria-label="Or paste a link"
                  style={{ flex: 1, minWidth: 0, padding: '10px 0', border: 'none', background: 'transparent', color: t.text, fontSize: 13.5, outline: 'none' }} />
              </div>
              <div>
                <TaskButton t={t} onClick={handleEfSend} disabled={!(fileUrl || linkUrl)}><PaperPlaneRight weight="duotone" className="w-3.5 h-3.5" /> {isDeliverable ? 'Submit deliverable' : 'Send'}</TaskButton>
              </div>
            </div>
          </div>
        )
      ) : isTyping ? (
        <div style={{ padding: '16px 22px 20px' }}>
          {efMeThread}
          <MailTypingRow isDark={isDark} person={manager} />
        </div>
      ) : showReply ? (
        <div style={{ padding: '16px 22px 20px' }}>
          {efMeThread}
          <MailThreadMsg isDark={isDark} from={manager}>
            <p style={{ margin: '0 0 10px' }}>{efManagerReply}</p>
            <MailStatusChip accent={accentColor}>{isTask ? 'Noted' : 'Received'}</MailStatusChip>
          </MailThreadMsg>
        </div>
      ) : null
    );
  }

  // AI review types: full email thread -- compose reviewing manager report
  if (req.type === 'dashboard_critique' || req.type === 'code_review' || req.type === 'excel_review' || req.type === 'document_review') {
    const saved = progress[req.id];
    const savedReport = parseReviewNotes(saved?.notes)?.report;
    const reviewing = efReviewing[req.id] && !done;
    const typeLabel = req.type === 'dashboard_critique' ? 'dashboard' : req.type === 'code_review' ? 'code' : req.type === 'excel_review' ? 'Excel file' : 'document';
    const markDone = (notes: string, completed: boolean) => setProgress(prev => { const next = { ...prev, [req.id]: { completed, notes } }; saveProgress(next, currentModId, currentLesId); return next; });
    const startReview = () => {
      setEfTyping(prev => ({ ...prev, [req.id]: true }));
      anchorZone(req.id);
      const delay = 2000 + Math.floor(Math.random() * 2001);
      setTimeout(() => {
        setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
        setEfReviewing(prev => ({ ...prev, [req.id]: true }));
        anchorZone(req.id);
      }, delay);
    };
    const finishReview = () => {};
    const onReviewError = () => {
      setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
      setEfReviewing(prev => { const n = { ...prev }; delete n[req.id]; return n; });
    };
    return efCard(
      <>
        {/* Compose: hidden once typing/reviewing starts */}
        {!done && !efTyping[req.id] && !efReviewing[req.id] && (
          <div style={{ padding: '14px 22px 18px' }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 10px' }}>
              {req.type === 'dashboard_critique' ? 'Attach your dashboard for review' : req.type === 'code_review' ? 'Paste or upload your code' : req.type === 'excel_review' ? 'Upload your Excel file' : 'Upload your document'}
            </p>
            {!(req.type === 'document_review' && req.documentReviewMode === 'manual') && <div style={{ marginBottom: 10 }}><AiNote t={t} /></div>}
            {req.type === 'dashboard_critique' && (
              <DashboardCritiquePlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                savedResult={undefined} savedImageUrl={undefined} rubric={req.rubric}
                onReviewStart={startReview} onReviewError={onReviewError}
                onComplete={(result) => { finishReview(); markDone(buildReviewNotes('dashboard_critique', result, saved?.notes), true); }} />
            )}
            {req.type === 'code_review' && (
              <CodeReviewPlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                savedResult={undefined} rubric={req.rubric} schema={req.schema} reviewLanguage={req.reviewLanguage} minScore={req.minScore}
                onReviewStart={startReview} onReviewError={onReviewError}
                onComplete={(result, passed) => { finishReview(); markDone(buildReviewNotes('code_review', result, saved?.notes), passed); }} />
            )}
            {req.type === 'excel_review' && (
              <ExcelReviewPlayer hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                savedResult={undefined} context={req.context} reviewSheetNames={req.reviewSheetNames}
                reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} rubric={req.rubric} minScore={req.minScore}
                onReviewStart={startReview} onReviewError={onReviewError}
                onComplete={(result, passed) => { finishReview(); markDone(buildReviewNotes('excel_review', result, saved?.notes), passed); }} />
            )}
            {req.type === 'document_review' && (
              <DocumentReviewPlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
                onComplete={(result, passed) => markDone(buildReviewNotes('document_review', result, saved?.notes), passed)} />
            )}
          </div>
        )}
        {/* Manager typing dots -- shows for 2-4s after student submits */}
        {efTyping[req.id] && (
          <div style={{ padding: '16px 22px 20px' }}>
            <div style={{ marginBottom: 18 }}>
              <MailThreadMsg isDark={isDark} from="me" meName={studentName}>
                Submitted my {typeLabel} for review.
              </MailThreadMsg>
            </div>
            <MailTypingRow isDark={isDark} person={manager} />
          </div>
        )}
        {/* Manager "received + reviewing" reply -- persists when done so both replies stay in thread */}
        {!efTyping[req.id] && (efReviewing[req.id] || done) && (
          <div style={{ padding: '16px 22px 20px' }}>
            <div style={{ marginBottom: 18 }}>
              <MailThreadMsg isDark={isDark} from="me" meName={studentName} time="Earlier"
                receipt={`Seen by ${firstNameOf(manager.name)}`}>
                Submitted my {typeLabel} for review.
              </MailThreadMsg>
            </div>
            <MailThreadMsg isDark={isDark} from={manager}>
              <p style={{ margin: '0 0 10px' }}>Thanks, {firstNameOf(studentName)} - I have received your {typeLabel} and it is currently under review. I will get back to you shortly.</p>
              {!done && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#888' : '#999', fontSize: 12.5 }}>
                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" style={{ color: accentColor }} /> AI is reviewing your {typeLabel}...
                </div>
              )}
              {done && <MailStatusChip accent={accentColor}>Review complete</MailStatusChip>}
            </MailThreadMsg>
          </div>
        )}
        {/* Manager report -- appears below the received reply once AI finishes */}
        {done && (
          <div style={{ padding: '16px 22px 20px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
            <MailThreadMsg isDark={isDark} from={manager}>
              <p style={{ margin: '0 0 4px' }}>Hi {firstNameOf(studentName)},</p>
              <p style={{ margin: '0 0 18px' }}>Thanks for sending over your {typeLabel}. I have completed the review - please find my detailed feedback below.</p>
              <div style={{ background: isDark ? '#111' : '#f8fafc', borderRadius: 10, padding: 16, border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                {req.type === 'dashboard_critique' && savedReport && (
                  <DashboardCritiquePlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                    savedResult={savedReport as any} savedImageUrl={undefined} rubric={req.rubric} onComplete={() => {}} />
                )}
                {req.type === 'code_review' && savedReport && (
                  <CodeReviewPlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                    savedResult={isFullReport('code_review', savedReport) ? savedReport as any : undefined}
                    rubric={req.rubric} schema={req.schema} reviewLanguage={req.reviewLanguage} minScore={req.minScore} onComplete={() => {}} />
                )}
                {req.type === 'excel_review' && savedReport && (
                  <ExcelReviewPlayer hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                    savedResult={isFullReport('excel_review', savedReport) ? savedReport as any : undefined}
                    context={req.context} reviewSheetNames={req.reviewSheetNames} rubric={req.rubric} minScore={req.minScore} onComplete={() => {}} />
                )}
                {req.type === 'document_review' && savedReport && (
                  <DocumentReviewPlayer reviewTarget={{ source: 'virtual_experience', contentId: formId, itemId: req.id }} hideWorkspaceHeader reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                    savedResult={isFullReport('document_review', savedReport) ? savedReport as any : undefined}
                    context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode} onComplete={() => {}} />
                )}
              </div>
              <div style={{ marginTop: 12 }}><AiNote t={t} /></div>
              <p style={{ margin: '18px 0 0' }}>Let me know if anything is unclear.</p>
              <p style={{ margin: '4px 0 0' }}>Best,<br />{firstNameOf(manager.name)}</p>
            </MailThreadMsg>
          </div>
        )}
      </>
    );
  }

  return null;
}
