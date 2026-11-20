'use client';

// Learning-path management workspace shared by the instructor dashboard.

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, BarChart3, Check, CheckCircle2, ChevronRight, Circle, Images, Layers3, Loader2, Plus, Radar, Rocket, Search, Settings2, Trash2, Upload, Users, X, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToolIcons, useToolIconMap } from '@/lib/use-tool-icons';
import { RichTextEditor } from '@/components/RichTextEditor';
import { toPlainText } from '@/lib/plain-text';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { DARK_C, LIGHT_C, cardStyle } from '@/lib/theme';
import { LearningPathReport } from '@/components/dashboard/LearningPathReport';
import type { PathTrack } from '@/lib/learning-path-tracks';
import { PATH_CARD_COLORS, isPathCardColor, type PathCardColor } from '@/lib/path-card-colors';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, Kpis, PageHeader, StatusChips, contentKpis, matchesFilters, useReach, type Status } from '@/components/dashboard/content/kit';
import { Card, btnClass, btnStyle, plural } from '@/components/dashboard/subscriptions/ui';

// A request that never reached the server is worth distinguishing from one the server
// refused: the first is usually the connection and retrying often works.
const LOAD_ERROR_NETWORK = "Couldn't load learning paths. Check your connection and try again.";
const LOAD_ERROR_SERVER  = "Couldn't load learning paths right now. Try again.";

