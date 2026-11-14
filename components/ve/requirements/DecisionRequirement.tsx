'use client';

import { ChatCard, ChatMsg, ChatTypingMsg, ChatThread, ChatDecisionButtons } from '@/components/ve/ChatCard';
import { firstNameOf, workStamp, startTypingSound, anchorZone, colleaguesFor, hashStr, type Person } from '@/components/ve/workplace';
import type { RequirementProps } from './types';

/** A decision posted in team chat; the manager and a colleague reply to the pick. */
export function DecisionRequirement({ req, qi, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, config, manager, studentName, teamChannel, flatIdx, currentModId,
    currentLesId, reviewMode, progress, setProgress, saveProgress, typingDecisions,
    setTypingDecisions,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const selectedAnswer = progress[req.id]?.selectedAnswer;

  const options = (req.options || []).filter(Boolean);
  const selectedIdx = selectedAnswer ? (req.options || []).findIndex(opt => opt === selectedAnswer) : -1;
  const selectedFeedback = selectedIdx >= 0 ? req.optionFeedback?.[selectedIdx] : '';
  const stamp = workStamp(flatIdx, qi, req.id);
  const colleague: Person = { name: colleaguesFor(config.company || teamChannel, 1)[0], color: '#E8912D' };
  const colleagueLine = ['Good call.', '+1, agreed.', 'Nice - that unblocks us.', 'Makes sense to me.'][hashStr(req.id) % 4];
  const chooseDecision = (opt: string) => {
    if (reviewMode || done) return;
    setProgress(prev => {
      const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: true } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
    setTypingDecisions(prev => new Set([...prev, req.id]));
    startTypingSound(2800);
    anchorZone(req.id);
    setTimeout(() => {
      setTypingDecisions(prev => { const n = new Set(prev); n.delete(req.id); return n; });
      anchorZone(req.id);
    }, 3000);
  };
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5">
      <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
        members={[manager]} unread={!done} muteArrival={reviewMode}>
        <ChatMsg isDark={isDark} author={manager} time={stamp.time}>
          <p style={{ margin: 0 }}>{req.label}</p>
          {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
          {!done && (
            <ChatDecisionButtons isDark={isDark} accent={accentColor} options={options}
              onPick={chooseDecision} disabled={reviewMode} />
          )}
        </ChatMsg>
        {done && selectedAnswer && (
          <ChatThread isDark={isDark}
            label={typingDecisions.has(req.id) ? '1 reply in thread' : '3 replies in thread'}>
            <ChatMsg isDark={isDark} author="me" meName={studentName} time="Just now">
              {selectedAnswer}
            </ChatMsg>
            {typingDecisions.has(req.id) ? (
              <ChatTypingMsg isDark={isDark} author={manager} />
            ) : (
              <>
                <ChatMsg isDark={isDark} author={manager} time="Just now">
                  {selectedFeedback || `Noted, ${firstNameOf(studentName)}. Keep moving forward.`}
                </ChatMsg>
                <ChatMsg isDark={isDark} author={colleague} time="Just now">
                  {colleagueLine}
                </ChatMsg>
              </>
            )}
          </ChatThread>
        )}
      </ChatCard>
    </div>
  );
}
