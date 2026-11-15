'use client';

import { Package, MessageCircle, Paperclip, Check, Pencil, RotateCcw } from 'lucide-react';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import { sanitizeRichTextWithImages } from '@/lib/sanitize';
import { resolveDeliverableAccent } from '@/lib/ve-accent';
import { REQ_META, type RequirementProps } from './types';
import { TaskHeader, TaskButton, TaskIconButton, taskTheme, fieldStyle, TASK_FIELD } from './TaskCard';

/** Tasks, deliverables, and the reflection card that is the fallback for any other type. */
export function TaskRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, reviewMode, progress, noteValues, setNote, toggleReq,
  } = ctx;
  const done    = !!progress[req.id]?.completed;
  const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');

  // Deliverable: read the instructions, then mark it complete. The editor offers this as
  // "Deliverable (Brief + Checkbox)" and saves it as type 'task' ('deliverable' is the older
  // name), so both read as a deliverable to the learner. A deliverable may carry its
  // own accent colour; it styles the card's button and pill, while embedded instructions keep the
  // experience accent.
  if (req.type === 'task' || req.type === 'deliverable') {
    const t = taskTheme(isDark, resolveDeliverableAccent(req.accentColor, accentColor, !!isDark));
    const attachments = req.attachments || [];
    return (
      <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
        <TaskHeader t={t} icon={<Package className="w-3.5 h-3.5" />}
          label="Deliverable" title={req.label}
          description={!req.descriptionDoc && req.descriptionFormat !== 'rich' ? req.description : undefined}
          done={done ? 'Complete' : null}
          doneAction={!reviewMode && <TaskIconButton t={t} label="Undo" icon={<RotateCcw className="w-4 h-4" />} onClick={() => toggleReq(req.id)} />} />

        {req.descriptionDoc ? (
          // Scoped so guided steps inside a deliverable read as a plain numbered list: the card has
          // its own "Mark complete", so a second Continue button there would compete with it.
          <div className="ve-task-instructions">
            <LessonRenderer doc={req.descriptionDoc} isDark={isDark} accentColor={accentColor} />
          </div>
        ) : req.descriptionFormat === 'rich' && req.description ? (
          <div className="rich-content text-[13.5px] leading-relaxed" style={{ color: t.text }}
            dangerouslySetInnerHTML={{ __html: sanitizeRichTextWithImages(req.description) }} />
        ) : null}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold hover:opacity-80"
                style={{ background: t.soft, color: t.text }}>
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.muted }} />
                <span className="truncate">{a.name || 'Open resource'}</span>
              </a>
            ))}
          </div>
        )}

        {!reviewMode && !done && (
          <div className="flex items-center gap-3 pt-1">
            <TaskButton t={t} onClick={() => toggleReq(req.id)}><Check className="w-4 h-4" strokeWidth={3} /> Mark deliverable complete</TaskButton>
          </div>
        )}
      </div>
    );
  }

  // Reflection, and any other type without its own card: write notes (saved as you type), then
  // save to mark it done.
  const t = taskTheme(isDark, accentColor);
  const meta = REQ_META[req.type] || REQ_META.reflection;
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <TaskHeader t={t} icon={<MessageCircle className="w-3.5 h-3.5" />} label={meta.label} title={req.label}
        description={req.description} done={done ? 'Saved' : null}
        doneAction={!reviewMode && <TaskIconButton t={t} label="Edit" icon={<Pencil className="w-4 h-4" />} onClick={() => toggleReq(req.id)} />} />
      {done ? (
        noteVal.trim() ? (
          <p className="whitespace-pre-wrap rounded-[10px] px-3 py-2.5 text-[14px]" style={{ background: t.soft, color: t.text }}>{noteVal}</p>
        ) : null
      ) : (
        <>
          <textarea value={noteVal} onChange={e => setNote(req.id, e.target.value)} readOnly={reviewMode}
            placeholder="Write your notes" aria-label="Write your notes" rows={3}
            className={`${TASK_FIELD} w-full resize-y px-3 py-2.5 text-[14px]`} style={fieldStyle(t)} />
          {!reviewMode && (
            <div className="flex justify-end">
              <TaskButton t={t} onClick={() => toggleReq(req.id)}>Save reflection</TaskButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
