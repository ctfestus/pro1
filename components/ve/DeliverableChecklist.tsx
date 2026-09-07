'use client';

import { Paperclip } from 'lucide-react';
import { sanitizeRichTextWithImages } from '@/lib/sanitize';
import { MailStatusChip } from '@/components/ve/MailCard';

interface DeliverableAttachment {
  name: string;
  url: string;
  mimeType?: string;
}

interface DeliverableChecklistProps {
  title: string;
  instructions?: string;
  instructionsFormat?: 'rich';
  attachments?: DeliverableAttachment[];
  completed: boolean;
  readOnly: boolean;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  onToggle: () => void;
}

export function DeliverableChecklist({
  title,
  instructions,
  instructionsFormat,
  attachments = [],
  completed,
  readOnly,
  accentColor,
  textColor,
  mutedColor,
  onToggle,
}: DeliverableChecklistProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: mutedColor }}>
            Deliverable
          </p>
          <h4 className="mt-1 text-[15px] font-semibold leading-snug" style={{ color: textColor }}>
            {title}
          </h4>
        </div>
        {completed && (
          <div className="flex-shrink-0">
            <MailStatusChip accent="#10b981">Complete</MailStatusChip>
          </div>
        )}
      </div>

      {instructions && (instructionsFormat === 'rich' ? (
        <div
          className="rich-content text-[13px] leading-relaxed"
          style={{ color: textColor }}
          dangerouslySetInnerHTML={{ __html: sanitizeRichTextWithImages(instructions) }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: textColor }}>
          {instructions}
        </p>
      ))}

      {attachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: mutedColor }}>
            Resources
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <a
                key={`${attachment.url}-${index}`}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold hover:opacity-80"
                style={{ background: `${accentColor}12`, color: accentColor }}>
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{attachment.name || 'Open resource'}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <label
        className="flex items-center gap-3 rounded-xl px-4 py-3"
        style={{
          background: completed ? 'rgba(16,185,129,0.10)' : `${accentColor}10`,
          cursor: readOnly ? 'default' : 'pointer',
        }}>
        <input
          type="checkbox"
          checked={completed}
          disabled={readOnly}
          onChange={onToggle}
          className="h-5 w-5 flex-shrink-0 cursor-pointer disabled:cursor-default"
          style={{ accentColor }}
        />
        <span className="text-[13px] font-semibold" style={{ color: textColor }}>
          {completed ? 'Deliverable completed' : 'I have completed this deliverable'}
        </span>
      </label>
    </div>
  );
}
