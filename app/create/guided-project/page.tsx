'use client';

import { normalizeCoverVideo } from '@/lib/course-schema';
import { CoverVideoField } from '@/components/CoverVideoField';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DARK_C, useC } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary, uploadCoverImage } from '@/lib/uploadToCloudinary';
import { DEFAULT_VE_ACCENT } from '@/lib/ve-accent';
import { THEME_ACCENT_COLORS, accentColorFor, type ThemeColor } from '@/lib/theme-types';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ImageLibrary } from '@/components/ImageLibrary';
import type { LessonDoc } from '@/lib/lesson-doc';
import { safeEmbedUrl, isHtmlEmbedUrl, HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';
import { validateVirtualExperienceForPublish } from '@/lib/virtual-experience-validation';
import { attachDeliverableDescriptionDoc, htmlToPlainText } from '@/lib/ve-deliverable-content';
import { Sparkles, Loader2, Trash2, ChevronDown, ChevronUp, ChevronRight, Plus, X, Check, Upload, Link as LinkIcon, Database, PenLine, Table, Video, Eye, Images, Mail, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToolIcons } from '@/lib/use-tool-icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { AiTextarea } from '@/components/AiTextarea';
import { loadLessonHtmlToDoc } from '@/components/lesson/loadLessonHtmlToDoc';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { EditorHeader, SwitchRow } from '@/components/create/EditorKit';
import { MenuSelect } from '@/components/MenuSelect';
import { Requirement, Lesson, Module, ProjectConfig, INDUSTRIES, VE_SECTIONS, uid, REQ_TYPE_NAMES, VE_TOOL_SUGGESTIONS, normalizeToolList } from '@/components/create/ve/model';
import { SortableVEShell, RowMenu } from '@/components/create/ve/parts';
import { TaskEditor } from '@/components/create/ve/TaskEditor';
import { BunnyPicker } from '@/components/create/ve/BunnyPicker';
import { PublishStep } from '@/components/create/ve/PublishStep';

const TEXT_DATASET_EXTENSIONS = new Set(['.csv', '.tsv', '.txt']);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const VE_DATASET_UPLOAD_MAX_BYTES = 4.3 * 1024 * 1024;
const VE_DATASET_UPLOAD_MAX_LABEL = '4.3 MB';

function datasetExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isTextDatasetFile(file: File): boolean {
  const ext = datasetExtension(file.name);
  if (ext) return TEXT_DATASET_EXTENSIONS.has(ext);
  return ['text/csv', 'text/tab-separated-values', 'text/plain'].includes(file.type);
}

function isXlsxDatasetFile(file: File): boolean {
  const ext = datasetExtension(file.name);
  if (ext) return ext === '.xlsx';
  return file.type === XLSX_MIME;
}


// Convert AI-generated lesson bodies (HTML) into canonical interactive docs so VE
// lessons stay doc-canonical, matching the course generate_lesson flow. The HTML
// `body` is kept as the lossy fallback. Runs client-side (generateJSON needs a DOM).
function attachLessonDocs<T extends { modules?: unknown[] }>(cfg: T, lessonHtmlToDoc: (html: string) => LessonDoc): T {
  if (!cfg?.modules) return cfg;
  return {
    ...cfg,
    modules: (cfg.modules as any[]).map((m: any) => ({
      ...m,
      lessons: Array.isArray(m?.lessons)
        ? m.lessons.map((l: any) => {
            let lesson = l;
            if (l?.body) {
              try { lesson = { ...lesson, doc: lessonHtmlToDoc(l.body) }; }
              catch { /* keep body-only if the HTML cannot be parsed */ }
            }
            if (!Array.isArray(l?.requirements)) return lesson;
            const requirements = l.requirements.map((r: any) =>
              attachDeliverableDescriptionDoc(r, lessonHtmlToDoc));
            return { ...lesson, requirements };
          })
        : m?.lessons,
    })),
  };
}


// The editor uses the shared dashboard theme with the shared blue on buttons and selection
// controls. Field fills are the theme's input colour; outlines use inputBorder, which stays
// visible in dark mode (cardBorder is transparent there).
function useVeC() {
  const theme = useC();
  return useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
}







// Page
function VirtualExperienceCreatePageInner() {
  const C = useVeC();
  const toolIcon = useToolIcons();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  // Step 1 state
  const [creationMode, setCreationMode] = useState<'ai' | 'manual' | null>(null);
  const [industry,    setIndustry]    = useState('fintech');
  const [customIndustry, setCustomIndustry] = useState('');
  const effectiveIndustry = industry === 'other' ? (customIndustry.trim() || 'other') : industry;
  const [difficulty,  setDifficulty]  = useState<'beginner'|'intermediate'|'advanced'>('intermediate');
  const [companyName,  setCompanyName]  = useState('');
  const [scenario,     setScenario]     = useState('');
  const [roleHint,     setRoleHint]     = useState('');
  const [focusTopic,   setFocusTopic]   = useState('');
  const [toolsInput,   setToolsInput]   = useState('');
  // Draft for the "add a skill" box under Skills you will use.
  const [newToolDraft, setNewToolDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [emailStyle,   setEmailStyle]   = useState(false);
  // Plain-text draft for the Scenario/Background textarea. Deriving the textarea's
  // `value` fresh from config.background on every render (via this same HTML<->text
  // conversion) reset the caret to the end on every keystroke, since React reassigns
  // a controlled input's DOM value whenever the prop is a newly computed string. This
  // draft is updated directly from the raw keystroke, decoupling display from storage.
  const [backgroundDraft, setBackgroundDraft] = useState('');
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState('');
  // Dataset state (shared across all modes)
  const [datasetCsv,      setDatasetCsv]      = useState('');
  const [datasetFilename, setDatasetFilename]  = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
  const [datasetFileUrl,  setDatasetFileUrl]   = useState('');
  const [datasetUploadNote, setDatasetUploadNote] = useState('');
  const [datasetUrl,      setDatasetUrl]       = useState('');
  const [datasetInputTab, setDatasetInputTab]  = useState<'upload'|'link'>('upload');
  const [uploadingDataset, setUploadingDataset] = useState(false);
  const datasetRef = useRef<HTMLInputElement>(null);
  // Replace/remove the dataset directly on an already-generated/saved VE - the step-1
  // upload screen (and its "Regenerate" way back) is only reachable for a brand-new,
  // not-yet-saved VE, so editing an existing one had no path to change the dataset at all.
  const [uploadingDatasetReplace, setUploadingDatasetReplace] = useState(false);
  const datasetReplaceRef = useRef<HTMLInputElement>(null);

  // Step 2 state
  const [step,        setStep]        = useState<1|2>(1);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [secDir, setSecDir] = useState(1); // carousel slide direction
  const goToSection = (id: string) => {
    const ids = VE_SECTIONS.map(s => s.id) as readonly string[];
    setSecDir(ids.indexOf(id) >= ids.indexOf(activeSection) ? 1 : -1);
    setActiveSection(id);
  };
  const [config,      setConfig]      = useState<ProjectConfig | null>(null);
  const [title,       setTitle]       = useState('');
  const [cohorts,     setCohorts]     = useState<any[]>([]);
  const [selectedCohorts, setSelectedCohorts] = useState<string[]>([]);
  // Offered to everyone, including accounts with no cohort. Mutually exclusive with cohort
  // targeting, matching courses and certifications and the database constraint behind them.
  const [availableToEveryone, setAvailableToEveryone] = useState(false);

  const [deadlineDays, setDeadlineDays] = useState<string>('');
  const [coverImage,  setCoverImage]  = useState('');
  // The status as last saved. A live experience offers Unpublish, not Save draft, since saving a
  // draft takes it away from its cohorts.
  const [savedStatus, setSavedStatus] = useState<'draft' | 'published'>('draft');
  const createdId = useRef<string | null>(null);
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [richTextImageLibraryOpen, setRichTextImageLibraryOpen] = useState(false);
  const richTextImageResolver = useRef<((url: string | null) => void) | null>(null);
  const requestRichTextImage = useCallback(() => new Promise<string | null>(resolve => {
    richTextImageResolver.current?.(null);
    richTextImageResolver.current = resolve;
    setRichTextImageLibraryOpen(true);
  }), []);
  const resolveRichTextImage = useCallback((url: string | null) => {
    const resolve = richTextImageResolver.current;
    richTextImageResolver.current = null;
    setRichTextImageLibraryOpen(false);
    resolve?.(url);
  }, []);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [saveWarning, setSaveWarning] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  // Milestones folded in the Content step, so a long experience can be read as its milestones.
  const [foldedMilestones, setFoldedMilestones] = useState<Set<string>>(new Set());
  const toggleMilestone = (id: string) => setFoldedMilestones(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });


  const coverRef = useRef<HTMLInputElement>(null);

  const [veSlug, setVeSlug] = useState('');
  // After the first save of a brand-new experience the API returns its id. Keep it so further
  // saves update the same record (editId comes from the URL and stays null for a new VE).
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // The mission whose video the Bunny picker fills, as "moduleId::lessonId"; null when closed.
  const [bunnyTarget, setBunnyTarget] = useState<string | null>(null);
  const [sessionToken,       setSessionToken]       = useState('');
  const [experienceGuides, setExperienceGuides] = useState<any[]>([]);
  const [guidesLoading, setGuidesLoading] = useState(false);
  const [showGuideForm, setShowGuideForm] = useState(false);
  const [showGuideManager, setShowGuideManager] = useState(false);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [savingGuide, setSavingGuide] = useState(false);
  const [guideError, setGuideError] = useState('');
  const emptyGuideDraft = { full_name: '', professional_title: '', company: '', profile_photo_url: '', bio: '', linkedin_url: '', expertise: '', consent_confirmed: false };
  const [guideDraft, setGuideDraft] = useState(emptyGuideDraft);
  const guidePhotoRef = useRef<HTMLInputElement>(null);

  const loadExperienceGuides = useCallback(async (token: string) => {
    setGuidesLoading(true);
    setGuideError('');
    try {
      const response = await fetch('/api/experience-guides', { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load experience guides.');
      setExperienceGuides([...(payload.guides ?? []), ...(payload.instructors ?? [])]);
    } catch (error: any) {
      setGuideError(error?.message || 'Could not load experience guides.');
    } finally {
      setGuidesLoading(false);
    }
  }, []);

  // The access token is replaced about every hour. Keep the stored copy current, or a page left
  // open sends an expired one and every AI call from it comes back "Unauthorized".
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setSessionToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load cohorts + existing project if editing
  useEffect(() => {
    // Just created by the first save: what is on screen is already that experience.
    if (editId && editId === createdId.current) return;
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/auth'); return; }
      setSessionToken(session.access_token);

      await loadExperienceGuides(session.access_token);

      const { data: cohortData } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      setCohorts(cohortData ?? []);

      if (editId) {
        const { data: ve } = await supabase.from('virtual_experiences').select('*').eq('id', editId).maybeSingle();
        if (ve) {
          setVeSlug(ve.slug || '');
          setSavedStatus(ve.status === 'published' ? 'published' : 'draft');
          const cfg: any = {
            isVirtualExperience: true, modules: ve.modules ?? [], industry: ve.industry,
            difficulty: ve.difficulty, role: ve.role, company: ve.company, duration: ve.duration,
            tools: ve.tools, tags: ve.tags ?? [], toolLogos: ve.tool_logos ?? {}, tagline: ve.tagline, background: ve.background,
            learnOutcomes: ve.learn_outcomes, managerName: ve.manager_name, managerTitle: ve.manager_title,
            guideId: ve.guide_id || (ve.guide_snapshot?.linkedUserId ? `instructor:${ve.guide_snapshot.linkedUserId}` : null), guideSnapshot: ve.guide_snapshot,
            dataset: ve.dataset, coverImage: ve.cover_image, deadline_days: ve.deadline_days,
            coverVideo: normalizeCoverVideo(ve.cover_video),
            badgeImageUrl: ve.badge_image_url ?? null,
            theme: ve.theme ?? undefined, customAccent: ve.custom_accent ?? undefined,
          };
          setTitle(ve.title || '');
          setCoverImage(cfg.coverImage || '');
          setSelectedCohorts(ve.cohort_ids || []);
          setAvailableToEveryone(ve.available_to_everyone === true);
          setDeadlineDays(cfg.deadline_days ? String(cfg.deadline_days) : '');
          const knownIndustry = INDUSTRIES.find(i => i.id === cfg.industry);
          if (knownIndustry) {
            setIndustry(cfg.industry);
          } else if (cfg.industry) {
            setIndustry('other');
            setCustomIndustry(cfg.industry);
          } else {
            setIndustry('fintech');
          }
          setDifficulty(cfg.difficulty || 'intermediate');
          if (cfg.dataset?.url) setDatasetUrl(cfg.dataset.url);
          if (cfg.dataset?.filename) setDatasetFilename(cfg.dataset.filename);
          if (cfg.dataset?.description) setDatasetDescription(cfg.dataset.description);
          setBackgroundDraft(htmlToPlainText(cfg.background || ''));
          setConfig(cfg as ProjectConfig);
          setStep(2);
          setExpandedModules(new Set((cfg.modules || []).map((m: Module) => m.id)));
        }
      }
    };
    init();
  }, [editId, router, loadExperienceGuides]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const selectExperienceGuide = (rawId: string) => {
    if (!rawId) {
      setConfig(c => c ? { ...c, guideId: null, guideSnapshot: null } : c);
      return;
    }
    const guide = experienceGuides.find(g => g.id === rawId);
    if (!guide) return;
    const snapshot = {
      fullName: guide.full_name,
      professionalTitle: guide.professional_title || undefined,
      company: guide.company || undefined,
      profilePhotoUrl: guide.profile_photo_url || undefined,
      linkedUserId: guide.linked_user_id || undefined,
      sourceType: guide.source_type,
      consentStatus: guide.consent_status || (guide.source_type === 'instructor' ? 'not_required' : 'pending'),
      bio: guide.bio || undefined,
      linkedinUrl: guide.linkedin_url || undefined,
      expertise: Array.isArray(guide.expertise) ? guide.expertise : [],
    };
    setConfig(c => c ? {
      ...c,
      guideId: guide.id,
      guideSnapshot: snapshot,
      managerName: snapshot.fullName,
      managerTitle: snapshot.professionalTitle || 'Experience Guide',
    } : c);
  };

  const uploadGuidePhoto = async (file?: File) => {
    if (!file) return;
    setSavingGuide(true); setGuideError('');
    try {
      const url = await uploadToCloudinary(file, 'experience-guides');
      setGuideDraft(d => ({ ...d, profile_photo_url: url }));
    } catch (e: any) {
      setGuideError(e?.message || 'Photo upload failed.');
    } finally { setSavingGuide(false); }
  };

  const createExperienceGuide = async () => {
    if (!guideDraft.full_name.trim()) { setGuideError('Professional name is required.'); return; }
    if (!guideDraft.consent_confirmed) { setGuideError('Please confirm permission before saving this professional profile.'); return; }
    setSavingGuide(true); setGuideError('');
    try {
      const res = await fetch('/api/experience-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          ...guideDraft,
          expertise: guideDraft.expertise.split(',').map(x => x.trim()).filter(Boolean),
          consent_status: guideDraft.consent_confirmed ? 'confirmed' : 'pending',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create the professional profile.');
      setExperienceGuides(list => [...list, json.guide]);
      setShowGuideForm(false);
      setGuideDraft(emptyGuideDraft);
      selectExperienceGuide(json.guide.id);
      // selectExperienceGuide reads the pre-update list; apply the freshly created row directly.
      setConfig(c => c ? {
        ...c,
        guideId: json.guide.id,
        guideSnapshot: {
          fullName: json.guide.full_name,
          professionalTitle: json.guide.professional_title || undefined,
          company: json.guide.company || undefined,
          profilePhotoUrl: json.guide.profile_photo_url || undefined,
          sourceType: 'external',
          consentStatus: json.guide.consent_status,
          bio: json.guide.bio || undefined,
          linkedinUrl: json.guide.linkedin_url || undefined,
          expertise: json.guide.expertise || [],
        },
        managerName: json.guide.full_name,
        managerTitle: json.guide.professional_title || 'Experience Guide',
      } : c);
    } catch (e: any) { setGuideError(e?.message || 'Could not create the professional profile.'); }
    finally { setSavingGuide(false); }
  };

  const beginEditGuide = (guide: any) => {
    if (guide.source_type !== 'external') return;
    setEditingGuideId(guide.id);
    setGuideDraft({
      full_name: guide.full_name || '',
      professional_title: guide.professional_title || '',
      company: guide.company || '',
      profile_photo_url: guide.profile_photo_url || '',
      bio: guide.bio || '',
      linkedin_url: guide.linkedin_url || '',
      expertise: Array.isArray(guide.expertise) ? guide.expertise.join(', ') : '',
      consent_confirmed: guide.consent_status === 'confirmed',
    });
    setShowGuideForm(true);
    setGuideError('');
  };

  const updateExperienceGuide = async () => {
    if (!editingGuideId || !guideDraft.full_name.trim()) { setGuideError('Professional name is required.'); return; }
    if (!guideDraft.consent_confirmed) { setGuideError('Please confirm permission before saving this professional profile.'); return; }
    setSavingGuide(true); setGuideError('');
    try {
      const res = await fetch('/api/experience-guides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          id: editingGuideId,
          ...guideDraft,
          expertise: guideDraft.expertise.split(',').map(x => x.trim()).filter(Boolean),
          consent_status: 'confirmed',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not update the professional profile.');
      setExperienceGuides(list => list.map(g => g.id === json.guide.id ? json.guide : g));
      if (config?.guideId === json.guide.id) selectExperienceGuideFromRow(json.guide);
      setEditingGuideId(null); setShowGuideForm(false); setGuideDraft(emptyGuideDraft);
    } catch (e: any) { setGuideError(e?.message || 'Could not update the professional profile.'); }
    finally { setSavingGuide(false); }
  };

  const selectExperienceGuideFromRow = (guide: any) => {
    const snapshot = {
      fullName: guide.full_name,
      professionalTitle: guide.professional_title || undefined,
      company: guide.company || undefined,
      profilePhotoUrl: guide.profile_photo_url || undefined,
      linkedUserId: guide.linked_user_id || undefined,
      sourceType: guide.source_type,
      consentStatus: guide.consent_status || (guide.source_type === 'instructor' ? 'not_required' : 'pending'),
      bio: guide.bio || undefined,
      linkedinUrl: guide.linkedin_url || undefined,
      expertise: Array.isArray(guide.expertise) ? guide.expertise : [],
    };
    setConfig(c => c ? { ...c, guideId: guide.id, guideSnapshot: snapshot, managerName: snapshot.fullName, managerTitle: snapshot.professionalTitle || 'Experience Guide' } : c);
  };

  const setGuideStatus = async (guide: any, status: 'active' | 'archived') => {
    setGuideError('');
    try {
      const res = await fetch('/api/experience-guides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ id: guide.id, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setGuideError(json.error || 'Could not update this profile.'); return; }
      setExperienceGuides(list => list.map(g => g.id === guide.id ? json.guide : g));
    } catch {
      setGuideError('Could not update this profile. Check your connection and try again.');
    }
  };

  /**
   * "Skills you will use" on the experience page is config.tools: a list of names, nothing more.
   * The logo beside each one resolves by name through the shared tool-icon registry, exactly as a
   * course's category does -- so a skill is only ever a string, and a logo is uploaded once for
   * the whole platform under dashboard Branding rather than per experience.
   */
  const applyTools = (tools: string[]) => setConfig(c => c ? { ...c, tools } : c);

  const renameTool = (index: number, name: string) => {
    const tools = [...(config?.tools || [])];
    tools[index] = name;
    applyTools(tools);
  };

  /** Tidy the list once the instructor leaves a name field. */
  const normalizeToolsNow = () => {
    const tidy = normalizeToolList(config?.tools);
    const current = config?.tools || [];
    if (tidy.length !== current.length || tidy.some((t, i) => t !== current[i])) applyTools(tidy);
  };

  const removeTool = (index: number) => {
    const tools = [...(config?.tools || [])];
    tools.splice(index, 1);
    applyTools(tools);
  };

  const moveTool = (from: number, to: number) => {
    const tools = config?.tools || [];
    if (to < 0 || to >= tools.length) return;
    applyTools(arrayMove([...tools], from, to));
  };

  const addTool = (raw?: string) => {
    const name = (raw ?? newToolDraft).trim();
    if (!name) return;
    const tools = config?.tools || [];
    if (!tools.some(t => t.trim().toLowerCase() === name.toLowerCase())) {
      applyTools([...tools, name]);
    }
    if (raw === undefined) setNewToolDraft('');
  };

  const handleModuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !config) return;
    const oldIdx = config.modules.findIndex(m => m.id === active.id);
    const newIdx = config.modules.findIndex(m => m.id === over.id);
    setConfig(c => c ? { ...c, modules: arrayMove(c.modules, oldIdx, newIdx) } : c);
  };

  const handleLessonDragEnd = (moduleId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !config) return;
    setConfig(c => {
      if (!c) return c;
      return {
        ...c,
        modules: c.modules.map(m => {
          if (m.id !== moduleId) return m;
          const oldIdx = m.lessons.findIndex(l => l.id === active.id);
          const newIdx = m.lessons.findIndex(l => l.id === over.id);
          return { ...m, lessons: arrayMove(m.lessons, oldIdx, newIdx) };
        }),
      };
    });
  };

  const handleReqDragEnd = (moduleId: string, lessonId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !config) return;
    setConfig(c => {
      if (!c) return c;
      return {
        ...c,
        modules: c.modules.map(m => {
          if (m.id !== moduleId) return m;
          return {
            ...m,
            lessons: m.lessons.map(l => {
              if (l.id !== lessonId) return l;
              const oldIdx = l.requirements.findIndex(r => r.id === active.id);
              const newIdx = l.requirements.findIndex(r => r.id === over.id);
              return { ...l, requirements: arrayMove(l.requirements, oldIdx, newIdx) };
            }),
          };
        }),
      };
    });
  };

  // Helpers
  const toggleModule = (id: string) => setExpandedModules(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const updateModule = (moduleId: string, updates: Partial<Module>) => {
    setConfig(c => c ? { ...c, modules: c.modules.map(m => m.id === moduleId ? { ...m, ...updates } : m) } : c);
  };

  const updateLesson = (moduleId: string, lessonId: string, updates: Partial<Lesson>) => {
    setConfig(c => c ? {
      ...c,
      modules: c.modules.map(m => m.id !== moduleId ? m : {
        ...m,
        lessons: m.lessons.map(l => l.id !== lessonId ? l : { ...l, ...updates }),
      }),
    } : c);
  };

  const updateReq = (
    moduleId: string,
    lessonId: string,
    reqId: string,
    updates: Partial<Requirement> | ((requirement: Requirement) => Partial<Requirement>),
  ) => {
    setConfig(c => c ? {
      ...c,
      modules: c.modules.map(m => m.id !== moduleId ? m : {
        ...m,
        lessons: m.lessons.map(l => l.id !== lessonId ? l : {
          ...l,
          requirements: l.requirements.map(r => r.id !== reqId
            ? r
            : { ...r, ...(typeof updates === 'function' ? updates(r) : updates) }),
        }),
      }),
    } : c);
  };

  const addLesson = (moduleId: string) => {
    const lesson: Lesson = { id: `les-${uid()}`, title: 'New Mission', body: '<p>Mission content here.</p>', requirements: [] };
    updateModule(moduleId, { lessons: [...(config?.modules.find(m => m.id === moduleId)?.lessons ?? []), lesson] });
  };

  // Deleting is immediate and there is no undo, so anything that holds work asks first. An empty
  // milestone, mission or task goes without a prompt.
  // Unsaved changes. Nothing here autosaves, so leaving the page (closing the tab, reloading, or
  // the back arrow) with changes since the last save asks first. The comparison runs only when
  // someone tries to leave, not on every keystroke. A loaded experience starts clean; a new one
  // (generated or blank) counts as unsaved until its first save.
  const savedSnapshot = useRef<string | null>(null);
  const snapshotNow = (cfg = config) => JSON.stringify([cfg, title, coverImage, selectedCohorts, availableToEveryone, deadlineDays, industry, customIndustry, difficulty]);
  const hasUnsavedChanges = () => step === 2 && !!config && savedSnapshot.current !== null && savedSnapshot.current !== snapshotNow();
  const unsavedRef = useRef(hasUnsavedChanges);
  unsavedRef.current = hasUnsavedChanges;
  useEffect(() => {
    if (step !== 2 || !config || savedSnapshot.current !== null) return;
    // Give a loaded experience a moment for its editors to settle before taking the baseline.
    if (!editId) { savedSnapshot.current = ''; return; }
    const timer = setTimeout(() => { if (savedSnapshot.current === null) savedSnapshot.current = snapshotNow(); }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, config, editId]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (unsavedRef.current()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const removeLesson = (moduleId: string, lessonId: string) => {
    const m = config?.modules.find(m => m.id === moduleId);
    if (!m) return;
    const les = m.lessons.find(l => l.id === lessonId);
    const hasWork = !!les && (les.requirements.length > 0 || !!(les.body || '').replace(/<[^>]*>/g, '').trim() || !!les.doc);
    if (hasWork) {
      const n = les!.requirements.length;
      if (!window.confirm(`Delete the mission "${les!.title || 'Untitled'}"${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    }
    updateModule(moduleId, { lessons: m.lessons.filter(l => l.id !== lessonId) });
  };

  // Moves a mission to a different milestone (appended at the end), since the
  // per-milestone drag-and-drop only reorders lessons within their own module.
  const moveLessonToModule = (fromModuleId: string, lessonId: string, toModuleId: string) => {
    if (fromModuleId === toModuleId) return;
    setConfig(c => {
      if (!c) return c;
      const from = c.modules.find(m => m.id === fromModuleId);
      const lesson = from?.lessons.find(l => l.id === lessonId);
      if (!lesson) return c;
      return {
        ...c,
        modules: c.modules.map(m => {
          if (m.id === fromModuleId) return { ...m, lessons: m.lessons.filter(l => l.id !== lessonId) };
          if (m.id === toModuleId) return { ...m, lessons: [...m.lessons, lesson] };
          return m;
        }),
      };
    });
    setExpandedModules(prev => new Set([...prev, toModuleId]));
  };

  const addModule = () => {
    const mod: Module = { id: `mod-${uid()}`, title: 'New Milestone', description: '', lessons: [] };
    setConfig(c => c ? { ...c, modules: [...c.modules, mod] } : c);
    setExpandedModules(prev => new Set([...prev, mod.id]));
  };

  const removeModule = (moduleId: string) => {
    const mod = config?.modules.find(m => m.id === moduleId);
    const n = mod?.lessons.length ?? 0;
    if (n > 0 && !window.confirm(`Delete the milestone "${mod!.title || 'Untitled'}" and its ${n} mission${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setConfig(c => c ? { ...c, modules: c.modules.filter(m => m.id !== moduleId) } : c);
  };

  // Which tasks are open for editing. Closed by default, so an open mission is a short list of
  // rows (number, type, title) rather than every task's full editor; a new task opens itself.
  const [openReqs, setOpenReqs] = useState<Set<string>>(new Set());
  // The learning outcome row just added, so the cursor goes straight into it.
  const [focusOutcome, setFocusOutcome] = useState<number | null>(null);
  const toggleReqOpen = (reqId: string) => setOpenReqs(prev => { const next = new Set(prev); if (next.has(reqId)) next.delete(reqId); else next.add(reqId); return next; });

  const addReq = (moduleId: string, lessonId: string) => {
    const req: Requirement = { id: `req-${uid()}`, label: '', description: '', type: 'mcq', options: ['', '', '', ''], correctAnswer: '' };
    setOpenReqs(prev => new Set([...prev, req.id]));
    updateLesson(moduleId, lessonId, {
      requirements: [...(config?.modules.find(m=>m.id===moduleId)?.lessons.find(l=>l.id===lessonId)?.requirements ?? []), req],
    });
  };

  const removeReq = (moduleId: string, lessonId: string, reqId: string) => {
    const l = config?.modules.find(m=>m.id===moduleId)?.lessons.find(l=>l.id===lessonId);
    if (!l) return;
    const req = l.requirements.find(r => r.id === reqId);
    const hasWork = !!req && [req.label, req.description, req.emailBody, req.expectedAnswer, req.schema, req.context, req.sharePrompt].some(v => !!(v || '').replace(/<[^>]*>/g, '').trim());
    if (hasWork && !window.confirm(`Delete the task "${(req!.label || 'Untitled').slice(0, 60)}"? This cannot be undone.`)) return;
    updateLesson(moduleId, lessonId, { requirements: l.requirements.filter(r => r.id !== reqId) });
  };

  // Moves a task/deliverable to a different mission (appended at the end), since
  // the per-mission drag-and-drop only reorders requirements within their own lesson.
  const moveReqToLesson = (fromModuleId: string, fromLessonId: string, reqId: string, toModuleId: string, toLessonId: string) => {
    if (fromModuleId === toModuleId && fromLessonId === toLessonId) return;
    setConfig(c => {
      if (!c) return c;
      const fromLesson = c.modules.find(m => m.id === fromModuleId)?.lessons.find(l => l.id === fromLessonId);
      const req = fromLesson?.requirements.find(r => r.id === reqId);
      if (!req) return c;
      return {
        ...c,
        modules: c.modules.map(m => ({
          ...m,
          lessons: m.lessons.map(l => {
            if (m.id === fromModuleId && l.id === fromLessonId) return { ...l, requirements: l.requirements.filter(r => r.id !== reqId) };
            if (m.id === toModuleId && l.id === toLessonId) return { ...l, requirements: [...l.requirements, req] };
            return l;
          }),
        })),
      };
    });
    setExpandedModules(prev => new Set([...prev, `${toModuleId}-${toLessonId}`]));
  };

  const uploadedDatasetUrl = datasetFileUrl.trim();
  const pastedDatasetUrl = datasetUrl.trim();
  const preferredDatasetUrl = uploadedDatasetUrl || pastedDatasetUrl;

  const draftDataset = () => {
    if (uploadedDatasetUrl) {
      return {
        filename: datasetFilename || 'dataset',
        description: datasetDescription.trim(),
        url: uploadedDatasetUrl,
      };
    }
    if (datasetCsv.trim()) {
      return {
        filename: datasetFilename || 'dataset.csv',
        description: datasetDescription.trim(),
        csvContent: datasetCsv,
      };
    }
    if (pastedDatasetUrl) {
      return {
        filename: '',
        description: datasetDescription.trim(),
        url: pastedDatasetUrl,
      };
    }
    return undefined;
  };

  const mergeDraftDatasetIntoGeneratedConfig = (generatedConfig: any) => {
    if (!generatedConfig) return generatedConfig;
    if (uploadedDatasetUrl) {
      const existingDataset = { ...(generatedConfig.dataset || {}) };
      delete existingDataset.csvContent;
      generatedConfig.dataset = {
        ...existingDataset,
        filename: datasetFilename || existingDataset.filename || 'dataset',
        url: uploadedDatasetUrl,
      };
    } else if (!datasetCsv.trim() && preferredDatasetUrl) {
      generatedConfig.dataset = { ...(generatedConfig.dataset || {}), url: preferredDatasetUrl };
      if (!generatedConfig.dataset.filename) generatedConfig.dataset.filename = datasetFilename || '';
    }
    if (datasetDescription.trim() && generatedConfig.dataset) {
      generatedConfig.dataset = { ...generatedConfig.dataset, description: datasetDescription.trim() };
    }
    return generatedConfig;
  };

  // Generate
  const handleGenerate = async () => {
    setGenerating(true); setGenError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // If instructor provided CSV, use data-driven generation for accurate answers
      const useDataMode = datasetCsv.trim().length > 0;
      const res = await fetch('/api/ai-guided-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(useDataMode
          ? { action: 'generate-from-data', industry: effectiveIndustry, difficulty, role: roleHint, focusTopic, tools: toolsInput, companyName, scenario, customPrompt, emailStyle: emailStyle ? 'frame' : undefined, csvContent: datasetCsv, filename: datasetFilename || 'dataset.csv' }
          : { action: 'generate', industry: effectiveIndustry, difficulty, role: roleHint, focusTopic, tools: toolsInput, companyName, scenario, customPrompt, emailStyle: emailStyle ? 'frame' : undefined }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      // Merge instructor-provided URL/description into dataset (whether AI-generated or instructor-provided)
      mergeDraftDatasetIntoGeneratedConfig(json.config);
      setConfig(attachLessonDocs(json.config, await loadLessonHtmlToDoc()));
      setBackgroundDraft(htmlToPlainText(json.config.background || ''));
      setTitle(json.config.company ? `${json.config.company} - ${effectiveIndustry.charAt(0).toUpperCase()+effectiveIndustry.slice(1)} Project` : 'Virtual Experience');
      setCoverImage(json.config.coverImage || '');
      setExpandedModules(new Set((json.config.modules || []).map((m: Module) => m.id)));
      setStep(2);
    } catch (e: any) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Generate from uploaded dataset

  // Manual scaffold
  const handleManual = () => {
    const ind = INDUSTRIES.find(i => i.id === industry) || INDUSTRIES[0];
    const dataset = draftDataset();
    const blankConfig: any = {
      isVirtualExperience: true,
      industry: effectiveIndustry,
      difficulty,
      role: roleHint || 'Data Analyst',
      company: '',
      duration: '4-6 hours',
      tools: toolsInput ? toolsInput.split(',').map(t => t.trim()).filter(Boolean) : [],
      tagline: '',
      description: '',
      background: '',
      coverImage: '',
      learnOutcomes: ['', '', ''],
      modules: [{
        id: `mod-${uid()}`,
        title: 'Milestone 1',
        description: '',
        lessons: [{
          id: `les-${uid()}`,
          title: 'Mission 1',
          body: '<p>Describe what the student should do in this mission.</p>',
          requirements: [{
            id: `req-${uid()}`,
            label: '',
            description: '',
            type: 'mcq',
            options: ['', '', '', ''],
            correctAnswer: '',
          }],
        }],
      }],
      managerName: '',
      managerTitle: '',
      ...(dataset ? { dataset } : {}),
    };
    setConfig(blankConfig);
    setBackgroundDraft('');
    setTitle(`${ind.label} Virtual Experience`);
    setExpandedModules(new Set([blankConfig.modules[0].id]));
    setStep(2);
  };

  // Dataset file upload
  const handleDatasetFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDatasetFilename(file.name);
    setUploadingDataset(true);
    setGenError('');
    try {
      if (file.size > VE_DATASET_UPLOAD_MAX_BYTES) {
        setDatasetCsv('');
        setDatasetFilename('');
        setDatasetFileUrl('');
        setDatasetUploadNote('');
        setGenError(`Dataset files are limited to ${VE_DATASET_UPLOAD_MAX_LABEL}.`);
        return;
      }
      if (isTextDatasetFile(file)) {
        const text = await file.text();
        setDatasetCsv(text);
        setDatasetFileUrl('');
        setDatasetUploadNote('');
        return;
      }
      const { url } = await uploadToGithub(file, 've-datasets');
      setDatasetFileUrl(url);
      if (isXlsxDatasetFile(file)) {
        try {
          const { firstWorkbookSheetRows, rowsToCsv } = await import('@/lib/workbook-rows');
          const { sheetName, rows } = await firstWorkbookSheetRows(await file.arrayBuffer());
          setDatasetCsv(rowsToCsv(rows));
          setDatasetUploadNote(`AI will read the first sheet, "${sheetName}". Students will download the original workbook.`);
        } catch {
          setDatasetCsv('');
          setDatasetUploadNote('Workbook uploaded for student download, but AI could not read a sheet preview. Generation will use the brief instead.');
        }
      } else if (datasetExtension(file.name) === '.xls') {
        setDatasetCsv('');
        setDatasetUploadNote('Legacy XLS files are uploaded for student download. AI cannot read them here, so generation will use the brief unless you paste CSV.');
      } else {
        setDatasetCsv('');
        setDatasetUploadNote('File uploaded for student download. AI will generate from the brief unless you paste CSV.');
      }
    } catch (err: any) {
      setDatasetCsv('');
      setDatasetFilename('');
      setDatasetFileUrl('');
      setDatasetUploadNote('');
      setGenError(err?.message || 'Dataset upload failed. Please try again.');
    } finally {
      setUploadingDataset(false);
      e.target.value = '';
    }
  };

  // Replace or attach the dataset on an already-generated VE (Overview tab), writing
  // straight into config.dataset since there is no step-1 draft to feed here.
  const handleDatasetReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDatasetReplace(true);
    try {
      if (file.size > VE_DATASET_UPLOAD_MAX_BYTES) {
        setDatasetCsv('');
        setDatasetUploadNote('');
        alert(`Dataset files are limited to ${VE_DATASET_UPLOAD_MAX_LABEL}.`);
        return;
      }
      if (isTextDatasetFile(file)) {
        const text = await file.text();
        setDatasetCsv('');
        setDatasetUploadNote('');
        setConfig(c => c ? { ...c, dataset: { filename: file.name, description: c.dataset?.description || '', csvContent: text, url: undefined } } : c);
        return;
      }
      const { url } = await uploadToGithub(file, 've-datasets');
      setDatasetCsv('');
      setDatasetUploadNote('');
      setConfig(c => c ? { ...c, dataset: { filename: file.name, description: c.dataset?.description || '', url } } : c);
    } catch (err: any) {
      setDatasetCsv('');
      setDatasetUploadNote('');
      alert(err?.message || 'Dataset upload failed. Please try again.');
    } finally {
      setUploadingDatasetReplace(false);
      e.target.value = '';
    }
  };

  const removeDataset = () => {
    setConfig(c => c ? { ...c, dataset: undefined } : c);
  };

  // AI Improve

  // Cover image upload
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const ref = await uploadCoverImage(file, 'covers');
      setCoverImage(ref);
      setConfig(c => c ? { ...c, coverImage: ref } : c);
    } catch (e: any) {
      alert('Upload failed: ' + e.message);
    } finally {
      setUploadingCover(false);
    }
  };

  const [uploadingBadge, setUploadingBadge] = useState(false);
  const badgeInputRef = useRef<HTMLInputElement>(null);

  const handleBadgeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBadge(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const ext  = file.name.split('.').pop() ?? 'png';
      const path = `badges/${session?.user.id ?? 'anon'}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      setConfig(c => c ? { ...c, badgeImageUrl: publicUrl } : c);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingBadge(false);
      if (badgeInputRef.current) badgeInputRef.current.value = '';
    }
  };

  // Dataset download

  // Save
  const effectiveId = editId ?? savedId;

  const handleSave = async (status: 'draft' | 'published') => {
    if (!config || !title.trim()) { setSaveError('Title is required'); return; }
    if (status === 'published') {
      const readinessIssues = validateVirtualExperienceForPublish(config);
      if (readinessIssues.length) {
        setSaveError(readinessIssues[0].message);
        setActiveSection(readinessIssues[0].section === 'branding' ? 'overview' : readinessIssues[0].section);
        return;
      }
    }
    if (status === 'published' && config.guideSnapshot?.sourceType === 'external' && config.guideSnapshot.consentStatus !== 'confirmed') {
      setSaveError('Confirm permission to use the selected professional\'s name and photo before publishing.');
      setActiveSection('brief');
      return;
    }
    setSaving(true); setSaveError(''); setSaveWarning(''); setSaveSuccess(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/guided-project-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          editId: effectiveId,
          title: title.trim(),
          // Normalized here too, not only on blur: a save triggered without the field losing
          // focus would otherwise persist a blank or duplicate skill name.
          config: { ...config, tools: normalizeToolList(config?.tools) },
          coverImage,
          cohort_ids: availableToEveryone ? [] : selectedCohorts,
          available_to_everyone: availableToEveryone,
          group_ids:  [],
          deadline_days: deadlineDays ? Number(deadlineDays) : null,
          status,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (Array.isArray(json.issues) && json.issues[0]?.section) setActiveSection(json.issues[0].section);
        throw new Error(json.error || 'Failed to save');
      }

      // Stay in the editor so the user can keep editing. Remember the new id (and reflect it in
      // the URL without a reload) so repeat saves update this record instead of creating new ones.
      if (!effectiveId && json.id) {
        // The URL change re-runs the load effect (it reads the id from the URL); this tells it the
        // experience on screen is already the one in the database.
        createdId.current = json.id;
        setSavedId(json.id);
        window.history.replaceState(null, '', `/create/guided-project?id=${json.id}`);
      }
      if (json.slug) setVeSlug(json.slug);
      if (json.registrationWarning) setSaveWarning(json.registrationWarning);
      setSavedStatus(status);
      setSaveSuccess(true);
      // An uploaded CSV is stored once: keep the link the server returns, so the next save does
      // not upload it again.
      let savedConfig = config;
      if (config.dataset?.csvContent && json.dataset?.url) {
        const dataset = { filename: config.dataset.filename, description: config.dataset.description, url: json.dataset.url };
        savedConfig = { ...config, dataset };
        setConfig(c => c ? { ...c, dataset } : c);
        setDatasetUrl(json.dataset.url);
      }
      savedSnapshot.current = snapshotNow(savedConfig);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Render
  // One field style everywhere in the editor: a soft fill, no border, green on focus (globals.css).
  const inp = {
    width: '100%', padding: '9px 12px', borderRadius: 10,
    border: '1.5px solid transparent', background: C.input, boxShadow: 'none',
    color: C.text, fontSize: 14, outline: 'none', transition: 'background 160ms ease',
  } as React.CSSProperties;

  // A section of a tab: no panel of its own, set off from the one above by a hairline and space.
  const card = {
    background: 'transparent', border: 'none', borderTop: `1px solid ${C.divider}`,
    borderRadius: 0, boxShadow: 'none', paddingLeft: 0, paddingRight: 0, paddingTop: 20, paddingBottom: 20,
  } as React.CSSProperties;

  const P = palette(C);
  const leaveEditor = () => {
    if (hasUnsavedChanges() && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push('/dashboard#virtual_experiences');
  };

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      {/* The first section on a tab has no line above it. Editors in this page show the common
          tools and Add interactive; the rest sit under More, which the shared lesson editor
          already offers on narrow screens. */}
      <style>{`.ve-tab > .space-y-4 > div:first-child { border-top: none !important; padding-top: 4px !important; }
.ve-tab .lesson-editor-toolbar__secondary, .ve-tab .lesson-editor-toolbar__media { display: none !important; }
.ve-tab .lesson-editor-toolbar__more { display: inline-flex !important; }
.ve-tab input:focus-visible, .ve-tab textarea:focus-visible, .ve-tab select:focus-visible { outline: none !important; box-shadow: inset 0 0 0 2px ${C.cta} !important; }
.ve-tab .ve-shell > input:focus-visible, .ve-tab [contenteditable="true"]:focus-visible { outline: none !important; box-shadow: none !important; }
.ve-tab .ve-shell:focus-within, .ve-tab .lesson-editor-shell:focus-within { outline: 2px solid ${C.cta}; outline-offset: -2px; }`}</style>
      <div className={`${step === 2 ? 'max-w-6xl' : 'max-w-4xl'} mx-auto px-4 sm:px-6 pt-6 sm:pt-8`}>
        <EditorHeader C={C} back="All virtual experiences" onBack={leaveEditor}
          title={step === 2 ? (title.trim() || 'Untitled experience') : (effectiveId ? 'Edit virtual experience' : 'New virtual experience')}
          pill={step === 2 ? (savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>) : undefined}
          error={step === 2 ? saveError : undefined} onDismissError={() => setSaveError('')}
          actions={step === 2 ? <>
            {veSlug ? (
              <a href={`/${veSlug}`} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('sec', C)}>
                <Eye className="w-4 h-4" /> Preview
              </a>
            ) : (
              <span title="Save the experience first to preview it" className={`${btnClass} opacity-50 cursor-not-allowed`} style={btnStyle('sec', C)}>
                <Eye className="w-4 h-4" /> Preview
              </span>
            )}
            <button type="button" disabled={saving}
              onClick={() => { if (savedStatus !== 'published' || window.confirm('Unpublish this experience? Learners lose access until you publish it again.')) handleSave('draft'); }}
              title={savedStatus === 'published' ? 'Takes it away from learners and their cohorts until you publish it again' : undefined}
              className={btnClass} style={btnStyle('sec', C)}>
              {savedStatus === 'published' ? 'Unpublish' : <><Check className="w-4 h-4" /> Save draft</>}
            </button>
            <button type="button" onClick={() => handleSave('published')} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saveSuccess ? 'Saved' : savedStatus === 'published' ? 'Publish changes' : 'Publish'}
            </button>
          </> : null}>
          {step === 2 && (
            <div role="tablist" aria-label="Virtual experience steps" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
              {VE_SECTIONS.map(section => {
                const active = activeSection === section.id;
                const count = section.id === 'curriculum' ? (config?.modules ?? []).reduce((n, m) => n + (m.lessons?.length ?? 0), 0) : null;
                return (
                  <button key={section.id} type="button" role="tab" aria-selected={active} onClick={() => goToSection(section.id)}
                    className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                    style={active ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                    {section.label}{count !== null && <span className="ml-1 text-xs" style={{ opacity: 0.7 }}>{count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </EditorHeader>
        {step === 2 && saveWarning && (
          <div role="status" className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: P.warnSoft, color: P.warn }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span className="flex-1">{saveWarning}</span>
          </div>
        )}

        {/* STEP 1: Configure */}
        {step === 1 && (
          <div className="mt-4">
          <Card C={C}>
            <div className="px-6 sm:px-8 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <h2 className="text-base font-semibold leading-tight" style={{ color: C.text }}>How do you want to build it?</h2>
              <p className="text-sm mt-1" style={{ color: C.muted }}>Let AI draft the whole experience, or start from a blank outline.</p>
            </div>
            <div className="ve-tab px-6 sm:px-8 py-7 space-y-6">

            {/* Creation mode cards */}
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'ai' as const,
                  icon: <Sparkles className="w-5 h-5"/>,
                  title: 'Generate with AI',
                  desc: 'AI creates the company scenario, modules and questions. Optionally provide your own dataset for more accurate answers.',
                  badge: 'Recommended',
                },
                {
                  id: 'manual' as const,
                  icon: <PenLine className="w-5 h-5"/>,
                  title: 'Build manually',
                  desc: 'Start with a blank template and write every module, lesson and question yourself. Optionally attach a dataset for students.',
                  badge: 'Full control',
                },
              ].map(m => (
                <button key={m.id} onClick={() => setCreationMode(m.id)}
                  className="relative text-left p-5 rounded-2xl transition-all hover:scale-[1.015]"
                  style={{
                    border: 'none',
                    background: creationMode === m.id ? `${C.cta}14` : C.pill,
                    boxShadow: creationMode === m.id ? `0 0 0 2px ${C.cta}` : 'none',
                  }}>
                  {creationMode === m.id && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: C.cta }}>
                      <Check className="w-3 h-3" style={{ color: C.ctaText }}/>
                    </div>
                  )}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: C.card, color: C.muted }}>
                    {m.icon}
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-base font-bold" style={{ color: C.text }}>{m.title}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.pill, color: C.muted }}>{m.badge}</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{m.desc}</p>
                </button>
              ))}
            </div>


            {/* Config card: appears when mode selected */}
            {creationMode && (
              <div className="space-y-6 mt-2">
                <div>
                  {/* Industry */}
                  <div className="pb-5 space-y-3">
                    <p className="text-xs font-semibold" style={{ color: C.muted }}>Industry</p>
                    <div className="flex flex-wrap gap-2">
                      {[...INDUSTRIES, { id: 'other', label: 'Other' }].map(ind => {
                        const selected = industry === ind.id;
                        return (
                          <button key={ind.id} type="button" aria-pressed={selected} onClick={() => setIndustry(ind.id)}
                            className="rounded-full px-3 py-2 text-sm font-semibold transition-colors"
                            style={selected ? { background: P.sel, color: P.onSel } : { background: C.input, color: C.text }}>
                            {ind.label}
                          </button>
                        );
                      })}
                    </div>
                    {industry === 'other' && (
                      <input
                        type="text"
                        value={customIndustry}
                        onChange={e => setCustomIndustry(e.target.value)}
                        placeholder="e.g. Logistics, Agriculture, Real Estate"
                        aria-label="Industry"
                        style={inp}
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Experience Level */}
                  <div className="pb-5 pt-5 space-y-3 border-t" style={{ borderColor: C.divider }}>
                    <p className="text-xs font-semibold" style={{ color: C.muted }}>Level</p>
                    <div className="inline-flex rounded-[10px] p-[3px]" style={{ background: C.input }}>
                      {([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] as const).map(([id, label]) => {
                        const selected = difficulty === id;
                        return (
                          <button key={id} type="button" aria-pressed={selected} onClick={() => setDifficulty(id)}
                            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                            style={selected ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Role / Focus / Tools */}
                  <div className="pb-5 pt-5 border-t" style={{ borderColor: C.divider }}>
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Role</label>
                        <input style={inp} value={roleHint} onChange={e => setRoleHint(e.target.value)} placeholder="e.g. Data Analyst" />
                      </div>
                      {creationMode !== 'manual' && (
                        <div>
                          <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Focus topic</label>
                          <input style={inp} value={focusTopic} onChange={e => setFocusTopic(e.target.value)} placeholder="e.g. Fraud detection" />
                        </div>
                      )}
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Tools</label>
                        <input style={inp} value={toolsInput} onChange={e => setToolsInput(e.target.value)} placeholder="e.g. Excel, Power BI" />
                      </div>
                    </div>
                  </div>

                  {/* Company & Scenario: AI + data modes */}
                  {creationMode !== 'manual' && (
                    <div className="pb-5 pt-5 border-t space-y-3" style={{ borderColor: C.divider }}>
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>
                          Company <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <input
                          style={inp}
                          value={companyName}
                          onChange={e => setCompanyName(e.target.value)}
                          placeholder="e.g. NaraPay"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>
                          Scenario <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <textarea
                          value={scenario}
                          onChange={e => setScenario(e.target.value)}
                          rows={3}
                          style={{ ...inp, fontSize: 14, resize: 'vertical', lineHeight: 1.6 } as React.CSSProperties}
                          placeholder="Describe the company background and the problem the student needs to solve. e.g. NaraPay is a Lagos-based fintech processing 50,000 mobile transactions daily. They are losing 12% revenue to fraud and need a data analyst to identify patterns."
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold block mb-1" style={{ color: C.muted }}>
                          Extra instructions for the AI <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <textarea
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          rows={2}
                          style={{ ...inp, fontSize: 14, resize: 'vertical', lineHeight: 1.6 } as React.CSSProperties}
                          placeholder="e.g. Make questions harder than usual. Use a conversational tone in lesson bodies."
                        />
                      </div>
                      <div className="pt-2">
                        <SwitchRow C={C} title="Present tasks as workplace emails" on={emailStyle} onChange={setEmailStyle}
                          sub="Wraps every task, upload, and AI review in an email thread from the manager. The AI will also write the email body for each one." />
                      </div>
                    </div>
                  )}

                  {/* Dataset */}
                  <div className="pb-5 pt-5 border-t space-y-3" style={{ borderColor: C.divider }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold" style={{ color: C.muted }}>
                          Dataset <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
                        </p>
                        {creationMode === 'ai' && (
                          <p className="text-[12px] mt-0.5" style={{ color: C.faint }}>
                            If provided, AI uses your data to generate accurate questions.
                          </p>
                        )}
                      </div>
                      <div className="flex rounded-[10px] overflow-hidden text-[12px] p-[3px]" style={{ background: C.input }}>
                        {(['upload', 'link'] as const).map(tab => (
                          <button key={tab} onClick={() => setDatasetInputTab(tab)}
                            className="px-3 py-2 font-medium transition-all"
                            style={{
                              background: datasetInputTab === tab ? C.card : 'transparent',
                              color: datasetInputTab === tab ? C.text : C.muted, borderRadius: 8,
                            }}>
                            {tab === 'upload'
                              ? <span className="flex items-center gap-1"><Upload className="w-3 h-3"/> Upload / Paste</span>
                              : <span className="flex items-center gap-1"><LinkIcon className="w-3 h-3"/> Link</span>}
                          </button>
                        ))}
                      </div>
                    </div>

                    {datasetInputTab === 'upload' && (
                      <>
                        <div className="flex items-center gap-2">
                          <input ref={datasetRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.zip,.json" className="hidden" onChange={handleDatasetFileUpload}/>
                          <button onClick={() => datasetRef.current?.click()}
                            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border transition-all hover:opacity-70"
                            style={{ border: 'none', color: C.text, background: C.input }}>
                            {uploadingDataset ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                            {datasetFilename ? datasetFilename : 'Upload CSV or Excel file'}
                          </button>
                          {datasetFilename && (
                            <button onClick={() => { setDatasetCsv(''); setDatasetFilename(''); setDatasetFileUrl(''); setDatasetUploadNote(''); }}
                              className="hover:opacity-70 transition-opacity" style={{ color: C.faint }}>
                              <X className="w-3.5 h-3.5"/>
                            </button>
                          )}
                        </div>
                        <textarea
                          value={datasetCsv}
                          onChange={e => setDatasetCsv(e.target.value)}
                          rows={8}
                          style={{ ...inp, fontFamily: 'monospace', fontSize: 14, resize: 'vertical', lineHeight: 1.5 } as React.CSSProperties}
                          placeholder={"Paste CSV data here, or upload a file above\n\ndate,region,amount,status\n2024-01-01,Lagos,45000,Completed\n2024-01-02,Abuja,32000,Pending"}
                        />
                        {datasetCsv.trim() && (
                          <div className="flex items-center gap-2 text-sm" style={{ color: C.faint }}>
                            <Table className="w-3.5 h-3.5"/>
                            {datasetCsv.trim().split('\n').length} rows detected
                            {creationMode === 'ai' && ', AI will generate questions from these exact values'}
                          </div>
                        )}
                        {datasetUploadNote && (
                          <p className="text-[12px]" style={{ color: C.faint }}>
                            {datasetUploadNote}
                          </p>
                        )}
                      </>
                    )}

                    {datasetInputTab === 'link' && (
                      <div className="space-y-2">
                        <input
                          value={datasetUrl}
                          onChange={e => setDatasetUrl(e.target.value)}
                          style={inp}
                          placeholder="https://docs.google.com/spreadsheets/ or any public CSV/sheet URL"
                        />
                        <p className="text-[12px]" style={{ color: C.faint }}>
                          The link will be shown to students as the dataset source.
                          {creationMode === 'ai' && ' To let AI generate questions from your data, paste the CSV content in the Upload tab instead.'}
                        </p>
                        {datasetFileUrl.trim() && (
                          <p className="text-[12px]" style={{ color: C.faint }}>
                            The uploaded dataset file is active. Clear it on the Upload tab if you want this link to be used instead.
                          </p>
                        )}
                      </div>
                    )}

                    {(datasetCsv.trim() || preferredDatasetUrl) && (
                      <div className="space-y-1">
                        <label className="text-[12px] font-medium" style={{ color: C.faint }}>Description shown to students</label>
                        <textarea
                          value={datasetDescription}
                          onChange={e => setDatasetDescription(e.target.value)}
                          rows={2}
                          style={{ ...inp, fontSize: 14, resize: 'vertical', lineHeight: 1.5 } as React.CSSProperties}
                          placeholder={creationMode === 'ai' ? 'Leave blank to let AI write one, or describe the dataset yourself' : 'e.g. Q3 regional sales transactions with status and amount columns.'}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Error */}
                {genError && (
                  <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    {genError}
                  </div>
                )}

                {/* CTA button */}
                {creationMode === 'ai' && (
                  <button onClick={handleGenerate} disabled={generating}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-base transition-all hover:opacity-90 hover:scale-[1.005] disabled:opacity-60"
                    style={{ background: C.cta, color: C.ctaText, boxShadow: `0 6px 20px ${C.cta}38` }}>
                    {generating
                      ? <><Loader2 className="w-5 h-5 animate-spin"/> Generating</>
                      : datasetCsv.trim()
                        ? <><Database className="w-5 h-5"/> Generate from My Dataset</>
                        : <><Sparkles className="w-5 h-5"/> Generate with AI</>}
                  </button>
                )}

                {creationMode === 'manual' && (
                  <button onClick={handleManual}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-base transition-all hover:opacity-90 hover:scale-[1.005]"
                    style={{ background: C.cta, color: C.ctaText, boxShadow: `0 6px 20px ${C.cta}38` }}>
                    <PenLine className="w-5 h-5"/> Start with Blank Template
                  </button>
                )}

                {generating && (
                  <div className="text-center space-y-3">
                    <p className="text-sm font-medium" style={{ color: C.muted }}>
                      {datasetCsv.trim() ? 'Analysing your data and generating questions' : 'Creating company scenario, milestones, missions and dataset'}
                    </p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {['Company brief', 'Dataset', 'Milestones', 'Missions', 'Questions'].map((s, i) => (
                        <span key={s} className="text-[12px] px-3 py-1 rounded-full animate-pulse font-medium"
                          style={{ background: `${C.cta}18`, color: C.cta, animationDelay: `${i * 0.2}s` }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </Card>
          </div>
        )}

        {/* STEP 2: Review & Edit */}
        {step === 2 && config && (() => {
          const managerName  = config.guideSnapshot?.fullName || config.managerName  || 'Your Manager';
          const managerTitle = config.guideSnapshot?.professionalTitle || config.managerTitle || 'Head of Analytics';
          const managerPhoto = config.guideSnapshot?.profilePhotoUrl;
          const managerInitials = managerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
          const dataset = config.dataset;
          const experienceAccent = accentColorFor(config.customAccent, config.theme) ?? DEFAULT_VE_ACCENT;

          return (
          <div className="mt-4">
              <Card C={C} className="overflow-hidden">
                <AnimatePresence mode="wait" custom={secDir}>
                <motion.div key={activeSection} custom={secDir}
                  initial={{ opacity: 0, x: secDir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: secDir * -28 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="ve-tab px-6 sm:px-8 py-7">

                {activeSection === 'overview' && (
                <div className="space-y-4">

                {/* Basics */}
                <div style={{ ...card, borderTop: 'none', paddingTop: 4 }} className="space-y-3">
                    <h3 className="text-base font-semibold" style={{ color: C.text }}>Basics</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Company</label>
                        <input value={config.company || ''} onChange={e => setConfig(c => c ? { ...c, company: e.target.value } : c)}
                          style={inp} placeholder="e.g. Kolapay" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Learner role</label>
                        <input value={config.role || ''} onChange={e => setConfig(c => c ? { ...c, role: e.target.value } : c)}
                          style={inp} placeholder="e.g. Data Analyst" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Experience title</label>
                      <input value={title} onChange={e => setTitle(e.target.value)}
                        style={{ ...inp, fontSize: 16, fontWeight: 600 }} placeholder="e.g. Churn Analyst at Kolapay" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Tagline</label>
                      <input value={config.tagline || ''} onChange={e => setConfig(c => c ? { ...c, tagline: e.target.value } : c)}
                        style={inp} placeholder="One line that says what the learner will do" />
                    </div>

                    {/* Skills / tools -- editable. Shown to students as "Skills you will use". */}
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Skills and tools</p>
                      <div className="space-y-2">
                        {(config.tools || []).map((t, i) => {
                          const logo = toolIcon(t);
                          const initial = t.trim().charAt(0).toUpperCase();
                          return (
                            <div key={i} className="ve-shell flex items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: C.input }}>
                              {logo
                                ? <img src={logo} alt={t} className="w-4 h-4 rounded object-contain flex-shrink-0" />
                                : <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-[11px] font-bold" style={{ background: C.pill, color: C.muted }}>{initial}</div>
                              }
                              <input value={t} onChange={e => renameTool(i, e.target.value)}
                                onBlur={normalizeToolsNow}
                                placeholder="Skill or tool name"
                                className="flex-1 min-w-0 bg-transparent text-[12px] font-medium outline-none"
                                style={{ color: C.text }} />
                              <button type="button" title="Move up" disabled={i === 0}
                                onClick={() => moveTool(i, i - 1)}
                                className="disabled:opacity-25 flex-shrink-0" style={{ color: C.muted }}>
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="Move down" disabled={i === (config.tools || []).length - 1}
                                onClick={() => moveTool(i, i + 1)}
                                className="disabled:opacity-25 flex-shrink-0" style={{ color: C.muted }}>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="Remove skill" onClick={() => removeTool(i)}
                                className="hover:text-red-400 flex-shrink-0" style={{ color: C.faint }}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2">
                          <input value={newToolDraft}
                            onChange={e => setNewToolDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTool(); } }}
                            placeholder="Add a skill or tool"
                            style={{ ...inp, fontSize: 12, flex: 1 }} />
                          <button type="button" onClick={() => addTool()} disabled={!newToolDraft.trim()} className={btnClass} style={btnStyle('sec', C)}>
                            <Plus className="w-4 h-4" /> Add
                          </button>
                        </div>
                      </div>
                      {/* Quick picks, matching the course category picker. */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {VE_TOOL_SUGGESTIONS
                          .filter(s => !(config.tools || []).some(t => t.trim().toLowerCase() === s.toLowerCase()))
                          .map(s => (
                            <button key={s} type="button" onClick={() => addTool(s)}
                              className="min-h-8 rounded-lg px-3 py-1 text-[11px] font-semibold transition-all hover:opacity-70"
                              style={{ background: C.pill, color: C.muted }}>
                              {s}
                            </button>
                          ))}
                      </div>
                      <p className="text-[11px] mt-2" style={{ color: C.faint }}>
                        Shown on the experience page. Logos come from the shared tool icons in dashboard Branding.
                      </p>
                    </div>

                    {/* Tags: topics the experience covers, typed one at a time, as on courses. */}
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Tags</p>
                      {(config.tags ?? []).length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {(config.tags ?? []).map(tag => (
                            <span key={tag} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg pl-3 pr-1.5 text-[12px] font-semibold" style={{ background: C.pill, color: C.text }}>
                              {tag}
                              <button type="button" aria-label={`Remove ${tag}`}
                                onClick={() => setConfig(c => c ? { ...c, tags: (c.tags ?? []).filter(t => t !== tag) } : c)}
                                className="grid h-5 w-5 place-items-center rounded-full hover:text-red-400" style={{ color: C.faint }}>
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input value={tagDraft} onChange={e => setTagDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ',') return;
                          e.preventDefault();
                          const tag = tagDraft.trim();
                          if (tag) setConfig(c => c && !(c.tags ?? []).some(t => t.toLowerCase() === tag.toLowerCase()) ? { ...c, tags: [...(c.tags ?? []), tag] } : c);
                          setTagDraft('');
                        }}
                        placeholder="Type a tag and press Enter, e.g. Financial analysis"
                        style={{ ...inp, fontSize: 12 }} />
                      <p className="text-[11px] mt-2" style={{ color: C.faint }}>
                        Topics the experience covers. The card shows as many as fit; the pop-up shows them all.
                      </p>
                    </div>

                    {/* Dataset - replace/attach/remove works here even for an already-saved VE */}
                    <div>
                    <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Dataset</label>
                    <div className="p-4 rounded-xl" style={{ background: C.page }}>
                      <input ref={datasetReplaceRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.zip,.json" className="hidden" onChange={handleDatasetReplace} />
                      {dataset ? (
                        <div className="flex items-start gap-2">
                          <Table className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: C.muted }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[12px] font-bold flex-1 min-w-[120px] truncate" style={{ color: C.text }}>{dataset.filename || 'Linked dataset'}</p>
                              <button type="button" onClick={() => datasetReplaceRef.current?.click()} disabled={uploadingDatasetReplace} className={btnSmClass} style={btnStyle('sec', C)}>
                                {uploadingDatasetReplace ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                {uploadingDatasetReplace ? 'Uploading...' : 'Replace file'}
                              </button>
                              <button type="button" onClick={removeDataset} className={btnSmClass} style={btnStyle('danger', C)}>Remove</button>
                            </div>
                            <input
                              value={dataset.description || ''}
                              onChange={e => setConfig(c => c && c.dataset ? { ...c, dataset: { ...c.dataset, description: e.target.value } } : c)}
                              className="w-full bg-transparent outline-none text-[11px] mt-0.5"
                              style={{ color: C.muted }}
                              placeholder="Describe this dataset for students"
                            />
                            <div className="flex items-center gap-2 mt-2">
                              <LinkIcon className="w-3 h-3 flex-shrink-0" style={{ color: C.faint }} />
                              <input
                                value={dataset.url || ''}
                                onChange={e => setConfig(c => c && c.dataset ? { ...c, dataset: { ...c.dataset, url: e.target.value || undefined } } : c)}
                                className="flex-1 min-w-0 bg-transparent outline-none text-[11px]"
                                style={{ color: C.muted }}
                                placeholder="Optional link shown to students instead of/alongside the file"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => datasetReplaceRef.current?.click()} disabled={uploadingDatasetReplace}
                          className="flex items-center gap-2 text-[12px] font-semibold hover:opacity-70 transition-opacity" style={{ color: C.cta }}>
                          {uploadingDatasetReplace ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          {uploadingDatasetReplace ? 'Uploading...' : 'Attach a dataset'}
                        </button>
                      )}
                    </div>
                    </div>
                </div>
                </div>)}
                {activeSection === 'brief' && (
                <div className="space-y-4">

                {/* Manager brief card */}
                <div style={card} className="space-y-3">
                  <h3 className="text-base font-semibold" style={{ color: C.text }}>Manager</h3>
                  {/* Header strip */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: C.input }}>
                    <div style={{ width: 32, height: 32, borderRadius: 999, overflow: 'hidden', background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.text, flexShrink: 0 }}>
                      {managerPhoto ? <img src={managerPhoto} alt={managerName} className="w-full h-full object-cover" /> : managerInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: C.text }}>{managerName} <span className="font-normal" style={{ color: C.muted }}>| {managerTitle}</span></p>
                      <p className="text-[11px]" style={{ color: C.faint }}>To: New {config.role}, Your Brief</p>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>Onboarding</span>
                  </div>

                  {/* Editable fields */}
                  <div className="pt-4 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <div className="flex items-end justify-between gap-3 mb-2">
                        <div>
                          <label className="text-xs font-semibold block" style={{ color: C.muted }}>Experience guide</label>
                          <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Choose the professional learners will hear from throughout this experience.</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button type="button" onClick={() => setShowGuideManager(v => !v)}
                            className={btnSmClass} style={btnStyle('sec', C)}>Manage profiles</button>
                          <button type="button" onClick={() => { setEditingGuideId(null); setGuideDraft(emptyGuideDraft); setShowGuideForm(true); setGuideError(''); }}
                            className={btnSmClass} style={btnStyle('sec', C)}>
                            <Plus className="w-3.5 h-3.5" /> Add professional
                          </button>
                        </div>
                      </div>
                      {(() => {
                        // External professionals (archived ones only while still chosen), then instructors.
                        const shown = experienceGuides.filter(g => g.source_type === 'instructor' || g.status !== 'archived' || g.id === config.guideId);
                        const options = [
                          { value: '', label: guidesLoading ? 'Loading profiles...' : 'Default generated manager' },
                          ...shown.filter(g => g.source_type === 'external').map(g => ({ value: g.id as string, label: `${g.full_name}${g.professional_title ? `, ${g.professional_title}` : ''}${g.status === 'archived' ? ' (Archived)' : ''}` })),
                          ...shown.filter(g => g.source_type === 'instructor').map(g => ({ value: g.id as string, label: `${g.full_name} (Instructor)` })),
                        ];
                        return <MenuSelect field label="Experience guide" value={config.guideId || ''} C={C} options={options} disabled={guidesLoading} onChange={selectExperienceGuide} />;
                      })()}
                      {guideError && !showGuideForm && <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>
                        <span>{guideError}</span>
                        <button type="button" disabled={guidesLoading || !sessionToken} onClick={() => loadExperienceGuides(sessionToken)} className="font-bold underline underline-offset-2">Retry</button>
                      </div>}
                    </div>

                    {showGuideManager && <div className="sm:col-span-2 rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.divider}` }}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.card }}>
                        <div>
                          <p className="text-sm font-bold" style={{ color: C.text }}>Experience guide profiles</p>
                          <p className="text-[11px]" style={{ color: C.faint }}>External profiles are editable. Instructor identities stay linked to their accounts.</p>
                        </div>
                        <button type="button" onClick={() => setShowGuideManager(false)} style={{ color: C.faint }}><X className="w-4 h-4" /></button>
                      </div>
                      <div>
                        {experienceGuides.filter(g => g.source_type === 'external').length === 0 && <p className="px-4 py-5 text-[12px]" style={{ color: C.muted }}>No external professionals yet. Use Add professional to create one.</p>}
                        {experienceGuides.filter(g => g.source_type === 'external').map(g => <div key={g.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${C.divider}`, opacity: g.status === 'archived' ? 0.6 : 1 }}>
                          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                            {g.profile_photo_url ? <img src={g.profile_photo_url} alt={g.full_name} className="w-full h-full object-cover" /> : g.full_name.split(/\s+/).map((x: string) => x[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: C.text }}>{g.full_name}</p>
                            <p className="text-[11px] truncate" style={{ color: C.muted }}>{[g.professional_title, g.company].filter(Boolean).join(', ') || 'Professional profile'}</p>
                          </div>
                          {g.status === 'archived' && <span className="text-xs font-semibold" style={{ color: C.muted }}>Archived</span>}
                          <button type="button" onClick={() => beginEditGuide(g)} className="text-[11px] font-bold px-3 py-2 rounded-lg" style={{ color: C.cta, background: `${C.cta}10` }}>Edit</button>
                          <button type="button" onClick={() => setGuideStatus(g, g.status === 'archived' ? 'active' : 'archived')} className="text-[11px] font-semibold px-3 py-2 rounded-lg" style={{ color: C.muted, background: C.pill }}>{g.status === 'archived' ? 'Restore' : 'Archive'}</button>
                        </div>)}
                        {experienceGuides.filter(g => g.source_type === 'instructor').map(g => <div key={g.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${C.divider}` }}>
                          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                            {g.profile_photo_url ? <img src={g.profile_photo_url} alt={g.full_name} className="w-full h-full object-cover" /> : g.full_name.split(/\s+/).map((x: string) => x[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0"><p className="text-sm font-bold" style={{ color: C.text }}>{g.full_name}</p><p className="text-[11px]" style={{ color: C.muted }}>Instructor | Linked account</p></div>
                          <span className="text-xs font-semibold" style={{ color: C.cta }}>Synced</span>
                        </div>)}
                      </div>
                    </div>}

                    {showGuideForm && <div className="sm:col-span-2 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr] gap-3" style={{ background: C.card, border: `1px solid ${C.divider}` }}>
                      <div className="sm:row-span-2 flex flex-col items-center gap-2">
                        <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center font-bold" style={{ background: C.pill, color: C.muted }}>
                          {guideDraft.profile_photo_url ? <img src={guideDraft.profile_photo_url} alt="Professional preview" className="w-full h-full object-cover" /> : (guideDraft.full_name || 'Guide').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <input ref={guidePhotoRef} type="file" accept="image/*" className="hidden" onChange={e => uploadGuidePhoto(e.target.files?.[0])} />
                        <button type="button" disabled={savingGuide} onClick={() => guidePhotoRef.current?.click()} className="text-[11px] font-bold" style={{ color: C.cta }}>{guideDraft.profile_photo_url ? 'Change photo' : 'Upload photo'}</button>
                      </div>
                      <input value={guideDraft.full_name} onChange={e => setGuideDraft(d => ({ ...d, full_name: e.target.value }))} style={{ ...inp, fontSize: 14 }} placeholder="Full name" />
                      <input value={guideDraft.professional_title} onChange={e => setGuideDraft(d => ({ ...d, professional_title: e.target.value }))} style={{ ...inp, fontSize: 14 }} placeholder="Professional title" />
                      <input value={guideDraft.company} onChange={e => setGuideDraft(d => ({ ...d, company: e.target.value }))} style={{ ...inp, fontSize: 14 }} placeholder="Company (optional)" />
                      <input value={guideDraft.linkedin_url} onChange={e => setGuideDraft(d => ({ ...d, linkedin_url: e.target.value }))} style={{ ...inp, fontSize: 14 }} placeholder="LinkedIn profile URL" />
                      <textarea value={guideDraft.bio} onChange={e => setGuideDraft(d => ({ ...d, bio: e.target.value }))} rows={3} className="sm:col-start-2 sm:col-span-2" style={{ ...inp, fontSize: 14, resize: 'vertical' }} placeholder="Short professional bio" />
                      <input value={guideDraft.expertise} onChange={e => setGuideDraft(d => ({ ...d, expertise: e.target.value }))} className="sm:col-start-2 sm:col-span-2" style={{ ...inp, fontSize: 14 }} placeholder="Areas of expertise, separated by commas" />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setShowGuideForm(false); setEditingGuideId(null); setGuideDraft(emptyGuideDraft); }} className="px-3 py-2 rounded-xl text-[12px] font-semibold" style={{ color: C.muted }}>Cancel</button>
                        <button type="button" disabled={savingGuide} onClick={editingGuideId ? updateExperienceGuide : createExperienceGuide} className="px-3 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50" style={{ background: C.cta }}>{savingGuide ? 'Saving' : editingGuideId ? 'Update profile' : 'Save profile'}</button>
                      </div>
                      {guideError && <p className="sm:col-start-2 sm:col-span-2 text-[11px] text-red-500">{guideError}</p>}
                      <label className="sm:col-start-2 sm:col-span-2 flex items-start gap-2 text-[11px] cursor-pointer" style={{ color: C.muted }}>
                        <input type="checkbox" checked={guideDraft.consent_confirmed} onChange={e => setGuideDraft(d => ({ ...d, consent_confirmed: e.target.checked }))} className="mt-0.5 accent-emerald-500" />
                        <span>I confirm I have permission to use this person&apos;s name and profile photo in learner-facing experiences.</span>
                      </label>
                    </div>}
                    <div>
                      <label className="text-xs font-semibold block mb-1" style={{ color: C.muted }}>Manager name</label>
                      <input value={config.managerName || ''} onChange={e => setConfig(c => c ? { ...c, managerName: e.target.value, guideId: null, guideSnapshot: null } : c)}
                        style={{ ...inp, fontSize: 14 }} placeholder="e.g. Amara Diallo" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1" style={{ color: C.muted }}>Manager title</label>
                      <input value={config.managerTitle || ''} onChange={e => setConfig(c => c ? { ...c, managerTitle: e.target.value, guideId: null, guideSnapshot: null } : c)}
                        style={{ ...inp, fontSize: 14 }} placeholder="e.g. Head of Analytics" />
                    </div>
                  </div>

                </div>

                {/* Scenario / background */}
                <div style={card} className="space-y-3">
                  <div className="pb-1">
                    <label className="text-base font-semibold block mb-3" style={{ color: C.text }}>Scenario</label>
                    <AiTextarea
                      value={backgroundDraft}
                      onValueChange={text => {
                        setBackgroundDraft(text);
                        const html = text
                          .split(/\n\n+/)
                          .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
                          .join('');
                        setConfig(c => c ? { ...c, background: html } : c);
                      }}
                      rows={5}
                      style={{ ...inp, fontSize: 14, resize: 'vertical', lineHeight: 1.6 } as React.CSSProperties}
                      placeholder="Describe the company scenario and the problem the student needs to solve"
                    />
                  </div>
                </div>

                {/* Learning outcomes card */}
                <div style={card} className="p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold" style={{ color: C.text }}>Learning outcomes</h3><span className="text-xs" style={{ color: C.muted }}>{(config.learnOutcomes || []).length} outcomes</span></div>
                    <div className="space-y-2">
                      {(config.learnOutcomes || []).map((o, i) => (
                        <div key={i} className="ve-shell flex items-center gap-2 rounded-[10px] px-3 py-3" style={{ background: C.input }}>
                          <input value={o} onChange={e => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.map((x, j) => j === i ? e.target.value : x) } : c)}
                            ref={el => { if (el && focusOutcome === i) { el.focus(); setFocusOutcome(null); } }}
                            aria-label={`Learning outcome ${i + 1}`} placeholder="Describe what the learner will be able to do (empty rows are not saved)"
                            className="flex-1 bg-transparent text-[14px] outline-none" style={{ color: C.text }} />
                          <button type="button" onClick={() => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.filter((_, j) => j !== i) } : c)}
                            aria-label={`Remove learning outcome ${i + 1}`} className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div><button type="button" onClick={() => { setFocusOutcome((config.learnOutcomes || []).length); setConfig(c => c ? { ...c, learnOutcomes: [...(c.learnOutcomes||[]), ''] } : c); }}
                      className={btnSmClass} style={btnStyle('sec', C)}>
                      <Plus className="w-3.5 h-3.5" /> Add outcome
                    </button></div>
                </div>
                </div>)}
                {activeSection === 'curriculum' && (
                <div className="space-y-4">

                {/* Outline: milestones as headings, missions and tasks as rows */}
                <div>
                  <div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
                    <SortableContext items={(config.modules || []).map(m => m.id)} strategy={verticalListSortingStrategy}>
                    {(config.modules || []).map((mod, mi) => {
                      return (
                      <SortableVEShell key={mod.id} id={mod.id}>
                        {({ dragHandle: moduleDragHandle }) => (
                        // Each milestone is its own outlined card, so milestones stay apart even with
                        // every mission folded.
                        <div className="group rounded-2xl p-3 sm:p-4" style={{ border: `1px solid ${C.divider}`, marginTop: mi > 0 ? 12 : 0 }}>

                          {/* Milestone heading */}
                          <div className={`flex items-center gap-2 ${foldedMilestones.has(mod.id) ? '' : 'mb-2'}`}>
                            <div className="flex-shrink-0" title="Drag to reorder milestone">{moduleDragHandle}</div>
                            <button type="button" onClick={() => toggleMilestone(mod.id)} aria-expanded={!foldedMilestones.has(mod.id)}
                              aria-label={foldedMilestones.has(mod.id) ? `Open milestone ${mi + 1}` : `Fold milestone ${mi + 1}`}
                              className="flex-shrink-0" style={{ color: C.muted }}>
                              {foldedMilestones.has(mod.id) ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: C.faint }}>Milestone {mi + 1}</span>
                            <input
                              value={mod.title}
                              onChange={e => updateModule(mod.id, { title: e.target.value })}
                              aria-label={`Milestone ${mi + 1} title`}
                              className="flex-1 bg-transparent text-base font-semibold outline-none min-w-0 rounded-lg px-2 -mx-2 py-1"
                              style={{ color: C.text }}
                              placeholder="Milestone title"
                            />
                            {foldedMilestones.has(mod.id) && (
                              <span className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: C.muted }}>
                                {(mod.lessons || []).length} mission{(mod.lessons || []).length === 1 ? '' : 's'}
                              </span>
                            )}
                            <RowMenu C={C} label={`Milestone ${mi + 1} options`} onDelete={() => removeModule(mod.id)} />
                          </div>

                          {/* Missions: each a soft grey row, open or folded, so they read as separate items */}
                          {!foldedMilestones.has(mod.id) && (
                          <div className="space-y-2">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd(mod.id)}>
                            <SortableContext items={(mod.lessons || []).map(l => l.id)} strategy={verticalListSortingStrategy}>
                            {(mod.lessons || []).map((les, li) => {
                              const reqCount  = les.requirements?.length || 0;
                              const expandKey = `${mod.id}-${les.id}`;
                              return (
                              <SortableVEShell key={les.id} id={les.id}>
                                {({ dragHandle: lessonDragHandle }) => (
                                <div className="rounded-xl group" style={{ background: C.page }}>

                                  {/* Mission row: open it to edit the content and tasks */}
                                  <div className="flex items-center gap-2 px-2 py-2">
                                    <div className="flex-shrink-0" title="Drag to reorder mission">{lessonDragHandle}</div>
                                    <button type="button" onClick={() => toggleModule(expandKey)} aria-expanded={expandedModules.has(expandKey)}
                                      aria-label={expandedModules.has(expandKey) ? 'Close mission' : 'Open mission'}
                                      className="flex items-center gap-2 flex-shrink-0" style={{ color: C.muted }}>
                                      {expandedModules.has(expandKey) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold"
                                        style={{ background: P.sel, color: P.onSel }}>{li + 1}</span>
                                    </button>
                                    <input
                                      value={les.title}
                                      onChange={e => updateLesson(mod.id, les.id, { title: e.target.value })}
                                      aria-label={`Mission ${li + 1} title`}
                                      className="flex-1 bg-transparent text-[14px] font-semibold outline-none min-w-0 py-1 rounded-lg px-2 -mx-1"
                                      style={{ color: C.text }}
                                      placeholder="Mission title"
                                    />
                                    <button type="button" onClick={() => toggleModule(expandKey)}
                                      className="hidden sm:block text-xs whitespace-nowrap flex-shrink-0 transition-opacity hover:opacity-70" style={{ color: C.muted }}>
                                      {reqCount} task{reqCount !== 1 ? 's' : ''}
                                    </button>
                                    <RowMenu C={C} label={`Mission ${li + 1} options`} onDelete={() => removeLesson(mod.id, les.id)}
                                      moveTargets={(config.modules || []).filter(m => m.id !== mod.id).map(m => ({ label: m.title, onPick: () => moveLessonToModule(mod.id, les.id, m.id) }))} />
                                  </div>

                                  {/* Open: mission content, media and tasks */}
                                  {expandedModules.has(expandKey) && (
                                    <div className="px-3 pb-3 space-y-3">
                                      <div className="pt-1">
                                        <LessonEditor
                                          key={les.id}
                                          doc={les.doc}
                                          bodyFallback={les.body}
                                          onChange={({ doc, body }) => updateLesson(mod.id, les.id, { doc, body })}
                                          placeholder="Write the mission content here. What should the student read, understand, or do?"
                                          isDark={C.page === DARK_C.page}
                                          accentColor={experienceAccent}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input style={{ ...inp, fontSize: 14, flex: 1, background: C.card }} value={les.videoUrl || ''} placeholder="Video link (YouTube, Vimeo, Bunny or Canva)"
                                          aria-label="Video link" onChange={e => updateLesson(mod.id, les.id, { videoUrl: e.target.value })} />
                                        <button type="button" onClick={() => setBunnyTarget(`${mod.id}::${les.id}`)}
                                          title="Choose a video from the Bunny library"
                                          className={btnSmClass} style={btnStyle('sec', C)}>
                                          <Video className="w-3.5 h-3.5"/> Bunny
                                        </button>
                                        {/* Interactive HTML embed: uploads to the public form-assets bucket; the
                                            players render it sandboxed at full height (same treatment as Canva) */}
                                        <label className="cursor-pointer flex-shrink-0" title="Upload a self-contained HTML file with inline assets (max 10 MB)">
                                          <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={async e => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            e.target.value = '';
                                            if (file.size > 10 * 1024 * 1024) { alert(`HTML file is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 10 MB.`); return; }
                                            try {
                                              const url = await uploadToStorage(file, 'lesson-html');
                                              updateLesson(mod.id, les.id, { videoUrl: url });
                                            } catch (err: any) { alert('Upload failed: ' + (err?.message || 'Please try again.')); }
                                          }} />
                                          <div className={btnSmClass} style={btnStyle('sec', C)}>
                                            <Upload className="w-3.5 h-3.5"/> HTML
                                          </div>
                                        </label>
                                      </div>
                                      {(() => {
                                        const embedUrl = safeEmbedUrl(les.videoUrl || '');
                                        return embedUrl ? (
                                          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.inputBorder}` }}>
                                            <iframe src={embedUrl} className={isHtmlEmbedUrl(embedUrl) ? 'w-full' : 'w-full aspect-video'} style={isHtmlEmbedUrl(embedUrl) ? { height: 480 } : undefined} sandbox={isHtmlEmbedUrl(embedUrl) ? HTML_EMBED_SANDBOX : undefined} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                                          </div>
                                        ) : null;
                                      })()}

                                      {/* Tasks */}
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold" style={{ color: C.muted }}>Tasks</span>
                                          <div className="flex-1 h-px" style={{ background: C.divider }}/>
                                        </div>
                                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReqDragEnd(mod.id, les.id)}>
                                        <SortableContext items={les.requirements.map(r => r.id)} strategy={verticalListSortingStrategy}>
                                        {les.requirements.map((req, qi) => {
                                          return (
                                            <SortableVEShell key={req.id} id={req.id}>
                                            {({ dragHandle: reqDragHandle }) => (
                                            <div className={`rounded-[10px] group ${openReqs.has(req.id) ? 'p-3 space-y-3' : 'px-2 py-1'}`} style={{ background: C.card }}>
                                              <div className="flex items-center gap-2">
                                                {reqDragHandle}
                                                {/* The row: type and title. Open it to edit the task. A task with no title
                                                    says so, since learners see the title as the task's heading. */}
                                                <button type="button" onClick={() => toggleReqOpen(req.id)} aria-expanded={openReqs.has(req.id)}
                                                  title={openReqs.has(req.id) ? 'Close this task' : 'Open this task to edit it'}
                                                  className="flex flex-1 min-w-0 items-center gap-2 py-2 text-left">
                                                  {openReqs.has(req.id) ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: C.muted }} /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" style={{ color: C.muted }} />}
                                                  <span className="flex-shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ background: C.input, color: C.muted }}>
                                                    {REQ_TYPE_NAMES[req.type] || 'Task'}
                                                  </span>
                                                  {req.label.trim()
                                                    ? <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: C.text }}>{req.label}</span>
                                                    : <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: '#b45309' }}>No title yet</span>}
                                                </button>
                                                {req.emailFrame && !openReqs.has(req.id) && (
                                                  <span className="hidden sm:inline-flex flex-shrink-0 items-center gap-1 text-xs font-semibold" style={{ color: C.cta }}>
                                                    <Mail className="w-3 h-3" /> Email
                                                  </span>
                                                )}
                                                <RowMenu C={C} label={`Task ${qi + 1} options`} onDelete={() => removeReq(mod.id, les.id, req.id)}
                                                  moveTargets={(config.modules || []).flatMap(m => (m.lessons || [])
                                                    .filter(l => !(m.id === mod.id && l.id === les.id))
                                                    .map(l => ({ group: m.title, label: l.title, onPick: () => moveReqToLesson(mod.id, les.id, req.id, m.id, l.id) })))} />
                                              </div>
                                              {openReqs.has(req.id) && (
                                                <TaskEditor req={req} C={C} inp={inp} sessionToken={sessionToken} accent={experienceAccent}
                                                  requestRichTextImage={requestRichTextImage}
                                                  update={updates => updateReq(mod.id, les.id, req.id, updates)} />
                                              )}
                                            </div>
                                            )}
                                            </SortableVEShell>
                                          );
                                        })}
                                        </SortableContext>
                                        </DndContext>
                                        <div><button type="button" onClick={() => addReq(mod.id, les.id)} className={btnSmClass} style={btnStyle('sec', C)}>
                                          <Plus className="w-3.5 h-3.5" /> Add task
                                        </button></div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                )}
                              </SortableVEShell>
                              );
                            })}
                            </SortableContext>
                            </DndContext>

                            {/* Add mission, then the milestone's optional solution link */}
                            <div className="space-y-2 pt-2">
                              <div><button type="button" onClick={() => addLesson(mod.id)} className={btnSmClass} style={btnStyle('sec', C)}>
                                <Plus className="w-3.5 h-3.5" /> Add mission
                              </button></div>
                              <div className="ve-shell flex items-center gap-2 px-3 rounded-[10px]" style={{ background: C.input }}>
                                <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }} />
                                <input
                                  value={mod.solutionVideo || ''}
                                  onChange={e => updateModule(mod.id, { solutionVideo: e.target.value })}
                                  aria-label={`Solution video or file for ${mod.title || 'this milestone'}`}
                                  className="flex-1 min-w-0 bg-transparent py-3 text-sm outline-none"
                                  style={{ color: C.text }}
                                  placeholder="Solution video or file link for this milestone (optional)" />
                              </div>
                            </div>
                          </div>
                          )}
                        </div>
                        )}
                      </SortableVEShell>
                      );
                    })}
                    </SortableContext>
                    </DndContext>
                  </div>
                  <div className="pt-4"><button type="button" onClick={addModule} className={btnSmClass} style={btnStyle('sec', C)}>
                    <Plus className="w-3.5 h-3.5" /> Add milestone
                  </button></div>
                </div>
                </div>)}
                {activeSection === 'overview' && (
                <div className="space-y-4">

                {/* The experience: industry, level and duration */}
                <div style={card} className="space-y-4">
                  <h3 className="text-base font-semibold" style={{ color: C.text }}>The experience</h3>
                  <div>
                    <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Industry</label>
                    <div className="flex flex-wrap gap-2">
                      {[...INDUSTRIES, { id: 'other', label: 'Other' }].map(ind => {
                        const selected = industry === ind.id;
                        return (
                          <button key={ind.id} type="button" aria-pressed={selected}
                            onClick={() => { setIndustry(ind.id); setConfig(c => c ? { ...c, industry: ind.id === 'other' ? (customIndustry.trim() || 'other') : ind.id } : c); }}
                            className="rounded-full px-3 py-2 text-sm font-semibold transition-colors"
                            style={selected ? { background: P.sel, color: P.onSel } : { background: C.input, color: C.text }}>
                            {ind.label}
                          </button>
                        );
                      })}
                    </div>
                    {industry === 'other' && (
                      <input type="text" value={customIndustry}
                        onChange={e => { setCustomIndustry(e.target.value); setConfig(c => c ? { ...c, industry: e.target.value } : c); }}
                        placeholder="e.g. Logistics, Agriculture, Real Estate" aria-label="Industry"
                        className="mt-2" style={inp} autoFocus />
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                    <div>
                      <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Level</label>
                      <div className="inline-flex rounded-[10px] p-[3px]" style={{ background: C.input }}>
                        {([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] as const).map(([id, label]) => {
                          const selected = (config.difficulty || 'intermediate') === id;
                          return (
                            <button key={id} type="button" aria-pressed={selected} onClick={() => setConfig(c => c ? { ...c, difficulty: id } : c)}
                              className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                              style={selected ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[12px] mt-2" style={{ color: C.faint }}>Shown on the experience page. It does not change the content.</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>Duration</label>
                      <input value={config.duration || ''} onChange={e => setConfig(c => c ? { ...c, duration: e.target.value } : c)}
                        style={inp} placeholder="e.g. 3 weeks" />
                      <p className="text-[12px] mt-2" style={{ color: C.faint }}>How long it takes to complete.</p>
                    </div>
                  </div>
                </div>
                </div>)}
                {activeSection === 'overview' && (
                <div className="space-y-4">


                {/* Look: accent, cover and badge. The accent is chosen as a course's is: a theme colour or a
                    custom one. Unset keeps the default green. */}
                <div style={{ ...card, paddingBottom: 12 }} className="space-y-3">
                  <h3 className="text-base font-semibold" style={{ color: C.text }}>Look</h3>
                  <p className="text-xs font-semibold" style={{ color: C.muted }}>Accent colour</p>
                  <div className="flex flex-wrap items-start gap-4">
                    {(Object.entries(THEME_ACCENT_COLORS) as [ThemeColor, string][]).map(([key, color]) => {
                      const selected = config.theme === key && !config.customAccent;
                      return (
                        <button key={key} type="button" onClick={() => setConfig(c => c ? { ...c, theme: key, customAccent: undefined } : c)}
                          aria-pressed={selected} title={key[0].toUpperCase() + key.slice(1)} className="flex flex-col items-center gap-2 group">
                          <span className={`h-7 w-7 rounded-full transition-transform group-hover:scale-110 ${selected ? 'scale-110' : ''}`}
                            style={{ background: color, boxShadow: selected ? `0 0 0 2.5px ${C.card}, 0 0 0 4.5px ${color}` : undefined }} />
                          <span className="text-[11px] capitalize" style={{ color: C.faint }}>{key}</span>
                        </button>
                      );
                    })}
                    <label title="Custom color" className="flex flex-col items-center gap-2 group cursor-pointer">
                      <span className={`relative grid h-7 w-7 place-items-center rounded-full transition-transform group-hover:scale-110 ${config.customAccent ? 'scale-110' : ''}`}
                        style={{
                          background: config.customAccent ?? 'conic-gradient(from 90deg, #f43f5e, #f59e0b, #a3e635, #10b981, #06b6d4, #3b82f6, #ec4899, #f43f5e)',
                          boxShadow: config.customAccent ? `0 0 0 2.5px ${C.card}, 0 0 0 4.5px ${config.customAccent}` : undefined,
                        }}>
                        {!config.customAccent && <span className="pointer-events-none grid h-[18px] w-[18px] place-items-center rounded-full" style={{ background: C.card, color: C.faint }}><Plus className="h-2.5 w-2.5" /></span>}
                        <input type="color" aria-label="Choose a custom accent color" value={config.customAccent ?? experienceAccent}
                          onChange={e => setConfig(c => c ? { ...c, customAccent: e.target.value } : c)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                      </span>
                      <span className="text-[11px]" style={{ color: C.faint }}>Custom</span>
                    </label>
                  </div>
                  <p className="text-[11px]" style={{ color: C.faint }}>Used for buttons, highlights and progress across the experience. Pale colours are darkened just enough to stay readable.</p>
                </div>

                {/* Cover image card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5">
                <div id="ve-cover-image" className="space-y-2 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: C.muted }}>Cover image</p>
                  {coverImage && (
                    <img src={resolveCoverUrl(coverImage)} alt="cover" className="w-full object-cover rounded-xl"
                      style={{ height: 180 }} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                  )}
                  {!coverImage && (
                    <button type="button" onClick={() => coverRef.current?.click()}
                      className="w-full min-h-28 rounded-xl flex flex-col items-center justify-center gap-2 transition-opacity hover:opacity-75"
                      style={{ background: C.input, border: `1px dashed ${C.inputBorder}`, color: C.muted }}>
                      <Images className="w-6 h-6" />
                      <span className="text-sm font-semibold">Upload or choose a cover image</span>
                      <span className="text-[11px]" style={{ color: C.faint }}>Recommended 16:9 landscape image</span>
                    </button>
                  )}
                  <div className="flex gap-2">
                    <input style={{ ...inp, fontSize: 14 }} value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="Or paste an image link" aria-label="Cover image link" />
                    <button type="button" onClick={() => coverRef.current?.click()} disabled={uploadingCover} title="Upload a cover image" aria-label="Upload a cover image"
                      className={`${btnClass} flex-shrink-0`} style={btnStyle('sec', C)}>
                      {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library" aria-label="Select from library"
                      className={`${btnClass} flex-shrink-0`} style={btnStyle('sec', C)}>
                      <Images className="w-4 h-4" />
                    </button>
                  </div>
                  <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                  {showCoverLibrary && (
                    <ImageLibrary
                      uploadFolder="covers"
                      initialFolder="covers"
                      returnPublicId
                      onSelect={ref => { setCoverImage(ref); setConfig(c => c ? { ...c, coverImage: ref } : c); }}
                      onClose={() => setShowCoverLibrary(false)}
                    />
                  )}
                </div>

                {/* Completion badge */}
                <div className="space-y-2 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: C.muted }}>Completion badge</p>
                  <p className="text-[12px] leading-relaxed" style={{ color: C.faint }}>Earned on completing the experience, alongside the certificate.</p>
                  {config?.badgeImageUrl && (
                    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.input }}>
                      <img src={config.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0"
                        style={{ border: `1px solid ${C.inputBorder}`, background: C.input }}/>
                      <button onClick={() => setConfig(c => c ? { ...c, badgeImageUrl: null } : c)}
                        className="text-xs px-3 py-2 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge} className={btnClass} style={btnStyle('sec', C)}>
                      {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {uploadingBadge ? 'Uploading...' : config?.badgeImageUrl ? 'Change badge' : 'Upload badge'}
                    </button>
                  </div>
                  <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeUpload} />
                </div>
                </div>
                <div className="pb-5">
                  <CoverVideoField value={config?.coverVideo} onChange={coverVideo => setConfig(c => c ? { ...c, coverVideo } : c)} noun="experience" />
                </div>
                </div>)}
                {activeSection === 'delivery' && (
                  <PublishStep C={C} card={card} inp={inp} experienceId={effectiveId}
                    availableToEveryone={availableToEveryone} setAvailableToEveryone={setAvailableToEveryone}
                    cohorts={cohorts} selectedCohorts={selectedCohorts} setSelectedCohorts={setSelectedCohorts}
                    deadlineDays={deadlineDays} setDeadlineDays={setDeadlineDays} />
                )}

                </motion.div>
                </AnimatePresence>
              </Card>
          </div>
          );
        })()}

      {/* Image library for rich text, and the Bunny video picker */}
      <AnimatePresence>
        {richTextImageLibraryOpen && (
          <ImageLibrary
            uploadFolder="ve-email-images"
            initialFolder="ve-email-images"
            onSelect={url => resolveRichTextImage(url)}
            onClose={() => resolveRichTextImage(null)}
          />
        )}
        {bunnyTarget && (
          <BunnyPicker key="bunny" C={C} onClose={() => setBunnyTarget(null)}
            onPick={embedUrl => {
              const [modId, lesId] = bunnyTarget.split('::');
              updateLesson(modId, lesId, { videoUrl: embedUrl });
              setBunnyTarget(null);
            }} />
        )}
      </AnimatePresence>

      </div>
    </div>
  );
}

export default function VirtualExperienceCreatePage() {
  return (
    <Suspense fallback={null}>
      <VirtualExperienceCreatePageInner />
    </Suspense>
  );
}
