'use client';

import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { supabase } from '@/lib/supabase';
import { useSessionToken } from '@/lib/use-session-token';
import { LIGHT_C, useC } from '@/lib/theme';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import {
  Plus, Loader2, Award, Upload, X, Check, Copy, ExternalLink,
  Download, AlertTriangle, Search, BadgeCheck, ArrowLeft, Edit2,
  MoreVertical, Trash2, ChevronLeft, ChevronRight, Image as ImageIcon,
  Calendar, Bold, Italic, List, ListOrdered,
} from 'lucide-react';
import { DateField } from '@/components/DatePicker';

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return m;
}

type IssueMode = 'certificate_only' | 'badge_only' | 'both';
type Program = {
  id: string; name: string; description: string | null;
  skills: string[]; badge_image_url: string | null;
  issue_mode: IssueMode; completion_text: string | null; created_at: string;
};
type OpenCert = {
  id: string; program_id: string | null; program_name: string;
  recipient_name: string; recipient_email: string | null;
  issued_date: string; revoked: boolean; created_at: string;
};
type ManualRow = { name: string; email: string; date: string };

const PRESET_SKILLS = ['Excel', 'Power BI', 'SQL', 'Tableau', 'Generative AI', 'Python', 'Data Analysis', 'Machine Learning'];
const ISSUE_MODES: { value: IssueMode; label: string; desc: string }[] = [
  { value: 'certificate_only', label: 'Certificate only',    desc: 'Recipients get a printable certificate' },
  { value: 'badge_only',       label: 'Badge only',          desc: 'Recipients get a digital badge' },
  { value: 'both',             label: 'Certificate + Badge', desc: 'Recipients get both' },
];
const PAGE_SIZE = 20;
const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsv(text: string): ManualRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('name') || first.includes('email') || first.includes('date');
  return (hasHeader ? lines.slice(1) : lines).map(line => {
    const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    return { name: parts[0] ?? '', email: parts[1] ?? '', date: parts[2] ?? '' };
  }).filter(r => r.name);
}

