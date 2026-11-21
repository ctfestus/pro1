'use client';

// New programme and Edit programme: name, description, completion text, skills, what to issue
// and the badge image.

import { useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Award, BadgeCheck, Bold, Image as ImageIcon, Italic, Layers, List, ListOrdered, Loader2, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { FIELD, Hint, Label, inputStyle } from '@/components/create/EditorKit';
import { BUTTON } from '@/components/dashboard/subscriptions/Modal';
import { OptionCard, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { Footer, ISSUE_MODES, Notice, type IssueMode, type Program } from './shared';

const PRESET_SKILLS = ['Excel', 'Power BI', 'SQL', 'Tableau', 'Generative AI', 'Python', 'Data Analysis', 'Machine Learning'];
const MODE_ICONS = { certificate_only: Award, badge_only: BadgeCheck, both: Layers };

const RICH_TEXT_CSS = `
  .rte-wrap .ProseMirror { outline: none; padding: 10px 12px; font-size: 14px; line-height: 1.65; color: inherit; }
  .rte-wrap .ProseMirror p { margin: 0 0 6px; }
  .rte-wrap .ProseMirror ul { list-style-type: disc; padding-left: 22px; margin: 0 0 6px; }
  .rte-wrap .ProseMirror ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 6px; }
  .rte-wrap .ProseMirror li { display: list-item; margin-bottom: 2px; }
  .rte-wrap .ProseMirror p:last-child,
  .rte-wrap .ProseMirror li:last-child { margin-bottom: 0; }
`;

function RichTextEditor({ value, onChange, C }: { value: string; onChange: (html: string) => void; C: ThemeColors }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;
  const P = palette(C);
  const tools = [
    { label: 'Bold', icon: Bold, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Bullet list', icon: List, active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', icon: ListOrdered, active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <div className="rte-wrap rounded-[10px] overflow-hidden" style={inputStyle(C)}>
      <style>{RICH_TEXT_CSS}</style>
      <div className="flex gap-1 px-2 py-1.5" style={{ borderBottom: `1px solid ${C.inputBorder}`, background: C.card }}>
        {tools.map(t => (
          <button key={t.label} type="button" onClick={t.run} title={t.label} aria-label={t.label} aria-pressed={t.active}
            className="w-7 h-7 rounded-md grid place-items-center" style={t.active ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
            <t.icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
      <div className="min-h-[140px]" style={{ color: C.text }}><EditorContent editor={editor} /></div>
    </div>
  );
}

export function ProgramForm({ initial, onSave, onCancel, C }: {
  initial?: Partial<Program>; onSave: (p: Program) => void; onCancel: () => void; C: ThemeColors;
}) {
  const P = palette(C);
  const [name, setName]               = useState(initial?.name ?? '');
  const [desc, setDesc]               = useState(initial?.description ?? '');
  const [skills, setSkills]           = useState<string[]>(initial?.skills ?? []);
  const [customSkill, setCustomSkill] = useState('');
  const [issueMode, setIssueMode]     = useState<IssueMode>(initial?.issue_mode ?? 'certificate_only');
  const [badgeUrl, setBadgeUrl]       = useState(initial?.badge_image_url ?? '');
  const [completionText, setCompletionText] = useState(initial?.completion_text ?? '');
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit  = !!initial?.id;

  const toggleSkill = (s: string) =>
    setSkills(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const addCustomSkill = () => {
    const s = customSkill.trim();
    if (s && !skills.includes(s)) setSkills(prev => [...prev, s]);
    setCustomSkill('');
  };

  const handleBadgeFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadToCloudinary(file, 'program-badges');
      setBadgeUrl(url);
    } catch { setError('Badge upload failed. Please try again.'); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) { setError('Programme name is required.'); return; }
    if ((issueMode === 'badge_only' || issueMode === 'both') && !badgeUrl) {
      setError('Please upload a badge image for this issue mode.'); return;
    }
    setSaving(true);
    try {
      const token  = (await supabase.auth.getSession()).data.session?.access_token;
      const method = isEdit ? 'PATCH' : 'POST';
      const body: any = { name: name.trim(), description: desc.trim() || null, skills, badge_image_url: badgeUrl || null, issue_mode: issueMode, completion_text: completionText.trim() || null };
      if (isEdit) body.id = initial!.id;
      const res  = await fetch('/api/programs', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to save programme.'); return; }
      onSave(data.data);
    } finally { setSaving(false); }
  };

  const needsBadge = issueMode === 'badge_only' || issueMode === 'both';
  const customSkills = skills.filter(s => !PRESET_SKILLS.includes(s));

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2 items-start">
        <div className="grid gap-5 min-w-0">
          <div>
            <Label C={C}>Programme name</Label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="For example Data Analytics Bootcamp" className={FIELD} style={inputStyle(C)} />
          </div>
          <div>
            <Label C={C}>Description</Label>
            <RichTextEditor value={desc} onChange={setDesc} C={C} />
          </div>
          <div>
            <Label C={C}>Completion text</Label>
            <input value={completionText} onChange={e => setCompletionText(e.target.value)} placeholder="has successfully completed" className={FIELD} style={inputStyle(C)} />
            <Hint C={C}>Shown on the certificate before the programme name. Leave blank to use your default.</Hint>
          </div>
        </div>

        <div className="grid gap-5 min-w-0">
          <div>
            <Label C={C}>Skills</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_SKILLS.map(s => {
                const active = skills.includes(s);
                return (
                  <button key={s} type="button" aria-pressed={active} onClick={() => toggleSkill(s)} className="h-8 px-3 rounded-full text-xs font-semibold"
                    style={active ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                    {s}
                  </button>
                );
              })}
              {customSkills.map(s => (
                <span key={s} className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full text-xs font-semibold" style={{ background: P.sel, color: P.onSel }}>
                  {s}
                  <button type="button" aria-label={`Remove ${s}`} onClick={() => setSkills(p => p.filter(x => x !== s))} className="grid place-items-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input value={customSkill} onChange={e => setCustomSkill(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill(); } }}
                placeholder="Add your own skill" className={FIELD} style={inputStyle(C)} />
              <button type="button" onClick={addCustomSkill} disabled={!customSkill.trim()} className={BUTTON} style={btnStyle('sec', C)}>Add</button>
            </div>
          </div>

          <div>
            <Label C={C}>What to issue</Label>
            <div role="radiogroup" aria-label="What to issue" className="grid gap-2">
              {ISSUE_MODES.map(m => {
                const Icon = MODE_ICONS[m.value];
                return <OptionCard key={m.value} selected={issueMode === m.value} onClick={() => setIssueMode(m.value)} icon={<Icon className="w-4 h-4" />} title={m.label} sub={m.desc} C={C} />;
              })}
            </div>
          </div>

          {needsBadge && (
            <div>
              <Label C={C}>Badge image</Label>
              {badgeUrl ? (
                <div className="flex items-center gap-3">
                  <img src={badgeUrl} alt="Badge" className="w-20 h-20 object-contain rounded-xl" style={{ background: C.page }} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => fileRef.current?.click()} className={btnSmClass} style={btnStyle('sec', C)}><Upload className="w-3.5 h-3.5" /> Replace</button>
                    <button type="button" onClick={() => setBadgeUrl('')} className={btnSmClass} style={btnStyle('danger', C)}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleBadgeFile(f); }}
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full rounded-xl px-5 py-6 text-center grid justify-items-center gap-1"
                  style={{ background: C.page, boxShadow: `inset 0 0 0 1px ${C.divider}`, cursor: uploading ? 'wait' : 'pointer' }}>
                  {uploading ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }} /> : <ImageIcon className="w-6 h-6" style={{ color: C.faint }} />}
                  <span className="text-sm font-semibold" style={{ color: C.text }}>{uploading ? 'Uploading...' : 'Drop a badge or click to browse'}</span>
                  <span className="text-xs" style={{ color: C.muted }}>PNG, JPG or SVG</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBadgeFile(f); }} />
            </div>
          )}
        </div>
      </div>

      {error && <Notice C={C}>{error}</Notice>}

      <Footer onCancel={onCancel} C={C}>
        <button type="button" onClick={handleSave} disabled={saving} className={BUTTON} style={btnStyle('pri', C)}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Create programme'}
        </button>
      </Footer>
    </div>
  );
}
