'use client';

import type React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The upload zone and submit button every AI review shares (workbook, document, dashboard, code),
 * so choosing a file and sending it looks and behaves the same in each: one soft dashed panel,
 * one hint format, and a submit button that is always there, grey until there is something to send.
 */

export function AiReviewDropzone({ isDark, accentColor, icon, title, hint, fileName, dragging, onDragChange, onDropFile, onClick, children }: {
  isDark: boolean;
  accentColor: string;
  icon: React.ReactNode;
  /** What to drop: "Drop your Excel file here". */
  title: string;
  /** The accepted types, written the same way everywhere: "Excel workbook (.xlsx)". */
  hint: string;
  /** Set once a file is chosen; shown in place of the title. */
  fileName?: string;
  dragging: boolean;
  onDragChange: (dragging: boolean) => void;
  onDropFile: (e: React.DragEvent) => void;
  onClick: () => void;
  /** The hidden file input. */
  children?: React.ReactNode;
}) {
  const active = dragging || !!fileName;
  const text = isDark ? '#f0f0f0' : '#111111';
  const muted = isDark ? '#9a9a9a' : '#5c6570';
  return (
    <div
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onDragOver={e => { e.preventDefault(); onDragChange(true); }}
      onDragLeave={() => onDragChange(false)}
      onDrop={onDropFile}
      onClick={onClick}
      className="focus-frame flex cursor-pointer flex-col items-center justify-center gap-2.5 text-center transition-colors"
      style={{
        border: `1.5px dashed ${active ? accentColor : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)'}`,
        borderRadius: 12,
        padding: '26px 20px',
        background: active ? `${accentColor}0d` : isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9',
      }}>
      {children}
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ color: accentColor, background: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff' }}>{icon}</span>
      <span>
        <span className="block text-[13.5px] font-semibold" style={{ color: text, overflowWrap: 'anywhere' }}>{fileName || title}</span>
        <span className="mt-0.5 block text-[12px]" style={{ color: muted }}>{fileName ? 'Click to choose a different file' : `or click to browse. Accepts ${hint}`}</span>
      </span>
    </div>
  );
}

export function AiReviewSubmitButton({ isDark, accentColor, disabled, busy, busyLabel = 'Reviewing...', onClick, children }: {
  isDark: boolean;
  accentColor: string;
  /** Nothing to send yet. Shown grey, not as a washed-out live button. */
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const off = disabled && !busy;
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className="flex w-full items-center justify-center gap-2 rounded-[10px] px-5 py-2.5 text-[13.5px] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed sm:w-auto"
      style={off
        ? { background: isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9', color: isDark ? '#6f6f6f' : '#8a929e' }
        : { background: accentColor, color: '#fff', opacity: busy ? 0.8 : 1 }}>
      {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busyLabel}</> : children}
    </button>
  );
}
