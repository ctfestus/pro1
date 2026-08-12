'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { motion } from 'motion/react';
import { ArrowLeft, Plus, Trash2, Loader2, Save, Link as LinkIcon, Upload, X, Images } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeRichText, sanitizePlainText } from '@/lib/sanitize';

// --- Design tokens: standard palette from lib/theme.ts ---

// --- Types ---
interface Topic {
  id: string;
  name: string;
  description: string;
}

interface Resource {
  id: string;
  name: string;
  url: string;
}

interface Course {
  id: string;
  title: string;
}

// --- Shared styles ---
function inputStyle(C: typeof LIGHT_C) {
  return {
    width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.cardBorder}`,
    background: C.input, color: C.text, fontSize: 14, outline: 'none',
    transition: 'border-color 0.15s', boxSizing: 'border-box',
  } as React.CSSProperties;
}
function textareaStyle(C: typeof LIGHT_C) {
  return { ...inputStyle(C), minHeight: 80, resize: 'vertical' as const, lineHeight: 1.6 };
}
function labelStyle(C: typeof LIGHT_C) {
  return { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 } as React.CSSProperties;
}

// --- Page ---
export default function CreateSchedulePage() {
  const C = useC();
  const isDark = C === DARK_C;
  const router = useRouter();

  const [editId, setEditId]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [courses, setCourses]   = useState<Course[]>([]);

  // Form fields
  const [title, setTitle]           = useState('');
  const [courseId, setCourseId]     = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage]     = useState('');
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [status, setStatus]         = useState<'draft' | 'published'>('draft');
  const [topics, setTopics]         = useState<Topic[]>([]);
  const [resources, setResources]   = useState<Resource[]>([]);
  const [cohorts, setCohorts]       = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['instructor', 'admin'].includes(profile.role)) {
        router.replace('/dashboard');
        return;
      }

      const [{ data: coursesData }, { data: cohortsData }] = await Promise.all([
        supabase.from('courses').select('id, title').eq('user_id', session.user.id).order('title'),
        supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
      ]);
      if (coursesData) setCourses(coursesData);
      if (cohortsData) setCohorts(cohortsData);

      if (id) {
        const [{ data: scheduleData }, { data: topicsData }, { data: resourcesData }] = await Promise.all([
          supabase.from('schedules').select('*').eq('id', id).single(),
          supabase.from('schedule_topics').select('*').eq('schedule_id', id).order('order_index', { ascending: true }),
          supabase.from('schedule_resources').select('*').eq('schedule_id', id).order('created_at', { ascending: true }),
        ]);

        if (scheduleData) {
          setTitle(scheduleData.title ?? '');
          setCourseId(scheduleData.course_id ?? '');
          setDescription(scheduleData.description ?? '');
          setCoverImage(scheduleData.cover_image ?? '');
          setStartDate(scheduleData.start_date ?? '');
          setEndDate(scheduleData.end_date ?? '');
          setStatus(scheduleData.status ?? 'draft');
          if (scheduleData.cohort_ids?.length) setSelectedCohortIds(scheduleData.cohort_ids);
        }
        if (topicsData) setTopics(topicsData.map((t: any) => ({ id: t.id, name: t.name, description: t.description ?? '' })));
        if (resourcesData) setResources(resourcesData.map((r: any) => ({ id: r.id, name: r.name, url: r.url })));
      }
    };
    init();
  }, [router]);

  // -- Topics helpers ---
  function addTopic() {
    setTopics(prev => [...prev, { id: crypto.randomUUID(), name: '', description: '' }]);
  }
  function removeTopic(id: string) {
    setTopics(prev => prev.filter(t => t.id !== id));
  }
  function updateTopic(id: string, field: 'name' | 'description', value: string) {
    setTopics(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  }

  // -- Resources helpers ---
  function addResource() {
    setResources(prev => [...prev, { id: crypto.randomUUID(), name: '', url: '' }]);
  }
  function removeResource(id: string) {
    setResources(prev => prev.filter(r => r.id !== id));
  }
  function updateResource(id: string, field: 'name' | 'url', value: string) {
    setResources(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // -- Save ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }

    if (startDate && endDate && endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const payload = {
        title: trimmedTitle,
        course_id: courseId || null,
        description: sanitizeRichText(description) || null,
        cover_image: coverImage.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        cohort_ids: selectedCohortIds,
      };

      let scheduleId = editId;
      if (editId) {
        const { error: scheduleError } = await supabase.from('schedules').update(payload).eq('id', editId);
        if (scheduleError) throw scheduleError;
        await supabase.from('schedule_topics').delete().eq('schedule_id', editId);
        await supabase.from('schedule_resources').delete().eq('schedule_id', editId);
      } else {
        const { data: schedule, error: scheduleError } = await supabase
          .from('schedules')
          .insert({ ...payload, created_by: session.user.id })
          .select('id')
          .single();

        if (scheduleError) throw scheduleError;
        scheduleId = schedule.id;
      }

      // Batch insert topics
      const validTopics = topics.filter(t => t.name.trim());
      if (validTopics.length > 0) {
        const { error: topicsError } = await supabase
          .from('schedule_topics')
          .insert(validTopics.map((t, idx) => ({
            schedule_id: scheduleId,
            name:        t.name.trim(),
            description: t.description.trim() || null,
            order_index: idx,
          })));
        if (topicsError) throw topicsError;
      }

      // Batch insert resources
      const validResources = resources.filter(r => r.name.trim() && r.url.trim());
      if (validResources.length > 0) {
        const { error: resourcesError } = await supabase
          .from('schedule_resources')
          .insert(validResources.map(r => ({
            schedule_id: scheduleId,
            name:        r.name.trim(),
            url:         r.url.trim(),
          })));
        if (resourcesError) throw resourcesError;
      }

      router.push('/dashboard#schedule');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // -- Render ---
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
          <h1 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{editId ? 'Edit Schedule' : 'New Schedule'}</h1>
          <motion.button
            type="submit" form="schedule-form"
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
            {loading ? 'Saving…' : status === 'draft' ? 'Save Draft' : 'Publish'}
          </motion.button>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 80px' }}>
        <form id="schedule-form" onSubmit={handleSubmit} noValidate>

          {error && (
            <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}`, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* -- One wide card, sections separated by hairlines --- */}
          <section style={{ background: C.card, borderRadius: 18, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow, overflow: 'hidden' }}>

            {/* Section: Details */}
            <div style={{ padding: '26px 30px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 18 }}>Details</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Title <span style={{ color: C.errorText }}>*</span></label>
                <input
                  type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                  placeholder="e.g. Data Science Bootcamp: Week 1 Schedule"
                  style={inputStyle(C)} required maxLength={255}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Course</label>
                <select
                  value={courseId} onChange={e => setCourseId(e.target.value)}
                  style={{ ...inputStyle(C), appearance: 'auto' }}
                >
                  <option value="">None</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Status</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['draft', 'published'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 8,
                        border: 'none',
                        background: status === s ? C.cta : C.input,
                        color: status === s ? C.ctaText : C.muted,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                        transition: 'all 0.15s',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Description</label>
                <RichTextEditor value={description} onChange={setDescription} placeholder="Briefly describe what this schedule covers…" enableAiAssist />
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle(C)}>Start Date</label>
                  <input
                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    style={inputStyle(C)}
                  />
                </div>
                <div>
                  <label style={labelStyle(C)}>End Date</label>
                  <input
                    type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    style={inputStyle(C)}
                  />
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Topics */}
            <div style={{ padding: '26px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>Topics</h2>
                  <p style={{ fontSize: 12, color: C.faint, margin: '4px 0 0' }}>Topics are ordered by their position in the list.</p>
                </div>
                <button
                  type="button" onClick={addTopic}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 8, border: 'none',
                    background: C.pill, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Plus style={{ width: 14, height: 14 }}/> Add Topic
                </button>
              </div>

              {topics.length === 0 && (
                <p style={{ textAlign: 'center', color: C.faint, fontSize: 14, padding: '24px 0' }}>
                  No topics yet. Use the Add Topic button to build your schedule outline.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {topics.map((topic, idx) => (
                  <div key={topic.id} style={{
                    padding: 16, borderRadius: 12, background: C.pill,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.faint, minWidth: 22, textAlign: 'center', background: C.pill, padding: '3px 7px', borderRadius: 6 }}>
                        {idx + 1}
                      </span>
                      <input
                        type="text" placeholder="Topic name" value={topic.name}
                        onChange={e => updateTopic(topic.id, 'name', sanitizePlainText(e.target.value))}
                        style={{ ...inputStyle(C), background: C.card, flex: 1 }} maxLength={200}
                      />
                      <button
                        type="button" onClick={() => removeTopic(topic.id)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 34, height: 34, borderRadius: 8, border: 'none',
                          background: C.pill, color: C.faint, cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <Trash2 style={{ width: 14, height: 14 }}/>
                      </button>
                    </div>
                    <textarea
                      placeholder="Topic description (optional)…"
                      value={topic.description}
                      onChange={e => updateTopic(topic.id, 'description', sanitizePlainText(e.target.value))}
                      style={{ ...textareaStyle(C), background: C.card, minHeight: 64 }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Resources */}
            <div style={{ padding: '26px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>Resources</h2>
                <button
                  type="button" onClick={addResource}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 8, border: 'none',
                    background: C.pill, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Plus style={{ width: 14, height: 14 }}/> Add Resource
                </button>
              </div>

              {resources.length === 0 && (
                <p style={{ textAlign: 'center', color: C.faint, fontSize: 14, padding: '24px 0' }}>
                  No resources yet. Use the Add Resource button to attach links.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {resources.map(resource => (
                  <div key={resource.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'center',
                    padding: 14, borderRadius: 10, background: C.pill,
                  }}>
                    <input
                      type="text" placeholder="Resource name" value={resource.name}
                      onChange={e => updateResource(resource.id, 'name', sanitizePlainText(e.target.value))}
                      style={{ ...inputStyle(C), background: C.card, width: '100%' }} maxLength={200}
                    />
                    <input
                      type="url" placeholder="https://…" value={resource.url}
                      onChange={e => updateResource(resource.id, 'url', e.target.value)}
                      style={{ ...inputStyle(C), background: C.card, width: '100%' }}
                    />
                    <button
                      type="button" onClick={() => removeResource(resource.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 34, height: 34, borderRadius: 8, border: 'none',
                        background: C.pill, color: C.faint, cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }}/>
                    </button>
                  </div>
                ))}
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
