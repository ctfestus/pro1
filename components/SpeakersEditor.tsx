'use client';

/**
 * The Speakers step of the event editors (app/create/page.tsx and components/FormEditor.tsx).
 *
 * The half-filled speaker form lives in useSpeakerDraft(), owned by the editor, so it survives
 * moving between steps. Each editor runs its Save through draft.applyTo(), which adds a speaker
 * still sitting in the form: without it, a host who filled one in and pressed Save lost it.
 */
import { useState } from 'react';
import { Image as ImageIcon, Pencil, Plus, X } from 'lucide-react';
import type { Speaker } from '@/lib/course-schema';
import { ImageCropModal } from '@/components/ImageCropModal';
import { AiTextarea } from '@/components/AiTextarea';
import { uploadToCloudinary, deleteFromCloudinary } from '@/lib/uploadToCloudinary';

type Draft = { name: string; title: string; bio: string; avatar_url: string; linkedin_url: string };
const EMPTY: Draft = { name: '', title: '', bio: '', avatar_url: '', linkedin_url: '' };

/** The colours the panel needs; both editors' theme objects have these. */
export type SpeakersEditorTokens = {
  text: string; faint: string; input: string; inputBorder: string; groupBg: string; groupBorder: string; pill: string;
};

export function useSpeakerDraft() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const reset = () => { setOpen(false); setEditId(null); setDraft(EMPTY); };

  /** The list with the speaker in the form added (or the edit applied); null when the form has none. */
  const merged = (speakers: Speaker[]): Speaker[] | null => {
    if (!open || !draft.name.trim()) return null;
    const speaker: Speaker = {
      id: editId ?? crypto.randomUUID(),
      name: draft.name.trim(),
      title: draft.title.trim() || undefined,
      bio: draft.bio.trim() || undefined,
      avatar_url: draft.avatar_url || undefined,
      linkedin_url: draft.linkedin_url.trim() || undefined,
    };
    return editId ? speakers.map(s => s.id === editId ? speaker : s) : [...speakers, speaker];
  };

  /** For Save: the speakers to store, with any pending one added, and the form cleared. */
  const applyTo = (speakers: Speaker[]): Speaker[] | null => {
    const next = merged(speakers);
    if (next) reset();
    return next;
  };

  return { open, setOpen, editId, setEditId, draft, setDraft, reset, merged, applyTo };
}

export type SpeakerDraftState = ReturnType<typeof useSpeakerDraft>;

