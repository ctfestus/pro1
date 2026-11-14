'use client';

import { ThumbsUp } from 'lucide-react';
import { BriefAskThread } from '@/components/ve/BriefAskThread';
import { ChatCard, ChatMsg, ChatTypingMsg, ChatReaction, ChatThread } from '@/components/ve/ChatCard';
import { MailCard, MailThreadMsg, MailStatusChip, SmartReplies, type MailAttachment } from '@/components/ve/MailCard';
import { firstNameOf, workStamp, startTypingSound, anchorZone, quoteSnippet } from '@/components/ve/workplace';
import { applyNameTags } from '@/lib/merge-tags';
import { sanitizeEmailContent } from '@/lib/sanitize';
import type { RequirementProps } from './types';

/** Manager brief (email with smart replies) and scenario update (team chat with a thumbs up). */
export function BriefingRequirement({ req, qi, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, config, manager, meEmail, studentName, teamChannel, formId, flatIdx,
    currentLes, currentModId, currentLesId, reviewMode, progress, setProgress, saveProgress,
    downloadDataset, typingAcks, setTypingAcks, askOpen, setAskOpen, askSeen, setAskSeen,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  const isUpdate = req.type === 'scenario_update';
  const subject = req.label || (isUpdate ? 'Project update' : `${currentLes?.title || 'Mission'} brief`);
  const stamp = workStamp(flatIdx, qi, req.id);
  const acknowledge = (text?: string) => {
    if (reviewMode || done) return;
    setProgress(prev => {
      const next = { ...prev, [req.id]: { ...prev[req.id], completed: true, ...(text ? { notes: text } : {}) } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
    setTypingAcks(prev => new Set([...prev, req.id]));
    if (isUpdate) startTypingSound(2200);
    anchorZone(req.id);
    setTimeout(() => {
      setTypingAcks(prev => { const n = new Set(prev); n.delete(req.id); return n; });
      anchorZone(req.id);
    }, 2500);
  };

  if (isUpdate) {
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5">
        <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
          members={[manager]} unread={!done} muteArrival={reviewMode}>
          <ChatMsg isDark={isDark} author={manager} time={stamp.time}
            reactions={
              !done && !reviewMode ? (
                <ChatReaction isDark={isDark} accent={accentColor} emoji={<ThumbsUp className="w-3.5 h-3.5" />} onClick={() => acknowledge()} />
              ) : done ? (
                <ChatReaction isDark={isDark} accent={accentColor} emoji={<ThumbsUp className="w-3.5 h-3.5" />} count={1} active disabled />
              ) : null
            }>
            <p style={{ margin: 0 }}>{subject}</p>
            {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
          </ChatMsg>
          {done && (
            <ChatThread isDark={isDark} label="1 reply in thread">
              {typingAcks.has(req.id)
                ? <ChatTypingMsg isDark={isDark} author="me" meName={studentName} />
                : (
                  <ChatMsg isDark={isDark} author="me" meName={studentName} time="Just now">
                    <>Got it, on it. <ThumbsUp className="inline w-3.5 h-3.5 align-[-2px]" /></>
                  </ChatMsg>
                )}
            </ChatThread>
          )}
        </ChatCard>
      </div>
    );
  }

  // Email brief: full mail-client reader with smart replies
  const briefAttachments: MailAttachment[] = [
    ...(req.attachments || []).map(a => ({ name: a.name, url: a.url })),
    ...(config.dataset ? [{ name: config.dataset.filename || 'dataset.csv', onClick: downloadDataset }] : []),
  ];
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5">
      <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={subject}
        sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
        bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
        attachments={briefAttachments} company={config.company}
        done={done} muteArrival={reviewMode}
        chatAction={!reviewMode ? {
          label: `Chat with ${firstNameOf(manager.name)}`,
          onClick: () => { setAskOpen(new Set([req.id])); setAskSeen(prev => new Set([...prev, req.id])); },
          attention: !askSeen.has(req.id),
        } : undefined}>
        <div style={{ padding: '14px 22px 18px' }}>
          {!done && !reviewMode ? (
            <SmartReplies isDark={isDark} accent={accentColor}
              options={['Got it, starting now', 'On it, will update you soon', 'Received, thank you']}
              onPick={text => acknowledge(text)} />
          ) : done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                time={typingAcks.has(req.id) ? 'Sending...' : 'Just now'}
                receipt={typingAcks.has(req.id) ? undefined : `Seen by ${firstNameOf(manager.name)} just now`}
                quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
                {progress[req.id]?.notes || 'Got it, starting now'}
              </MailThreadMsg>
              <div><MailStatusChip accent={accentColor}>Brief acknowledged</MailStatusChip></div>
            </div>
          ) : null}
          {!reviewMode && (
            <BriefAskThread isDark={!!isDark} accent={accentColor} manager={manager} studentName={studentName}
              veId={formId} reqId={req.id}
              open={askOpen.has(req.id)}
              onOpenChange={o => setAskOpen(o ? new Set([req.id]) : new Set())} />
          )}
        </div>
      </MailCard>
    </div>
  );
}
