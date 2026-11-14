'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import { DeliverableChecklist } from '@/components/ve/DeliverableChecklist';
import { resolveDeliverableAccent } from '@/lib/ve-accent';
import { REQ_META, type RequirementProps } from './types';

/** Task and deliverable checklists, and the reflection card that is the fallback for any other type. */
export function TaskRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, fieldBg, fieldBorder, fieldShadow, reviewMode, progress, noteValues,
    setNote, toggleReq,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  //: Default fallback (task / deliverable / reflection) -
  const meta    = REQ_META[req.type] || REQ_META.reflection;
  const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');

  // Simple completion items: a clear status circle without an extra response field.
  if (req.type === 'task' || req.type === 'deliverable') {
    return (
      <div
        style={{ ...rowStyle, borderLeft: 'none', background: 'transparent' }}
        className="px-4 sm:px-8 py-4">
        <DeliverableChecklist
          title={req.label}
          instructions={req.description}
          instructionsFormat={req.descriptionFormat}
          instructionsDoc={req.descriptionDoc}
          attachments={req.attachments}
          completed={done}
          readOnly={reviewMode}
          isDark={isDark}
          accentColor={resolveDeliverableAccent(req.accentColor, accentColor, !!isDark)}
          contentAccentColor={accentColor}
          textColor={isDark ? '#f0f0f0' : '#111'}
          mutedColor={isDark ? '#888' : '#666'}
          onToggle={() => toggleReq(req.id)}
        />
      </div>
    );
  }

  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-2.5">
      <div className="flex items-start gap-3">
        <button onClick={() => toggleReq(req.id)} className="flex-shrink-0 mt-0.5">
          {done
            ? <CheckCircle2 className="w-4 h-4" style={{ color: accentColor }} />
            : <Circle className="w-5 h-5" style={{ color: accentColor, opacity: 0.5 }} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
            <span className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</span>
          </div>
          <p className="text-[12.5px] leading-snug" style={{ color: isDark ? '#888' : '#555' }}>{req.description}</p>
          {!done && !reviewMode && (
            <p className="text-[11.5px] mt-1.5 font-semibold" style={{ color: accentColor, opacity: 0.75 }}>
              Add your notes, then click the circle to mark as done
            </p>
          )}
        </div>
      </div>
      <div className="pl-0 sm:pl-7">
        <textarea value={noteVal} onChange={e => setNote(req.id, e.target.value)}
          placeholder="Add your notes or work summary..." rows={2}
          className="w-full text-[14px] rounded-xl p-3.5 outline-none resize-none"
          style={{
            background: fieldBg,
            color: isDark ? '#f0f0f0' : '#111',
            border: `1.5px solid ${fieldBorder}`,
            boxShadow: fieldShadow,
            lineHeight: 1.6,
          }} />
      </div>
    </div>
  );
}
