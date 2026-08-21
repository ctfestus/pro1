'use client';

// Learning-path management workspace shared by the instructor dashboard.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, GraduationCap, Images, Layers3, Loader2, Plus, Radar, Rocket, Search, Settings2, Trash2, Upload, Users, X, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { DARK_C, LIGHT_C, cardStyle } from '@/lib/theme';

export function LearningPathsSection({ C, forms }: { C: typeof LIGHT_C; forms: any[] }) {
  const isDark = C.page === DARK_C.page;
  const [paths, setPaths]           = useState<any[]>([]);
  const [cohorts, setCohorts]       = useState<any[]>([]);
  const [certOptions, setCertOptions] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editing, setEditing]       = useState<any | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [uploadingBadge, setUploadingBadge] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [lpSection, setLpSection] = useState<'overview' | 'content' | 'audience' | 'publish'>('overview');
  const [contentSearch, setContentSearch] = useState('');
  const [contentFilter, setContentFilter] = useState<'all' | 'course' | 'virtual_experience' | 'certification'>('all');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const badgeInputRef = useRef<HTMLInputElement>(null);
  const editingBaseline = useRef<string | null>(null);
  const pathCarouselRef = useRef<HTMLDivElement>(null);

  const scrollPathCarousel = (direction: -1 | 1) => {
    pathCarouselRef.current?.scrollBy({ left: direction * 360, behavior: 'smooth' });
  };

  const publishedForms = forms.filter(f => f.status === 'published');
  const courseOptions  = publishedForms.filter(f => f.content_type === 'course' || f.config?.isCourse);
  const veOptions      = publishedForms.filter(f => f.content_type === 'virtual_experience' || f.content_type === 'guided_project' || f.config?.isVirtualExperience || f.config?.isGuidedProject);
  const allOptions     = [...courseOptions, ...veOptions, ...certOptions];

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    // Certifications live in their own table (not `forms`); RLS scopes this read to the
    // caller's own certifications (admins see all), matching the course options above.
    const [res, { data: coh }, { data: certs }] = await Promise.all([
      fetch('/api/learning-paths', { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }),
      supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
      supabase.from('certifications').select('id, title').eq('status', 'published').order('title'),
    ]);
    if (res.ok) { const { paths: p } = await res.json(); setPaths(p ?? []); }
    setCohorts(coh ?? []);
    setCertOptions((certs ?? []).map((c: any) => ({ ...c, content_type: 'certification' })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const uploadCover = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploadingCover(true);
    try {
      const url = await uploadToCloudinary(file, 'learning-paths');
      setEditing((p: any) => ({ ...p, cover_image: url }));
    } catch { /* ignore */ }
    setUploadingCover(false);
  };

  const uploadBadge = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploadingBadge(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const ext  = file.name.split('.').pop() ?? 'png';
      const path = `badges/${session?.user.id ?? 'anon'}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      setEditing((p: any) => ({ ...p, badge_image_url: publicUrl }));
    } catch { /* ignore */ }
    setUploadingBadge(false);
  };

  const generateDescription = async () => {
    if (!editing?.title?.trim()) { setSaveMsg({ ok: false, text: 'Add a title first so AI has context.' }); return; }
    setGeneratingDesc(true);
    setSaveMsg(null);
    const { data: { session } } = await supabase.auth.getSession();
    const selectedTitles = (editing.item_ids ?? []).map((id: string) => allOptions.find((f: any) => f.id === id)?.title).filter(Boolean);
    try {
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          action: 'generate_course_description',
          title: editing.title,
          description: editing.description ?? '',
          style: 'professional',
          length: 'medium',
          prompt: selectedTitles.length ? `This learning path includes: ${selectedTitles.join(', ')}` : '',
        }),
      });
      const json = await res.json();
      if (json.description) setEditing((p: any) => ({ ...p, description: json.description }));
      else setSaveMsg({ ok: false, text: 'AI could not generate a description. Try again.' });
    } catch {
      setSaveMsg({ ok: false, text: 'AI generation failed.' });
    }
    setGeneratingDesc(false);
  };

  const save = async (statusOverride?: 'draft' | 'published') => {
    const editingToSave = statusOverride ? { ...editing, status: statusOverride } : editing;
    if (!editingToSave?.title?.trim()) { setSaveMsg({ ok: false, text: 'Title is required.' }); return; }
    setSaving(true);
    setSaveMsg(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
      const action = editingToSave.id ? 'update' : 'create';
      const res = await fetch('/api/learning-paths', { method: 'POST', headers, body: JSON.stringify({ action, ...editingToSave }) });
      const json = await res.json();

      if (!res.ok) {
        setSaveMsg({ ok: false, text: json.error ?? 'Save failed.' });
        return;
      }

      const savedEditing = { ...editingToSave, id: json.id ?? editingToSave.id };
      setEditing(savedEditing);
      editingBaseline.current = JSON.stringify(savedEditing);

      const notification = json.notification;
      const notificationFailed = notification?.error || notification?.failed > 0;
      const notificationText = notification?.failed > 0
        ? ` ${notification.failed} notification email${notification.failed === 1 ? '' : 's'} could not be sent after automatic retries.`
        : notification?.error
          ? ' Notification emails could not be sent.'
          : '';
      setSaveMsg({ ok: true, text: `Saved.${notificationFailed ? notificationText : ''}` });

      await load();
      setTimeout(() => setEditing(null), notificationFailed ? 2500 : 800);
    } catch {
      // New paths carry a stable request_id, so repeating an unconfirmed request is safe.
      setSaveMsg({ ok: false, text: 'Could not confirm the save. You can safely try again.' });
    } finally {
      setSaving(false);
    }
  };

  const deletePath = async (id: string) => {
    setDeleting(id);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/learning-paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ action: 'delete', id }),
    });
    setDeleting(null);
    await load();
  };

  const openEditor = (path: any) => {
    setLpSection('overview');
    setContentSearch('');
    setContentFilter('all');
    setSaveMsg(null);
    editingBaseline.current = JSON.stringify(path);
    setEditing(path);
  };

  const openNewEditor = () => openEditor({
    request_id: crypto.randomUUID(), title: '', description: '', cover_image: '',
    item_ids: [], cohort_ids: [], status: 'draft', next_path_id: null,
  });

  const closeEditor = () => {
    const dirty = editingBaseline.current !== null && JSON.stringify(editing) !== editingBaseline.current;
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    setEditing(null);
    setSaveMsg(null);
  };

  const toggleItem = (id: string) => {
    const current: string[] = editing?.item_ids ?? [];
    setEditing((prev: any) => ({
      ...prev,
      item_ids: current.includes(id) ? current.filter((x: string) => x !== id) : [...current, id],
    }));
  };

  const toggleCohort = (id: string) => {
    const current: string[] = editing?.cohort_ids ?? [];
    setEditing((prev: any) => ({
      ...prev,
      cohort_ids: current.includes(id) ? current.filter((x: string) => x !== id) : [...current, id],
    }));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const ids: string[] = [...(editing?.item_ids ?? [])];
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    setEditing((prev: any) => ({ ...prev, item_ids: ids }));
  };

  const inputCls = `w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors`;
  const inputStyle = { background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>;

  // -- Editor ---
  if (editing !== null) {
    const selectedIds: string[]    = editing.item_ids ?? [];
    const selectedCohorts: string[] = editing.cohort_ids ?? [];
    const matchesContent = (item: any) => {
      const isVE = item.content_type === 'virtual_experience' || item.content_type === 'guided_project' || item.config?.isVirtualExperience || item.config?.isGuidedProject;
      const type = item.content_type === 'certification' ? 'certification' : isVE ? 'virtual_experience' : 'course';
      return (contentFilter === 'all' || contentFilter === type) && (item.title ?? '').toLowerCase().includes(contentSearch.trim().toLowerCase());
    };
    return (
      <div className="space-y-5 pb-24">
        <div className="fixed z-50 bottom-5 left-4 right-4 sm:left-auto sm:right-6 flex items-center justify-end gap-2">
            <button onClick={() => save('draft')} disabled={saving}
              className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
              style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? '0 10px 28px rgba(0,0,0,0.35)' : '0 12px 32px rgba(15,23,42,0.14)' }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
              Save draft
            </button>
            <button onClick={() => save('published')} disabled={saving}
              className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText, boxShadow: isDark ? 'none' : `0 10px 26px ${C.cta}30` }}>
              <Rocket className="w-4 h-4"/> Publish
            </button>
        </div>

        {/* Standalone step navigation and editor workspace. */}
        {(() => {
          const LP_SECTIONS = [
            { id: 'overview', label: 'Overview', Icon: Radar },
            { id: 'content', label: 'Content', Icon: Layers3 },
            { id: 'audience', label: 'Audience', Icon: Users },
            { id: 'publish', label: 'Publish', Icon: Rocket },
          ] as const;
          return (
          <div className="space-y-5">
            <div className="flex items-stretch gap-3 min-w-0">
              <button onClick={closeEditor} aria-label="Back to learning paths"
                className="w-12 flex-shrink-0 rounded-2xl grid place-items-center transition-opacity hover:opacity-70"
                style={{ background: C.card, color: C.muted }}>
                <ArrowLeft className="w-4 h-4"/>
              </button>
            <div className="flex-1 min-w-0 flex gap-1 px-4 py-3 overflow-x-auto rounded-2xl" style={{ ...cardStyle(C) }}>
              {LP_SECTIONS.map(({ id, label, Icon }) => {
                const active = lpSection === id;
                return (
                  <button key={id} onClick={() => setLpSection(id)} aria-current={active ? 'page' : undefined}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
                    style={{ background: active ? `${C.green}12` : 'transparent', color: active ? C.green : C.faint }}>
                    <Icon className="w-4 h-4"/>{label}
                  </button>
                );
              })}
            </div>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
            <AnimatePresence mode="wait">
            <motion.div key={lpSection} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="p-5 sm:p-6">

            {lpSection === 'overview' && (
            <div className="space-y-6">

        {/* Basic info */}
        <div className="space-y-6 max-w-5xl">
          <div>
            <label className="text-xs font-bold mb-2 block" style={{ color: C.muted }}>Path title *</label>
            <input value={editing.title ?? ''} onChange={e => setEditing((p: any) => ({ ...p, title: e.target.value }))} placeholder="e.g. AI Fundamentals Track" className={inputCls} style={inputStyle}/>
          </div>

          {/* Description + AI generate */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold" style={{ color: C.muted }}>Path description</label>
              <button onClick={generateDescription} disabled={generatingDesc}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: `${C.green}18`, color: C.green }}>
                {generatingDesc ? <Loader2 className="w-3 h-3 animate-spin"/> : <Zap className="w-3 h-3"/>}
                {generatingDesc ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <textarea value={editing.description ?? ''} onChange={e => setEditing((p: any) => ({ ...p, description: e.target.value }))} rows={4} placeholder="What will students achieve by completing this path?" className={inputCls} style={inputStyle}/>
          </div>

          {/* Cover image upload */}
          <div className="rounded-2xl p-4 sm:p-5" style={{ background: C.pill }}>
            <div className="mb-4"><label className="text-sm font-bold block" style={{ color: C.text }}>Cover image</label><p className="text-xs mt-1" style={{ color: C.faint }}>Choose a clear visual that represents the full journey.</p></div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ''; }}/>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {editing.cover_image && (
                <img src={editing.cover_image} alt="Learning path cover" className="w-full sm:w-44 aspect-video rounded-xl object-cover flex-shrink-0"/>
              )}
              <button onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted, background: C.pill }}>
                {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                {uploadingCover ? 'Uploading…' : editing.cover_image ? 'Change image' : 'Upload image'}
              </button>
              <button onClick={() => setShowCoverLibrary(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted, background: C.pill }}>
                <Images className="w-4 h-4"/> Browse library
              </button>
              {editing.cover_image && (
                <button onClick={() => setEditing((p: any) => ({ ...p, cover_image: '' }))}
                  className="text-xs px-3 py-2 rounded-xl transition-opacity hover:opacity-70"
                  style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
              )}
            </div>
            {showCoverLibrary && (
              <ImageLibrary
                uploadFolder="covers"
                initialFolder="covers"
                onSelect={url => setEditing((p: any) => ({ ...p, cover_image: url }))}
                onClose={() => setShowCoverLibrary(false)}
              />
            )}
          </div>

          {/* Completion Badge */}
          <div className="rounded-2xl p-4 sm:p-5" style={{ background: C.pill }}>
            <label className="text-sm font-bold mb-1 block" style={{ color: C.text }}>Completion badge</label>
            <p className="text-[11px] mb-2 leading-relaxed" style={{ color: C.faint }}>
              Students earn this badge when they complete all items in the path, alongside their certificate.
            </p>
            <input ref={badgeInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadBadge(f); e.target.value = ''; }}/>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {editing.badge_image_url && (
                <img src={editing.badge_image_url} alt="Completion badge" className="w-16 h-16 rounded-2xl object-contain flex-shrink-0 p-1"
                  style={{ background: C.card }}/>
              )}
              <button onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted, background: C.pill }}>
                {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                {uploadingBadge ? 'Uploading...' : editing.badge_image_url ? 'Change badge' : 'Upload badge'}
              </button>
              {editing.badge_image_url && (
                <button onClick={() => setEditing((p: any) => ({ ...p, badge_image_url: null }))}
                  className="text-xs px-3 py-2 rounded-xl transition-opacity hover:opacity-70"
                  style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="hidden">
            <label className="text-xs font-medium" style={{ color: C.muted }}>Status</label>
            <select value={editing.status ?? 'draft'} onChange={e => setEditing((p: any) => ({ ...p, status: e.target.value }))}
              className="rounded-xl px-3 py-2 text-sm focus:outline-none" style={inputStyle}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>

          {/* Next path (auto-enroll chaining) */}
          <div className="hidden">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>
              Next Learning Path
              <span className="ml-1.5 font-normal" style={{ color: C.faint }}>· students auto-enroll here when they complete this path</span>
            </label>
            <select
              value={editing.next_path_id ?? ''}
              onChange={e => setEditing((p: any) => ({ ...p, next_path_id: e.target.value || null }))}
              className="rounded-xl px-3 py-2 text-sm focus:outline-none w-full"
              style={inputStyle}
            >
              <option value="">None</option>
              {paths.filter((p: any) => p.id !== editing.id).map((p: any) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Cohort assignment */}
        <div className="hidden">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Assign to Cohorts</h3>
          {cohorts.length === 0
            ? <p className="text-sm" style={{ color: C.muted }}>No cohorts found. Create a cohort first.</p>
            : <div className="space-y-1.5">
                {cohorts.map((c: any) => {
                  const selected = selectedCohorts.includes(c.id);
                  return (
                    <div key={c.id} onClick={() => toggleCohort(c.id)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                      style={{ background: selected ? `${C.green}14` : C.pill }}>
                      <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2" style={{ background: selected ? C.green : 'transparent', borderColor: selected ? C.green : C.faint }}>
                        {selected && <Check className="w-2.5 h-2.5 text-white"/>}
                      </div>
                      <span className="text-sm" style={{ color: C.text }}>{c.name}</span>
                    </div>
                  );
                })}
              </div>
          }
          {selectedCohorts.length > 0 && (
            <p className="text-xs" style={{ color: C.faint }}>{selectedCohorts.length} cohort{selectedCohorts.length !== 1 ? 's' : ''} assigned</p>
          )}
        </div>
            </div>
            )}

            {lpSection === 'audience' && (
              <div className="max-w-4xl space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-sm font-bold" style={{ color: C.text }}>Assigned cohorts</p><p className="text-xs mt-1" style={{ color: C.faint }}>Learners in these cohorts receive the path when it is published.</p></div>
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: `${C.green}12`, color: C.green }}>{selectedCohorts.length} selected</span>
                </div>
                {cohorts.length === 0 ? <div className="rounded-2xl py-16 text-center" style={{ background: C.pill }}><Users className="w-7 h-7 mx-auto mb-3" style={{ color: C.faint }}/><p className="text-sm font-semibold" style={{ color: C.text }}>No cohorts found</p><p className="text-xs mt-1" style={{ color: C.faint }}>Create a cohort before assigning this path.</p></div> : <div className="grid sm:grid-cols-2 gap-3">{cohorts.map((cohort: any) => { const selected = selectedCohorts.includes(cohort.id); return <button key={cohort.id} onClick={() => toggleCohort(cohort.id)} className="p-4 rounded-2xl flex items-center gap-3 text-left transition-all" style={{ background: selected ? `${C.green}10` : C.pill, boxShadow: selected ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}><span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: selected ? `${C.green}18` : C.card }}><Users className="w-4 h-4" style={{ color: selected ? C.green : C.faint }}/></span><span className="text-sm font-semibold flex-1" style={{ color: C.text }}>{cohort.name}</span><span className="w-5 h-5 rounded-full grid place-items-center" style={{ background: selected ? C.green : 'transparent', border: `1.5px solid ${selected ? C.green : C.cardBorder}` }}>{selected && <Check className="w-3 h-3 text-white"/>}</span></button>; })}</div>}
              </div>
            )}

            {lpSection === 'publish' && (
              <div className="grid lg:grid-cols-[1fr_340px] gap-7 max-w-5xl">
                <div className="space-y-6">
                  <div><label className="text-xs font-bold block mb-2" style={{ color: C.muted }}>Publishing status</label><div className="grid sm:grid-cols-2 gap-3">{(['draft','published'] as const).map(status => { const active = editing.status === status; return <button key={status} onClick={() => setEditing((p: any) => ({ ...p, status }))} className="p-4 rounded-2xl flex items-center gap-3 text-left" style={{ background: active ? `${C.green}10` : C.pill, boxShadow: active ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}><span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: active ? `${C.green}18` : C.card }}>{status === 'published' ? <Rocket className="w-4 h-4" style={{ color: active ? C.green : C.faint }}/> : <Settings2 className="w-4 h-4" style={{ color: active ? C.green : C.faint }}/>}</span><span><span className="block text-sm font-bold capitalize" style={{ color: C.text }}>{status}</span><span className="block text-[11px] mt-0.5" style={{ color: C.faint }}>{status === 'published' ? 'Visible to assigned learners' : 'Private working version'}</span></span></button>; })}</div></div>
                  <div><label className="text-xs font-bold mb-2 block" style={{ color: C.muted }}>Continue into another path</label><p className="text-xs mb-3" style={{ color: C.faint }}>Automatically enrol learners after they complete this journey.</p><select value={editing.next_path_id ?? ''} onChange={e => setEditing((p: any) => ({ ...p, next_path_id: e.target.value || null }))} className={inputCls} style={inputStyle}><option value="">No next path</option>{paths.filter((path: any) => path.id !== editing.id).map((path: any) => <option key={path.id} value={path.id}>{path.title}</option>)}</select></div>
                </div>
                <aside className="rounded-2xl p-5" style={{ background: C.pill }}>
                  <div className="flex items-center justify-between"><div><p className="text-sm font-bold" style={{ color: C.text }}>Path readiness</p><p className="text-xs mt-1" style={{ color: C.faint }}>Essentials for a strong launch.</p></div><span className="text-sm font-bold" style={{ color: C.green }}>{[editing.title?.trim(), editing.description?.trim(), editing.cover_image, selectedIds.length, selectedCohorts.length].filter(Boolean).length}/5</span></div>
                  <div className="space-y-2 mt-5">{[
                    ['Path title', !!editing.title?.trim(), 'overview'], ['Description', !!editing.description?.trim(), 'overview'], ['Cover image', !!editing.cover_image, 'overview'], ['Learning sequence', selectedIds.length > 0, 'content'], ['Audience', selectedCohorts.length > 0, 'audience'],
                  ].map(([label, ready, target]) => <button key={String(label)} onClick={() => setLpSection(target as typeof lpSection)} className="w-full flex items-center gap-2 text-left text-xs py-1.5" style={{ color: ready ? C.muted : C.text }}>{ready ? <CheckCircle2 className="w-4 h-4" style={{ color: C.green }}/> : <Circle className="w-4 h-4" style={{ color: C.faint }}/>}<span className="flex-1">{label}</span>{!ready && <ChevronRight className="w-3.5 h-3.5"/>}</button>)}</div>
                  <div className="mt-5 pt-4 space-y-2 text-xs" style={{ borderTop: `1px solid ${C.divider}`, color: C.faint }}><p>{selectedIds.length} content{selectedIds.length === 1 ? '' : 's'}</p><p>{selectedCohorts.length} assigned cohorts</p><p>{editing.badge_image_url ? 'Custom completion badge' : 'Default completion credential'}</p></div>
                </aside>
              </div>
            )}

            {lpSection === 'content' && (
            <div className="space-y-6">

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faint }}/><input value={contentSearch} onChange={e => setContentSearch(e.target.value)} placeholder="Search published content..." className={`${inputCls} pl-10`} style={inputStyle}/></div>
          <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: C.pill }}>{(['all','course','virtual_experience','certification'] as const).map(filter => <button key={filter} onClick={() => setContentFilter(filter)} className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap" style={{ background: contentFilter === filter ? C.card : 'transparent', color: contentFilter === filter ? C.green : C.faint }}>{filter === 'all' ? 'All' : filter === 'virtual_experience' ? 'Experiences' : filter === 'certification' ? 'Certifications' : 'Courses'}</button>)}</div>
        </div>

        {/* Item selection -- grouped by type */}
        {allOptions.length === 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>No published courses, virtual experiences, or certifications found.</p>
        ) : (
          <div className="space-y-5">
            {([
              { label: 'Courses', items: courseOptions },
              { label: 'Virtual Experiences', items: veOptions },
              { label: 'Certifications', items: certOptions },
            ] as const).map(group => ({ ...group, items: group.items.filter(matchesContent) })).filter(g => g.items.length > 0).map(group => (
              <div key={group.label} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>{group.label}</h3>
                {group.items.map((f: any) => {
                  const selected = selectedIds.includes(f.id);
                  return (
                    <div key={f.id} onClick={() => toggleItem(f.id)} role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleItem(f.id); } }}
                      className="flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all"
                      style={{ background: selected ? `${C.green}10` : C.pill, boxShadow: selected ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}>
                      <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: selected ? C.green : 'transparent', border: `1.5px solid ${selected ? C.green : C.cardBorder}` }}>
                        {selected && <Check className="w-2.5 h-2.5 text-white"/>}
                      </div>
                      <span className="text-sm flex-1 truncate" style={{ color: C.text }}>{f.title}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Order selected items */}
        {selectedIds.length > 0 && (
          <div className="space-y-3 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            <div><h3 className="text-sm font-bold" style={{ color: C.text }}>Path sequence</h3><p className="text-xs mt-1" style={{ color: C.faint }}>{selectedIds.length} ordered content{selectedIds.length === 1 ? '' : 's'}</p></div>
            <div className="space-y-1.5">
              {selectedIds.map((id, idx) => {
                const f = allOptions.find((x: any) => x.id === id);
                const isVE = f && (f.content_type === 'virtual_experience' || f.content_type === 'guided_project' || f.config?.isVirtualExperience || f.config?.isGuidedProject);
                const isCert = f?.content_type === 'certification';
                return (
                  <div key={id} className="flex items-center gap-2 px-3 py-3 rounded-2xl" style={{ background: C.pill }}>
                    <span className="text-xs font-bold w-8 h-8 rounded-full grid place-items-center flex-shrink-0" style={{ color: C.green, background: `${C.green}16` }}>{idx + 1}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: C.card, color: C.muted }}>
                      {isCert ? 'Cert' : isVE ? 'VE' : 'Course'}
                    </span>
                    <span className="text-sm flex-1 truncate" style={{ color: C.text }}>{f?.title ?? id}</span>
                    <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} aria-label="Move up" className="p-1 rounded opacity-50 hover:opacity-100 disabled:opacity-20"><ArrowUp className="w-3.5 h-3.5" style={{ color: C.muted }}/></button>
                    <button onClick={() => moveItem(idx, 1)} disabled={idx === selectedIds.length - 1} aria-label="Move down" className="p-1 rounded opacity-50 hover:opacity-100 disabled:opacity-20"><ArrowDown className="w-3.5 h-3.5" style={{ color: C.muted }}/></button>
                    <button onClick={() => toggleItem(id)} className="p-1 rounded opacity-50 hover:opacity-100"><X className="w-3 h-3" style={{ color: C.muted }}/></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

            </div>
            )}

            </motion.div>
            </AnimatePresence>
            </div>
          </div>
          );
        })()}

        {saveMsg && (
          <p role="status" className="mx-5 sm:mx-7 mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: saveMsg.ok ? `${C.green}10` : '#ef444412', color: saveMsg.ok ? C.green : '#ef4444' }}>{saveMsg.text}</p>
        )}
      </div>
    );
  }

  // -- List ---
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.text }}>Learning Paths</h1>
          <p className="text-sm mt-0.5" style={{ color: C.faint }}>Build structured journeys across courses, experiences, and certifications.</p>
        </div>
        <button onClick={openNewEditor}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4"/> New Learning Path
        </button>
      </div>

      {paths.length === 0 ? (
        <div className="text-center py-24 rounded-3xl" style={{ ...cardStyle(C) }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: `${C.green}18` }}>
            <BookOpen className="w-6 h-6" style={{ color: C.green }}/>
          </div>
          <p className="font-semibold text-base mb-1" style={{ color: C.text }}>No learning paths yet</p>
          <p className="text-sm mb-6" style={{ color: C.faint }}>Create your first learning path to group courses into a structured journey.</p>
          <button onClick={openNewEditor}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold"
            style={{ background: C.cta, color: C.ctaText }}>
            <Plus className="w-4 h-4"/> New Learning Path
          </button>
        </div>
      ) : (
        <section className="rounded-2xl p-4 sm:p-5" style={{ ...cardStyle(C) }}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold" style={{ color: C.text }}>Your learning paths</h3>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>Browse and manage each structured journey.</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => scrollPathCarousel(-1)} aria-label="Previous learning paths"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronLeft className="w-4 h-4"/>
              </button>
              <button onClick={() => scrollPathCarousel(1)} aria-label="Next learning paths"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          </div>
          <div ref={pathCarouselRef} className="flex gap-5 overflow-x-auto snap-x snap-mandatory pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {paths.map((path: any) => {
            const assignedCohortNames = (path.cohort_ids ?? []).map((id: string) => cohorts.find((c: any) => c.id === id)?.name).filter(Boolean);
            // Active learners in the cohorts this path is assigned to (counted by the API).
            const learnerCount: number = path.learner_count ?? 0;
            return (
              <article key={path.id} className="group flex-none w-[280px] sm:w-[330px] snap-start rounded-2xl overflow-hidden transition-transform hover:-translate-y-0.5" style={{ ...cardStyle(C) }}>
                {path.cover_image
                  ? <img src={path.cover_image} alt="" loading="lazy" className="w-full aspect-[16/8] object-cover transition-transform duration-500 group-hover:scale-[1.02]"/>
                  : <div className="w-full aspect-[16/8] flex items-center justify-center" style={{ background: `${C.green}0d` }}>
                      <Layers3 className="w-8 h-8 opacity-40" style={{ color: C.green }}/>
                    </div>}
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: path.status === 'published' ? `${C.green}18` : `${C.faint}18`, color: path.status === 'published' ? C.green : C.faint }}>
                      {path.status}
                    </span>
                    <span className="text-[11px] flex items-center gap-1" style={{ color: C.faint }}><Layers3 className="w-3 h-3"/>{(path.item_ids ?? []).length} content{(path.item_ids ?? []).length === 1 ? '' : 's'}</span>
                    <span className="text-[11px] flex items-center gap-1" style={{ color: C.faint }}><GraduationCap className="w-3 h-3"/>{learnerCount} {learnerCount === 1 ? 'learner' : 'learners'}</span>
                  </div>
                  <p className="font-bold text-base" style={{ color: C.text }}>{path.title}</p>
                  {path.description && <p className="text-sm line-clamp-2 leading-relaxed" style={{ color: C.muted }}>{path.description}</p>}
                  {assignedCohortNames.length > 0 && (
                    <p className="text-[11px] flex items-center gap-1.5" style={{ color: C.faint }}><Users className="w-3 h-3"/>{assignedCohortNames.slice(0, 2).join(', ')}{assignedCohortNames.length > 2 ? ` +${assignedCohortNames.length - 2}` : ''}</p>
                  )}
                  <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${C.divider}` }}>
                    <button onClick={() => openEditor(path)}
                      className="flex-1 text-center text-xs font-bold py-2.5 rounded-xl transition-all hover:opacity-80"
                      style={{ background: `${C.green}18`, color: C.green }}>
                      Edit
                    </button>
                    <button onClick={() => { if (window.confirm(`Delete "${path.title}"? This cannot be undone.`)) deletePath(path.id); }} disabled={deleting === path.id}
                      aria-label={`Delete ${path.title}`} title="Delete learning path" className="w-10 rounded-xl grid place-items-center transition-all hover:opacity-80 disabled:opacity-50"
                      style={{ background: '#ef444418', color: '#ef4444' }}>
                      {deleting === path.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4"/>}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          </div>
        </section>
      )}
    </div>
  );
}