export function LearningPathsSection({ C, forms }: { C: typeof LIGHT_C; forms: any[] }) {
  const isDark = C.page === DARK_C.page;
  const [paths, setPaths]           = useState<any[]>([]);
  const [cohorts, setCohorts]       = useState<any[]>([]);
  const [certOptions, setCertOptions] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState('');
  const [editing, setEditing]       = useState<any | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [uploadingBadge, setUploadingBadge] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [lpSection, setLpSection] = useState<'overview' | 'content' | 'audience' | 'publish'>('overview');
  // Set while the progress report for a saved path is open. Checked before the editor, so closing
  // the report returns to whichever view (list or editor) opened it.
  const [reportPathId, setReportPathId] = useState<string | null>(null);
  const [contentSearch, setContentSearch] = useState('');
  const [contentFilter, setContentFilter] = useState<'all' | 'course' | 'virtual_experience' | 'certification'>('all');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const badgeInputRef = useRef<HTMLInputElement>(null);
  const editingBaseline = useRef<string | null>(null);
  // The list: filters, the path asked to be deleted, and how each path reaches learners.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const reach = useReach('learning_paths');
  // As on the other admin pages: the dark-mode blue for buttons and selection controls on the list.
  const LC = useMemo(() => ({ ...C, cta: DARK_C.cta }), [C]);

  const publishedForms = forms.filter(f => f.status === 'published');
  const courseOptions  = publishedForms.filter(f => f.content_type === 'course' || f.config?.isCourse);
  const veOptions      = publishedForms.filter(f => f.content_type === 'virtual_experience' || f.content_type === 'guided_project' || f.config?.isVirtualExperience || f.config?.isGuidedProject);
  const allOptions     = [...courseOptions, ...veOptions, ...certOptions];

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Certifications live in their own table (not `forms`); RLS scopes this read to the
      // caller's own certifications (admins see all), matching the course options above.
      const [res, { data: coh }, { data: certs }] = await Promise.all([
        fetch('/api/learning-paths', { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }),
        supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
        supabase.from('certifications').select('id, title').eq('status', 'published').order('title'),
      ]);
      if (!res.ok) { setLoadError(LOAD_ERROR_SERVER); return; }
      const { paths: p } = await res.json();
      setPaths(p ?? []);
      setCohorts(coh ?? []);
      setCertOptions((certs ?? []).map((c: any) => ({ ...c, content_type: 'certification' })));
    } catch {
      // The request never reached the server, so the list below would be misleading rather
      // than empty. Say so and offer the retry instead of rendering "no learning paths".
      setLoadError(LOAD_ERROR_NETWORK);
    } finally {
      setLoading(false);
    }
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

  const toolIcon = useToolIcons();
  const toolIconMap = useToolIconMap();
  // Skills, audience bullets and tools are all "a list of short strings" in the editor. One
  // setter rather than three near-identical ones.
  //
  // Kept exactly as typed. Trimming and dropping blanks here looked tidy and made the field
  // unusable: pressing Enter creates an empty last line, filtering removed it, and the newline
  // vanished as fast as it was typed -- so the box could never hold more than one line, and a
  // space could never be typed mid-word. The cleaning happens once, on save.
  const setList = (field: 'skills' | 'who_should_take' | 'tools', values: string[]) =>
    setEditing((p: any) => ({ ...p, [field]: values }));

  /** Blank rows never reach the page as an empty pill or an empty bullet. */
  const cleanList = (values: unknown): string[] =>
    Array.isArray(values) ? values.map(v => String(v ?? '').trim()).filter(Boolean) : [];

  const save = async (statusOverride?: 'draft' | 'published') => {
    const editingToSave = {
      ...editing,
      ...(statusOverride ? { status: statusOverride } : {}),
      skills: cleanList(editing?.skills),
      who_should_take: cleanList(editing?.who_should_take),
      tools: cleanList(editing?.tools),
    };
    if (!editingToSave?.title?.trim()) { setSaveMsg({ ok: false, text: 'Title is required.' }); return; }
    // An unnamed track is dropped on save, which would quietly make its items core for everyone.
    if ((Array.isArray(editingToSave.tracks) ? editingToSave.tracks : []).some((t: any) => !String(t?.name ?? '').trim())) {
      setLpSection('content');
      setSaveMsg({ ok: false, text: 'Every track needs a name. Name it or remove it before saving.' });
      return;
    }
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
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/learning-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ action: 'delete', id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDeleteError(json.error ?? 'Could not delete that learning path.');
        return;
      }
    } catch {
      // Deleting the same path twice is harmless, so an unconfirmed request is safe to repeat.
      setDeleteError('Could not confirm the delete. You can safely try again.');
      return;
    } finally {
      setDeleting(null);
    }
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
    item_ids: [], cohort_ids: [], available_to_everyone: false, status: 'draft', next_path_id: null,
    overview: '', skills: [], who_should_take: [], tools: [], tracks: [], tracks_optional: false,
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

  // Tracks: one path personalised by background. An item in no track is core (everyone).
  const setTracks = (fn: (tracks: PathTrack[]) => PathTrack[]) =>
    setEditing((prev: any) => ({ ...prev, tracks: fn(Array.isArray(prev?.tracks) ? prev.tracks : []) }));

  const addTrack = () => setTracks(tracks => [...tracks, { id: crypto.randomUUID(), name: '', description: '', item_ids: [] }]);

  const updateTrack = (trackId: string, patch: Partial<PathTrack>) =>
    setTracks(tracks => tracks.map(t => (t.id === trackId ? { ...t, ...patch } : t)));

  const removeTrack = (trackId: string) => {
    if (!window.confirm('Remove this track? Its items become core, so everyone takes them.')) return;
    setTracks(tracks => tracks.filter(t => t.id !== trackId));
  };

  const toggleItemTrack = (itemId: string, trackId: string) =>
    setTracks(tracks => tracks.map(t => t.id !== trackId ? t : {
      ...t,
      item_ids: t.item_ids.includes(itemId) ? t.item_ids.filter(i => i !== itemId) : [...t.item_ids, itemId],
    }));

  const moveItem = (idx: number, dir: -1 | 1) => {
    const ids: string[] = [...(editing?.item_ids ?? [])];
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    setEditing((prev: any) => ({ ...prev, item_ids: ids }));
  };

  const inputCls = `w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors`;
  const inputStyle = { background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertCircle className="w-8 h-8 mb-3" style={{ color: '#dc2626' }}/>
      <p className="text-sm" style={{ color: C.muted }}>{loadError}</p>
      <button onClick={load} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Retry</button>
    </div>
  );

  // -- Report ---
  if (reportPathId) {
    return <LearningPathReport C={C} pathId={reportPathId} onBack={() => setReportPathId(null)}/>;
  }

  // -- Editor ---
  if (editing !== null) {
    const selectedIds: string[]    = editing.item_ids ?? [];
    const tracks: PathTrack[]      = Array.isArray(editing.tracks) ? editing.tracks : [];
    const selectedCohorts: string[] = editing.cohort_ids ?? [];
    const openToEveryone: boolean = editing.available_to_everyone === true;
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
                    className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
                    style={{ background: active ? `${C.green}12` : 'transparent', color: active ? C.green : C.faint }}>
                    <Icon className="w-4 h-4"/>{label}
                  </button>
                );
              })}
              {editing.id && (
                <button onClick={() => setReportPathId(editing.id)}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
                  style={{ background: 'transparent', color: C.faint }}>
                  <BarChart3 className="w-4 h-4"/>Report
                </button>
              )}
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
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold" style={{ color: C.muted }}>Path description</label>
              <button onClick={generateDescription} disabled={generatingDesc}
                className="flex items-center gap-2 text-[11px] font-semibold px-3 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: `${C.green}18`, color: C.green }}>
                {generatingDesc ? <Loader2 className="w-3 h-3 animate-spin"/> : <Zap className="w-3 h-3"/>}
                {generatingDesc ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <RichTextEditor
              value={editing.description ?? ''}
              onChange={html => setEditing((p: any) => ({ ...p, description: html }))}
              placeholder="What will students achieve by completing this path?"
            />
          </div>

          {/* Overview: the long form, shown full width on the public page above everything else. */}
          <div>
            <label className="text-xs font-bold block mb-2" style={{ color: C.muted }}>Overview</label>
            <RichTextEditor
              value={editing.overview ?? ''}
              onChange={html => setEditing((p: any) => ({ ...p, overview: html }))}
              placeholder="The fuller picture: what this path covers, how it is structured, and what a learner walks away able to do."
            />
          </div>

          {/* Skills and audience: one per line, because that is how they are read back out --
              as pills and as bullets. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-bold block mb-2" style={{ color: C.muted }}>Skills you will learn</label>
              <textarea
                value={(editing.skills ?? []).join('\n')}
                onChange={e => setList('skills', e.target.value.split('\n'))}
                rows={6}
                placeholder={'One skill per line\nPrompt engineering\nData storytelling'}
                className={inputCls} style={inputStyle}/>
              <p className="text-[11px] mt-2" style={{ color: C.faint }}>Shown as pills. One per line.</p>
            </div>
            <div>
              <label className="text-xs font-bold block mb-2" style={{ color: C.muted }}>Who should take this path</label>
              <textarea
                value={(editing.who_should_take ?? []).join('\n')}
                onChange={e => setList('who_should_take', e.target.value.split('\n'))}
                rows={6}
                placeholder={'One audience per line\nAnalysts moving into AI work\nManagers briefing technical teams'}
                className={inputCls} style={inputStyle}/>
              <p className="text-[11px] mt-2" style={{ color: C.faint }}>Shown as bullets. One per line.</p>
            </div>
          </div>

          {/* Tools: picked from the platform's icon registry rather than typed, so every tool
              named here has a logo to render with. */}
          <div>
            <label className="text-xs font-bold block mb-2" style={{ color: C.muted }}>Tools</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(toolIconMap).sort((a, b) => a.localeCompare(b)).map(name => {
                const picked = (editing.tools ?? []).includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setList('tools', picked
                      ? (editing.tools ?? []).filter((t: string) => t !== name)
                      : [...(editing.tools ?? []), name])}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{
                      background: picked ? `${C.green}18` : C.pill,
                      color: picked ? C.green : C.muted,
                      border: `1px solid ${picked ? C.green : 'transparent'}`,
                    }}>
                    {toolIcon(name) && <img src={toolIcon(name) as string} alt="" className="h-4 w-4 object-contain"/>}
                    {name}
                  </button>
                );
              })}
            </div>
            {(editing.tools ?? []).length === 0 && (
              <p className="text-[11px] mt-2" style={{ color: C.faint }}>None selected. The tools section is hidden until you pick at least one.</p>
            )}
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

          {/* Card colour on the landing page */}
          <div className="rounded-2xl p-4 sm:p-5" style={{ background: C.pill }}>
            <div className="mb-4"><label className="text-sm font-bold block" style={{ color: C.text }}>Card colour</label><p className="text-xs mt-1" style={{ color: C.faint }}>The colour of this path on the home page. Automatic picks one by its place in the row.</p></div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Card colour">
              {([['', 'Automatic'], ...Object.entries(PATH_CARD_COLORS).map(([key, c]) => [key, c.label])] as [PathCardColor | '', string][]).map(([key, label]) => {
                const chosen = (isPathCardColor(editing.card_color) ? editing.card_color : '') === key;
                const swatch = key ? PATH_CARD_COLORS[key] : null;
                return (
                  <button key={key || 'auto'} type="button" role="radio" aria-checked={chosen}
                    onClick={() => setEditing((p: any) => ({ ...p, card_color: key || null }))}
                    className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl text-sm font-medium transition-shadow"
                    style={{ background: C.card, color: C.text, boxShadow: chosen ? `inset 0 0 0 2px ${LC.cta}` : `inset 0 0 0 1px ${C.cardBorder}` }}>
                    <span className="w-5 h-5 rounded-full flex-shrink-0 grid place-items-center"
                      style={swatch ? { background: swatch.tint, boxShadow: `inset 0 0 0 5px ${swatch.tint}, inset 0 0 0 10px ${swatch.deep}` } : { background: C.pill, boxShadow: `inset 0 0 0 1px ${C.cardBorder}` }} />
                    {label}
                  </button>
                );
              })}
            </div>
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
            <label className="text-xs font-medium mb-2 block" style={{ color: C.muted }}>
              Next Learning Path
              <span className="ml-2 font-normal" style={{ color: C.faint }}>| students auto-enroll here when they complete this path</span>
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
            : <div className="space-y-2">
                {cohorts.map((c: any) => {
                  const selected = selectedCohorts.includes(c.id);
                  return (
                    <div key={c.id} onClick={() => toggleCohort(c.id)}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors"
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
                  <span className="text-xs font-bold px-3 py-2 rounded-full" style={{ background: `${C.green}12`, color: C.green }}>{selectedCohorts.length} selected</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={openToEveryone}
                  onClick={() => setEditing((prev: any) => ({ ...prev, available_to_everyone: !prev.available_to_everyone, cohort_ids: !prev.available_to_everyone ? [] : (prev.cohort_ids ?? []) }))}
                  className="w-full flex items-start justify-between gap-4 p-4 rounded-2xl text-left transition-all mb-3"
                  style={{ background: openToEveryone ? `${C.green}10` : C.pill, boxShadow: openToEveryone ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}
                >
                  <span className="space-y-1">
                    <span className="block text-sm font-bold" style={{ color: C.text }}>Available to everyone</span>
                    <span className="block text-xs leading-relaxed" style={{ color: C.faint }}>
                      Anyone with an account can open this path and the content inside it, including learners
                      with no cohort. Cohort assignment is replaced while this is on.
                    </span>
                  </span>
                  <span className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
                    style={{ background: openToEveryone ? C.green : C.card }}>
                    <span className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
                      style={{ left: openToEveryone ? 23 : 3, background: '#ffffff' }} />
                  </span>
                </button>
                <div className="mb-4 pb-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
                  <PlanAccessPicker
                    contentTable="learning_paths"
                    contentId={editing.id}
                    availableToEveryone={editing.available_to_everyone}
                    onPublicAccessClosed={() =>
                      setEditing((prev: any) => ({ ...prev, available_to_everyone: false }))
                    }
                  />
                </div>
                <div style={openToEveryone ? { opacity: 0.45, pointerEvents: 'none' } : undefined} aria-hidden={openToEveryone}>
                {cohorts.length === 0 ? <div className="rounded-2xl py-16 text-center" style={{ background: C.pill }}><Users className="w-7 h-7 mx-auto mb-3" style={{ color: C.faint }}/><p className="text-sm font-semibold" style={{ color: C.text }}>No cohorts found</p><p className="text-xs mt-1" style={{ color: C.faint }}>Create a cohort before assigning this path.</p></div> : <div className="grid sm:grid-cols-2 gap-3">{cohorts.map((cohort: any) => { const selected = selectedCohorts.includes(cohort.id); return <button key={cohort.id} onClick={() => toggleCohort(cohort.id)} className="p-4 rounded-2xl flex items-center gap-3 text-left transition-all" style={{ background: selected ? `${C.green}10` : C.pill, boxShadow: selected ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}><span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: selected ? `${C.green}18` : C.card }}><Users className="w-4 h-4" style={{ color: selected ? C.green : C.faint }}/></span><span className="text-sm font-semibold flex-1" style={{ color: C.text }}>{cohort.name}</span><span className="w-5 h-5 rounded-full grid place-items-center" style={{ background: selected ? C.green : 'transparent', border: `1.5px solid ${selected ? C.green : C.cardBorder}` }}>{selected && <Check className="w-3 h-3 text-white"/>}</span></button>; })}</div>}
                </div>
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
                    ['Path title', !!editing.title?.trim(), 'overview'], ['Description', !!editing.description?.trim(), 'overview'], ['Cover image', !!editing.cover_image, 'overview'], ['Learning sequence', selectedIds.length > 0, 'content'], ['Audience', openToEveryone || selectedCohorts.length > 0, 'audience'],
                  ].map(([label, ready, target]) => <button key={String(label)} onClick={() => setLpSection(target as typeof lpSection)} className="w-full flex items-center gap-2 text-left text-xs py-2" style={{ color: ready ? C.muted : C.text }}>{ready ? <CheckCircle2 className="w-4 h-4" style={{ color: C.green }}/> : <Circle className="w-4 h-4" style={{ color: C.faint }}/>}<span className="flex-1">{label}</span>{!ready && <ChevronRight className="w-3.5 h-3.5"/>}</button>)}</div>
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
              <div key={group.label} className="space-y-2">
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

        {/* Tracks: personalise one path by background instead of building a path per specialisation */}
        <div className="space-y-3 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold" style={{ color: C.text }}>Tracks</h3>
              <p className="text-xs mt-1 max-w-xl" style={{ color: C.faint }}>
                Optional. Add a track for each background (for example Finance or HR), then tag items in the sequence below.
                Untagged items are core and everyone takes them. Learners pick their track when they open the path.
              </p>
            </div>
            <button onClick={addTrack} className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: C.pill, color: C.text }}>
              <Plus className="w-3.5 h-3.5"/> Add track
            </button>
          </div>
          {tracks.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {tracks.map(track => (
                <div key={track.id} className="rounded-2xl p-4 space-y-2" style={{ background: C.pill }}>
                  <div className="flex items-center gap-2">
                    <input value={track.name} onChange={e => updateTrack(track.id, { name: e.target.value })} placeholder="Track name, for example Finance"
                      aria-label="Track name" className={inputCls} style={inputStyle}/>
                    <button onClick={() => removeTrack(track.id)} aria-label="Remove track" className="p-2 rounded-lg opacity-60 hover:opacity-100">
                      <Trash2 className="w-4 h-4" style={{ color: C.muted }}/>
                    </button>
                  </div>
                  <input value={track.description ?? ''} onChange={e => updateTrack(track.id, { description: e.target.value })} placeholder="Who it is for (shown to learners)"
                    aria-label="Track description" className={inputCls} style={inputStyle}/>
                  <p className="text-[11px]" style={{ color: track.name.trim() ? C.faint : '#ef4444' }}>
                    {track.name.trim()
                      ? `${track.item_ids.filter(i => selectedIds.includes(i)).length} track item${track.item_ids.filter(i => selectedIds.includes(i)).length === 1 ? '' : 's'}`
                      : 'A track needs a name, or it is not saved.'}
                  </p>
                </div>
              ))}
            </div>
          )}
          {tracks.length > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={editing.tracks_optional === true}
              onClick={() => setEditing((prev: any) => ({ ...prev, tracks_optional: !(prev.tracks_optional === true) }))}
              className="w-full flex items-start justify-between gap-4 p-4 rounded-2xl text-left transition-all"
              style={{ background: editing.tracks_optional ? `${C.green}10` : C.pill, boxShadow: editing.tracks_optional ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}
            >
              <span className="space-y-1">
                <span className="block text-sm font-bold" style={{ color: C.text }}>Specializing is optional</span>
                <span className="block text-xs leading-relaxed" style={{ color: C.faint }}>
                  Learners can also choose no specialization and complete the path, and get its certificate, with the core
                  items only. Turning this off later keeps the learners who already chose it.
                </span>
                {editing.tracks_optional === true && !selectedIds.some(id => !tracks.some(t => t.item_ids.includes(id))) && (
                  <span className="block text-xs font-semibold" style={{ color: '#ef4444' }}>
                    Every item is in a track, so there is no core to complete. Leave at least one item untagged.
                  </span>
                )}
              </span>
              <span className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
                style={{ background: editing.tracks_optional ? C.green : C.card }}>
                <span className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
                  style={{ left: editing.tracks_optional ? 23 : 3, background: '#ffffff' }} />
              </span>
            </button>
          )}
        </div>

        {/* Order selected items */}
        {selectedIds.length > 0 && (
          <div className="space-y-3 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            <div><h3 className="text-sm font-bold" style={{ color: C.text }}>Path sequence</h3><p className="text-xs mt-1" style={{ color: C.faint }}>{selectedIds.length} ordered content{selectedIds.length === 1 ? '' : 's'}{tracks.length > 0 ? '. Tag an item with a track to make it track-only. Learners take the core items first, then their track.' : ''}</p></div>
            <div className="space-y-2">
              {selectedIds.map((id, idx) => {
                const f = allOptions.find((x: any) => x.id === id);
                const isVE = f && (f.content_type === 'virtual_experience' || f.content_type === 'guided_project' || f.config?.isVirtualExperience || f.config?.isGuidedProject);
                const isCert = f?.content_type === 'certification';
                const itemTracks = tracks.filter(t => t.item_ids.includes(id));
                return (
                  <div key={id} className="px-3 py-3 rounded-2xl" style={{ background: C.pill }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold w-8 h-8 rounded-full grid place-items-center flex-shrink-0" style={{ color: C.green, background: `${C.green}16` }}>{idx + 1}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: C.card, color: C.muted }}>
                      {isCert ? 'Cert' : isVE ? 'VE' : 'Course'}
                    </span>
                    <span className="text-sm flex-1 truncate" style={{ color: C.text }}>{f?.title ?? id}</span>
                    <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} aria-label="Move up" className="p-1 rounded opacity-50 hover:opacity-100 disabled:opacity-20"><ArrowUp className="w-3.5 h-3.5" style={{ color: C.muted }}/></button>
                    <button onClick={() => moveItem(idx, 1)} disabled={idx === selectedIds.length - 1} aria-label="Move down" className="p-1 rounded opacity-50 hover:opacity-100 disabled:opacity-20"><ArrowDown className="w-3.5 h-3.5" style={{ color: C.muted }}/></button>
                    <button onClick={() => toggleItem(id)} aria-label="Remove from path" className="p-1 rounded opacity-50 hover:opacity-100"><X className="w-3 h-3" style={{ color: C.muted }}/></button>
                  </div>
                  {tracks.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 pl-10">
                      <span className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: itemTracks.length === 0 ? `${C.green}14` : C.card, color: itemTracks.length === 0 ? C.green : C.faint }}>
                        {itemTracks.length === 0 ? 'Core: everyone' : 'Track only'}
                      </span>
                      {tracks.map(track => {
                        const on = track.item_ids.includes(id);
                        return (
                          <button key={track.id} onClick={() => toggleItemTrack(id, track.id)} aria-pressed={on}
                            className="text-[11px] font-semibold px-2 py-1 rounded-full inline-flex items-center gap-1"
                            style={{ background: on ? C.cta : C.card, color: on ? C.ctaText : C.muted }}>
                            {on && <Check className="w-3 h-3"/>}{track.name.trim() || 'Unnamed track'}
                          </button>
                        );
                      })}
                    </div>
                  )}
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
  const term = search.trim().toLowerCase();
  const visible = paths.filter((p: any) => matchesFilters(p, statusFilter, term, [p.title, toPlainText(p.description)]));
  const avgItems = paths.length ? Math.round(paths.reduce((n: number, p: any) => n + (p.item_ids ?? []).length, 0) / paths.length) : 0;
  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Learning paths" sub="Journeys across courses, experiences and certifications." C={LC} actions={
        <button type="button" onClick={openNewEditor} className={btnClass} style={btnStyle('pri', LC)}>
          <Plus className="w-4 h-4"/>
          New learning path
        </button>
      } />
      {deleteError && (
        <p role="alert" className="px-4 py-3 rounded-2xl text-sm" style={{ background: LC.errorBg, color: LC.errorText, border: `1px solid ${LC.errorBorder}` }}>{deleteError}</p>
      )}

      {paths.length === 0 ? (
        <Card C={LC} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: LC.text }}>No learning paths yet</p>
          <p className="text-sm mt-1" style={{ color: LC.muted }}>Create your first path to group courses into a structured journey.</p>
        </Card>
      ) : (
        <>
          <Kpis items={contentKpis({ items: paths, reach, noun: ['path', 'learning paths'], totalSub: `${plural(avgItems, 'item')} on average`, C: LC })} C={LC} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search learning paths" C={LC} />
            <StatusChips value={statusFilter} onChange={setStatusFilter} C={LC} />
          </div>
          {visible.length === 0 ? (
            <Card C={LC} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: LC.muted }}>No learning paths match these filters.</p></Card>
          ) : (
            <div className={CARD_GRID}>
              {visible.map((path: any) => {
                // Active learners in the cohorts this path is assigned to (counted by the API).
                const learners: number = path.learner_count ?? 0;
                const detail = `${plural((path.item_ids ?? []).length, 'item')}, ${plural(learners, 'learner')}`;
                return (
                  <ContentCard key={path.id} item={path} cover={path.cover_image} Icon={Layers3} detail={detail} reach={reach} onOpen={() => openEditor(path)} C={LC}
                    menu={(close) => [
                      { label: 'Report', sub: 'Who is on the path and how far', icon: BarChart3, onClick: () => { close(); setReportPathId(path.id); } },
                      { label: 'Edit', sub: 'Overview, content, audience, publish', icon: Settings2, onClick: () => { close(); openEditor(path); } },
                      null,
                      { label: deleting === path.id ? 'Deleting...' : 'Delete', sub: 'Asks first', icon: Trash2, danger: true, disabled: deleting === path.id, onClick: () => { close(); setConfirmDelete(path); } },
                    ]} />
                );
              })}
            </div>
          )}
        </>
      )}
      {confirmDelete && (
        <ConfirmModal title="Delete learning path?" eyebrow={confirmDelete.title} body="This cannot be undone." action="Delete learning path"
          danger busy={deleting === confirmDelete.id} onClose={() => setConfirmDelete(null)}
          onConfirm={async () => { await deletePath(confirmDelete.id); setConfirmDelete(null); }} C={LC} />
      )}
    </div>
  );
}