function downloadCertsCsv(certs: OpenCert[], programName: string) {
  const rows = [
    ['Name', 'Email', 'Issue Date', 'Certificate URL', 'Status'],
    ...certs.map(c => [
      c.recipient_name, c.recipient_email ?? '', c.issued_date,
      `${window.location.origin}/credential/${c.id}`, c.revoked ? 'Revoked' : 'Active',
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `${programName.replace(/\s+/g, '-')}-certificates.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function getAvatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// --- Modal ---
function Modal({ title, onClose, children, C, width = 560 }: {
  title: string; onClose: () => void; children: ReactNode;
  C: typeof LIGHT_C; width?: number;
}) {
  const isMobile = useIsMobile();
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: isMobile ? '20px 20px 0 0' : 16, width: '100%', maxWidth: isMobile ? '100%' : width, maxHeight: isMobile ? '96vh' : '94vh', overflowY: 'auto', padding: isMobile ? '20px 16px 32px' : '28px 36px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 18, fontWeight: 700, color: C.text }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- Rich Text Editor ---
const RICH_TEXT_CSS = `
  .rte-wrap .ProseMirror {
    outline: none;
    min-height: 120px;
    padding: 10px 12px;
    font-size: 14px;
    line-height: 1.65;
    color: inherit;
  }
  .rte-wrap .ProseMirror p { margin: 0 0 6px; }
  .rte-wrap .ProseMirror ul { list-style-type: disc; padding-left: 22px; margin: 0 0 6px; }
  .rte-wrap .ProseMirror ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 6px; }
  .rte-wrap .ProseMirror li { display: list-item; margin-bottom: 2px; }
  .rte-wrap .ProseMirror p:last-child,
  .rte-wrap .ProseMirror li:last-child { margin-bottom: 0; }
  .rte-wrap .ProseMirror.ProseMirror-focused { outline: none; }
`;

function RichTextEditor({ value, onChange, C, placeholder, rows }: {
  value: string; onChange: (html: string) => void;
  C: typeof LIGHT_C; placeholder?: string; rows?: number;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) return null;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 5, cursor: 'pointer', border: 'none',
    background: active ? C.cta : 'transparent',
    color: active ? C.ctaText : C.muted,
    transition: 'background 0.12s, color 0.12s',
  });

  const minH = rows ? `${rows * 24 + 20}px` : '120px';

  return (
    <div className="rte-wrap" style={{ border: `1px solid ${C.cardBorder}`, borderRadius: 8, background: C.input, overflow: 'hidden' }}>
      <style>{RICH_TEXT_CSS}</style>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 8px', borderBottom: `1px solid ${C.cardBorder}`, background: C.card }}>
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} style={btnStyle(editor.isActive('bold'))} title="Bold">
          <Bold style={{ width: 13, height: 13 }} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} style={btnStyle(editor.isActive('italic'))} title="Italic">
          <Italic style={{ width: 13, height: 13 }} />
        </button>
        <div style={{ width: 1, background: C.cardBorder, margin: '0 4px' }} />
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} style={btnStyle(editor.isActive('bulletList'))} title="Bullet list">
          <List style={{ width: 13, height: 13 }} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} style={btnStyle(editor.isActive('orderedList'))} title="Numbered list">
          <ListOrdered style={{ width: 13, height: 13 }} />
        </button>
      </div>
      {/* Editor area */}
      <div style={{ minHeight: minH, color: C.text }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// --- Program Form ---
function ProgramForm({ initial, onSave, onCancel, C }: {
  initial?: Partial<Program>; onSave: (p: Program) => void;
  onCancel: () => void; C: typeof LIGHT_C;
}) {
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
    if (!name.trim()) { setError('Program name is required.'); return; }
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
      if (!res.ok) { setError(data.error ?? 'Failed to save program.'); return; }
      onSave(data.data);
    } finally { setSaving(false); }
  };

  const needsBadge = issueMode === 'badge_only' || issueMode === 'both';
  const isMobile   = useIsMobile();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* Two-column on desktop, single column on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 18 : 32, alignItems: 'start' }}>

        {/* Left: name, description, badge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Program Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Data Analytics Bootcamp"
              style={{ width: '100%', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: C.text, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Description</label>
            <RichTextEditor value={desc} onChange={setDesc} C={C} rows={isMobile ? 3 : 5} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Completion Text</label>
            <p style={{ fontSize: 11, color: C.faint, margin: '0 0 6px' }}>Text that appears on the certificate before the program name (e.g. &quot;has successfully completed&quot;). Leave blank to use your default.</p>
            <input value={completionText} onChange={e => setCompletionText(e.target.value)} placeholder="has successfully completed"
              style={{ width: '100%', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: C.text, boxSizing: 'border-box' }} />
          </div>

          {needsBadge && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Badge Image *</label>
              {badgeUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={badgeUrl} alt="Badge" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button onClick={() => fileRef.current?.click()}
                      style={{ padding: '7px 14px', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
                      Replace
                    </button>
                    <button onClick={() => setBadgeUrl('')}
                      style={{ padding: '7px 14px', background: C.deleteBg, border: `1px solid ${C.deleteBorder}`, borderRadius: 8, fontSize: 13, color: C.deleteText, cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleBadgeFile(f); }}
                  onClick={() => fileRef.current?.click()}
                  style={{ border: `2px dashed ${C.cardBorder}`, borderRadius: 10, padding: '24px 20px', textAlign: 'center', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.7 : 1 }}
                >
                  {uploading
                    ? <Loader2 style={{ width: 26, height: 26, color: C.faint, margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
                    : <ImageIcon style={{ width: 26, height: 26, color: C.faint, margin: '0 auto 8px' }} />
                  }
                  <p style={{ fontSize: 13, color: C.muted, margin: '0 0 3px' }}>
                    {uploading ? 'Uploading...' : 'Drop badge or click to browse'}
                  </p>
                  <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>PNG, JPG, SVG</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBadgeFile(f); }} />
            </div>
          )}
        </div>

        {/* Right: skills + what to issue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Skills</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
              {PRESET_SKILLS.map(s => {
                const active = skills.includes(s);
                return (
                  <button key={s} onClick={() => toggleSkill(s)} style={{
                    padding: '5px 12px', fontSize: 13, fontWeight: active ? 700 : 400, borderRadius: 8, cursor: 'pointer',
                    background: active ? C.cta : C.input, color: active ? C.ctaText : C.muted,
                    border: active ? `1px solid ${C.cta}` : `1px solid ${C.cardBorder}`, transition: 'all 0.12s',
                  }}>{s}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={customSkill} onChange={e => setCustomSkill(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill(); } }}
                placeholder="Add custom skill..."
                style={{ flex: 1, background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: C.text }} />
              <button onClick={addCustomSkill} disabled={!customSkill.trim()}
                style={{ padding: '7px 14px', background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: customSkill.trim() ? 'pointer' : 'not-allowed', opacity: customSkill.trim() ? 1 : 0.5 }}>
                Add
              </button>
            </div>
            {skills.filter(s => !PRESET_SKILLS.includes(s)).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {skills.filter(s => !PRESET_SKILLS.includes(s)).map(s => (
                  <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 8, background: C.cta, color: C.ctaText }}>
                    {s}
                    <button onClick={() => setSkills(p => p.filter(x => x !== s))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.ctaText, lineHeight: 1, padding: 0, display: 'flex' }}>
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>What to issue</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ISSUE_MODES.map(m => (
                <label key={m.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 10, border: `1px solid ${issueMode === m.value ? C.cta : C.cardBorder}`, background: issueMode === m.value ? `${C.cta}0d` : C.input, transition: 'all 0.12s' }}>
                  <input type="radio" name="issue_mode" value={m.value} checked={issueMode === m.value} onChange={() => setIssueMode(m.value)} style={{ marginTop: 2, accentColor: C.cta }} />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{m.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.faint }}>{m.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.deleteBg, border: `1px solid ${C.deleteBorder}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, color: C.deleteText }}>
          <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0 }} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel}
          style={{ background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 18px', fontSize: 14, color: C.muted, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 15, height: 15 }} />}
          {isEdit ? 'Save Changes' : 'Create Program'}
        </button>
      </div>
    </div>
  );
}

