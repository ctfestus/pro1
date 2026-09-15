'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { ArrowLeft, Plus, Loader2, Save, X, Upload, Check, Images, Paperclip, Trash2, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sanitizeRichText } from '@/lib/sanitize';
import { uploadToCloudinary, deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AttachmentPicker } from '@/components/AttachmentPicker';
import { formatAttachmentSize } from '@/lib/lesson-attachment';
import {
  isUploadedAttachmentUrl, normalizeRecordingAttachments, recordingAttachmentBadge,
  type RecordingAttachment,
} from '@/lib/recording-attachments';

// --- Design tokens: standard palette from lib/theme.ts ---

interface Entry {
  id: string;
  week: number;
  topic: string;
  url: string;
  description: string;
  attachments: RecordingAttachment[];
}

function inp(C: typeof LIGHT_C) {
  return {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: `1px solid ${C.cardBorder}`, background: C.input,
    color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  } as React.CSSProperties;
}
function lbl(C: typeof LIGHT_C) {
  return { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 } as React.CSSProperties;
}

export default function CreateRecordingPage() {
  const C = useC();
  const isDark = C === DARK_C;
  const router = useRouter();

  const [editId, setEditId]   = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // Fields
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [coverImage, setCoverImage]         = useState('');
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [originalCoverImage, setOriginalCoverImage] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const [status, setStatus]             = useState<'draft' | 'published'>('draft');
  const [cohorts, setCohorts]           = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [entries, setEntries]           = useState<Entry[]>([]);
  const [originalWeeks, setOriginalWeeks] = useState<Set<number>>(new Set());

  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin', 'staff'].includes(profile.role)) {
        router.replace('/dashboard'); return;
      }

      const { data: cohortsData } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (cohortsData) setCohorts(cohortsData);

      if (id) {
        const [{ data: rec }, { data: entriesData }] = await Promise.all([
          supabase.from('recordings').select('*').eq('id', id).single(),
          supabase.from('recording_entries').select('*').eq('recording_id', id)
            .order('week').order('order_index'),
        ]);
        if (rec) {
          setTitle(rec.title ?? '');
          setDescription(rec.description ?? '');
          setCoverImage(rec.cover_image ?? '');
          setOriginalCoverImage(rec.cover_image ?? '');
          setStatus(rec.status ?? 'draft');
          if (rec.cohort_ids?.length) setSelectedCohortIds(rec.cohort_ids);
        }
        if (entriesData) {
          setEntries(entriesData.map((e: any) => ({
            id: e.id, week: e.week, topic: e.topic, url: e.url,
            description: e.description ?? '',
            attachments: normalizeRecordingAttachments(e.attachments),
          })));
          setOriginalWeeks(new Set(entriesData.map((e: any) => e.week)));
        }
      }
    };
    init();
  }, [router]);

  function addEntry(week?: number) {
    const maxWeek = entries.length ? Math.max(...entries.map(e => e.week)) : 0;
    setEntries(prev => [...prev, {
      id: crypto.randomUUID(), week: week ?? maxWeek + 1, topic: '', url: '',
      description: '', attachments: [],
    }]);
  }
  function removeEntry(id: string) { setEntries(prev => prev.filter(e => e.id !== id)); }
  function updateEntry<K extends keyof Entry>(id: string, field: K, value: Entry[K]) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }
  function addAttachment(id: string, attachment: RecordingAttachment) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, attachments: [...e.attachments, attachment] } : e));
  }
  // Removal only drops the reference. The uploaded object stays: nothing is saved until
  // the form is submitted, so deleting it here would break the live session for students
  // whenever an author removes a resource and then cancels. Same trade lesson attachments
  // make -- an orphaned object costs storage, a deleted one costs a broken download.
  function removeAttachment(id: string, attachmentId: string) {
    setEntries(prev => prev.map(e => e.id === id
      ? { ...e, attachments: e.attachments.filter(a => a.id !== attachmentId) }
      : e));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (entries.some(e => !e.topic.trim() || !e.url.trim())) {
      setError('Each session must have a topic and a video link.'); return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const payload = {
        title: trimmedTitle,
        description: sanitizeRichText(description) || null,
        cover_image: coverImage.trim() || null,
        cohort_ids: selectedCohortIds,
        status,
      };

      let recId = editId;
      if (editId) {
        const { error: e } = await supabase.from('recordings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId);
        if (e) throw e;
        if (originalCoverImage && originalCoverImage !== coverImage.trim()) {
          await deleteFromCloudinary(originalCoverImage).catch(() => {});
        }
        await supabase.from('recording_entries').delete().eq('recording_id', editId);
      } else {
        const { data, error: e } = await supabase.from('recordings')
          .insert({ ...payload, created_by: session.user.id }).select('id').single();
        if (e) throw e;
        recId = data!.id;
        // The recording row exists from here on. If saving the sessions below fails the
        // author stays on this page with everything still typed in, so adopt the row as
        // the edit target -- without this, pressing Save again creates a second recording.
        // The URL follows so a reload continues editing the same row rather than a third.
        setEditId(recId);
        window.history.replaceState(null, '', `/create/recording?edit=${recId}`);
      }

      if (entries.length) {
        const rows = entries.map((en, idx) => ({
          recording_id: recId,
          week: en.week,
          topic: en.topic.trim(),
          url: en.url.trim(),
          description: sanitizeRichText(en.description) || null,
          attachments: en.attachments,
          order_index: idx,
        }));
        const { error: entErr } = await supabase.from('recording_entries').insert(rows);
        if (entErr) throw entErr;
      }

      // Notify if: new recording published, OR existing published recording has new weeks added
      const currentWeeks = entries.map(e => e.week);
      const addedWeeks = !editId
        ? [...new Set(currentWeeks)]
        : [...new Set(currentWeeks)].filter(w => !originalWeeks.has(w));
      if (status === 'published' && recId && addedWeeks.length > 0) {
        fetch('/api/recording-notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ recordingId: recId, newWeeks: addedWeeks }),
        }).catch(() => {});
      }

      router.push('/dashboard?section=recordings');
    } catch (err: any) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  // Group entries by week for display
  const weeks = [...new Set(entries.map(e => e.week))].sort((a, b) => a - b);

  return (
    <div style={{ minHeight: '100vh', background: C.page }}>
      {/* Nav */}
      <nav style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}`, position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard?section=recordings" style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft size={16}/> Dashboard
          </Link>
          <span style={{ color: C.faint, fontSize: 14 }}>/</span>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{editId ? 'Edit Recording' : 'New Recording'}</span>
        </div>
      </nav>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 16px 80px' }}>
        <form onSubmit={handleSubmit}>

          {/* -- One wide card, sections separated by hairlines --- */}
          <div style={{ background: C.card, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>

            {/* Section: Recording Details */}
            <div style={{ padding: '26px 30px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 18 }}>Recording Details</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl(C)}>Course / Programme Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Microsoft Excel Masterclass"
                  style={inp(C)} required/>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl(C)}>Description</label>
                <RichTextEditor value={description} onChange={setDescription}
                  placeholder="Brief overview of the programme or course..." enableAiAssist/>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl(C)}>Cover Image</label>
                <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setCoverUploading(true);
                  try { const url = await uploadToCloudinary(file, 'covers'); setCoverImage(url); }
                  catch (err: any) { setError(err?.message || 'Image upload failed.'); }
                  finally { setCoverUploading(false); e.target.value = ''; }
                }}/>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="url" value={coverImage} onChange={e => setCoverImage(e.target.value)}
                    placeholder="https://example.com/image.jpg" style={{ ...inp(C), flex: 1 }}/>
                  <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10,
                      border: 'none', background: C.pill, color: C.muted,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Upload size={14}/>{coverUploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library"
                    style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', flexShrink: 0 }}>
                    <Images style={{ width: 14, height: 14 }}/>
                  </button>
                </div>
                {coverImage.trim() && (
                  <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.cardBorder}`, position: 'relative' }}>
                    <img src={coverImage.trim()} alt="Cover" style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                      onError={e => ((e.target as HTMLImageElement).style.display = 'none')}/>
                    <button type="button" onClick={() => setCoverImage('')}
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none',
                        borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <X size={14} color="white"/>
                    </button>
                  </div>
                )}
                {showCoverLibrary && (
                  <ImageLibrary
                    uploadFolder="covers"
                    initialFolder="covers"
                    onSelect={url => setCoverImage(url)}
                    onClose={() => setShowCoverLibrary(false)}
                  />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl(C)}>Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value as any)}
                    style={{ ...inp(C), cursor: 'pointer' }}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Cohorts */}
            <div style={{ padding: '26px 30px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 4 }}>Assign to Cohorts</h2>
              <p style={{ fontSize: 13, color: C.faint, marginBottom: 16 }}>Only students in selected cohorts will see these recordings.</p>
              {cohorts.length === 0
                ? <p style={{ fontSize: 13, color: C.faint }}>No cohorts found.</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {cohorts.map(c => {
                      const sel = selectedCohortIds.includes(c.id);
                      return (
                        <button type="button" key={c.id} onClick={() => toggleCohort(c.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: 'none',
                            background: sel ? C.cta : C.pill,
                            color: sel ? C.ctaText : C.muted,
                            transition: 'all 0.15s',
                          }}>
                          {sel && <Check size={13}/>}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
              }
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Sessions */}
            <div style={{ padding: '26px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 2 }}>Sessions</h2>
                  <p style={{ fontSize: 13, color: C.faint }}>Each session takes a week number, a topic and a video link. Add notes and the files students need for that class.</p>
                </div>
                <button type="button" onClick={() => addEntry()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                    background: C.cta, color: C.ctaText, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', flexShrink: 0 }}>
                  <Plus size={14}/> Add Session
                </button>
              </div>

              {entries.length === 0 && (
                <div style={{ textAlign: 'center', padding: '36px 16px', borderRadius: 14, background: C.pill }}>
                  <Video size={22} style={{ color: C.faint }}/>
                  <p style={{ fontSize: 14, fontWeight: 600, color: C.muted, marginTop: 10 }}>No sessions yet</p>
                  <p style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>Add your first session to start building this programme.</p>
                </div>
              )}

              {weeks.map(week => {
                const weekEntries = entries.filter(e => e.week === week);
                return (
                  <div key={week} style={{ marginBottom: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Week {week} <span style={{ color: C.faint, fontWeight: 600 }}>({weekEntries.length})</span>
                      </div>
                      <button type="button" onClick={() => addEntry(week)}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none',
                          background: C.pill, color: C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                        <Plus size={12}/> Add to week {week}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {weekEntries.map((entry, idx) => (
                        <SessionCard key={entry.id} entry={entry} position={idx + 1} C={C}
                          onUpdate={updateEntry} onRemove={removeEntry}
                          onAddAttachment={addAttachment} onRemoveAttachment={removeAttachment}/>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Error */}
          {error && (
            <div style={{ background: C.errorBg, border: `1px solid ${C.errorBorder}`, borderRadius: 12,
              padding: '12px 16px', marginBottom: 16, color: C.errorText, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Link href="/dashboard?section=recordings"
              style={{ padding: '11px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                background: C.pill, color: C.muted, textDecoration: 'none' }}>
              Cancel
            </Link>
            <button type="submit" disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 24px', borderRadius: 12,
                fontSize: 14, fontWeight: 700, background: C.cta, color: C.ctaText,
                border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? <Loader2 size={15} className="animate-spin"/> : <Save size={15}/>}
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Recording'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// One session row in the editor. Kept in this file because only this editor renders it;
// it holds the picker's open/closed state so two cards can never share one dialog.
function SessionCard({ entry, position, C, onUpdate, onRemove, onAddAttachment, onRemoveAttachment }: {
  entry: Entry;
  position: number;
  C: typeof LIGHT_C;
  onUpdate: <K extends keyof Entry>(id: string, field: K, value: Entry[K]) => void;
  onRemove: (id: string) => void;
  onAddAttachment: (id: string, attachment: RecordingAttachment) => void;
  onRemoveAttachment: (id: string, attachmentId: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div style={{ background: C.pill, borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Session {position}</span>
        <button type="button" onClick={() => onRemove(entry.id)} aria-label="Remove session"
          style={{ padding: 6, borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)',
            color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <Trash2 size={14}/>
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 86, flexShrink: 0 }}>
          <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Week</label>
          <input type="number" min={1} value={entry.week}
            onChange={e => onUpdate(entry.id, 'week', parseInt(e.target.value) || 1)}
            style={{ ...inp(C), background: C.card, padding: '8px 10px', fontSize: 13 }}/>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Topic</label>
          <input value={entry.topic} onChange={e => onUpdate(entry.id, 'topic', e.target.value)}
            placeholder="e.g. Introduction to Pivot Tables"
            style={{ ...inp(C), background: C.card, padding: '8px 10px', fontSize: 13 }}/>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Video link</label>
        <input value={entry.url} onChange={e => onUpdate(entry.id, 'url', e.target.value)}
          placeholder="https://youtu.be/..."
          style={{ ...inp(C), background: C.card, padding: '8px 10px', fontSize: 13 }}/>
        <p style={{ fontSize: 11, color: C.faint, marginTop: 5 }}>
          YouTube, Vimeo, Canva and Bunny links play inside the app. Anything else opens in a new tab.
        </p>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Session notes</label>
        <RichTextEditor value={entry.description}
          onChange={html => onUpdate(entry.id, 'description', html)}
          bgOverride={C.card}
          placeholder="What this class covered, homework, timestamps..."
          enableAiAssist/>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <label style={{ ...lbl(C), marginBottom: 0, fontSize: 11 }}>Resources</label>
          <button type="button" onClick={() => setShowPicker(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none',
              background: C.card, color: C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            <Paperclip size={12}/> Add file or link
          </button>
        </div>
        {entry.attachments.length === 0
          ? <p style={{ fontSize: 12, color: C.faint }}>No resources yet. Upload the workbook or slides, or paste a link.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entry.attachments.map(att => {
                const size = formatAttachmentSize(att.size);
                return (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 10, background: C.card }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: C.muted,
                      background: C.pill, borderRadius: 6, padding: '3px 6px', flexShrink: 0 }}>
                      {recordingAttachmentBadge(att)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: C.text }} className="truncate">{att.name}</p>
                      <p style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>
                        {att.kind === 'file' ? (size ? `Uploaded file - ${size}` : 'Uploaded file') : 'External link'}
                      </p>
                    </div>
                    <button type="button" onClick={() => onRemoveAttachment(entry.id, att.id)} aria-label={`Remove ${att.name}`}
                      style={{ padding: 6, borderRadius: 8, border: 'none', background: 'transparent',
                        color: C.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      <X size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {showPicker && (
        <AttachmentPicker
          folder="recording-files"
          onSelect={picked => {
            onAddAttachment(entry.id, {
              id: crypto.randomUUID(),
              name: picked.fileName || 'Attached file',
              url: picked.href,
              kind: isUploadedAttachmentUrl(picked.href) ? 'file' : 'link',
              size: picked.fileSize,
            });
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
