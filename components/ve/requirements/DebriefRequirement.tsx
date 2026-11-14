'use client';

import { Reply } from 'lucide-react';
import { MailCard, MailThreadMsg, MailComposer, MailStatusChip } from '@/components/ve/MailCard';
import { firstNameOf, workStamp, anchorZone, quoteSnippet } from '@/components/ve/workplace';
import { applyNameTags } from '@/lib/merge-tags';
import { sanitizeRichText, sanitizeEmailContent } from '@/lib/sanitize';
import type { RequirementProps } from './types';

/** Debrief email the learner answers with a written reply. */
export function DebriefRequirement({ req, qi, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, config, manager, meEmail, studentName, flatIdx, currentLes, currentModId,
    currentLesId, reviewMode, progress, setProgress, saveProgress, noteValues, setNote, openReplies,
    setOpenReplies,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');
  const debriefSubject = req.label || `Re: ${currentLes?.title || 'Mission'}`;
  const hasContent = noteVal.replace(/<[^>]*>/g, '').trim().length > 0;
  const replyOpen = done || openReplies.has(req.id) || hasContent;
  const stamp = workStamp(flatIdx, qi, req.id);
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5">
      <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={debriefSubject}
        sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
        bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
        company={config.company} done={done} muteArrival={reviewMode}>
        {!done ? (
          !replyOpen ? (
            <div style={{ padding: '14px 22px' }}>
              {!reviewMode && (
                <button
                  onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                  <Reply className="w-4 h-4" /> Reply
                </button>
              )}
            </div>
          ) : (
            <div style={{ padding: '14px 22px 18px' }}>
              <MailComposer isDark={isDark} accent={accentColor} to={manager} subject={debriefSubject}
                value={noteVal} onChange={(html) => setNote(req.id, html)} canSend={hasContent}
                onSend={() => {
                  if (!hasContent) return;
                  setProgress(prev => {
                    const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true } };
                    saveProgress(next, currentModId, currentLesId);
                    return next;
                  });
                  anchorZone(req.id);
                }}
                onDiscard={() => { setNote(req.id, ''); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
            </div>
          )
        ) : (
          <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <MailThreadMsg isDark={isDark} from="me" meName={studentName}
              receipt={`Seen by ${firstNameOf(manager.name)} just now`}
              quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(noteVal) }} />
            </MailThreadMsg>
            <div><MailStatusChip accent={accentColor}>Reply sent to {manager.name}</MailStatusChip></div>
          </div>
        )}
      </MailCard>
    </div>
  );
}
