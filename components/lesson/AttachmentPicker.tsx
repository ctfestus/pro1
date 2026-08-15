'use client';

// Small modal for choosing the file behind an interactive lesson attachment block:
// upload one (Supabase Storage, max 25 MB) OR paste a direct URL. Returns the URL plus
// the name and size the block displays, which an upload knows and a pasted URL does not
// (the object key we upload under is a timestamp, so the original name has to travel
// alongside it). Mirrors the AudioPicker overlay/theme conventions.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Loader2, Paperclip } from 'lucide-react';
import { useC } from '@/lib/theme';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { deleteUploadedFile } from '@/lib/storage-cleanup';
import { fileNameFromUrl, safeAttachmentUrl } from '@/lib/lesson-attachment';

export interface PickedAttachment {
  href: string;
  fileName: string;
  fileSize: number | null;
}

interface Props {
  onSelect: (file: PickedAttachment) => void;
  onClose: () => void;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function AttachmentPicker({ onSelect, onClose }: Props) {
  const C = useC();
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // Every exit from this modal is final: an upload already in flight cannot be recalled,
  // so once the author has closed or chosen, the pending result must be thrown away.
  // Without it the modal closes, the request lands a moment later, and a second file the
  // author never asked for is inserted into the lesson. The outcome also decides where
  // focus goes: back to the trigger if nothing was chosen, but left in the editor after
  // an insert, where the caret now sits beside the new block.
  const outcome = useRef<'open' | 'dismissed' | 'chosen'>('open');
  const urlRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const dismiss = () => { outcome.current = 'dismissed'; onClose(); };
  const choose = (picked: PickedAttachment) => {
    outcome.current = 'chosen';
    onSelect(picked);
    // Top-level insertion focuses the editor itself. Replacement only updates node attrs,
    // so if focus is still inside this dialog, return it to the control that opened us.
    if (dialogRef.current?.contains(document.activeElement)) restoreFocusTo.current?.focus();
    onClose();
  };

  // Dialog conventions used by the other lesson overlays: focus lands inside on open and
  // Escape closes.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const focusId = window.requestAnimationFrame(() => urlRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener('keydown', onKey);
      if (outcome.current !== 'chosen') restoreFocusTo.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setError(`File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 25 MB.`);
      return;
    }
    setError('');
    setUploading(true);
    try {
      const uploaded = await uploadToStorage(file, 'lesson-files');
      // Abandoned while the bytes were in flight. The object exists but nothing will ever
      // reference it, and no undo can bring the reference back, so it is safe to remove now.
      if (outcome.current !== 'open') { void deleteUploadedFile(uploaded); return; }
      choose({ href: uploaded, fileName: file.name, fileSize: file.size });
    } catch (err) {
      if (outcome.current !== 'open') return;
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      if (outcome.current === 'open') setUploading(false);
    }
  };

  const handleInsertUrl = () => {
    const safe = safeAttachmentUrl(url);
    if (!safe) {
      setError('Enter a full web address, for example https://example.com/workbook.xlsx');
      return;
    }
    choose({ href: safe, fileName: fileNameFromUrl(safe), fileSize: null });
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Add a file" style={{ width: '100%', maxWidth: 420, background: C.card, borderRadius: 16, padding: 20 }}>
        <div className="flex items-center justify-between mb-4">
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
            <Paperclip className="w-4 h-4" /> Add a file
          </span>
          <button type="button" onClick={dismiss} className="p-1 rounded-lg transition-opacity hover:opacity-70" style={{ color: C.muted }} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block cursor-pointer mb-4">
          <input
            type="file"
            className="peer sr-only"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleUpload(f); }}
          />
          <div
            className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-opacity hover:opacity-80 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--attachment-focus)]"
            style={{ background: C.cta, color: C.ctaText, '--attachment-focus': C.text } as React.CSSProperties}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload a file (max 25 MB)'}
          </div>
        </label>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px" style={{ background: C.divider }} />
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: C.faint }}>or paste a URL</span>
          <div className="flex-1 h-px" style={{ background: C.divider }} />
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={urlRef}
            type="text"
            value={url}
            disabled={uploading}
            onChange={(e) => { setUrl(e.target.value); if (error) setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertUrl(); } }}
            placeholder="https://.../workbook.xlsx"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-40"
            style={{ background: C.input, color: C.text, border: `1px solid ${C.divider}` }}
          />
          <button
            type="button"
            onClick={handleInsertUrl}
            disabled={uploading || !url.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: C.cta, color: C.ctaText }}
          >
            Insert
          </button>
        </div>

        {error && <p className="mt-3 text-xs" style={{ color: '#e5484d' }}>{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
