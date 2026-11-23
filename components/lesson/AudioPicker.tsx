'use client';

// Small modal for choosing an audio source for the interactive lesson audio block:
// upload a file (Cloudinary, max 20 MB) OR paste a direct audio URL. Returns the chosen
// URL via onSelect. Mirrors the ImageLibrary overlay/theme conventions.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleNotch, MusicNotes, UploadSimple, X } from '@phosphor-icons/react';
import { useC } from '@/lib/theme';
import { uploadToStorage } from '@/lib/uploadToStorage';

interface Props {
  onSelect: (url: string) => void;
  onClose: () => void;
}

export function AudioPicker({ onSelect, onClose }: Props) {
  const C = useC();
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setError(`Audio file is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 20 MB.`);
      return;
    }
    setError('');
    setUploading(true);
    try {
      const uploaded = await uploadToStorage(file, 'lesson-audio');
      onSelect(uploaded);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleInsertUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSelect(trimmed);
    onClose();
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 420, background: C.card, borderRadius: 16, padding: 20 }}>
        <div className="flex items-center justify-between mb-4">
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
            <MusicNotes weight="duotone" className="w-4 h-4" /> Add audio
          </span>
          <button type="button" onClick={onClose} className="p-1 rounded-lg transition-opacity hover:opacity-70" style={{ color: C.muted }} aria-label="Close">
            <X weight="bold" className="w-4 h-4" />
          </button>
        </div>

        <label className="block cursor-pointer mb-4">
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleUpload(f); }}
          />
          <div className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-opacity hover:opacity-80" style={{ background: C.cta, color: C.ctaText }}>
            {uploading ? <CircleNotch weight="bold" className="w-4 h-4 animate-spin" /> : <UploadSimple weight="bold" className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload audio file (max 20 MB)'}
          </div>
        </label>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px" style={{ background: C.divider }} />
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: C.faint }}>or paste a URL</span>
          <div className="flex-1 h-px" style={{ background: C.divider }} />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertUrl(); } }}
            placeholder="https://.../audio.mp3"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: C.input, color: C.text, border: `1px solid ${C.divider}` }}
          />
          <button
            type="button"
            onClick={handleInsertUrl}
            disabled={!url.trim()}
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
