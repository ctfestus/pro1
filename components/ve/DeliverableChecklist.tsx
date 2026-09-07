'use client';

import { Check, Paperclip } from 'lucide-react';
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
    <div
      className="relative space-y-4 overflow-hidden rounded-2xl p-4 transition-[background-color,box-shadow] duration-300 motion-reduce:transition-none"
      style={{
        background: completed ? 'rgba(16,185,129,0.07)' : `${accentColor}05`,
        boxShadow: completed ? `0 0 0 1px ${accentColor}18` : 'none',
      }}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 overflow-hidden" style={{ background: `${accentColor}1f` }}>
        <div
          className="h-full origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ background: accentColor, transform: `scaleX(${completed ? 1 : 0})` }}
        />
      </div>

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
          <div className="flex-shrink-0 transition-all duration-300 motion-reduce:transition-none">
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
        className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors duration-300 motion-reduce:transition-none"
        style={{
          background: completed ? 'rgba(16,185,129,0.10)' : `${accentColor}10`,
          cursor: readOnly ? 'default' : 'pointer',
        }}>
        <input
          type="checkbox"
          checked={completed}
          disabled={readOnly}
          onChange={onToggle}
          aria-label={`${title}: ${completed ? 'completed' : 'not completed'}`}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 motion-reduce:transition-none"
          style={{
            background: completed ? accentColor : 'transparent',
            borderColor: completed ? accentColor : `${accentColor}70`,
            color: '#fff',
            outlineColor: accentColor,
            transform: completed ? 'scale(1)' : 'scale(0.92)',
          }}>
          <Check
            className="h-4 w-4 transition-all duration-300 motion-reduce:transition-none"
            strokeWidth={3}
            style={{ opacity: completed ? 1 : 0, transform: completed ? 'scale(1)' : 'scale(0.4)' }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold" style={{ color: textColor }}>
            {completed ? 'Deliverable completed' : 'I have completed this deliverable'}
          </span>
          <span aria-live="polite" className="mt-0.5 block text-[11px]" style={{ color: completed ? accentColor : mutedColor }}>
            {completed && !readOnly
              ? 'Progress updated. You can undo this until submission'
              : completed
                ? 'Completion recorded'
                : 'Turn this on when the whole deliverable is complete'}
          </span>
        </span>
      </label>
    </div>
  );
}