// --- Issue Panel ---
function IssuePanel({ programs, initialProgram, onDone, onCancel, C }: {
  programs: Program[]; initialProgram: Program | null;
  onDone: (certs: OpenCert[]) => void; onCancel: () => void; C: typeof LIGHT_C;
}) {
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgram?.id ?? '');
  const [tab, setTab]               = useState<'manual' | 'csv'>('manual');
  const [manualRows, setManualRows] = useState<ManualRow[]>([{ name: '', email: '', date: '' }]);
  const [csvRows, setCsvRows]       = useState<ManualRow[]>([]);
  const [sendEmail, setSendEmail]   = useState(false);
  const [issuing, setIssuing]       = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const program    = programs.find(p => p.id === selectedProgramId) ?? null;
  const recipients = (tab === 'manual' ? manualRows : csvRows).filter(r => r.name.trim());

  const handleCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setCsvRows(parseCsv(e.target?.result as string));
    reader.readAsText(file);
  };

  const issue = async () => {
    setError(''); setSuccess('');
    if (!program)             { setError('Select a program first.'); return; }
    if (!recipients.length)   { setError('Add at least one recipient.'); return; }
    setIssuing(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const today = new Date().toISOString().split('T')[0];
      const res   = await fetch('/api/open-certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          program_id:   program.id,
          program_name: program.name,
          send_email:   sendEmail,
          recipients:   recipients.map(r => ({ name: r.name.trim(), email: r.email.trim() || undefined, issued_date: r.date || today })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to issue credentials.'); return; }
      setSuccess(`${data.count} credential${data.count !== 1 ? 's' : ''} issued!`);
      setTimeout(() => onDone(data.data ?? []), 1400);
    } finally { setIssuing(false); }
  };

  const isMobile = useIsMobile();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Program selector */}
      {!initialProgram ? (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Select Program *</label>
          <select value={selectedProgramId} onChange={e => setSelectedProgramId(e.target.value)}
            style={{ width: '100%', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 12px', fontSize: 14, color: selectedProgramId ? C.text : C.faint, boxSizing: 'border-box' }}>
            <option value="">Choose a program</option>
            {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ background: C.input, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          {initialProgram.badge_image_url ? (
            <img src={initialProgram.badge_image_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6 }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: 6, background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Award style={{ width: 18, height: 18, color: C.faint }} />
            </div>
          )}
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{initialProgram.name}</p>
            <p style={{ margin: '1px 0 0', fontSize: 12, color: C.faint }}>
              {ISSUE_MODES.find(m => m.value === initialProgram.issue_mode)?.label}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.input, borderRadius: 8, padding: 4 }}>
        {(['manual', 'csv'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '7px 0', fontSize: 13, fontWeight: tab === t ? 600 : 400,
            background: tab === t ? C.card : 'transparent', color: tab === t ? C.text : C.faint,
            border: tab === t ? `1px solid ${C.cardBorder}` : '1px solid transparent', borderRadius: 6, cursor: 'pointer',
          }}>
            {t === 'manual' ? 'Manual Entry' : 'CSV Upload'}
          </button>
        ))}
      </div>

      {/* Manual entry */}
      {tab === 'manual' && (
        <div>
          {isMobile ? (
            /* Mobile: card-style rows */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {manualRows.map((row, i) => (
                <div key={i} style={{ background: C.input, borderRadius: 10, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input placeholder="Full name *" value={row.name}
                      onChange={e => setManualRows(p => p.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                      style={{ flex: 1, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, color: C.text }} />
                    <button onClick={() => setManualRows(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', alignItems: 'center', padding: 4 }}>
                      <X style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input placeholder="Email (optional)" value={row.email}
                      onChange={e => setManualRows(p => p.map((r, j) => j === i ? { ...r, email: e.target.value } : r))}
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, color: C.text }} />
                    <DateField compact label={`Row ${i + 1} date`} value={row.date} onChange={date => setManualRows(p => p.map((r, j) => j === i ? { ...r, date } : r))} C={C} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop: grid table */
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 28px', gap: 6, marginBottom: 6 }}>
                {['Name *', 'Email', 'Date', ''].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                ))}
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {manualRows.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 28px', gap: 6, alignItems: 'center' }}>
                    <input placeholder="Full name" value={row.name}
                      onChange={e => setManualRows(p => p.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                      style={{ background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '7px 8px', fontSize: 13, color: C.text }} />
                    <input placeholder="Email (optional)" value={row.email}
                      onChange={e => setManualRows(p => p.map((r, j) => j === i ? { ...r, email: e.target.value } : r))}
                      style={{ background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '7px 8px', fontSize: 13, color: C.text }} />
                    <DateField compact label={`Row ${i + 1} date`} value={row.date} onChange={date => setManualRows(p => p.map((r, j) => j === i ? { ...r, date } : r))} C={C} />
                    <button onClick={() => setManualRows(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setManualRows(p => [...p, { name: '', email: '', date: '' }])}
            style={{ marginTop: 8, width: '100%', background: 'none', border: `1px dashed ${C.cardBorder}`, borderRadius: 8, padding: '9px 14px', fontSize: 13, color: C.cta, cursor: 'pointer' }}>
            + Add recipient
          </button>
        </div>
      )}

      {/* CSV upload */}
      {tab === 'csv' && (
        <div>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsv(f); }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${C.cardBorder}`, borderRadius: 10, padding: '24px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 12 }}
          >
            <Upload style={{ width: 28, height: 28, color: C.faint, margin: '0 auto 8px' }} />
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 4px' }}>Drop CSV or click to browse</p>
            <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>Columns: name, email (optional), date (optional)</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); }} />
          </div>
          {csvRows.length > 0 && (
            <div style={{ background: C.input, borderRadius: 8, border: `1px solid ${C.cardBorder}`, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.divider}`, fontSize: 12, fontWeight: 600, color: C.muted }}>
                {csvRows.length} recipient{csvRows.length !== 1 ? 's' : ''} found
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {csvRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.divider}` }}>
                        <td style={{ padding: '6px 12px', color: C.text, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '6px 12px', color: C.muted }}>{r.email || '-'}</td>
                        <td style={{ padding: '6px 12px', color: C.muted }}>{r.date || 'today'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.muted }}>
        <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} style={{ width: 15, height: 15 }} />
        Send credential link by email to recipients
      </label>

      {error   && <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.deleteBg, border: `1px solid ${C.deleteBorder}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.deleteText }}><AlertTriangle style={{ width: 14, height: 14 }} /> {error}</div>}
      {success && <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: (C as any).successBg, border: `1px solid ${(C as any).successBorder}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: (C as any).successText }}><Check style={{ width: 14, height: 14 }} /> {success}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 18px', fontSize: 14, color: C.muted, cursor: 'pointer' }}>Cancel</button>
        <button onClick={issue} disabled={issuing || !program || recipients.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: (issuing || !program || !recipients.length) ? 'not-allowed' : 'pointer', opacity: (issuing || !program || !recipients.length) ? 0.6 : 1 }}>
          {issuing ? <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> : <Award style={{ width: 15, height: 15 }} />}
          Issue {recipients.length > 0 ? `${recipients.length} Credential${recipients.length !== 1 ? 's' : ''}` : 'Credentials'}
        </button>
      </div>
    </div>
  );
}

// --- Main Page ---
type PanelMode = 'none' | 'new_program' | 'edit_program' | 'issue';
type ActiveTab = 'programs' | 'credentials';

export default function OpenCertificatesPage() {
  const C        = useC();
  const isMobile = useIsMobile();

  const [token, setToken]                     = useState<string | null>(null);
  const [authChecked, setAuthChecked]         = useState(false);
  const [programs, setPrograms]               = useState<Program[]>([]);
  const [allCerts, setAllCerts]               = useState<OpenCert[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [certsLoading, setCertsLoading]       = useState(false);
  const [activeTab, setActiveTab]             = useState<ActiveTab>('programs');
  const [panel, setPanel]                     = useState<PanelMode>('none');
  const [editingProgram, setEditingProgram]   = useState<Program | null>(null);
  const [issuingForProgram, setIssuingForProgram] = useState<Program | null>(null);

  // Credentials tab filters
  const [credSearch, setCredSearch]           = useState('');
  const [credProgramFilter, setCredProgramFilter] = useState('all');
  const [credStatusFilter, setCredStatusFilter]   = useState('all');
  const [credPage, setCredPage]               = useState(1);
  const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());

  // Menu state
  const [openMenuId, setOpenMenuId]           = useState<string | null>(null);
  const [copiedId, setCopiedId]               = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingProgramId, setDeletingProgramId] = useState<string | null>(null);
  const [menuPos, setMenuPos]           = useState<{ top: number; right: number } | null>(null);
  const [editingCert, setEditingCert]   = useState<OpenCert | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setAuthChecked(true);
    });
  }, []);

  // `token` says the page has loaded a session; requests send the current one, which Supabase
  // replaces about every hour.
  const liveToken = useSessionToken(token ?? '');
  const headers = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${liveToken}`,
  }), [liveToken]);

  const freshAuthHeader = useCallback(async (): Promise<HeadersInit> => {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token ?? token ?? '';
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    freshAuthHeader().then(h =>
      fetch('/api/programs', { headers: h as any })
        .then(r => r.json())
        .then(d => setPrograms(d.data ?? []))
        .finally(() => setLoading(false))
    );
  }, [token]);

  const loadAllCerts = useCallback(async () => {
    setCertsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const t = sessionData.session?.access_token;
      if (!t) { setCertsLoading(false); return; }
      const res = await fetch('/api/open-certificates', {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      if (!res.ok) { setCertsLoading(false); return; }
      setAllCerts(data.data ?? []);
    } catch { /* non-blocking */ }
    setCertsLoading(false);
  }, []);

  useEffect(() => { if (authChecked) loadAllCerts(); }, [authChecked, loadAllCerts]);

  const certCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of allCerts) {
      if (c.program_id) map[c.program_id] = (map[c.program_id] ?? 0) + 1;
    }
    return map;
  }, [allCerts]);

  const filteredCerts = useMemo(() => {
    let list = allCerts;
    if (credProgramFilter !== 'all') list = list.filter(c => c.program_id === credProgramFilter);
    if (credStatusFilter === 'active')  list = list.filter(c => !c.revoked);
    if (credStatusFilter === 'revoked') list = list.filter(c => c.revoked);
    if (credSearch) {
      const q = credSearch.toLowerCase();
      list = list.filter(c =>
        c.recipient_name.toLowerCase().includes(q) ||
        (c.recipient_email ?? '').toLowerCase().includes(q) ||
        c.id.includes(q)
      );
    }
    return list;
  }, [allCerts, credProgramFilter, credStatusFilter, credSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredCerts.length / PAGE_SIZE));
  const pagedCerts = filteredCerts.slice((credPage - 1) * PAGE_SIZE, credPage * PAGE_SIZE);

  const revoke = async (cert: OpenCert) => {
    const next = !cert.revoked;
    await fetch(`/api/open-certificates/${cert.id}`, { method: 'PATCH', headers: headers() as any, body: JSON.stringify({ revoked: next }) });
    setAllCerts(prev => prev.map(c => c.id === cert.id ? { ...c, revoked: next } : c));
  };

  const copyLink = async (certId: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/credential/${certId}`);
    setCopiedId(certId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteProgram = async (id: string) => {
    setDeletingProgramId(id);
    try {
      await fetch('/api/programs', { method: 'DELETE', headers: headers() as any, body: JSON.stringify({ id }) });
      setPrograms(prev => prev.filter(p => p.id !== id));
      setAllCerts(prev => prev.filter(c => c.program_id !== id));
      setOpenMenuId(null);
      setDeleteConfirmId(null);
    } finally { setDeletingProgramId(null); }
  };

  const openIssueForProgram = (p: Program) => {
    setIssuingForProgram(p);
    setPanel('issue');
    setOpenMenuId(null);
  };


  if (!authChecked) return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 style={{ width: 32, height: 32, animation: 'spin 1s linear infinite', color: C.faint }} />
    </div>
  );

  if (!token) return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: C.muted }}>You must be signed in to access this page.</p>
    </div>
  );

  const viewCertsByProgram = (programId: string) => {
    setCredProgramFilter(programId);
    setCredPage(1);
    setActiveTab('credentials');
  };

  return (
    <div style={{ minHeight: '100vh', background: C.page, color: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 15, ['--prog-hover' as any]: C.input }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .prog-card:hover { background: var(--prog-hover) !important; }
        .row-hover:hover { background: var(--row-hover) !important; }
        input:focus, textarea:focus, select:focus { outline: none !important; box-shadow: none !important; }
      `}</style>

      {/* Nav */}
      <div style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}`, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 56, position: 'sticky', top: 0, zIndex: 40 }}>
        <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, textDecoration: 'none', fontSize: 14 }}>
          <ArrowLeft style={{ width: 15, height: 15 }} /> Dashboard
        </a>
        <span style={{ color: C.divider }}>|</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Award style={{ width: 18, height: 18, color: C.cta }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Open Credentials</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}`, padding: '0 28px', display: 'flex', gap: 4 }}>
        {(['programs', 'credentials'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '14px 16px', fontSize: 14, fontWeight: activeTab === tab ? 700 : 400,
            color: activeTab === tab ? C.cta : C.muted, background: 'none', border: 'none',
            borderBottom: `2px solid ${activeTab === tab ? C.cta : 'transparent'}`,
            cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
          }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 16px' }}>

        {/* -- PROGRAMS TAB -- */}
        {activeTab === 'programs' && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: C.text }}>Programs</h2>
              <button
                onClick={() => { setEditingProgram(null); setPanel('new_program'); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                <Plus style={{ width: 15, height: 15 }} /> {isMobile ? 'New' : 'New Program'}
              </button>
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Loader2 style={{ width: 28, height: 28, animation: 'spin 1s linear infinite', color: C.faint }} />
              </div>
            ) : programs.length === 0 ? (
              <div style={{ background: C.card, border: `2px dashed ${C.cardBorder}`, borderRadius: 16, padding: '64px 24px', textAlign: 'center' }}>
                <Award style={{ width: 48, height: 48, color: C.faint, opacity: 0.3, margin: '0 auto 12px' }} />
                <p style={{ fontSize: 16, fontWeight: 600, color: C.muted, margin: '0 0 6px' }}>No programs yet</p>
                <p style={{ fontSize: 13, color: C.faint, margin: '0 0 18px' }}>Create a program to start issuing credentials to participants.</p>
                <button onClick={() => setPanel('new_program')}
                  style={{ background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Plus style={{ width: 15, height: 15 }} /> Create Program
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {programs.map(p => {
                  const menuOpen  = openMenuId === p.id;
                  const count      = certCounts[p.id] ?? 0;
                  const isDeleting = deletingProgramId === p.id;
                  const confirmDel = deleteConfirmId === p.id;

                  return (
                    <div key={p.id} className="prog-card" style={{ background: C.card, borderRadius: 14, padding: '18px 20px', display: 'flex', gap: 18, alignItems: 'center', transition: 'background 0.15s', position: 'relative' }}>

                      {/* Badge thumbnail */}
                      <div style={{ width: 84, height: 84, flexShrink: 0, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {p.badge_image_url
                          ? <img src={p.badge_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <Award style={{ width: 36, height: 36, color: '#6366f1', opacity: 0.4 }} />
                        }
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{p.name}</h3>
                        {p.description && (
                          <p style={{ margin: '0 0 10px', fontSize: 14, color: C.muted, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{stripHtml(p.description)}</p>
                        )}
                        {/* Stats row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                          <button onClick={() => viewCertsByProgram(p.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontSize: 14, fontWeight: 600, padding: 0 }}>
                            <BadgeCheck style={{ width: 14, height: 14 }} />
                            {count} Credential{count !== 1 ? 's' : ''} 
                          </button>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, color: C.faint }}>
                            <Calendar style={{ width: 13, height: 13 }} />
                            Created {fmtDate(p.created_at)}
                          </span>
                        </div>
                      </div>

                      {/* 3-dot menu */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {menuOpen && (
                          <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => { setOpenMenuId(null); setMenuPos(null); }} />
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); if (menuOpen) { setOpenMenuId(null); setMenuPos(null); } else { const r = e.currentTarget.getBoundingClientRect(); setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right }); setOpenMenuId(p.id); } }}
                          style={{ background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: C.faint, display: 'flex', alignItems: 'center' }}
                        >
                          <MoreVertical style={{ width: 16, height: 16 }} />
                        </button>

                        {menuOpen && menuPos && (
                          <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 20, minWidth: 180, overflow: 'hidden' }}>
                            <MenuBtn icon={<Edit2 style={{ width: 14, height: 14 }} />} label="Edit"
                              onClick={() => { setEditingProgram(p); setPanel('edit_program'); setOpenMenuId(null); }} C={C} />
                            <MenuBtn icon={<Plus style={{ width: 14, height: 14 }} />} label="Create Credential"
                              onClick={() => openIssueForProgram(p)} C={C} />
                            <MenuBtn icon={<Download style={{ width: 14, height: 14 }} />} label="Export CSV"
                              onClick={() => { downloadCertsCsv(allCerts.filter(c => c.program_id === p.id), p.name); setOpenMenuId(null); }} C={C} />
                            <div style={{ height: 1, background: C.divider, margin: '4px 0' }} />
                            {confirmDel ? (
                              <div style={{ padding: '10px 14px' }}>
                                <p style={{ fontSize: 12, color: C.deleteText, margin: '0 0 8px', fontWeight: 600 }}>Delete this program?</p>
                                <p style={{ fontSize: 11, color: C.faint, margin: '0 0 10px', lineHeight: 1.4 }}>Issued credentials remain but will lose their program link.</p>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button onClick={() => setDeleteConfirmId(null)}
                                    style={{ flex: 1, fontSize: 12, background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: C.muted }}>
                                    Cancel
                                  </button>
                                  <button onClick={() => deleteProgram(p.id)} disabled={isDeleting}
                                    style={{ flex: 1, fontSize: 12, background: C.deleteBg, border: `1px solid ${C.deleteBorder}`, borderRadius: 6, padding: '5px 8px', cursor: isDeleting ? 'not-allowed' : 'pointer', color: C.deleteText, fontWeight: 700 }}>
                                    {isDeleting ? '...' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <MenuBtn icon={<Trash2 style={{ width: 14, height: 14 }} />} label="Delete"
                                onClick={() => setDeleteConfirmId(p.id)} C={C} danger />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* -- CREDENTIALS TAB -- */}
        {activeTab === 'credentials' && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BadgeCheck style={{ width: 20, height: 20, color: C.cta }} />
                <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: C.text }}>Credentials</h2>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!isMobile && (
                  <button
                    onClick={() => downloadCertsCsv(filteredCerts, credProgramFilter !== 'all' ? (programs.find(p => p.id === credProgramFilter)?.name ?? 'all') : 'all-credentials')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontSize: 14, color: C.muted, cursor: 'pointer', fontWeight: 500 }}
                  >
                    <Download style={{ width: 14, height: 14 }} /> Export CSV
                  </button>
                )}
                <button
                  onClick={() => { setIssuingForProgram(null); setPanel('issue'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                >
                  <Plus style={{ width: 15, height: 15 }} /> {isMobile ? 'Issue' : 'Create Credentials'}
                </button>
              </div>
            </div>

            {/* Search + filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <div style={{ position: 'relative' }}>
                <Search style={{ width: 14, height: 14, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />
                <input
                  placeholder="Search by name, email or ID..."
                  value={credSearch}
                  onChange={e => { setCredSearch(e.target.value); setCredPage(1); }}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 10px 9px 32px', fontSize: 13, color: C.text, boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select
                  value={credProgramFilter}
                  onChange={e => { setCredProgramFilter(e.target.value); setCredPage(1); }}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.text, cursor: 'pointer' }}
                >
                  <option value="all">All Programs</option>
                  {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select
                  value={credStatusFilter}
                  onChange={e => { setCredStatusFilter(e.target.value); setCredPage(1); }}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.text, cursor: 'pointer' }}
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>
            </div>

            {/* Stats + pagination controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 14, color: C.muted }}>
                {certsLoading ? 'Loading...' : filteredCerts.length === 0 ? 'No credentials' : `Viewing ${(credPage - 1) * PAGE_SIZE + 1} - ${Math.min(credPage * PAGE_SIZE, filteredCerts.length)} of ${filteredCerts.length} credential${filteredCerts.length !== 1 ? 's' : ''}`}
              </span>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: C.muted }}>Page {credPage} of {totalPages}</span>
                  <button onClick={() => setCredPage(p => Math.max(1, p - 1))} disabled={credPage === 1}
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '4px 7px', cursor: credPage === 1 ? 'not-allowed' : 'pointer', opacity: credPage === 1 ? 0.4 : 1, display: 'flex' }}>
                    <ChevronLeft style={{ width: 14, height: 14, color: C.muted }} />
                  </button>
                  <button onClick={() => setCredPage(p => Math.min(totalPages, p + 1))} disabled={credPage === totalPages}
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '4px 7px', cursor: credPage === totalPages ? 'not-allowed' : 'pointer', opacity: credPage === totalPages ? 0.4 : 1, display: 'flex' }}>
                    <ChevronRight style={{ width: 14, height: 14, color: C.muted }} />
                  </button>
                </div>
              )}
            </div>

            {/* Bulk actions */}
            {selectedCertIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '8px 14px', marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.cta }}>{selectedCertIds.size} selected</span>
                <button
                  onClick={() => downloadCertsCsv(allCerts.filter(c => selectedCertIds.has(c.id)), 'selected')}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, color: C.muted, cursor: 'pointer' }}>
                  <Download style={{ width: 12, height: 12 }} /> Export Selected
                </button>
                <button
                  onClick={() => setSelectedCertIds(new Set())}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: C.faint, cursor: 'pointer', marginLeft: 'auto' }}>
                  Deselect all
                </button>
              </div>
            )}

            {/* Table */}
            {certsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Loader2 style={{ width: 28, height: 28, animation: 'spin 1s linear infinite', color: C.faint }} />
              </div>
            ) : filteredCerts.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
                <BadgeCheck style={{ width: 40, height: 40, color: C.faint, opacity: 0.3, margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14, color: C.faint, margin: 0 }}>
                  {allCerts.length === 0 ? 'No credentials issued yet. Click "Create Credentials" to get started.' : 'No credentials match your filters.'}
                </p>
              </div>
            ) : isMobile ? (
              /* Mobile: card list */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pagedCerts.map(cert => {
                  const rowMenuOpen = openMenuId === `cert-${cert.id}`;
                  return (
                    <div key={cert.id} style={{ background: C.card, borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: getAvatarColor(cert.recipient_name), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: 12, fontWeight: 700 }}>
                            {getInitials(cert.recipient_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.recipient_name}</p>
                            {cert.recipient_email && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.recipient_email}</p>}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0, background: cert.revoked ? C.deleteBg : '#f0fdf4', color: cert.revoked ? C.deleteText : '#16a34a', border: `1px solid ${cert.revoked ? C.deleteBorder : '#bbf7d0'}` }}>
                          {cert.revoked ? 'Revoked' : 'Active'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.faint, marginBottom: 12 }}>
                        <span>{cert.program_name}</span>
                        <span>{fmtDate(cert.issued_date)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a href={`/credential/${cert.id}`} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                          <ExternalLink style={{ width: 13, height: 13 }} /> Open
                        </a>
                        <button onClick={() => copyLink(cert.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, color: copiedId === cert.id ? '#16a34a' : C.muted, cursor: 'pointer' }}>
                          <Copy style={{ width: 13, height: 13 }} /> {copiedId === cert.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button onClick={() => { setEditingCert(cert); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, color: C.muted, cursor: 'pointer' }}>
                          <Edit2 style={{ width: 13, height: 13 }} /> Edit
                        </button>
                        <button onClick={() => revoke(cert)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, background: cert.revoked ? C.input : C.deleteBg, border: `1px solid ${cert.revoked ? C.cardBorder : C.deleteBorder}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, color: cert.revoked ? C.muted : C.deleteText, cursor: 'pointer' }}>
                          {cert.revoked ? <Check style={{ width: 13, height: 13 }} /> : <X style={{ width: 13, height: 13 }} />}
                          {cert.revoked ? 'Restore' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Desktop: table */
              <div style={{ background: C.card, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.divider}`, background: C.input }}>
                      <th style={{ width: 40, padding: '10px 14px' }}>
                        <input type="checkbox"
                          checked={pagedCerts.length > 0 && pagedCerts.every(c => selectedCertIds.has(c.id))}
                          onChange={e => {
                            if (e.target.checked) setSelectedCertIds(prev => new Set([...prev, ...pagedCerts.map(c => c.id)]));
                            else setSelectedCertIds(prev => { const next = new Set(prev); pagedCerts.forEach(c => next.delete(c.id)); return next; });
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      {['Credential ID', 'Recipient', 'Program', 'Issue Date', 'Status', ''].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.faint }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCerts.map((cert, i) => {
                      const rowMenuOpen = openMenuId === `cert-${cert.id}`;
                      return (
                        <tr key={cert.id} style={{ borderBottom: i < pagedCerts.length - 1 ? `1px solid ${C.divider}` : 'none', background: selectedCertIds.has(cert.id) ? `${C.cta}08` : 'transparent', transition: 'background 0.1s' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <input type="checkbox" checked={selectedCertIds.has(cert.id)}
                              onChange={e => setSelectedCertIds(prev => { const next = new Set(prev); e.target.checked ? next.add(cert.id) : next.delete(cert.id); return next; })}
                              style={{ cursor: 'pointer' }} />
                          </td>

                          {/* Credential ID */}
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>
                              {cert.id.replace(/-/g, '').slice(0, 8).toUpperCase()}
                            </span>
                          </td>

                          {/* Recipient */}
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 34, height: 34, borderRadius: '50%', background: getAvatarColor(cert.recipient_name), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: 12, fontWeight: 700 }}>
                                {getInitials(cert.recipient_name)}
                              </div>
                              <div>
                                <p style={{ margin: 0, fontWeight: 500, color: C.text, fontSize: 13 }}>{cert.recipient_name}</p>
                                {cert.recipient_email && (
                                  <p style={{ margin: '1px 0 0', fontSize: 12, color: C.faint }}>{cert.recipient_email}</p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Program */}
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{cert.program_name}</span>
                          </td>

                          {/* Issue Date */}
                          <td style={{ padding: '12px 14px', color: C.muted, fontSize: 13, whiteSpace: 'nowrap' }}>
                            {fmtDate(cert.issued_date)}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: cert.revoked ? C.deleteBg : '#f0fdf4', color: cert.revoked ? C.deleteText : '#16a34a', border: `1px solid ${cert.revoked ? C.deleteBorder : '#bbf7d0'}` }}>
                              {cert.revoked ? 'Revoked' : 'Active'}
                            </span>
                          </td>

                          {/* Actions */}
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <a href={`/credential/${cert.id}`} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                Open
                              </a>
                              <div style={{ position: 'relative' }}>
                                {rowMenuOpen && (
                                  <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => { setOpenMenuId(null); setMenuPos(null); }} />
                                )}
                                <button
                                  onClick={e => { e.stopPropagation(); if (rowMenuOpen) { setOpenMenuId(null); setMenuPos(null); } else { const r = e.currentTarget.getBoundingClientRect(); setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right }); setOpenMenuId(`cert-${cert.id}`); } }}
                                  style={{ background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '5px 6px', cursor: 'pointer', color: C.faint, display: 'flex' }}>
                                  <MoreVertical style={{ width: 14, height: 14 }} />
                                </button>
                                {rowMenuOpen && menuPos && (
                                  <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 20, minWidth: 170, overflow: 'hidden' }}>
                                    <MenuBtn icon={<Edit2 style={{ width: 14, height: 14 }} />} label="Edit Credential"
                                      onClick={() => { setEditingCert(cert); setOpenMenuId(null); setMenuPos(null); }} C={C} />
                                    <MenuBtn icon={<Copy style={{ width: 14, height: 14 }} />}
                                      label={copiedId === cert.id ? 'Copied!' : 'Copy Link'}
                                      onClick={() => { copyLink(cert.id); setOpenMenuId(null); setMenuPos(null); }} C={C} />
                                    <MenuBtn icon={<ExternalLink style={{ width: 14, height: 14 }} />} label="View"
                                      onClick={() => { window.open(`/credential/${cert.id}`, '_blank'); setOpenMenuId(null); setMenuPos(null); }} C={C} />
                                    <div style={{ height: 1, background: C.divider, margin: '4px 0' }} />
                                    <MenuBtn
                                      icon={cert.revoked ? <Check style={{ width: 14, height: 14 }} /> : <X style={{ width: 14, height: 14 }} />}
                                      label={cert.revoked ? 'Restore' : 'Revoke'}
                                      onClick={() => { revoke(cert); setOpenMenuId(null); setMenuPos(null); }} C={C}
                                      danger={!cert.revoked}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bottom pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                <button onClick={() => setCredPage(1)} disabled={credPage === 1}
                  style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: C.muted, cursor: credPage === 1 ? 'not-allowed' : 'pointer', opacity: credPage === 1 ? 0.4 : 1 }}>
                  First
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pg = Math.max(1, Math.min(totalPages - 4, credPage - 2)) + i;
                  return (
                    <button key={pg} onClick={() => setCredPage(pg)}
                      style={{ background: credPage === pg ? C.cta : C.card, border: `1px solid ${credPage === pg ? C.cta : C.cardBorder}`, borderRadius: 6, padding: '6px 11px', fontSize: 13, color: credPage === pg ? C.ctaText : C.muted, cursor: 'pointer', fontWeight: credPage === pg ? 700 : 400 }}>
                      {pg}
                    </button>
                  );
                })}
                <button onClick={() => setCredPage(totalPages)} disabled={credPage === totalPages}
                  style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: C.muted, cursor: credPage === totalPages ? 'not-allowed' : 'pointer', opacity: credPage === totalPages ? 0.4 : 1 }}>
                  Last
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {(panel === 'new_program' || panel === 'edit_program') && (
        <Modal title={panel === 'edit_program' ? 'Edit Program' : 'New Program'} onClose={() => setPanel('none')} C={C} width={920}>
          <ProgramForm
            initial={editingProgram ?? undefined}
            C={C}
            onCancel={() => setPanel('none')}
            onSave={saved => {
              if (panel === 'edit_program') {
                setPrograms(prev => prev.map(p => p.id === saved.id ? saved : p));
              } else {
                setPrograms(prev => [saved, ...prev]);
              }
              setPanel('none');
            }}
          />
        </Modal>
      )}

      {editingCert && (
        <Modal title="Edit Credential" onClose={() => setEditingCert(null)} C={C} width={480}>
          <EditCertForm
            cert={editingCert}
            C={C}
            hdrs={headers()}
            onCancel={() => setEditingCert(null)}
            onSave={updated => {
              setAllCerts(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
              setEditingCert(null);
            }}
          />
        </Modal>
      )}

      {panel === 'issue' && (
        <Modal title="Create Credentials" onClose={() => setPanel('none')} C={C} width={800}>
          <IssuePanel
            programs={programs}
            initialProgram={issuingForProgram}
            C={C}
            onCancel={() => setPanel('none')}
            onDone={async () => {
              setPanel('none');
              await loadAllCerts().catch(() => {});
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// --- Edit Credential Form ---
function EditCertForm({ cert, C, hdrs, onCancel, onSave }: {
  cert: OpenCert; C: typeof LIGHT_C; hdrs: HeadersInit;
  onCancel: () => void; onSave: (updated: OpenCert) => void;
}) {
  const [name, setName]     = useState(cert.recipient_name);
  const [email, setEmail]   = useState(cert.recipient_email ?? '');
  const [date, setDate]     = useState(cert.issued_date);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/open-certificates/${cert.id}`, {
        method: 'PATCH', headers: hdrs,
        body: JSON.stringify({ recipient_name: name.trim(), recipient_email: email.trim() || null, issued_date: date || cert.issued_date }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to update.'); return; }
      onSave({ ...cert, recipient_name: name.trim(), recipient_email: email.trim() || null, issued_date: date || cert.issued_date });
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Recipient Name *</label>
        <input value={name} onChange={e => setName(e.target.value)}
          style={{ width: '100%', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 12px', fontSize: 14, color: C.text, boxSizing: 'border-box' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Optional"
          style={{ width: '100%', background: C.input, border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 12px', fontSize: 14, color: C.text, boxSizing: 'border-box' }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Issue Date</label>
        <DateField label="Issue date" value={date} onChange={setDate} C={C} />
      </div>
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.deleteBg, border: `1px solid ${C.deleteBorder}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.deleteText }}>
          <AlertTriangle style={{ width: 14, height: 14 }} /> {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: '9px 18px', fontSize: 14, color: C.muted, cursor: 'pointer' }}>Cancel</button>
        <button onClick={save} disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 14, height: 14 }} />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

// --- Menu Button Helper ---
function MenuBtn({ icon, label, onClick, C, danger = false }: {
  icon: ReactNode; label: string; onClick: () => void;
  C: typeof LIGHT_C; danger?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
      padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
      color: danger ? C.deleteText : C.text, transition: 'background 0.1s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? C.deleteBg : C.input)}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {icon} {label}
    </button>
  );
}
