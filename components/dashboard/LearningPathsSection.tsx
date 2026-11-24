'use client';

// Learning-path management workspace shared by the instructor dashboard.

import { normalizeCoverVideo } from '@/lib/course-schema';
import { CoverVideoField } from '@/components/CoverVideoField';
import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, ArrowLeft, BarChart3, Check, CheckCircle2, ChevronDown, ChevronUp, Layers3, Loader2, Pencil, Plus, Settings2, Sparkles, Trash2, Upload, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToolIcons, useToolIconMap } from '@/lib/use-tool-icons';
import { RichTextEditor } from '@/components/RichTextEditor';
import { toPlainText } from '@/lib/plain-text';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { LearningPathReport, SectionHead } from '@/components/dashboard/LearningPathReport';
import type { PathTrack } from '@/lib/learning-path-tracks';
import { MenuSelect } from '@/components/MenuSelect';
import { ConfirmModal, Tick } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, Kpis, PageHeader, StatusChips, contentKpis, matchesFilters, useReach, type Status } from '@/components/dashboard/content/kit';
import { FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { SectionSkeleton } from '@/components/dashboard/content/SectionSkeleton';

// A request that never reached the server is worth distinguishing from one the server
// refused: the first is usually the connection and retrying often works.
const LOAD_ERROR_NETWORK = "Couldn't load learning paths. Check your connection and try again.";
const LOAD_ERROR_SERVER  = "Couldn't load learning paths right now. Try again.";

type Section = 'overview' | 'content' | 'audience' | 'report';
type Kind = 'course' | 'virtual_experience' | 'certification';
const KIND_NAME: Record<Kind, string> = { course: 'Course', virtual_experience: 'Virtual experience', certification: 'Certification' };
const kindOf = (item: any): Kind =>
  item.content_type === 'certification' ? 'certification'
  : item.content_type === 'virtual_experience' || item.content_type === 'guided_project' || item.config?.isVirtualExperience || item.config?.isGuidedProject ? 'virtual_experience'
  : 'course';

/** One titled block of an editor card; blocks after the first get a divider line. */
function Sect({ title, aside, first, children, C }: { title: string; aside?: ReactNode; first?: boolean; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="p-5 grid gap-4" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

export function LearningPathsSection({ C: theme, forms }: { C: ThemeColors; forms: any[] }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
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
  const [lpSection, setLpSection] = useState<Section>('overview');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [trackToRemove, setTrackToRemove] = useState<PathTrack | null>(null);
  // One track is open for editing at a time; the rest show as a single line.
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);
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

  const openEditor = (path: any, section: Section = 'overview') => {
    setLpSection(section);
    setOpenTrackId(null);
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
    if (dirty) { setConfirmLeave(true); return; }
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

  const addTrack = () => {
    const id = crypto.randomUUID();
    setTracks(tracks => [...tracks, { id, name: '', description: '', item_ids: [] }]);
    setOpenTrackId(id);
  };

  const updateTrack = (trackId: string, patch: Partial<PathTrack>) =>
    setTracks(tracks => tracks.map(t => (t.id === trackId ? { ...t, ...patch } : t)));

  const toggleItemTrack = (itemId: string, trackId: string) =>
    setTracks(tracks => tracks.map(t => t.id !== trackId ? t : {
      ...t,
      item_ids: t.item_ids.includes(itemId) ? t.item_ids.filter(i => i !== itemId) : [...t.item_ids, itemId],
    }));

  /** Swaps an item with its neighbour in `ids` (the whole path, or one group of it) in the saved order. */
  const moveWithin = (ids: string[], pos: number, dir: -1 | 1) => {
    const a = ids[pos], b = ids[pos + dir];
    if (!b) return;
    setEditing((prev: any) => {
      const all: string[] = [...(prev.item_ids ?? [])];
      const ia = all.indexOf(a), ib = all.indexOf(b);
      [all[ia], all[ib]] = [all[ib], all[ia]];
      return { ...prev, item_ids: all };
    });
  };

  if (loading) return <SectionSkeleton C={C} shape="cards" />;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertCircle className="w-8 h-8 mb-3" style={{ color: P.bad }}/>
      <p className="text-sm" style={{ color: C.muted }}>{loadError}</p>
      <button type="button" onClick={load} className={`${btnClass} mt-4`} style={btnStyle('pri', C)}>Retry</button>
    </div>
  );

  // -- Editor (and the report, as its last tab) ---
  if (editing !== null) {
    const selectedIds: string[]    = editing.item_ids ?? [];
    const tracks: PathTrack[]      = Array.isArray(editing.tracks) ? editing.tracks : [];
    const selectedCohorts: string[] = editing.cohort_ids ?? [];
    const openToEveryone: boolean = editing.available_to_everyone === true;
    // The header shows the saved status, not the choice in the Audience tab that has not been saved yet.
    const savedStatus = editingBaseline.current ? JSON.parse(editingBaseline.current).status : 'draft';
    const pickable = allOptions.filter(item => (contentFilter === 'all' || contentFilter === kindOf(item)) && (item.title ?? '').toLowerCase().includes(contentSearch.trim().toLowerCase()));
    const label = 'text-xs font-semibold mb-2 block';

    const header = (actions: ReactNode) => (
      <div>
        <button type="button" onClick={closeEditor} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4"/>All learning paths
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{editing.title?.trim() || 'New learning path'}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: C.muted }}>
              {savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
              <span>{plural(selectedIds.length, 'item')}</span>
              <span>{openToEveryone ? 'Everyone' : plural(selectedCohorts.length, 'cohort')}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
        <div role="tablist" aria-label="Path sections" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {(['overview', 'content', 'audience', ...(editing.id ? ['report'] : [])] as Section[]).map(id => (
            <button key={id} type="button" role="tab" aria-selected={lpSection === id} onClick={() => setLpSection(id)}
              className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
              style={lpSection === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
              {id === 'overview' ? 'Overview' : id === 'content' ? 'Content' : id === 'audience' ? 'Audience' : 'Report'}
            </button>
          ))}
        </div>
        {saveMsg && (
          <div role={saveMsg.ok ? 'status' : 'alert'} className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
            style={saveMsg.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            {saveMsg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
            <span className="flex-1">{saveMsg.text}</span>
            <button type="button" onClick={() => setSaveMsg(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4"/></button>
          </div>
        )}
      </div>
    );

    const saveButtons = (
      <>
        <button type="button" onClick={() => save('draft')} disabled={saving} className={btnClass} style={btnStyle('sec', C)}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
          Save draft
        </button>
        <button type="button" onClick={() => save('published')} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
          {savedStatus === 'published' ? 'Publish changes' : 'Publish'}
        </button>
      </>
    );

    const modals = (
      <>
        {confirmLeave && (
          <ConfirmModal title="Leave without saving?" eyebrow={editing.title?.trim() || 'New learning path'} body="Your changes to this path have not been saved." action="Leave"
            danger onClose={() => setConfirmLeave(false)} onConfirm={() => { setConfirmLeave(false); setEditing(null); setSaveMsg(null); }} C={C}/>
        )}
        {trackToRemove && (
          <ConfirmModal title="Remove this track?" eyebrow={trackToRemove.name.trim() || 'Unnamed track'} body="Its items become core, so everyone takes them." action="Remove track"
            danger onClose={() => setTrackToRemove(null)} onConfirm={() => { const id = trackToRemove.id; setTrackToRemove(null); setTracks(ts => ts.filter(t => t.id !== id)); }} C={C}/>
        )}
      </>
    );

    if (lpSection === 'report' && editing.id) {
      return (
        <div className="pb-12">
          <LearningPathReport C={C} pathId={editing.id} header={header}/>
          {modals}
        </div>
      );
    }

    const chip = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` });
    const iconBtn = 'w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80 disabled:opacity-30';
    const imageButtons = (kind: 'cover' | 'badge') => {
      const has = kind === 'cover' ? !!editing.cover_image : !!editing.badge_image_url;
      const busy = kind === 'cover' ? uploadingCover : uploadingBadge;
      return (
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => (kind === 'cover' ? coverInputRef : badgeInputRef).current?.click()} disabled={busy} className={btnSmClass} style={btnStyle('sec', C)}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
            {busy ? 'Uploading...' : has ? 'Change' : 'Upload'}
          </button>
          {kind === 'cover' && <button type="button" onClick={() => setShowCoverLibrary(true)} className={btnSmClass} style={btnStyle('sec', C)}>Browse library</button>}
          {has && (
            <button type="button" onClick={() => setEditing((p: any) => ({ ...p, ...(kind === 'cover' ? { cover_image: '' } : { badge_image_url: null }) }))} className={btnSmClass} style={btnStyle('danger', C)}>Remove</button>
          )}
        </div>
      );
    };

    return (
      <div className="pb-12">
        {header(saveButtons)}
        <AnimatePresence mode="wait">
        <motion.div key={lpSection} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="mt-4">

        {lpSection === 'overview' && (
          <Card C={C} className="overflow-hidden">
            <Sect C={C} title="About the path" first>
              <div>
                <label htmlFor="lp-title" className={label} style={{ color: C.muted }}>Title</label>
                <input id="lp-title" value={editing.title ?? ''} onChange={e => setEditing((p: any) => ({ ...p, title: e.target.value }))} placeholder="For example, Data Analyst Path" className={FIELD} style={inputStyle(C)}/>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-xs font-semibold" style={{ color: C.muted }}>Short description</span>
                  <button type="button" onClick={generateDescription} disabled={generatingDesc} className={btnSmClass} style={btnStyle('sec', C)}>
                    {generatingDesc ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5"/>}
                    {generatingDesc ? 'Writing...' : 'Write with AI'}
                  </button>
                </div>
                <RichTextEditor value={editing.description ?? ''} onChange={html => setEditing((p: any) => ({ ...p, description: html }))} placeholder="What learners achieve by finishing this path."/>
              </div>
              <div>
                <span className={label} style={{ color: C.muted }}>Overview</span>
                <RichTextEditor value={editing.overview ?? ''} onChange={html => setEditing((p: any) => ({ ...p, overview: html }))}
                  placeholder="What the path covers, how it is structured, and what a learner can do at the end."/>
              </div>
            </Sect>

            <Sect C={C} title="Who it is for">
              {/* One per line, because that is how they are read back out: as tags and as a list. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="lp-skills" className={label} style={{ color: C.muted }}>Skills you will learn</label>
                  <textarea id="lp-skills" value={(editing.skills ?? []).join('\n')} onChange={e => setList('skills', e.target.value.split('\n'))} rows={5}
                    placeholder="One skill per line" className={FIELD} style={inputStyle(C)}/>
                  <p className="text-xs mt-2" style={{ color: C.muted }}>Shown as tags</p>
                </div>
                <div>
                  <label htmlFor="lp-who" className={label} style={{ color: C.muted }}>Who should take it</label>
                  <textarea id="lp-who" value={(editing.who_should_take ?? []).join('\n')} onChange={e => setList('who_should_take', e.target.value.split('\n'))} rows={5}
                    placeholder="One audience per line" className={FIELD} style={inputStyle(C)}/>
                  <p className="text-xs mt-2" style={{ color: C.muted }}>Shown as a list</p>
                </div>
              </div>
              {/* Picked from the platform's icon registry rather than typed, so every tool has a logo. */}
              <div>
                <span className={label} style={{ color: C.muted }}>Tools</span>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(toolIconMap).sort((a, b) => a.localeCompare(b)).map(name => {
                    const picked = (editing.tools ?? []).includes(name);
                    return (
                      <button key={name} type="button" aria-pressed={picked}
                        onClick={() => setList('tools', picked ? (editing.tools ?? []).filter((t: string) => t !== name) : [...(editing.tools ?? []), name])}
                        className="inline-flex items-center gap-2 h-8 px-3 rounded-full text-xs font-semibold" style={chip(picked)}>
                        {toolIcon(name) && <img src={toolIcon(name) as string} alt="" className="h-4 w-4 object-contain"/>}
                        {name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs mt-2" style={{ color: C.muted }}>The tools section is hidden from learners until you pick one.</p>
              </div>
            </Sect>

            <Sect C={C} title="Images">
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ''; }}/>
              <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadBadge(f); e.target.value = ''; }}/>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={label} style={{ color: C.muted }}>Cover image</span>
                  <div className="rounded-xl p-4 grid gap-3 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
                    {editing.cover_image
                      ? <img src={editing.cover_image} alt="Learning path cover" className="w-full aspect-video rounded-xl object-cover"/>
                      : <span>A clear visual for the whole journey</span>}
                    {imageButtons('cover')}
                  </div>
                </div>
                <div>
                  <span className={label} style={{ color: C.muted }}>Completion badge</span>
                  <div className="rounded-xl p-4 grid gap-3 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
                    {editing.badge_image_url
                      ? <img src={editing.badge_image_url} alt="Completion badge" className="w-20 h-20 mx-auto object-contain"/>
                      : <span>Earned with the certificate when every item is done</span>}
                    {imageButtons('badge')}
                  </div>
                </div>
              </div>
              {showCoverLibrary && (
                <ImageLibrary uploadFolder="covers" initialFolder="covers" onSelect={url => setEditing((p: any) => ({ ...p, cover_image: url }))} onClose={() => setShowCoverLibrary(false)}/>
              )}
              <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
                <CoverVideoField value={normalizeCoverVideo(editing.cover_video)} onChange={video => setEditing((p: any) => ({ ...p, cover_video: video }))} noun="learning path" />
              </div>
            </Sect>
          </Card>
        )}

        {lpSection === 'content' && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <Card C={C} className="overflow-hidden">
              <SectionHead C={C} title="Add content" aside="Published only"/>
              <div className="px-5 py-4 grid grid-cols-[minmax(0,1fr)] gap-3">
                <SearchBox value={contentSearch} onChange={setContentSearch} placeholder="Search content" C={C}/>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Content type">
                  {(['all', 'course', 'virtual_experience', 'certification'] as const).map(f => (
                    <button key={f} type="button" aria-pressed={contentFilter === f} onClick={() => setContentFilter(f)} className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(contentFilter === f)}>
                      {f === 'all' ? 'All' : f === 'course' ? 'Courses' : f === 'virtual_experience' ? 'Experiences' : 'Certifications'}
                    </button>
                  ))}
                </div>
                {allOptions.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: C.muted }}>No published courses, experiences or certifications yet.</p>
                ) : pickable.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: C.muted }}>No content matches.</p>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    {pickable.map((f: any, i: number) => {
                      const on = selectedIds.includes(f.id);
                      return (
                        <button key={f.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleItem(f.id)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                          <Tick on={on} C={C}/>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{f.title}</span>
                            <span className="block text-xs" style={{ color: C.muted }}>{KIND_NAME[kindOf(f)]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>

            <Card C={C} className="overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
                <h3 className="text-base font-semibold" style={{ color: C.text }}>Path order</h3>
                <button type="button" onClick={addTrack} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5"/>Add track</button>
              </div>
              <div className="px-5 py-4 grid grid-cols-[minmax(0,1fr)] gap-4">
                {(() => {
                  // One timeline step: a numbered node joined to the next by a dashed line. `ids` is the group
                  // it sits in, so moving swaps it with its neighbour in that group.
                  const step = (id: string, n: number, pos: number, ids: string[], grouped: boolean, also?: string) => {
                    const f = allOptions.find((x: any) => x.id === id);
                    const inTracks = tracks.filter(t => t.item_ids.includes(id));
                    const last = pos === ids.length - 1;
                    return (
                      <li key={id} className={`relative pl-12 ${last ? '' : 'pb-3'}`}>
                        {!last && <span aria-hidden className="absolute left-[15px] top-[46px] -bottom-1.5" style={{ borderLeft: `2px dashed ${C.faint}`, opacity: 0.5 }}/>}
                        <span className="absolute left-0 top-2.5 w-8 h-8 rounded-full grid place-items-center text-xs font-bold" style={{ background: P.sel, color: P.onSel }}>{n}</span>
                        <div className="rounded-xl px-3 py-2.5" style={{ background: grouped ? C.card : C.page }}>
                          <div className="flex items-center gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold break-words" style={{ color: C.text }}>{f?.title ?? 'Unpublished or removed item'}</span>
                              {f && <span className="block text-xs" style={{ color: C.muted }}>{KIND_NAME[kindOf(f)]}</span>}
                              {also && <span className="block text-xs" style={{ color: C.muted }}>Also in {also}</span>}
                            </span>
                            <button type="button" onClick={() => moveWithin(ids, pos, -1)} disabled={pos === 0} aria-label="Move up" className={iconBtn} style={{ color: C.muted }}><ChevronUp className="w-4 h-4"/></button>
                            <button type="button" onClick={() => moveWithin(ids, pos, 1)} disabled={last} aria-label="Move down" className={iconBtn} style={{ color: C.muted }}><ChevronDown className="w-4 h-4"/></button>
                            <button type="button" onClick={() => toggleItem(id)} aria-label="Remove from path" className={iconBtn} style={{ color: C.muted }}><X className="w-4 h-4"/></button>
                          </div>
                          {grouped && (
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Pill tone="mute" C={C}>{inTracks.length === 0 ? 'Core' : 'Track only'}</Pill>
                              {tracks.map(track => {
                                const on = track.item_ids.includes(id);
                                return (
                                  <button key={track.id} type="button" onClick={() => toggleItemTrack(id, track.id)} aria-pressed={on}
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold" style={chip(on)}>
                                    {on && <Check className="w-3 h-3"/>}{track.name.trim() || 'Unnamed track'}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  };
                  if (selectedIds.length === 0 && tracks.length === 0) {
                    return <p className="text-sm py-6 text-center" style={{ color: C.muted }}>Tick content above to add it here.</p>;
                  }
                  if (tracks.length === 0) {
                    return <ol aria-label="Path order">{selectedIds.map((id, i) => step(id, i + 1, i, selectedIds, false))}</ol>;
                  }

                  // With tracks: Core first, then one group per track. Learners take the core, then their
                  // track, so every track's numbers carry on from the core.
                  const core = selectedIds.filter(id => !tracks.some(t => t.item_ids.includes(id)));
                  const field = { ...inputStyle(C), background: C.card };
                  const group = (key: string, head: ReactNode, ids: string[], empty: string, trackId?: string) => (
                    <section key={key} aria-label={key} className="rounded-[14px] px-3.5 pt-1 pb-3.5" style={{ background: C.page }}>
                      {head}
                      {ids.length === 0
                        ? <p className="px-3 py-3.5 rounded-xl text-[13px] text-center" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>{empty}</p>
                        : <ol>{ids.map((id, i) => step(id, (trackId ? core.length : 0) + i + 1, i, ids, true,
                            trackId ? tracks.filter(t => t.id !== trackId && t.item_ids.includes(id)).map(t => t.name.trim() || 'an unnamed track').join(', ') || undefined : undefined))}</ol>}
                    </section>
                  );
                  return (
                    <>
                      {group('Core', (
                        <div className="py-3">
                          <p className="text-[15px] font-bold" style={{ color: C.text }}>Core <span className="text-xs font-medium ml-1.5" style={{ color: C.muted }}>{plural(core.length, 'item')}</span></p>
                          <p className="text-xs" style={{ color: C.muted }}>Everyone takes these first</p>
                        </div>
                      ), core, selectedIds.length ? 'Every item is in a track.' : 'Tick content above to add it here.')}
                      {tracks.map(track => {
                        const ids = selectedIds.filter(id => track.item_ids.includes(id));
                        const named = !!track.name.trim();
                        const remove = <button type="button" onClick={() => setTrackToRemove(track)} aria-label="Remove track" className={iconBtn} style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4"/></button>;
                        const head = openTrackId === track.id ? (
                          <div className="py-3 grid grid-cols-[minmax(0,1fr)] gap-2">
                            <div className="flex items-center gap-2">
                              <input value={track.name} onChange={e => updateTrack(track.id, { name: e.target.value })} placeholder="Track name, for example Finance"
                                aria-label="Track name" autoFocus className={FIELD} style={field}/>
                              {remove}
                            </div>
                            <input value={track.description ?? ''} onChange={e => updateTrack(track.id, { description: e.target.value })} placeholder="Who it is for"
                              aria-label="Track description" className={FIELD} style={field}/>
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs" style={{ color: named ? C.muted : P.bad }}>{named ? plural(ids.length, 'item') : 'Add a name to save it.'}</p>
                              <button type="button" onClick={() => setOpenTrackId(null)} className={btnSmClass} style={btnStyle('sec', C)}>Done</button>
                            </div>
                          </div>
                        ) : (
                          <div className="py-3 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-bold break-words" style={{ color: named ? C.text : P.bad }}>
                                {named ? `${track.name.trim()} track` : 'Unnamed track, add a name'}
                                <span className="text-xs font-medium ml-1.5" style={{ color: C.muted }}>{plural(ids.length, 'item')}</span>
                              </p>
                              <p className="text-xs" style={{ color: C.muted }}>{track.description?.trim() || 'No description yet'}</p>
                            </div>
                            <button type="button" onClick={() => setOpenTrackId(track.id)} aria-label={`Edit ${named ? track.name : 'unnamed track'}`} className={iconBtn} style={{ color: C.muted }}><Pencil className="w-4 h-4"/></button>
                            {remove}
                          </div>
                        );
                        return group(track.id, head, ids, `No items yet. Tag an item with ${named ? track.name.trim() : 'this track'} to add it here.`, track.id);
                      })}
                      <div className="flex items-center justify-between gap-4 px-0.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: C.text }}>Specializing is optional</p>
                          <p className="text-xs" style={{ color: C.muted }}>Learners can finish with the core items only.</p>
                          {editing.tracks_optional === true && core.length === 0 && (
                            <p className="text-xs font-semibold mt-1" style={{ color: P.bad }}>Leave at least one item untagged.</p>
                          )}
                        </div>
                        <Switch on={editing.tracks_optional === true} onChange={on => setEditing((prev: any) => ({ ...prev, tracks_optional: on }))} label="Specializing is optional" C={C}/>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Card>
          </div>
        )}

        {lpSection === 'audience' && (
          <Card C={C} className="overflow-hidden">
            <Sect C={C} title="Who gets this path" aside={openToEveryone ? 'Everyone' : plural(selectedCohorts.length, 'cohort')} first>
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: C.text }}>Available to everyone</p>
                  <p className="text-xs" style={{ color: C.muted }}>Anyone with an account can open the path and what is in it, including learners with no cohort. Cohort choices are set aside while this is on.</p>
                </div>
                <Switch on={openToEveryone} label="Available to everyone" C={C}
                  onChange={on => setEditing((prev: any) => ({ ...prev, available_to_everyone: on, cohort_ids: on ? [] : (prev.cohort_ids ?? []) }))}/>
              </div>
            </Sect>
            <Sect C={C} title="Cohorts">
              {cohorts.length === 0 ? (
                <p className="text-sm" style={{ color: C.muted }}>No bootcamp cohorts yet. Create a cohort to assign this path.</p>
              ) : (
                <div style={openToEveryone ? { opacity: 0.45, pointerEvents: 'none' } : undefined} aria-hidden={openToEveryone}>
                  {cohorts.map((cohort: any, i: number) => {
                    const on = selectedCohorts.includes(cohort.id);
                    return (
                      <button key={cohort.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleCohort(cohort.id)}
                        className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: C.text, borderTop: i ? `1px solid ${C.divider}` : undefined }}>
                        <Tick on={on} C={C}/>{cohort.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Sect>
            <div className="p-5" style={{ borderTop: `1px solid ${C.divider}` }}>
              <PlanAccessPicker contentTable="learning_paths" contentId={editing.id} availableToEveryone={editing.available_to_everyone}
                onPublicAccessClosed={() => setEditing((prev: any) => ({ ...prev, available_to_everyone: false }))}/>
            </div>
            <Sect C={C} title="Status">
              <div className="grid gap-3 sm:grid-cols-2">
                {(['draft', 'published'] as const).map(status => {
                  const on = (editing.status ?? 'draft') === status;
                  return (
                    <button key={status} type="button" role="radio" aria-checked={on} onClick={() => setEditing((p: any) => ({ ...p, status }))}
                      className="flex items-start gap-3 p-4 rounded-2xl text-left" style={{ background: C.page, boxShadow: on ? `inset 0 0 0 2px ${P.sel}` : 'none' }}>
                      <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={on ? { background: P.sel } : { background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                        {on && <span className="w-2 h-2 rounded-full" style={{ background: P.onSel }}/>}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: C.text }}>{status === 'draft' ? 'Draft' : 'Published'}</span>
                        <span className="block text-xs" style={{ color: C.muted }}>{status === 'draft' ? 'A private working version' : 'Visible to the learners it is given to'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div>
                <span className={label} style={{ color: C.muted }}>Continue into another path</span>
                <MenuSelect label="Next path" field value={editing.next_path_id ?? ''} onChange={v => setEditing((p: any) => ({ ...p, next_path_id: v || null }))} C={C} searchable
                  options={[{ value: '', label: 'No next path' }, ...paths.filter((p: any) => p.id !== editing.id).map((p: any) => ({ value: p.id as string, label: p.title as string }))]}/>
                <p className="text-xs mt-2" style={{ color: C.muted }}>Learners who finish this path are enrolled in the next one.</p>
              </div>
            </Sect>
          </Card>
        )}

        </motion.div>
        </AnimatePresence>
        {modals}
      </div>
    );
  }

  // -- List ---
  const term = search.trim().toLowerCase();
  const visible = paths.filter((p: any) => matchesFilters(p, statusFilter, term, [p.title, toPlainText(p.description)]));
  const avgItems = paths.length ? Math.round(paths.reduce((n: number, p: any) => n + (p.item_ids ?? []).length, 0) / paths.length) : 0;
  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Learning paths" sub="Journeys across courses, experiences and certifications." C={C} actions={
        <button type="button" onClick={openNewEditor} className={btnClass} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4"/>
          New learning path
        </button>
      } />
      {deleteError && (
        <p role="alert" className="px-4 py-3 rounded-2xl text-sm" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>{deleteError}</p>
      )}

      {paths.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No learning paths yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first path to group courses into a structured journey.</p>
        </Card>
      ) : (
        <>
          <Kpis items={contentKpis({ items: paths, reach, noun: ['path', 'learning paths'], totalSub: `${plural(avgItems, 'item')} on average`, C: C })} C={C} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search learning paths" C={C} />
            <StatusChips value={statusFilter} onChange={setStatusFilter} C={C} />
          </div>
          {visible.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No learning paths match these filters.</p></Card>
          ) : (
            <div className={CARD_GRID}>
              {visible.map((path: any) => {
                // Active learners in the cohorts this path is assigned to (counted by the API).
                const learners: number = path.learner_count ?? 0;
                const detail = `${plural((path.item_ids ?? []).length, 'item')}, ${plural(learners, 'learner')}`;
                return (
                  <ContentCard key={path.id} item={path} cover={path.cover_image} Icon={Layers3} detail={detail} reach={reach} onOpen={() => openEditor(path)} C={C}
                    menu={(close) => [
                      { label: 'Report', sub: 'Who is on the path and how far', icon: BarChart3, onClick: () => { close(); openEditor(path, 'report'); } },
                      { label: 'Edit', sub: 'Overview, content, audience', icon: Settings2, onClick: () => { close(); openEditor(path); } },
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
          onConfirm={async () => { await deletePath(confirmDelete.id); setConfirmDelete(null); }} C={C} />
      )}
    </div>
  );
}
