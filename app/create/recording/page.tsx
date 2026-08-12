'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { ArrowLeft, Plus, Loader2, Save, X, Upload, Check, Images } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sanitizeRichText } from '@/lib/sanitize';
import { uploadToCloudinary, deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';

// --- Design tokens: standard palette from lib/theme.ts ---

interface Entry { id: string; week: number; topic: string; url: string; }

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
          })));
          setOriginalWeeks(new Set(entriesData.map((e: any) => e.week)));
        }
      }
    };
    init();
  }, [router]);

  function addEntry() {
    const maxWeek = entries.length ? Math.max(...entries.map(e => e.week)) : 0;
    setEntries(prev => [...prev, { id: crypto.randomUUID(), week: maxWeek + 1, topic: '', url: '' }]);
  }
  function removeEntry(id: string) { setEntries(prev => prev.filter(e => e.id !== id)); }
  function updateEntry(id: string, field: keyof Entry, value: string | number) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (entries.some(e => !e.topic.trim() || !e.url.trim())) {
      setError('Each recording must have a topic and a URL.'); return;
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
      }

      if (entries.length) {
        const rows = entries.map((en, idx) => ({
          recording_id: recId,
          week: en.week,
          topic: en.topic.trim(),
          url: en.url.trim(),
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
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Brief overview of the programme or course…"
                  rows={3} style={{ ...inp(C), resize: 'vertical', lineHeight: 1.6 }}/>
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

            {/* Section: Recordings */}
            <div style={{ padding: '26px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 2 }}>Recordings</h2>
                  <p style={{ fontSize: 13, color: C.faint }}>Add each session with its week number, topic, and link.</p>
                </div>
                <button type="button" onClick={addEntry}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                    background: C.cta, color: C.ctaText, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none' }}>
                  <Plus size={14}/> Add Recording
                </button>
              </div>

              {entries.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: C.faint, fontSize: 14 }}>
                  No recordings yet. Click &quot;Add Recording&quot; to get started.
                </div>
              )}

              {weeks.map(week => {
                const weekEntries = entries.filter(e => e.week === week);
                return (
                  <div key={week} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      Week {week}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {weekEntries.map(entry => (
                        <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto', gap: 8, alignItems: 'center',
                          background: C.pill, borderRadius: 12, padding: '12px 14px' }}>
                          <div>
                            <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Week</label>
                            <input type="number" min={1} value={entry.week}
                              onChange={e => updateEntry(entry.id, 'week', parseInt(e.target.value) || 1)}
                              style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                          </div>
                          <div>
                            <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Topic</label>
                            <input value={entry.topic} onChange={e => updateEntry(entry.id, 'topic', e.target.value)}
                              placeholder="e.g. Introduction to Pivot Tables"
                              style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                          </div>
                          <div>
                            <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Recording URL</label>
                            <input value={entry.url} onChange={e => updateEntry(entry.id, 'url', e.target.value)}
                              placeholder="https://..."
                              style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                          </div>
                          <button type="button" onClick={() => removeEntry(entry.id)}
                            style={{ marginTop: 18, padding: 7, borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)',
                              color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <X size={14}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Entries not yet grouped (new ones before week is set) */}
              {entries.filter(e => !weeks.includes(e.week)).map(entry => (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto', gap: 8, alignItems: 'center',
                  background: C.pill, borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                  <div>
                    <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Week</label>
                    <input type="number" min={1} value={entry.week}
                      onChange={e => updateEntry(entry.id, 'week', parseInt(e.target.value) || 1)}
                      style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                  </div>
                  <div>
                    <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Topic</label>
                    <input value={entry.topic} onChange={e => updateEntry(entry.id, 'topic', e.target.value)}
                      placeholder="e.g. Introduction to Pivot Tables"
                      style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                  </div>
                  <div>
                    <label style={{ ...lbl(C), marginBottom: 4, fontSize: 11 }}>Recording URL</label>
                    <input value={entry.url} onChange={e => updateEntry(entry.id, 'url', e.target.value)}
                      placeholder="https://..."
                      style={{ ...inp(C), background: C.card, padding: '7px 10px', fontSize: 13 }}/>
                  </div>
                  <button type="button" onClick={() => removeEntry(entry.id)}
                    style={{ marginTop: 18, padding: 7, borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)',
                      color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <X size={14}/>
                  </button>
                </div>
              ))}
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