export function SpeakersEditor({ speakers, onChange, draft: d, tokens: T, accentColor, labelClass, labelStyle, onError }: {
  speakers: Speaker[];
  onChange: (next: Speaker[]) => void;
  draft: SpeakerDraftState;
  tokens: SpeakersEditorTokens;
  accentColor: string;
  labelClass: string;
  labelStyle: React.CSSProperties;
  onError: (message: string) => void;
}) {
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { draft, setDraft } = d;
  const isEditing = d.editId !== null;
  const field = { background: T.input, border: `1px solid ${T.inputBorder}`, color: T.text };

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { onError('Image must be 8MB or smaller.'); return; }
    setCropSrc(URL.createObjectURL(file));
    e.target.value = ''; // so the same file can be picked again
  };

  const deletePhoto = (url: string) => { if (url) deleteFromCloudinary(url).catch(() => {}); };

  const confirmCrop = async (blob: Blob) => {
    setCropSrc(null);
    setUploading(true);
    const oldUrl = draft.avatar_url;
    try {
      const publicUrl = await uploadToCloudinary(new File([blob], 'speaker.jpg', { type: 'image/jpeg' }), 'speakers');
      setDraft(prev => ({ ...prev, avatar_url: publicUrl }));
      if (oldUrl) deletePhoto(oldUrl);
    } catch {
      onError('Could not upload the photo. Try again.');
    }
    setUploading(false);
  };

  const openEdit = (sp: Speaker) => {
    d.setEditId(sp.id);
    setDraft({ name: sp.name, title: sp.title ?? '', bio: sp.bio ?? '', avatar_url: sp.avatar_url ?? '', linkedin_url: sp.linkedin_url ?? '' });
    d.setOpen(true);
  };

  const avatar = (size: number, url: string, name: string) => (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${accentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 40 ? 14 : 13, fontWeight: 700, color: accentColor }}>
      {url
        ? <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : name ? name.slice(0, 2).toUpperCase() : <ImageIcon className="w-4 h-4" />}
    </div>
  );

  return (
    <div className="space-y-5">
      {cropSrc && (
        <ImageCropModal src={cropSrc} aspect={1} shape="round" title="Crop speaker photo"
          onConfirm={confirmCrop}
          onCancel={() => { URL.revokeObjectURL(cropSrc); setCropSrc(null); }} />
      )}

      {speakers.length > 0 && (
        <div className="space-y-2 mb-3">
          {speakers.map(sp => (
            <div key={sp.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: T.groupBg, border: `1px solid ${T.groupBorder}` }}>
              {avatar(36, sp.avatar_url ?? '', sp.name || '?')}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="text-sm font-semibold truncate" style={{ color: T.text }}>{sp.name}</p>
                {sp.title && <p className="text-xs truncate" style={{ color: T.faint }}>{sp.title}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" onClick={() => openEdit(sp)} className="p-1 rounded-lg transition-colors hover:bg-black/10" title="Edit speaker">
                  <Pencil className="w-3.5 h-3.5" style={{ color: T.faint }} />
                </button>
                <button type="button" title="Remove speaker" className="p-1 rounded-lg transition-colors hover:bg-red-500/10"
                  onClick={() => { if (sp.avatar_url) deletePhoto(sp.avatar_url); onChange(speakers.filter(s => s.id !== sp.id)); }}>
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!d.open ? (
        <button type="button" onClick={() => { d.reset(); d.setOpen(true); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold"
          style={{ border: `1.5px dashed ${T.inputBorder}`, color: T.faint }}>
          <Plus className="w-3.5 h-3.5" />
          Add Speaker
        </button>
      ) : (
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: T.groupBg, border: `1px solid ${T.groupBorder}` }}>
          <div className="flex items-center gap-3">
            {avatar(44, draft.avatar_url, draft.name)}
            <label className="flex-1 cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} disabled={uploading} />
              <span className="text-xs font-medium" style={{ color: accentColor }}>
                {uploading ? 'Uploading' : draft.avatar_url ? 'Change photo' : 'Upload photo'}
              </span>
            </label>
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>Name <span className="text-red-400">*</span></label>
            <input type="text" value={draft.name} onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Jane Doe" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={field} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>Title / Role</label>
            <input type="text" value={draft.title} onChange={e => setDraft(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. CEO at Acme, Keynote Speaker" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={field} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>Short bio</label>
            <AiTextarea value={draft.bio} onValueChange={value => setDraft(prev => ({ ...prev, bio: value }))}
              placeholder="A sentence or two about this speaker" rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none" style={field} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>LinkedIn URL</label>
            <input type="url" value={draft.linkedin_url} onChange={e => setDraft(prev => ({ ...prev, linkedin_url: e.target.value }))}
              placeholder="https://linkedin.com/in/username" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={field} />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button"
              onClick={() => { const next = d.merged(speakers); if (next) { onChange(next); d.reset(); } }}
              className="flex-1 py-2 rounded-lg text-xs font-semibold"
              style={{ background: accentColor, color: 'white', opacity: draft.name.trim() ? 1 : 0.45 }}>
              {isEditing ? 'Save Changes' : 'Add Speaker'}
            </button>
            <button type="button" onClick={d.reset}
              className="px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: T.pill, border: `1px solid ${T.inputBorder}`, color: T.faint }}>
              Cancel
            </button>
          </div>
          <p className="text-[11px]" style={{ color: T.faint }}>Saving the event also adds this speaker.</p>
        </div>
      )}
    </div>
  );
}
