'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { motion } from 'motion/react';
import { ArrowLeft, Loader2, Save, Sparkles, Upload, X, Images } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeAnnouncementContent, sanitizePlainText } from '@/lib/sanitize';

// --- Design tokens: standard palette from lib/theme.ts ---

function inputStyle(C: typeof LIGHT_C) {
  return {
    width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.cardBorder}`,
    background: C.input, color: C.text, fontSize: 14, outline: 'none',
    transition: 'border-color 0.15s', boxSizing: 'border-box',
  } as React.CSSProperties;
}
function textareaStyle(C: typeof LIGHT_C) {
  return { ...inputStyle(C), minHeight: 140, resize: 'vertical' as const, lineHeight: 1.6 };
}
function labelStyle(C: typeof LIGHT_C) {
  return { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 } as React.CSSProperties;
}

// -- Format a date for datetime-local input ---
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Page ---
export default function CreateAnnouncementPage() {
  const C = useC();
  const isDark = C === DARK_C;
  const router = useRouter();

  const [editId, setEditId]             = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const [title, setTitle]               = useState('');
  const [subtitle, setSubtitle]         = useState('');
  const [subtitleGenerating, setSubtitleGenerating] = useState(false);
  const [content, setContent]           = useState('');
  const [coverImage, setCoverImage]     = useState('');
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl]     = useState('');
  const [isPinned, setIsPinned]         = useState(false);
  const [publishedAt, setPublishedAt]   = useState(() => toDatetimeLocalValue(new Date()));
  const [expiresAt, setExpiresAt]       = useState('');
  const [cohorts, setCohorts]           = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const originalCohortIds = useRef<string[]>([]);
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase.from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin'].includes(profile.role)) { router.replace('/dashboard'); return; }

      const { data: c } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (c) setCohorts(c);

      if (id) {
        const { data } = await supabase.from('announcements').select('*').eq('id', id).single();
        if (data) {
          setTitle(data.title ?? '');
          setSubtitle(data.subtitle ?? '');
          setContent(data.content ?? '');
          setCoverImage(data.cover_image ?? '');
          setYoutubeUrl(data.youtube_url ?? '');
          setIsPinned(data.is_pinned ?? false);
          if (data.published_at) setPublishedAt(toDatetimeLocalValue(new Date(data.published_at)));
          if (data.expires_at) setExpiresAt(toDatetimeLocalValue(new Date(data.expires_at)));
          if (data.cohort_ids?.length) {
            setSelectedCohortIds(data.cohort_ids);
            originalCohortIds.current = data.cohort_ids;
          }
        }
      }
    };
    init();
  }, [router]);

  async function generateSubtitle() {
    if (!content.trim()) { setError('Write some content first so the AI has something to work with.'); return; }
    setSubtitleGenerating(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/announcement-subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setSubtitle(json.subtitle ?? '');
    } catch (err: any) {
      setError(err.message || 'Could not generate subtitle.');
    } finally {
      setSubtitleGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle   = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle)   { setError('Title is required.'); return; }
    if (!trimmedContent) { setError('Content is required.'); return; }

    const publishedDate = new Date(publishedAt);
    const expiresDate   = expiresAt ? new Date(expiresAt) : null;
    if (expiresDate && expiresDate <= publishedDate) { setError('Expiry date must be after the published date.'); return; }

    setLoading(true);
    try {
      const payload = {
        title: trimmedTitle, subtitle: subtitle.trim() || null, content: sanitizeAnnouncementContent(content), cover_image: coverImage.trim() || null,
        youtube_url: youtubeUrl.trim() || null,
        is_pinned: isPinned, cohort_ids: selectedCohortIds,
        published_at: publishedDate.toISOString(), expires_at: expiresDate ? expiresDate.toISOString() : null,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      let addedCohortIds: string[] = [];
      if (editId) {
        const { error: e } = await supabase.from('announcements').update(payload).eq('id', editId);
        if (e) throw e;
        // Detect newly added cohorts
        addedCohortIds = selectedCohortIds.filter(id => !originalCohortIds.current.includes(id));
      } else {
        const { error: e } = await supabase.from('announcements').insert({ ...payload, author_id: session.user.id });
        if (e) throw e;
        // On create, all selected cohorts are new
        addedCohortIds = selectedCohortIds;
      }


      router.push('/dashboard#announcements');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.page }}>
      {/* Sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: C.nav, borderBottom: `1px solid ${C.navBorder}`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft style={{ width: 16, height: 16 }}/> Back
          </Link>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{editId ? 'Edit Announcement' : 'New Announcement'}</h1>
          <motion.button
            type="submit" form="announcement-form"
            disabled={loading}
            whileTap={{ scale: 0.96 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: C.cta, color: C.ctaText, fontSize: 14, fontWeight: 600,
              opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
            }}
          >
            {loading ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin"/> : <Save style={{ width: 15, height: 15 }}/>}
            {loading ? 'Saving…' : 'Publish'}
          </motion.button>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 80px' }}>
        <form id="announcement-form" onSubmit={handleSubmit} noValidate>

          {error && (
            <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}`, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* -- One wide card, sections separated by hairlines --- */}
          <section style={{ background: C.card, borderRadius: 18, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow, overflow: 'hidden' }}>

            {/* Section: Content */}
            <div style={{ padding: '26px 30px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 18 }}>Content</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Title <span style={{ color: C.errorText }}>*</span></label>
                <input
                  type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                  placeholder="e.g. Important update for all students"
                  style={inputStyle(C)} required maxLength={255}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ ...labelStyle(C), marginBottom: 0 }}>Subtitle <span style={{ color: C.faint, fontWeight: 400 }}>(optional, shown as the card teaser)</span></label>
                  <button
                    type="button"
                    onClick={generateSubtitle}
                    disabled={subtitleGenerating}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', cursor: subtitleGenerating ? 'not-allowed' : 'pointer', background: `${C.green}1a`, color: C.green, fontSize: 12, fontWeight: 700, opacity: subtitleGenerating ? 0.7 : 1, transition: 'opacity 0.15s', flexShrink: 0 }}>
                    {subtitleGenerating
                      ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin"/>
                      : <Sparkles style={{ width: 12, height: 12 }}/>}
                    {subtitleGenerating ? 'Writing...' : 'AI Write'}
                  </button>
                </div>
                <input
                  type="text" value={subtitle} onChange={e => setSubtitle(sanitizePlainText(e.target.value))}
                  placeholder="A short punchy line shown on the card preview"
                  style={inputStyle(C)} maxLength={200}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Content <span style={{ color: C.errorText }}>*</span></label>
                <RichTextEditor value={content} onChange={setContent} placeholder="Write your announcement here…" enableAiAssist />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Cover Image</label>
                <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setCoverUploading(true);
                  try {
                    const url = await uploadToCloudinary(file, 'covers');
                    setCoverImage(url);
                  } catch (err: any) { setError(err?.message || 'Image upload failed.'); }
                  finally { setCoverUploading(false); e.target.value = ''; }
                }}/>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="url" value={coverImage} onChange={e => setCoverImage(e.target.value)}
                    placeholder="https://example.com/image.jpg" style={{ ...inputStyle(C), flex: 1 }}/>
                  <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Upload style={{ width: 14, height: 14 }}/>{coverUploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library"
                    style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', flexShrink: 0 }}>
                    <Images style={{ width: 14, height: 14 }}/>
                  </button>
                </div>
                {coverImage.trim() && (
                  <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.cardBorder}`, position: 'relative' }}>
                    <img src={coverImage.trim()} alt="Cover" style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} onError={e => (e.target as HTMLImageElement).style.display = 'none'}/>
                    <button type="button" onClick={() => setCoverImage('')}
                      style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <X style={{ width: 14, height: 14, color: 'white' }}/>
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

              <div>
                <label style={labelStyle(C)}>YouTube Video <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="url" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…"
                  style={inputStyle(C)}
                />
                {youtubeUrl.trim() && (() => {
                  const embedId = youtubeUrl.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
                  return embedId ? (
                    <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.cardBorder}`, position: 'relative', paddingBottom: '56.25%', height: 0 }}>
                      <iframe
                        src={`https://www.youtube.com/embed/${embedId}`}
                        title="YouTube preview"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                      />
                    </div>
                  ) : (
                    <p style={{ marginTop: 6, fontSize: 12, color: C.errorText }}>Could not parse YouTube URL. Paste a standard YouTube link.</p>
                  );
                })()}
              </div>
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Settings */}
            <div style={{ padding: '26px 30px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 18 }}>Settings</h2>

              {/* Pin toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.input }}>
                <button
                  type="button"
                  onClick={() => setIsPinned(p => !p)}
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: isPinned ? C.cta : C.faint,
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}
                  aria-checked={isPinned} role="switch" aria-label="Pin announcement"
                >
                  <span style={{
                    position: 'absolute', top: 3, left: isPinned ? 21 : 3,
                    width: 16, height: 16, borderRadius: '50%', background: 'white',
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}/>
                </button>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>Pin Announcement</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.faint }}>Pinned announcements appear at the top of the feed</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle(C)}>Published At</label>
                  <input
                    type="datetime-local" value={publishedAt}
                    onChange={e => setPublishedAt(e.target.value)}
                    style={inputStyle(C)}
                  />
                </div>
                <div>
                  <label style={labelStyle(C)}>Expires At <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span></label>
                  <input
                    type="datetime-local" value={expiresAt}
                    onChange={e => setExpiresAt(e.target.value)}
                    style={inputStyle(C)}
                  />
                </div>
              </div>
            </div>

            {/* Section: Cohorts */}
            {cohorts.length > 0 && (
              <>
                <div style={{ height: 1, background: C.divider }} />
                <div style={{ padding: '26px 30px' }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>Assign to Cohorts</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {cohorts.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedCohortIds.includes(c.id)} onChange={() => toggleCohort(c.id)}
                          style={{ width: 16, height: 16, accentColor: C.cta, cursor: 'pointer' }} />
                        <span style={{ fontSize: 14, color: C.text }}>{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

          </section>

        </form>
      </main>
    </div>
  );
}
