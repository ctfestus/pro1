'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary, uploadCoverImage } from '@/lib/uploadToCloudinary';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ImageLibrary } from '@/components/ImageLibrary';
import type { LessonDoc } from '@/lib/lesson-doc';
import { safeEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { clampLinkedInSharePoints, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';
import { validateVirtualExperienceForPublish } from '@/lib/virtual-experience-validation';
import { useTheme } from '@/components/ThemeProvider';
import {
  ArrowLeft, Sparkles, Loader2, Save, ChevronDown, ChevronRight, ChevronLeft,
  Plus, Trash2, X, Check, Upload, Pencil, Star, Clock, Download,
  Link as LinkIcon, FileText, FileCode, Database, PenLine, Table, GripVertical, Video, Search, Eye, Images, Paperclip, Mail,
  Blocks, Building2, MessageSquareText, Workflow, Palette, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RichTextEditor } from '@/components/RichTextEditor';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableVEShell({ id, children }: {
  id: string;
  children: (bag: { dragHandle: React.ReactNode; isDragging: boolean }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? {
      opacity: 0.85,
      boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
      borderRadius: 14,
      zIndex: 50,
      position: 'relative',
      outline: '2px solid rgba(173,238,102,0.7)',
    } : {}),
  };
  const dragHandle = (
    <button type="button" {...attributes} {...listeners}
      className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ color: '#888' }}>
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );
  return <div ref={setNodeRef} style={style}>{children({ dragHandle, isDragging })}</div>;
}
import { LessonEditor } from '@/components/lesson/LessonEditor';
import { AiTextarea } from '@/components/AiTextarea';
import { lessonHtmlToDoc } from '@/components/lesson/extensions';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// Convert AI-generated lesson bodies (HTML) into canonical interactive docs so VE
// lessons stay doc-canonical, matching the course generate_lesson flow. The HTML
// `body` is kept as the lossy fallback. Runs client-side (generateJSON needs a DOM).
function attachLessonDocs<T extends { modules?: unknown[] }>(cfg: T): T {
  if (!cfg?.modules) return cfg;
  return {
    ...cfg,
    modules: (cfg.modules as any[]).map((m: any) => ({
      ...m,
      lessons: Array.isArray(m?.lessons)
        ? m.lessons.map((l: any) => {
            if (!l?.body) return l;
            try { return { ...l, doc: lessonHtmlToDoc(l.body) }; }
            catch { return l; } // keep body-only if the HTML cannot be parsed
          })
        : m?.lessons,
    })),
  };
}

// Like attachLessonDocs, but preserves the ORIGINAL interactive doc for any lesson the
// AI left unchanged (same id, same body). Used after "improve", which strips doc to
// body-only server-side -- rebuilding doc from the lossy HTML would otherwise destroy
// accordions / tabs / knowledge checks / runnable code on lessons the AI did not touch.
// Lessons the AI actually rewrote (body changed) are reconverted from the new body.
function preserveLessonDocs<T extends { modules?: unknown[] }>(cfg: T, prior: { modules?: any[] } | null | undefined): T {
  if (!cfg?.modules) return cfg;
  // Compare bodies ignoring whitespace so harmless reformatting by the AI is not
  // mistaken for a rewrite (which would trigger a lossy doc rebuild).
  const norm = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();
  const priorById = new Map<string, { body?: string; doc?: LessonDoc }>();
  (prior?.modules || []).forEach((m: any) => (m?.lessons || []).forEach((l: any) => {
    if (l?.id) priorById.set(l.id, { body: l.body, doc: l.doc });
  }));
  return {
    ...cfg,
    modules: (cfg.modules as any[]).map((m: any) => ({
      ...m,
      lessons: Array.isArray(m?.lessons)
        ? m.lessons.map((l: any) => {
            if (!l?.body) return l;
            const prev = l.id ? priorById.get(l.id) : undefined;
            if (prev?.doc && norm(prev.body) === norm(l.body)) return { ...l, doc: prev.doc };
            try { return { ...l, doc: lessonHtmlToDoc(l.body) }; }
            catch { return l; }
          })
        : m?.lessons,
    })),
  };
}

// Design tokens
const LIGHT_C = {
  page: '#F2F5FA', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.08)',
  cardShadow: '0 1px 4px rgba(0,0,0,0.06)', green: '#00bf63', lime: '#00bf63',
  cta: '#00bf63', ctaText: 'white', text: '#111', muted: '#555', faint: '#888',
  divider: 'rgba(0,0,0,0.07)', input: '#F8F8F8', pill: '#F2F4F2',
  nav: '#F2F5FA', navBorder: 'rgba(0,0,0,0.07)',
  modeBorder: 'rgba(0,0,0,0.09)',
};
const DARK_C = {
  page: '#17181E', card: '#1E1F26', cardBorder: 'rgba(255,255,255,0.07)',
  cardShadow: '0 1px 4px rgba(0,0,0,0.40)', green: '#00bf63', lime: '#00bf63',
  cta: '#00bf63', ctaText: 'white', text: '#f0f0f0', muted: '#aaa', faint: '#777',
  divider: 'rgba(255,255,255,0.07)', input: 'rgba(255,255,255,0.05)', pill: '#242630',
  nav: '#17181E', navBorder: 'rgba(255,255,255,0.07)',
  modeBorder: 'rgba(255,255,255,0.09)',
};
function useC() { const { theme } = useTheme(); return theme === 'dark' ? DARK_C : LIGHT_C; }

// Types
interface ReqAttachment { name: string; url: string; mimeType?: string; }
interface Requirement {
  id: string;
  label: string;
  description: string;
  type: 'task' | 'deliverable' | 'reflection' | 'mcq' | 'text' | 'upload' | 'briefing' | 'scenario_update' | 'decision' | 'debrief' | 'dashboard_critique' | 'code_review' | 'excel_review' | 'document_review' | 'linkedin_share';
  options?: string[];
  optionFeedback?: string[];
  correctAnswer?: string;
  expectedAnswer?: string;
  rubric?: string[];
  schema?: string;
  context?: string;
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  aiReview?: boolean;
  emailFrame?: boolean;
  emailBody?: string;
  attachments?: ReqAttachment[];
  sharePrompt?: string;   // linkedin_share: suggested post text the student can copy
  // linkedin_share: only an explicit `true` gates the lesson. Absent/false = optional, never blocks.
  shareRequired?: boolean;
  // linkedin_share: bonus XP, clamped server-side to 0..MAX_LINKEDIN_SHARE_POINTS. ABSENT MEANS 0,
  // not the default amount -- requirements authored before VE shares paid XP must stay at zero
  // rather than silently start offering a bonus nobody chose. The editor writes the default
  // explicitly for newly created share requirements.
  sharePoints?: number;
}
interface Lesson {
  id: string;
  title: string;
  body: string;           // sanitized HTML; lossy fallback when `doc` is present
  doc?: LessonDoc;        // canonical interactive-lesson content (TipTap/ProseMirror JSON)
  videoUrl?: string;
  requirements: Requirement[];
}
interface Module {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  solutionVideo?: string;
}
interface ProjectConfig {
  isVirtualExperience: true;
  industry: string;
  difficulty: string;
  role: string;
  company: string;
  duration: string;
  tools: string[];
  toolLogos?: Record<string, string>;
  tagline: string;
  description: string;
  background: string;
  coverImage: string;
  learnOutcomes: string[];
  modules: Module[];
  managerName?: string;
  managerTitle?: string;
  guideId?: string | null;
  guideSnapshot?: {
    fullName: string;
    professionalTitle?: string;
    company?: string;
    profilePhotoUrl?: string;
    linkedUserId?: string;
    sourceType?: 'external' | 'instructor';
    consentStatus?: 'pending' | 'confirmed' | 'not_required';
    bio?: string;
    linkedinUrl?: string;
    expertise?: string[];
  } | null;
  badgeImageUrl?: string | null;
  dataset?: { filename: string; description: string; csvContent?: string; url?: string };
}

const INDUSTRIES = [
  { id: 'fintech',    label: 'Fintech',    emoji: '💳', color: '#6366f1' },
  { id: 'marketing',  label: 'Marketing',  emoji: '📣', color: '#f59e0b' },
  { id: 'hr',         label: 'HR',         emoji: '👥', color: '#10b981' },
  { id: 'finance',    label: 'Finance',    emoji: '📊', color: '#3b82f6' },
  { id: 'edtech',     label: 'EdTech',     emoji: '🎓', color: '#8b5cf6' },
  { id: 'healthcare', label: 'Healthcare', emoji: '🏥', color: '#ef4444' },
  { id: 'ecommerce',  label: 'E-commerce', emoji: '🛒', color: '#f97316' },
  { id: 'consulting', label: 'Consulting', emoji: '🤝', color: '#14b8a6' },
];

// Carousel sections for the step-2 editor
const VE_SECTIONS = [
  { id: 'overview',   label: 'Overview', Icon: Blocks },
  { id: 'setup',      label: 'Setup', Icon: Building2 },
  { id: 'brief',      label: 'Brief', Icon: MessageSquareText },
  { id: 'curriculum', label: 'Curriculum', Icon: Workflow },
  { id: 'branding',   label: 'Branding', Icon: Palette },
  { id: 'delivery',   label: 'Publish', Icon: CheckCircle2 },
] as const;

function uid() { return Math.random().toString(36).slice(2, 10); }


function RubricBuilder({ criteria, onChange, C, inp, sessionToken }: {
  criteria: string[];
  onChange: (rubric: string[]) => void;
  C: typeof LIGHT_C;
  inp: React.CSSProperties;
  sessionToken?: string;
}) {
  const [draft, setDraft] = useState('');
  const [extracting, setExtracting] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const add = () => {
    const val = draft.trim();
    if (!val) return;
    onChange([...criteria, val]);
    setDraft('');
  };

  const handleFile = async (label: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionToken) return;
    setExtracting(label);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      const json = await res.json();
      if (res.ok && json.criteria?.length) {
        onChange([...criteria, ...json.criteria]);
      }
    } finally {
      setExtracting(null);
      e.target.value = '';
    }
  };

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'transparent' }}>
      <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>
        Grading Rubric
        <span className="ml-1.5 normal-case font-normal tracking-normal" style={{ color: C.faint }}>
          · optional · AI grades each criterion as Pass / Fail
        </span>
      </p>
      {sessionToken && (
        <div>
          <input type="file" accept=".xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.docx"
            style={{ display: 'none' }}
            ref={el => { fileRefs.current['reference_solution'] = el; }}
            onChange={e => handleFile('reference_solution', e)}
          />
          <button type="button" disabled={!!extracting}
            onClick={() => fileRefs.current['reference_solution']?.click()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-opacity"
            style={{ background: C.card, color: C.muted, border: `1px solid ${C.cardBorder}`, opacity: extracting ? 0.5 : 1, cursor: extracting ? 'not-allowed' : 'pointer' }}>
            {extracting === 'reference_solution'
              ? <><Loader2 className="w-3 h-3 animate-spin"/> Extracting...</>
              : <><Upload className="w-3 h-3"/> Upload Reference Solution</>}
          </button>
        </div>
      )}
      {criteria.map((crit, ci) => (
        <div key={ci} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
          style={{ background: C.pill }}>
          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: C.card }}>
            <span className="text-[9px] font-black" style={{ color: C.muted }}>{ci + 1}</span>
          </div>
          <input
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: C.text }}
            value={crit}
            onChange={e => { const next = [...criteria]; next[ci] = e.target.value; onChange(next); }}
          />
          <button onClick={() => onChange(criteria.filter((_, j) => j !== ci))}
            className="hover:text-red-400 flex-shrink-0 transition-colors" style={{ color: C.faint }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ ...inp, background: C.card, fontSize: 12, padding: '6px 10px' }}
          placeholder="e.g. Must include a KPI row with at least 3 metrics"
        />
        <button onClick={add} disabled={!draft.trim()}
          className="flex items-center gap-1 px-3 rounded-xl text-[12px] font-semibold flex-shrink-0 transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {criteria.length === 0 && (
        <p className="text-[11px]" style={{ color: C.faint }}>
          No criteria yet. AI will use its default standards. Add criteria to grade against your specific assignment requirements.
        </p>
      )}
    </div>
  );
}

// Page
function VirtualExperienceCreatePageInner() {
  const C = useC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  // Step 1 state
  const [creationMode, setCreationMode] = useState<'ai' | 'data' | 'manual' | null>(null);
  const [isShortCourse, setIsShortCourse] = useState(false);
  const [industry,    setIndustry]    = useState('fintech');
  const [customIndustry, setCustomIndustry] = useState('');
  const effectiveIndustry = industry === 'other' ? (customIndustry.trim() || 'other') : industry;
  const [difficulty,  setDifficulty]  = useState<'beginner'|'intermediate'|'advanced'>('intermediate');
  const [companyName,  setCompanyName]  = useState('');
  const [scenario,     setScenario]     = useState('');
  const [roleHint,     setRoleHint]     = useState('');
  const [focusTopic,   setFocusTopic]   = useState('');
  const [toolsInput,   setToolsInput]   = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [emailStyle,   setEmailStyle]   = useState(false);
  // Plain-text draft for the Scenario/Background textarea. Deriving the textarea's
  // `value` fresh from config.background on every render (via this same HTML<->text
  // conversion) reset the caret to the end on every keystroke, since React reassigns
  // a controlled input's DOM value whenever the prop is a newly computed string. This
  // draft is updated directly from the raw keystroke, decoupling display from storage.
  const [backgroundDraft, setBackgroundDraft] = useState('');
  const htmlToPlainText = (html: string) => (html || '').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState('');
  // Dataset state (shared across all modes)
  const [datasetCsv,      setDatasetCsv]      = useState('');
  const [datasetFilename, setDatasetFilename]  = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
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

  const [deadlineDays, setDeadlineDays] = useState<string>('');
  const [coverImage,  setCoverImage]  = useState('');
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [saveWarning, setSaveWarning] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);

  // AI improve state
  const [improveInstruction, setImproveInstruction] = useState('');
  const [improving,   setImproving]   = useState(false);
  const [showImprove, setShowImprove] = useState(false);

  const coverRef = useRef<HTMLInputElement>(null);
  const toolLogoRef = useRef<HTMLInputElement>(null);
  const [uploadingToolLogo, setUploadingToolLogo] = useState<string | null>(null); // tool name being uploaded

  const [veSlug, setVeSlug] = useState('');
  // After the first save of a brand-new experience the API returns its id. Keep it so further
  // saves update the same record (editId comes from the URL and stays null for a new VE).
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Bunny video picker
  const [bunnyPickerOpen,    setBunnyPickerOpen]    = useState(false);
  const [bunnyPickerTarget,  setBunnyPickerTarget]  = useState<string | null>(null); // "modId::lesId"
  const [bunnyVideos,        setBunnyVideos]        = useState<any[]>([]);
  const [bunnyCollections,   setBunnyCollections]   = useState<any[]>([]);
  const [bunnyCollection,    setBunnyCollection]    = useState('');
  const [bunnyLoading,       setBunnyLoading]       = useState(false);
  const [bunnySearch,        setBunnySearch]        = useState('');
  const [bunnyError,         setBunnyError]         = useState('');
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

  // Load cohorts + existing project if editing
  useEffect(() => {
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
          const cfg: any = {
            isVirtualExperience: true, modules: ve.modules ?? [], industry: ve.industry,
            difficulty: ve.difficulty, role: ve.role, company: ve.company, duration: ve.duration,
            tools: ve.tools, toolLogos: ve.tool_logos ?? {}, tagline: ve.tagline, background: ve.background,
            learnOutcomes: ve.learn_outcomes, managerName: ve.manager_name, managerTitle: ve.manager_title,
            guideId: ve.guide_id || (ve.guide_snapshot?.linkedUserId ? `instructor:${ve.guide_snapshot.linkedUserId}` : null), guideSnapshot: ve.guide_snapshot,
            dataset: ve.dataset, coverImage: ve.cover_image, deadline_days: ve.deadline_days,
            badgeImageUrl: ve.badge_image_url ?? null,
          };
          setTitle(ve.title || '');
          setCoverImage(cfg.coverImage || '');
          setSelectedCohorts(ve.cohort_ids || []);
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
          setIsShortCourse(!!(ve as any).is_short_course);
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
    const res = await fetch('/api/experience-guides', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ id: guide.id, status }),
    });
    const json = await res.json();
    if (!res.ok) { setGuideError(json.error || 'Could not update this profile.'); return; }
    setExperienceGuides(list => list.map(g => g.id === guide.id ? json.guide : g));
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

  const updateReq = (moduleId: string, lessonId: string, reqId: string, updates: Partial<Requirement>) => {
    setConfig(c => c ? {
      ...c,
      modules: c.modules.map(m => m.id !== moduleId ? m : {
        ...m,
        lessons: m.lessons.map(l => l.id !== lessonId ? l : {
          ...l,
          requirements: l.requirements.map(r => r.id !== reqId ? r : { ...r, ...updates }),
        }),
      }),
    } : c);
  };

  const addLesson = (moduleId: string) => {
    const lesson: Lesson = { id: `les-${uid()}`, title: 'New Mission', body: '<p>Mission content here.</p>', requirements: [] };
    updateModule(moduleId, { lessons: [...(config?.modules.find(m => m.id === moduleId)?.lessons ?? []), lesson] });
  };

  const removeLesson = (moduleId: string, lessonId: string) => {
    const m = config?.modules.find(m => m.id === moduleId);
    if (m) updateModule(moduleId, { lessons: m.lessons.filter(l => l.id !== lessonId) });
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
    setConfig(c => c ? { ...c, modules: c.modules.filter(m => m.id !== moduleId) } : c);
  };

  const addReq = (moduleId: string, lessonId: string) => {
    const req: Requirement = { id: `req-${uid()}`, label: '', description: '', type: 'mcq', options: ['', '', '', ''], correctAnswer: '' };
    updateLesson(moduleId, lessonId, {
      requirements: [...(config?.modules.find(m=>m.id===moduleId)?.lessons.find(l=>l.id===lessonId)?.requirements ?? []), req],
    });
  };

  const removeReq = (moduleId: string, lessonId: string, reqId: string) => {
    const l = config?.modules.find(m=>m.id===moduleId)?.lessons.find(l=>l.id===lessonId);
    if (l) updateLesson(moduleId, lessonId, { requirements: l.requirements.filter(r => r.id !== reqId) });
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

  // Bunny picker helpers
  const openBunnyPicker = async (target: string, search = '', collection = '') => {
    setBunnyPickerTarget(target);
    setBunnyPickerOpen(true);
    setBunnyLoading(true);
    setBunnyError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';
      const qs = new URLSearchParams({ ...(search ? { search } : {}), ...(collection ? { collection } : {}) });
      const [videosRes, collectionsRes] = await Promise.all([
        fetch(`/api/bunny?${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
        bunnyCollections.length === 0
          ? fetch('/api/bunny?collections=1', { headers: { Authorization: `Bearer ${token}` } })
          : Promise.resolve(null),
      ]);
      const videosJson = await videosRes.json();
      if (!videosRes.ok) { setBunnyError(videosJson.error || 'Failed to load videos'); return; }
      setBunnyVideos(videosJson.videos ?? []);
      if (collectionsRes) {
        const colJson = await collectionsRes.json();
        setBunnyCollections(colJson.collections ?? []);
      }
    } catch {
      setBunnyError('Network error. Please try again.');
    } finally {
      setBunnyLoading(false);
    }
  };

  const selectBunnyVideo = (embedUrl: string) => {
    if (!bunnyPickerTarget) return;
    const [modId, lesId] = bunnyPickerTarget.split('::');
    updateLesson(modId, lesId, { videoUrl: embedUrl });
    setBunnyPickerOpen(false);
    setBunnyPickerTarget(null);
    setBunnySearch('');
    setBunnyCollection('');
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
      if (json.config) {
        if (datasetUrl.trim()) {
          json.config.dataset = { ...(json.config.dataset || {}), url: datasetUrl.trim() };
        }
        // If only a URL was given with no CSV, create a minimal dataset entry
        if (!datasetCsv.trim() && datasetUrl.trim() && !json.config.dataset) {
          json.config.dataset = { filename: '', description: '', url: datasetUrl.trim() };
        }
        // Instructor-provided description takes precedence over the AI's own
        if (datasetDescription.trim() && json.config.dataset) {
          json.config.dataset = { ...json.config.dataset, description: datasetDescription.trim() };
        }
      }
      setConfig(attachLessonDocs(json.config));
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
  const handleGenerateFromData = async () => {
    if (!datasetCsv.trim()) { setGenError('Please paste or upload a dataset first.'); return; }
    setGenerating(true); setGenError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-guided-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'generate-from-data', industry: effectiveIndustry, difficulty, role: roleHint, focusTopic, tools: toolsInput, companyName, scenario, customPrompt, emailStyle: emailStyle ? 'frame' : undefined, csvContent: datasetCsv, filename: datasetFilename || 'dataset.csv' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setConfig(attachLessonDocs(json.config));
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

  // Manual scaffold
  const handleManual = () => {
    const ind = INDUSTRIES.find(i => i.id === industry) || INDUSTRIES[0];
    const dataset = datasetCsv.trim()
      ? { filename: datasetFilename || 'dataset.csv', description: datasetDescription.trim(), csvContent: datasetCsv, url: datasetUrl.trim() || undefined }
      : datasetUrl.trim()
        ? { filename: '', description: datasetDescription.trim(), url: datasetUrl.trim() }
        : undefined;
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

    // Read into memory for AI generation use
    const text = await file.text();
    setDatasetCsv(text);

    // Storage upload happens server-side in guided-project-save when the VE is saved

    setUploadingDataset(false);
  };

  // Replace or attach the dataset on an already-generated VE (Overview tab), writing
  // straight into config.dataset since there is no step-1 draft to feed here.
  const handleDatasetReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDatasetReplace(true);
    try {
      const text = await file.text();
      setConfig(c => c ? { ...c, dataset: { filename: file.name, description: c.dataset?.description || '', csvContent: text, url: c.dataset?.url } } : c);
    } finally {
      setUploadingDatasetReplace(false);
      e.target.value = '';
    }
  };

  const removeDataset = () => {
    setConfig(c => c ? { ...c, dataset: undefined } : c);
  };

  // AI Improve
  const handleImprove = async () => {
    if (!improveInstruction.trim() || !config) return;
    setImproving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-guided-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'improve', instruction: improveInstruction, currentConfig: config }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      if (json.config) {
        setConfig(preserveLessonDocs(json.config, config) as ProjectConfig);
        setImproveInstruction('');
        setShowImprove(false);
      }
    } catch (e: any) {
      alert('AI error: ' + e.message);
    } finally {
      setImproving(false);
    }
  };

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

  const handleToolLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, toolName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingToolLogo(toolName);
    try {
      const publicUrl = await uploadToCloudinary(file, 'tool-logos');
      setConfig(c => c ? { ...c, toolLogos: { ...(c.toolLogos || {}), [toolName]: publicUrl } } : c);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingToolLogo(null);
      e.target.value = '';
    }
  };

  // Dataset download
  const downloadDataset = () => {
    const dataset = (config as any)?.dataset;
    if (!dataset) return;
    const content = datasetCsv.trim() || dataset.csvContent || '';
    if (content) {
      const blob = new Blob([content], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = dataset.filename || 'dataset.csv'; a.click();
      URL.revokeObjectURL(url);
    } else if (dataset.url) {
      window.open(dataset.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Save
  const effectiveId = editId ?? savedId;

  const handleSave = async (status: 'draft' | 'published') => {
    if (!config || !title.trim()) { setSaveError('Title is required'); return; }
    if (status === 'published') {
      const readinessIssues = validateVirtualExperienceForPublish(config);
      if (readinessIssues.length) {
        setSaveError(readinessIssues[0].message);
        setActiveSection(readinessIssues[0].section);
        return;
      }
    }
    if (status === 'published' && config.guideSnapshot?.sourceType === 'external' && config.guideSnapshot.consentStatus !== 'confirmed') {
      setSaveError('Confirm permission to use the selected professional’s name and photo before publishing.');
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
          config,
          coverImage,
          cohort_ids: selectedCohorts,
          group_ids:  [],
          deadline_days: deadlineDays ? Number(deadlineDays) : null,
          status,
          is_short_course: isShortCourse,
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
        setSavedId(json.id);
        window.history.replaceState(null, '', `/create/guided-project?id=${json.id}`);
      }
      if (json.slug) setVeSlug(json.slug);
      if (json.registrationWarning) setSaveWarning(json.registrationWarning);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Render
  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    border: '1px solid transparent', background: C.card,
    boxShadow: C === DARK_C ? '0 0 0 1px rgba(255,255,255,0.07)' : '0 0 0 1px rgba(15,23,42,0.08)',
    color: C.text, fontSize: 15, outline: 'none', transition: 'box-shadow 160ms ease, background 160ms ease',
  } as React.CSSProperties;

  const card = {
    background: C.pill, border: '1px solid transparent',
    borderRadius: 18, boxShadow: 'none',
  } as React.CSSProperties;

  const REQ_COLORS: Record<string, string> = {
    task: '#3b82f6', deliverable: '#10b981', reflection: '#8b5cf6',
  };

  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text, fontFamily: "'Google Sans', 'Inter', sans-serif" }}>
      {/* Experience Studio header */}
      <header className="px-4 sm:px-6 pt-6" style={{ background: C.page }}>
        <div className={`max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-3 ${step === 2 ? 'rounded-t-2xl' : 'rounded-2xl'}`}
          style={{ background: C.card }}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard" aria-label="Back to dashboard"
                className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-70 flex-shrink-0"
                style={{ color: C.muted, background: C.pill }}>
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="relative flex w-2 h-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-20" style={{ background: C.cta }}/>
                    <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: C.cta }}/>
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: C.cta }}>Experience Studio</span>
                </div>
                <h1 className="text-[17px] sm:text-[18px] font-bold leading-tight truncate" style={{ color: C.text }}>
                  {step === 2 ? (title || 'Untitled experience') : (effectiveId ? 'Edit Virtual Experience' : 'New Virtual Experience')}
                </h1>
              </div>
            </div>
            {step === 2 ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                {veSlug ? (
                  <a href={`/${veSlug}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all hover:opacity-70"
                    style={{ color: C.muted, background: C.pill, textDecoration: 'none' }}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </a>
                ) : (
                  <span title="Save the experience first to preview it"
                    className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold cursor-not-allowed opacity-40"
                    style={{ color: C.muted, background: C.pill }}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </span>
                )}
                <button onClick={() => handleSave('draft')} disabled={saving}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors hover:opacity-70"
                  style={{ color: C.muted, background: 'transparent' }}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  Save draft
                </button>
                <button onClick={() => handleSave('published')} disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all hover:opacity-85"
                  style={{ background: saveSuccess ? '#16a34a' : C.cta, color: C.ctaText }}>
                  {saveSuccess ? <Check className="w-3.5 h-3.5"/> : <CheckCircle2 className="w-3.5 h-3.5"/>}
                  {saveSuccess ? 'Saved' : effectiveId ? 'Update' : 'Publish'}
                </button>
              </div>
            ) : (
              <span className="text-[11px] font-semibold px-3 py-1.5 rounded-full" style={{ background: C.pill, color: C.faint }}>Setup</span>
            )}
          </div>
        </div>
      </header>

      <div className={`px-4 sm:px-6 pb-4 ${step === 2 ? 'pt-0' : 'pt-3'}`}>
        {step === 2 && (saveError || saveWarning) && (
          <div className="max-w-6xl mx-auto pt-3">
            <div className="px-4 py-3 rounded-xl text-[13px] flex items-start gap-2"
              role="status"
              style={saveError
                ? { background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }
                : { background: 'rgba(245,158,11,0.09)', color: '#d97706', border: '1px solid rgba(245,158,11,0.22)' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{saveError || saveWarning}</span>
            </div>
          </div>
        )}

        {/* STEP 1: Configure */}
        {step === 1 && (
          <div className="max-w-5xl mx-auto px-0 sm:px-4 py-6">
          <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: C === DARK_C ? '1px solid transparent' : `1px solid ${C.cardBorder}`, boxShadow: 'none' }}>
            <div className="px-6 sm:px-8 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <h2 className="text-lg sm:text-xl font-bold leading-tight" style={{ color: C.text }}>What kind of project?</h2>
              <p className="text-[11px] mt-1 font-medium tracking-wide uppercase" style={{ color: C.faint }}>Choose how to build your virtual experience</p>
            </div>
            <div className="px-6 sm:px-8 py-7 space-y-6">

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
                  title: 'Build Manually',
                  desc: 'Start with a blank template and write every module, lesson and question yourself. Optionally attach a dataset for students.',
                  badge: 'Full Control',
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
                    <p className="text-[15px] font-bold" style={{ color: C.text }}>{m.title}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.pill, color: C.muted }}>{m.badge}</span>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>{m.desc}</p>
                </button>
              ))}
            </div>

            {/* Short Course toggle */}
            <button
              type="button"
              onClick={() => setIsShortCourse(v => !v)}
              className="w-full flex items-center justify-between p-4 rounded-2xl text-left transition-all"
              style={{
                border: 'none',
                background: isShortCourse ? `${C.cta}14` : C.pill,
                boxShadow: isShortCourse ? `0 0 0 2px ${C.cta}` : 'none',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: C.card, color: C.muted }}>
                  <Star className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[14px] font-bold" style={{ color: C.text }}>Short Course Mode</p>
                  <p className="text-[12px]" style={{ color: C.muted }}>Simplified experience -- no company/dataset context. Lessons + questions + AI review only.</p>
                </div>
              </div>
              <div className="flex-shrink-0 ml-3">
                <div className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0"
                  style={{ background: isShortCourse ? C.cta : C.divider }}>
                  <div className="w-4 h-4 rounded-full bg-white absolute top-1 transition-all"
                    style={{ left: isShortCourse ? '22px' : '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </div>
              </div>
            </button>

            {/* Config card: appears when mode selected */}
            {creationMode && (
              <div className="space-y-6 mt-2">
                <div style={{ background: C.pill, borderRadius: 16, overflow: 'hidden' }}>
                  {/* Industry */}
                  <div className="p-5 space-y-3">
                    <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Industry</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {INDUSTRIES.map(ind => (
                        <button key={ind.id} onClick={() => setIndustry(ind.id)}
                          className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all"
                          style={{
                            border: `1.5px solid ${industry === ind.id ? C.cta : C.cardBorder}`,
                            background: industry === ind.id ? `${C.cta}12` : 'transparent',
                          }}>
                          <span className="text-base">{ind.emoji}</span>
                          <span className="text-[13px] font-semibold" style={{ color: C.text }}>{ind.label}</span>
                          {industry === ind.id && <Check className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: C.cta }}/>}
                        </button>
                      ))}
                      {/* Other / custom industry */}
                      <button onClick={() => setIndustry('other')}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all"
                        style={{
                          border: `1.5px solid ${industry === 'other' ? C.cta : C.cardBorder}`,
                          background: industry === 'other' ? `${C.cta}12` : 'transparent',
                        }}>
                        <span className="text-base">✏️</span>
                        <span className="text-[13px] font-semibold" style={{ color: C.text }}>Other</span>
                        {industry === 'other' && <Check className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: C.cta }}/>}
                      </button>
                    </div>
                    {industry === 'other' && (
                      <input
                        type="text"
                        value={customIndustry}
                        onChange={e => setCustomIndustry(e.target.value)}
                        placeholder="e.g. Logistics, Agriculture, Real Estate…"
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                        style={{
                          border: `1.5px solid ${C.cta}`,
                          background: C.input,
                          color: C.text,
                        }}
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Experience Level */}
                  <div className="px-5 pb-5 pt-4 space-y-3 border-t" style={{ borderColor: C.divider }}>
                    <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Experience Level</p>
                    <div className="flex gap-2">
                      {([
                        { id: 'beginner',     label: 'Beginner',     desc: 'Foundational' },
                        { id: 'intermediate', label: 'Intermediate', desc: 'Real-world' },
                        { id: 'advanced',     label: 'Advanced',     desc: 'Expert-level' },
                      ] as const).map(d => (
                        <button key={d.id} onClick={() => setDifficulty(d.id)}
                          className="flex-1 py-2.5 px-3 rounded-xl text-left transition-all"
                          style={{
                            border: `1.5px solid ${difficulty === d.id ? C.cta : C.cardBorder}`,
                            background: difficulty === d.id ? `${C.cta}12` : 'transparent',
                          }}>
                          <p className="text-[13px] font-bold" style={{ color: C.text }}>{d.label}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{d.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Role / Focus / Tools */}
                  <div className="px-5 pb-5 pt-4 border-t" style={{ borderColor: C.divider }}>
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[12px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Role</label>
                        <input style={inp} value={roleHint} onChange={e => setRoleHint(e.target.value)} placeholder="e.g. Data Analyst" />
                      </div>
                      {creationMode !== 'manual' && (
                        <div>
                          <label className="block text-[12px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Focus Topic</label>
                          <input style={inp} value={focusTopic} onChange={e => setFocusTopic(e.target.value)} placeholder="e.g. Fraud detection" />
                        </div>
                      )}
                      <div>
                        <label className="block text-[12px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Tools</label>
                        <input style={inp} value={toolsInput} onChange={e => setToolsInput(e.target.value)} placeholder="e.g. Excel, Power BI" />
                      </div>
                    </div>
                  </div>

                  {/* Company & Scenario: AI + data modes */}
                  {creationMode !== 'manual' && (
                    <div className="px-5 pb-5 pt-4 border-t space-y-3" style={{ borderColor: C.divider }}>
                      <div>
                        <label className="block text-[12px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>
                          Company Name <span className="normal-case font-normal tracking-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <input
                          style={inp}
                          value={companyName}
                          onChange={e => setCompanyName(e.target.value)}
                          placeholder="e.g. NaraPay"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>
                          Scenario <span className="normal-case font-normal tracking-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <textarea
                          value={scenario}
                          onChange={e => setScenario(e.target.value)}
                          rows={3}
                          style={{ ...inp, fontSize: 13, resize: 'vertical', lineHeight: 1.6 } as React.CSSProperties}
                          placeholder="Describe the company background and the problem the student needs to solve. e.g. NaraPay is a Lagos-based fintech processing 50,000 mobile transactions daily. They are losing 12% revenue to fraud and need a data analyst to identify patterns."
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
                          Additional Instructions <span className="normal-case font-normal tracking-normal" style={{ color: C.faint }}>(optional)</span>
                        </label>
                        <textarea
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          rows={2}
                          style={{ ...inp, fontSize: 13, resize: 'vertical', lineHeight: 1.6 } as React.CSSProperties}
                          placeholder="e.g. Make questions harder than usual. Use a conversational tone in lesson bodies."
                        />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 0 2px' }}>
                        <input
                          type="checkbox"
                          checked={emailStyle}
                          onChange={e => setEmailStyle(e.target.checked)}
                          style={{ marginTop: 2, accentColor: C.cta, flexShrink: 0 }}
                        />
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Present tasks as workplace emails</span>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                            Wraps every task, upload, and AI review in an email thread from the manager. The AI will also write the email body for each one.
                          </p>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Dataset */}
                  <div className="px-5 pb-5 pt-4 border-t space-y-3" style={{ borderColor: C.divider }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>
                          Dataset <span className="normal-case font-normal tracking-normal" style={{ color: C.faint }}>(optional)</span>
                        </p>
                        {creationMode === 'ai' && (
                          <p className="text-[12px] mt-0.5" style={{ color: C.faint }}>
                            If provided, AI uses your data to generate accurate questions.
                          </p>
                        )}
                      </div>
                      <div className="flex rounded-xl overflow-hidden text-[12px]" style={{ border: `1px solid ${C.cardBorder}` }}>
                        {(['upload', 'link'] as const).map(tab => (
                          <button key={tab} onClick={() => setDatasetInputTab(tab)}
                            className="px-3 py-1.5 font-medium transition-all"
                            style={{
                              background: datasetInputTab === tab ? C.cta : C.card,
                              color: datasetInputTab === tab ? C.ctaText : C.muted,
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
                          <input ref={datasetRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleDatasetFileUpload}/>
                          <button onClick={() => datasetRef.current?.click()}
                            className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-xl border transition-all hover:opacity-70"
                            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted, background: C.card }}>
                            {uploadingDataset ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                            {datasetFilename ? datasetFilename : 'Upload CSV file'}
                          </button>
                          {datasetFilename && (
                            <button onClick={() => { setDatasetCsv(''); setDatasetFilename(''); setDatasetUrl(''); }}
                              className="hover:opacity-70 transition-opacity" style={{ color: C.faint }}>
                              <X className="w-3.5 h-3.5"/>
                            </button>
                          )}
                        </div>
                        <textarea
                          value={datasetCsv}
                          onChange={e => setDatasetCsv(e.target.value)}
                          rows={8}
                          style={{ ...inp, fontFamily: 'monospace', fontSize: 13, resize: 'vertical', lineHeight: 1.5 } as React.CSSProperties}
                          placeholder={"Paste CSV data here, or upload a file above…\n\ndate,region,amount,status\n2024-01-01,Lagos,45000,Completed\n2024-01-02,Abuja,32000,Pending"}
                        />
                        {datasetCsv.trim() && (
                          <div className="flex items-center gap-2 text-[13px]" style={{ color: C.faint }}>
                            <Table className="w-3.5 h-3.5"/>
                            {datasetCsv.trim().split('\n').length} rows detected
                            {creationMode === 'ai' && ' · AI will generate questions from these exact values'}
                          </div>
                        )}
                      </>
                    )}

                    {datasetInputTab === 'link' && (
                      <div className="space-y-2">
                        <input
                          value={datasetUrl}
                          onChange={e => setDatasetUrl(e.target.value)}
                          style={inp}
                          placeholder="https://docs.google.com/spreadsheets/… or any public CSV/sheet URL"
                        />
                        <p className="text-[12px]" style={{ color: C.faint }}>
                          The link will be shown to students as the dataset source.
                          {creationMode === 'ai' && ' To let AI generate questions from your data, paste the CSV content in the Upload tab instead.'}
                        </p>
                      </div>
                    )}

                    {(datasetCsv.trim() || datasetUrl.trim()) && (
                      <div className="space-y-1">
                        <label className="text-[12px] font-medium" style={{ color: C.faint }}>Description shown to students</label>
                        <textarea
                          value={datasetDescription}
                          onChange={e => setDatasetDescription(e.target.value)}
                          rows={2}
                          style={{ ...inp, fontSize: 13, resize: 'vertical', lineHeight: 1.5 } as React.CSSProperties}
                          placeholder={creationMode === 'ai' ? 'Leave blank to let AI write one, or describe the dataset yourself…' : 'e.g. Q3 regional sales transactions with status and amount columns.'}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Error */}
                {genError && (
                  <div className="px-4 py-3 rounded-xl text-[13px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    {genError}
                  </div>
                )}

                {/* CTA button */}
                {creationMode === 'ai' && (
                  <button onClick={handleGenerate} disabled={generating}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 hover:scale-[1.005] disabled:opacity-60"
                    style={{ background: C.cta, color: C.ctaText, boxShadow: `0 6px 20px ${C.cta}38` }}>
                    {generating
                      ? <><Loader2 className="w-5 h-5 animate-spin"/> Generating…</>
                      : datasetCsv.trim()
                        ? <><Database className="w-5 h-5"/> Generate from My Dataset</>
                        : <><Sparkles className="w-5 h-5"/> Generate with AI</>}
                  </button>
                )}

                {creationMode === 'manual' && (
                  <button onClick={handleManual}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 hover:scale-[1.005]"
                    style={{ background: C.cta, color: C.ctaText, boxShadow: `0 6px 20px ${C.cta}38` }}>
                    <PenLine className="w-5 h-5"/> Start with Blank Template
                  </button>
                )}

                {generating && (
                  <div className="text-center space-y-3">
                    <p className="text-[13px] font-medium" style={{ color: C.muted }}>
                      {datasetCsv.trim() ? 'Analysing your data and generating questions…' : 'Creating company scenario, milestones, missions and dataset…'}
                    </p>
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {['Company brief', 'Dataset', 'Milestones', 'Missions', 'Questions'].map((s, i) => (
                        <span key={s} className="text-[12px] px-2.5 py-1 rounded-full animate-pulse font-medium"
                          style={{ background: `${C.cta}18`, color: C.cta, animationDelay: `${i * 0.2}s` }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
          </div>
        )}

        {/* STEP 2: Review & Edit */}
        {step === 2 && config && (() => {
          const indInfo = INDUSTRIES.find(i => i.id === config.industry) || INDUSTRIES[0];
          const managerName  = config.guideSnapshot?.fullName || config.managerName  || 'Your Manager';
          const managerTitle = config.guideSnapshot?.professionalTitle || config.managerTitle || 'Head of Analytics';
          const managerPhoto = config.guideSnapshot?.profilePhotoUrl;
          const managerInitials = managerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
          const companyInitials = config.company?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '??';
          const dataset = config.dataset;

          return (
          <div className="max-w-6xl mx-auto py-0">
            {/* Carousel: navigable sections */}
            {(() => {
              const ids = VE_SECTIONS.map(s => s.id) as readonly string[];
              const si = ids.indexOf(activeSection);
              return (
              <div className="rounded-b-2xl overflow-hidden" style={{ background: C.card, border: 'none', boxShadow: C === DARK_C ? '0 16px 38px rgba(0,0,0,0.12)' : '0 16px 38px rgba(15,23,42,0.045)' }}>
                <nav className="flex items-center gap-2 overflow-x-auto px-4 sm:px-6 py-3" aria-label="Virtual experience editor sections"
                  style={{ scrollbarWidth: 'none', borderBottom: `1px solid ${C.divider}` }}>
                  {VE_SECTIONS.map(section => {
                    const active = activeSection === section.id;
                    return (
                      <button key={section.id} type="button" onClick={() => goToSection(section.id)} aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 flex-shrink-0 px-3.5 py-2.5 rounded-xl text-[14px] transition-colors ${active ? 'font-bold' : 'font-semibold'}`}
                        style={{ background: active ? `${C.cta}14` : 'transparent', color: active ? C.cta : C.faint }}>
                        <section.Icon className="w-4 h-4" /> {section.label}
                      </button>
                    );
                  })}
                </nav>
                <div className="flex items-center justify-between gap-4 px-6 sm:px-8 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold leading-tight truncate" style={{ color: C.text }}>{VE_SECTIONS[si]?.label}</h2>
                    <p className="text-[11px] mt-1 font-medium tracking-wide uppercase" style={{ color: C.faint }}>Step {si + 1} of {ids.length}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" disabled={si <= 0} onClick={() => goToSection(ids[si - 1])} aria-label="Previous"
                      className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-30" style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button type="button" disabled={si >= ids.length - 1} onClick={() => goToSection(ids[si + 1])} aria-label="Next"
                      className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-30" style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <AnimatePresence mode="wait" custom={secDir}>
                <motion.div key={activeSection} custom={secDir}
                  initial={{ opacity: 0, x: secDir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: secDir * -28 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="px-6 sm:px-8 py-7">

                {activeSection === 'overview' && (
                <div className="space-y-4">

                {/* Project card */}
                <div style={{ ...card, overflow: 'hidden' }}>
                  {/* Cover */}
                  {coverImage ? (
                    <div style={{ height: 160, overflow: 'hidden', position: 'relative' }}>
                      <img src={resolveCoverUrl(coverImage)} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 60%)' }} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => goToSection('branding')}
                      className="w-full flex flex-col items-center justify-center gap-2 transition-opacity hover:opacity-75"
                      style={{ height: 132, background: C.card, color: C.muted }}>
                      <Images className="w-6 h-6" />
                      <span className="text-[12px] font-semibold">Add cover image</span>
                      <span className="text-[10px]" style={{ color: C.faint }}>Opens Branding</span>
                    </button>
                  )}

                  <div className="p-5 sm:p-6 space-y-3">
                    {/* Company identity */}
                    <div className="flex items-end gap-3">
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: C.text, flexShrink: 0, letterSpacing: 1 }}>
                        {companyInitials === '??' ? <Building2 className="w-4 h-4" style={{ color: C.muted }} /> : companyInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <label className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: C.faint }}>Company name</label>
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.cta }}>{config.industry} · Virtual Experience</p>
                        </div>
                        <input
                          value={config.company || ''}
                          onChange={e => setConfig(c => c ? { ...c, company: e.target.value } : c)}
                          className="w-full outline-none text-[14px] font-semibold"
                          style={{ ...inp, color: C.text }}
                          placeholder="Company name…"
                        />
                      </div>
                    </div>

                    {/* Editable title */}
                    <label className="block text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: C.faint }}>Experience title</label>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="!mt-1.5 w-full text-[16px] font-bold outline-none"
                      style={{ ...inp, color: C.text }}
                      placeholder="Program title…"
                    />

                    {/* Editable tagline */}
                    <label className="block text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: C.faint }}>Tagline</label>
                    <input
                      value={config.tagline || ''}
                      onChange={e => setConfig(c => c ? { ...c, tagline: e.target.value } : c)}
                      className="!mt-1.5 w-full outline-none text-[13px]"
                      style={{ ...inp, color: C.muted }}
                      placeholder="One-line tagline…"
                    />

                    {/* Meta pills */}
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: C.pill, color: C.text }}>{config.role}</span>
                      <span className="text-[12px] px-3 py-1 rounded-full font-semibold capitalize" style={{ background: C.pill, color: C.muted }}>{config.difficulty}</span>
                      {config.duration && <span className="text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: C.pill, color: C.muted }}>{config.duration}</span>}
                      {config.modules?.length > 0 && <span className="text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: C.pill, color: C.muted }}>{config.modules.length} modules</span>}
                    </div>

                    {/* Tools */}
                    {(config.tools || []).length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: C.faint }}>Skills you will use</p>
                        <div className="flex flex-wrap gap-2">
                          {(config.tools || []).map(t => {
                            const logo = (config.toolLogos || {})[t];
                            return (
                              <div key={t} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: C.card }}>
                                {logo
                                  ? <img src={logo} alt={t} className="w-4 h-4 rounded object-contain flex-shrink-0" />
                                  : <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-[9px] font-bold" style={{ background: C.pill, color: C.muted }}>{t[0]}</div>
                                }
                                <span className="text-[12px] font-medium" style={{ color: C.text }}>{t}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Dataset - replace/attach/remove works here even for an already-saved VE */}
                    <div className="p-4 rounded-2xl" style={{ background: C.card, border: `1px dashed ${C.cardBorder}` }}>
                      <input ref={datasetReplaceRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleDatasetReplace} />
                      {dataset ? (
                        <div className="flex items-start gap-2">
                          <span className="text-base flex-shrink-0 mt-0.5">📊</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[12px] font-bold flex-1 min-w-0 truncate" style={{ color: C.text }}>{dataset.filename || 'Linked Dataset'}</p>
                              <button onClick={() => datasetReplaceRef.current?.click()} disabled={uploadingDatasetReplace}
                                className="flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 hover:opacity-70 transition-opacity" style={{ color: C.cta }}>
                                {uploadingDatasetReplace ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                {uploadingDatasetReplace ? 'Uploading…' : 'Replace file'}
                              </button>
                              <button onClick={removeDataset} title="Remove dataset"
                                className="flex-shrink-0 hover:text-red-400 transition-colors" style={{ color: C.faint }}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input
                              value={dataset.description || ''}
                              onChange={e => setConfig(c => c && c.dataset ? { ...c, dataset: { ...c.dataset, description: e.target.value } } : c)}
                              className="w-full bg-transparent outline-none text-[11px] mt-0.5"
                              style={{ color: C.muted }}
                              placeholder="Describe this dataset for students…"
                            />
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <LinkIcon className="w-3 h-3 flex-shrink-0" style={{ color: C.faint }} />
                              <input
                                value={dataset.url || ''}
                                onChange={e => setConfig(c => c && c.dataset ? { ...c, dataset: { ...c.dataset, url: e.target.value || undefined } } : c)}
                                className="flex-1 min-w-0 bg-transparent outline-none text-[11px]"
                                style={{ color: C.muted }}
                                placeholder="Optional link shown to students instead of/alongside the file…"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => datasetReplaceRef.current?.click()} disabled={uploadingDatasetReplace}
                          className="flex items-center gap-2 text-[12px] font-semibold hover:opacity-70 transition-opacity" style={{ color: C.cta }}>
                          {uploadingDatasetReplace ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          {uploadingDatasetReplace ? 'Uploading…' : 'Attach a dataset'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                </div>)}
                {activeSection === 'brief' && (
                <div className="space-y-4">

                {/* Manager brief card */}
                <div style={{ ...card, overflow: 'hidden' }}>
                  {/* Header strip */}
                  <div className="flex items-center gap-3 px-4 py-3 m-4 mb-0 rounded-2xl" style={{ background: C.card }}>
                    <div style={{ width: 32, height: 32, borderRadius: 999, overflow: 'hidden', background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.text, flexShrink: 0 }}>
                      {managerPhoto ? <img src={managerPhoto} alt={managerName} className="w-full h-full object-cover" /> : managerInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: C.text }}>{managerName} <span className="font-normal" style={{ color: C.muted }}>· {managerTitle}</span></p>
                      <p className="text-[11px]" style={{ color: C.faint }}>To: New {config.role} · Your Brief</p>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>Onboarding</span>
                  </div>

                  {/* Editable fields */}
                  <div className="px-5 pt-4 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <div className="flex items-end justify-between gap-3 mb-1.5">
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Experience guide</label>
                          <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>Choose the professional learners will hear from throughout this experience.</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button type="button" onClick={() => setShowGuideManager(v => !v)}
                            className="text-[12px] font-semibold px-3 py-2 rounded-xl" style={{ color: C.muted, background: C.pill }}>Manage profiles</button>
                          <button type="button" onClick={() => { setEditingGuideId(null); setGuideDraft(emptyGuideDraft); setShowGuideForm(true); setGuideError(''); }}
                            className="text-[12px] font-bold flex items-center gap-1.5 px-3 py-2 rounded-xl"
                            style={{ color: C.cta, background: `${C.cta}12` }}>
                            <Plus className="w-3.5 h-3.5" /> Add professional
                          </button>
                        </div>
                      </div>
                      <select disabled={guidesLoading} value={config.guideId || ''} onChange={e => selectExperienceGuide(e.target.value)} style={{ ...inp, fontSize: 13, opacity: guidesLoading ? 0.7 : 1 }}>
                        <option value="">{guidesLoading ? 'Loading profiles...' : 'Default generated manager'}</option>
                        {experienceGuides.some(g => g.source_type === 'external' && (g.status !== 'archived' || g.id === config.guideId)) && <optgroup label="External professionals">
                          {experienceGuides.filter(g => g.source_type === 'external' && (g.status !== 'archived' || g.id === config.guideId)).map(g => <option key={g.id} value={g.id}>{g.full_name}{g.professional_title ? ` — ${g.professional_title}` : ''}{g.status === 'archived' ? ' (Archived)' : ''}</option>)}
                        </optgroup>}
                        {experienceGuides.some(g => g.source_type === 'instructor') && <optgroup label="Instructors">
                          {experienceGuides.filter(g => g.source_type === 'instructor').map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
                        </optgroup>}
                      </select>
                      {guideError && !showGuideForm && <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>
                        <span>{guideError}</span>
                        <button type="button" disabled={guidesLoading || !sessionToken} onClick={() => loadExperienceGuides(sessionToken)} className="font-bold underline underline-offset-2">Retry</button>
                      </div>}
                    </div>

                    {showGuideManager && <div className="sm:col-span-2 rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.divider}` }}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.card }}>
                        <div>
                          <p className="text-[13px] font-bold" style={{ color: C.text }}>Experience guide profiles</p>
                          <p className="text-[11px]" style={{ color: C.faint }}>External profiles are editable. Instructor identities stay linked to their accounts.</p>
                        </div>
                        <button type="button" onClick={() => setShowGuideManager(false)} style={{ color: C.faint }}><X className="w-4 h-4" /></button>
                      </div>
                      <div>
                        {experienceGuides.filter(g => g.source_type === 'external').length === 0 && <p className="px-4 py-5 text-[12px]" style={{ color: C.muted }}>No external professionals yet. Use “Add professional” to create one.</p>}
                        {experienceGuides.filter(g => g.source_type === 'external').map(g => <div key={g.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${C.divider}`, opacity: g.status === 'archived' ? 0.6 : 1 }}>
                          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                            {g.profile_photo_url ? <img src={g.profile_photo_url} alt={g.full_name} className="w-full h-full object-cover" /> : g.full_name.split(/\s+/).map((x: string) => x[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold truncate" style={{ color: C.text }}>{g.full_name}</p>
                            <p className="text-[11px] truncate" style={{ color: C.muted }}>{[g.professional_title, g.company].filter(Boolean).join(' · ') || 'Professional profile'}</p>
                          </div>
                          {g.status === 'archived' && <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>Archived</span>}
                          <button type="button" onClick={() => beginEditGuide(g)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg" style={{ color: C.cta, background: `${C.cta}10` }}>Edit</button>
                          <button type="button" onClick={() => setGuideStatus(g, g.status === 'archived' ? 'active' : 'archived')} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg" style={{ color: C.muted, background: C.pill }}>{g.status === 'archived' ? 'Restore' : 'Archive'}</button>
                        </div>)}
                        {experienceGuides.filter(g => g.source_type === 'instructor').map(g => <div key={g.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${C.divider}` }}>
                          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                            {g.profile_photo_url ? <img src={g.profile_photo_url} alt={g.full_name} className="w-full h-full object-cover" /> : g.full_name.split(/\s+/).map((x: string) => x[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0"><p className="text-[13px] font-bold" style={{ color: C.text }}>{g.full_name}</p><p className="text-[11px]" style={{ color: C.muted }}>Instructor · Linked account</p></div>
                          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.cta }}>Synced</span>
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
                      <input value={guideDraft.full_name} onChange={e => setGuideDraft(d => ({ ...d, full_name: e.target.value }))} style={{ ...inp, fontSize: 13 }} placeholder="Full name" />
                      <input value={guideDraft.professional_title} onChange={e => setGuideDraft(d => ({ ...d, professional_title: e.target.value }))} style={{ ...inp, fontSize: 13 }} placeholder="Professional title" />
                      <input value={guideDraft.company} onChange={e => setGuideDraft(d => ({ ...d, company: e.target.value }))} style={{ ...inp, fontSize: 13 }} placeholder="Company (optional)" />
                      <input value={guideDraft.linkedin_url} onChange={e => setGuideDraft(d => ({ ...d, linkedin_url: e.target.value }))} style={{ ...inp, fontSize: 13 }} placeholder="LinkedIn profile URL" />
                      <textarea value={guideDraft.bio} onChange={e => setGuideDraft(d => ({ ...d, bio: e.target.value }))} rows={3} className="sm:col-start-2 sm:col-span-2" style={{ ...inp, fontSize: 13, resize: 'vertical' }} placeholder="Short professional bio" />
                      <input value={guideDraft.expertise} onChange={e => setGuideDraft(d => ({ ...d, expertise: e.target.value }))} className="sm:col-start-2 sm:col-span-2" style={{ ...inp, fontSize: 13 }} placeholder="Areas of expertise, separated by commas" />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setShowGuideForm(false); setEditingGuideId(null); setGuideDraft(emptyGuideDraft); }} className="px-3 py-2 rounded-xl text-[12px] font-semibold" style={{ color: C.muted }}>Cancel</button>
                        <button type="button" disabled={savingGuide} onClick={editingGuideId ? updateExperienceGuide : createExperienceGuide} className="px-3 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50" style={{ background: C.cta }}>{savingGuide ? 'Saving…' : editingGuideId ? 'Update profile' : 'Save profile'}</button>
                      </div>
                      {guideError && <p className="sm:col-start-2 sm:col-span-2 text-[11px] text-red-500">{guideError}</p>}
                      <label className="sm:col-start-2 sm:col-span-2 flex items-start gap-2 text-[11px] cursor-pointer" style={{ color: C.muted }}>
                        <input type="checkbox" checked={guideDraft.consent_confirmed} onChange={e => setGuideDraft(d => ({ ...d, consent_confirmed: e.target.checked }))} className="mt-0.5 accent-emerald-500" />
                        <span>I confirm I have permission to use this person’s name and profile photo in learner-facing experiences.</span>
                      </label>
                    </div>}
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Role</label>
                      <input value={config.role || ''} onChange={e => setConfig(c => c ? { ...c, role: e.target.value } : c)}
                        style={{ ...inp, fontSize: 13 }} placeholder="e.g. Data Analyst" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Manager Name</label>
                      <input value={config.managerName || ''} onChange={e => setConfig(c => c ? { ...c, managerName: e.target.value, guideId: null, guideSnapshot: null } : c)}
                        style={{ ...inp, fontSize: 13 }} placeholder="e.g. Amara Diallo" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Manager Title</label>
                      <input value={config.managerTitle || ''} onChange={e => setConfig(c => c ? { ...c, managerTitle: e.target.value, guideId: null, guideSnapshot: null } : c)}
                        style={{ ...inp, fontSize: 13 }} placeholder="e.g. Head of Analytics" />
                    </div>
                  </div>

                  {/* Scenario / background */}
                  <div className="px-5 pb-4">
                    <label className="block text-[12px] font-semibold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Scenario / Background</label>
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
                      placeholder="Describe the company scenario and the problem the student needs to solve…"
                    />
                  </div>
                </div>

                {/* Learning outcomes card */}
                <div style={card} className="p-5 space-y-3">
                    <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Learning Outcomes</p>
                    <div className="space-y-2">
                      {(config.learnOutcomes || []).map((o, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: C.card }}>
                          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: `${C.cta}18` }}>
                            <Check className="w-3 h-3" style={{ color: C.cta }} />
                          </div>
                          <input value={o} onChange={e => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.map((x, j) => j === i ? e.target.value : x) } : c)}
                            className="flex-1 bg-transparent text-[14px] outline-none" style={{ color: C.muted }} />
                          <button onClick={() => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.filter((_, j) => j !== i) } : c)}
                            style={{ color: C.faint }} className="hover:text-red-400 transition-colors flex-shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setConfig(c => c ? { ...c, learnOutcomes: [...(c.learnOutcomes||[]), ''] } : c)}
                      className="text-[13px] font-semibold flex items-center gap-1.5 rounded-xl px-3 py-2 hover:opacity-70" style={{ color: C.muted, background: C.card }}>
                      <Plus className="w-3.5 h-3.5" /> Add outcome
                    </button>
                </div>
                </div>)}
                {activeSection === 'curriculum' && (
                <div className="space-y-4">

                {/* Program Outline card */}
                <div style={card} className="overflow-hidden">
                  <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Program Outline</p>
                    <button onClick={addModule}
                      className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-xl transition-all hover:opacity-70"
                      style={{ color: C.muted, background: C.card }}>
                      <Plus className="w-3 h-3" /> Add Milestone
                    </button>
                  </div>

                  <div className="px-5 pb-5 space-y-4">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
                    <SortableContext items={(config.modules || []).map(m => m.id)} strategy={verticalListSortingStrategy}>
                    {(config.modules || []).map((mod, mi) => {
                      return (
                      <SortableVEShell key={mod.id} id={mod.id}>
                        {({ dragHandle: moduleDragHandle }) => (
                        <div className="rounded-2xl group overflow-hidden" style={{ background: C.card, boxShadow: C === DARK_C ? 'none' : '0 1px 2px rgba(15,23,42,0.04)' }}>

                          {/* MODULE HEADER */}
                          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
                            <div className="flex-shrink-0" title="Drag to reorder module">{moduleDragHandle}</div>
                            <span className="text-[11px] font-black uppercase tracking-widest flex-shrink-0" style={{ color: C.muted }}>Milestone {mi + 1}</span>
                            <input
                              value={mod.title}
                              onChange={e => updateModule(mod.id, { title: e.target.value })}
                              className="flex-1 bg-transparent text-[13px] font-bold outline-none min-w-0"
                              style={{ color: C.text }}
                              placeholder="Milestone title…"
                            />
                            <button onClick={() => removeModule(mod.id)}
                              className="hover:text-red-400 flex-shrink-0 transition-colors"
                              style={{ color: C.faint }} title="Delete module">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* LESSONS */}
                          <div className="p-3 space-y-2">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd(mod.id)}>
                            <SortableContext items={(mod.lessons || []).map(l => l.id)} strategy={verticalListSortingStrategy}>
                            {(mod.lessons || []).map((les, li) => {
                              const reqCount  = les.requirements?.length || 0;
                              const estTime   = reqCount <= 2 ? '15-30 mins' : reqCount <= 4 ? '30-60 mins' : '45-90 mins';
                              const expandKey = `${mod.id}-${les.id}`;
                              return (
                              <SortableVEShell key={les.id} id={les.id}>
                                {({ dragHandle: lessonDragHandle }) => (
                                <div className="rounded-xl overflow-hidden group" style={{ background: C.input }}>

                                  {/* Lesson header row */}
                                  <div className="flex items-center gap-2 px-3 py-2.5">
                                    <div className="flex-shrink-0" title="Drag to reorder lesson">{lessonDragHandle}</div>
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                                      style={{ background: C.pill, color: C.muted }}>
                                      {li + 1}
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0 px-1.5 py-0.5 rounded"
                                      style={{ background: C.pill, color: C.faint }}>Mission</span>
                                    <input
                                      value={les.title}
                                      onChange={e => updateLesson(mod.id, les.id, { title: e.target.value })}
                                      className="flex-1 bg-transparent text-[14px] font-semibold outline-none min-w-0"
                                      style={{ color: C.text }}
                                      placeholder="Mission title…"
                                    />
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <div className="flex items-center gap-1" style={{ color: C.faint }}>
                                        <Clock className="w-3 h-3" />
                                        <span className="text-[11px]">{estTime}</span>
                                      </div>
                                      <button onClick={() => toggleModule(expandKey)}
                                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-all hover:opacity-70"
                                        style={{ background: C.pill, color: C.muted }}>
                                        {expandedModules.has(expandKey)
                                          ? <><ChevronDown className="w-3 h-3" /> Hide</>
                                          : <><ChevronRight className="w-3 h-3" /> {reqCount} deliverable{reqCount !== 1 ? 's' : ''}</>}
                                      </button>
                                      {(config.modules || []).filter(m => m.id !== mod.id).length > 0 && (
                                        <select value="" title="Move this mission to a different milestone"
                                          onChange={e => { if (e.target.value) moveLessonToModule(mod.id, les.id, e.target.value); }}
                                          className="flex-shrink-0"
                                          style={{ padding: '2px 4px', borderRadius: 6, border: `1px solid ${C.cardBorder}`, background: C.card, color: C.muted, fontSize: 11, maxWidth: 96 }}>
                                          <option value="">Move to…</option>
                                          {(config.modules || []).filter(m => m.id !== mod.id).map(m => (
                                            <option key={m.id} value={m.id}>{m.title}</option>
                                          ))}
                                        </select>
                                      )}
                                      <button onClick={() => removeLesson(mod.id, les.id)}
                                        className="hover:text-red-400 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                        style={{ color: C.faint }}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* EXPANDED: lesson body + tasks */}
                                  {expandedModules.has(expandKey) && (
                                    <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: C.divider }}>
                                      <div className="pt-3">
                                        <LessonEditor
                                          key={les.id}
                                          doc={les.doc}
                                          bodyFallback={les.body}
                                          onChange={({ doc, body }) => updateLesson(mod.id, les.id, { doc, body })}
                                          placeholder="Write the mission content here. What should the student read, understand, or do?"
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input style={{ ...inp, fontSize: 13, flex: 1 }} value={les.videoUrl || ''} placeholder="YouTube, Vimeo, Bunny or Canva URL..."
                                          onChange={e => updateLesson(mod.id, les.id, { videoUrl: e.target.value })} />
                                        <button type="button" onClick={() => openBunnyPicker(`${mod.id}::${les.id}`)}
                                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0"
                                          style={{ background: '#FF6B35', color: 'white' }}>
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
                                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0"
                                            style={{ background: C.pill, color: C.muted }}>
                                            <FileCode className="w-3.5 h-3.5"/> HTML
                                          </div>
                                        </label>
                                      </div>
                                      {(() => {
                                        const embedUrl = safeEmbedUrl(les.videoUrl || '');
                                        return embedUrl ? (
                                          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                                            <iframe src={embedUrl} className={isHtmlEmbedUrl(embedUrl) ? 'w-full' : 'w-full aspect-video'} style={isHtmlEmbedUrl(embedUrl) ? { height: 480 } : undefined} sandbox={isHtmlEmbedUrl(embedUrl) ? 'allow-scripts allow-popups' : undefined} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                                          </div>
                                        ) : null;
                                      })()}

                                      {/* Tasks */}
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: C.muted }}>Deliverables</span>
                                          <div className="flex-1 h-px" style={{ background: C.divider }}/>
                                        </div>
                                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReqDragEnd(mod.id, les.id)}>
                                        <SortableContext items={les.requirements.map(r => r.id)} strategy={verticalListSortingStrategy}>
                                        {les.requirements.map((req, qi) => {
                                          const opts = req.options?.length === 4 ? req.options : ['', '', '', ''];
                                          const TYPE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
                                            mcq:    { bg: `${C.cta}18`,              color: C.cta,       label: 'Multiple Choice' },
                                            text:               { bg: 'rgba(139,92,246,0.12)',   color: '#8b5cf6',   label: 'Short Answer'       },
                                            upload:             { bg: 'rgba(245,158,11,0.12)',   color: '#f59e0b',   label: 'File Upload'         },
                                            task:               { bg: 'rgba(59,130,246,0.12)',   color: '#3b82f6',   label: 'Deliverable (Checkbox)' },
                                            briefing:           { bg: 'rgba(59,130,246,0.12)',   color: '#3b82f6',   label: 'Inbox Email' },
                                            scenario_update:    { bg: 'rgba(245,158,11,0.12)',   color: '#f59e0b',   label: 'Team Chat Update' },
                                            decision:           { bg: 'rgba(139,92,246,0.12)',   color: '#8b5cf6',   label: 'Chat Decision Thread' },
                                            debrief:            { bg: 'rgba(20,184,166,0.12)',   color: '#14b8a6',   label: 'Email Update Composer' },
                                            dashboard_critique: { bg: 'rgba(16,185,129,0.12)',   color: '#10b981',   label: 'AI Dashboard Critique' },
                                            code_review:        { bg: 'rgba(99,102,241,0.12)',   color: '#6366f1',   label: 'AI Code Review' },
                                            excel_review:       { bg: 'rgba(34,197,94,0.12)',    color: '#22c55e',   label: 'AI Excel Review' },
                                            document_review:    { bg: 'rgba(14,165,233,0.12)',   color: '#0ea5e9',   label: 'AI Document Review' },
                                          };
                                          const tc = TYPE_COLORS[req.type] || TYPE_COLORS.mcq;
                                          return (
                                            <SortableVEShell key={req.id} id={req.id}>
                                            {({ dragHandle: reqDragHandle }) => (
                                            <div className="rounded-xl p-3.5 space-y-3 group" style={{ background: C.card, boxShadow: C === DARK_C ? '0 0 0 1px rgba(255,255,255,0.05)' : '0 0 0 1px rgba(15,23,42,0.06)' }}>
                                              <div className="flex items-center gap-2">
                                                {reqDragHandle}
                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                                  style={{ background: C.card, color: C.muted }}>Deliverable {qi + 1}</span>
                                                <select value={req.type}
                                                  onChange={e => {
                                                    const type = e.target.value as Requirement['type'];
                                                    updateReq(mod.id, les.id, req.id, {
                                                      type,
                                                      options: type === 'mcq'
                                                        ? ['', '', '', '']
                                                        : type === 'decision'
                                                          ? ['', '', '']
                                                          : undefined,
                                                      optionFeedback: type === 'decision' ? ['', '', ''] : undefined,
                                                      correctAnswer: type === 'mcq' || type === 'decision' ? '' : undefined,
                                                      expectedAnswer: undefined,
                                                      aiReview: type === 'text' ? req.aiReview : undefined,
                                                      sharePrompt: type === 'linkedin_share' ? req.sharePrompt : undefined,
                                                      shareRequired: type === 'linkedin_share' ? (req.shareRequired ?? false) : undefined,
                                                      // Written explicitly so NEW share requirements offer the default bonus,
                                                      // while ones authored before VE shares paid XP keep an absent field and
                                                      // stay at 0 until an instructor sets an amount.
                                                      sharePoints: type === 'linkedin_share' ? (req.sharePoints ?? DEFAULT_LINKEDIN_SHARE_POINTS) : undefined,
                                                    });
                                                  }}
                                                  style={{ padding: '6px 9px', borderRadius: 9, border: '1px solid transparent', background: C.input, color: C.text, fontSize: 11, fontWeight: 700 }}>
                                                  <option value="mcq">Multiple Choice</option>
                                                  <option value="text">Short Answer</option>
                                                  <option value="upload">File Upload</option>
                                                  <option value="linkedin_share">LinkedIn Post Share</option>
                                                  <option value="task">Deliverable (Checkbox)</option>
                                                  <option value="briefing">Inbox Email</option>
                                                  <option value="scenario_update">Team Chat Update</option>
                                                  <option value="decision">Chat Decision Thread</option>
                                                  <option value="debrief">Email Update Composer</option>
                                                  <option value="dashboard_critique">AI Dashboard Critique</option>
                                                  <option value="code_review">AI Code Review</option>
                                                  <option value="excel_review">AI Excel Review</option>
                                                  <option value="document_review">AI Document Review</option>
                                                </select>
                                                {!['briefing','scenario_update','decision','debrief'].includes(req.type) && (
                                                  <button
                                                    type="button"
                                                    onClick={() => updateReq(mod.id, les.id, req.id, { emailFrame: !req.emailFrame })}
                                                    title={req.emailFrame ? 'Remove email frame' : 'Deliver via email thread'}
                                                    className="flex-shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all"
                                                    style={{ background: req.emailFrame ? 'rgba(59,130,246,0.15)' : C.card, color: req.emailFrame ? '#3b82f6' : C.muted, border: `1px solid ${req.emailFrame ? '#3b82f6' : C.cardBorder}` }}>
                                                    <Mail className="w-3 h-3" /> {req.emailFrame ? 'Email' : 'Email'}
                                                  </button>
                                                )}
                                                <input value={req.label}
                                                  onChange={e => updateReq(mod.id, les.id, req.id, { label: e.target.value })}
                                                  className="flex-1 bg-transparent text-[13px] font-semibold outline-none"
                                                  style={{ color: C.text }} placeholder="Task description…" />
                                                {(() => {
                                                  const groups = (config.modules || [])
                                                    .map(m => ({
                                                      modId: m.id,
                                                      modTitle: m.title,
                                                      lessons: (m.lessons || [])
                                                        .filter(l => !(m.id === mod.id && l.id === les.id))
                                                        .map(l => ({ lesId: l.id, lesTitle: l.title })),
                                                    }))
                                                    .filter(g => g.lessons.length > 0);
                                                  if (groups.length === 0) return null;
                                                  return (
                                                    <select value="" title="Move this task to a different mission"
                                                      onChange={e => {
                                                        const [toModId, toLesId] = e.target.value.split('::');
                                                        if (toModId && toLesId) moveReqToLesson(mod.id, les.id, req.id, toModId, toLesId);
                                                      }}
                                                      className="flex-shrink-0"
                                                      style={{ padding: '2px 4px', borderRadius: 6, border: `1px solid ${C.cardBorder}`, background: C.card, color: C.muted, fontSize: 11, maxWidth: 96 }}>
                                                      <option value="">Move to…</option>
                                                      {groups.map(g => (
                                                        <optgroup key={g.modId} label={g.modTitle}>
                                                          {g.lessons.map(l => (
                                                            <option key={l.lesId} value={`${g.modId}::${l.lesId}`}>{l.lesTitle}</option>
                                                          ))}
                                                        </optgroup>
                                                      ))}
                                                    </select>
                                                  );
                                                })()}
                                                <button onClick={() => removeReq(mod.id, les.id, req.id)} className="hover:text-red-400 flex-shrink-0" style={{ color: C.faint }}>
                                                  <X className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                              {(req.type === 'briefing' || req.type === 'debrief') ? (
                                                <>
                                                  <RichTextEditor
                                                    value={req.description}
                                                    onChange={html => updateReq(mod.id, les.id, req.id, { description: html })}
                                                    placeholder={req.type === 'briefing' ? 'Write the email body - formatting, bullet points, and images are all supported...' : 'Describe what students should write in their debrief update...'}
                                                    onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
                                                    enableAiAssist
                                                    enableNameTag
                                                  />
                                                  <p className="text-[11px]" style={{ color: C.faint }}>
                                                    {'Tip: insert {{first_name}} (or type {{name}} for the full name) to greet each student by name.'}
                                                  </p>
                                                  {req.type === 'briefing' && (
                                                    <div className="space-y-2">
                                                      {(req.attachments || []).map((att, ai) => (
                                                        <div key={ai} className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                                                          <Paperclip className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.muted }} />
                                                          <span className="flex-1 truncate" style={{ color: C.text }}>{att.name}</span>
                                                          <button onClick={() => updateReq(mod.id, les.id, req.id, { attachments: req.attachments?.filter((_, i) => i !== ai) })} style={{ color: C.faint }} className="hover:text-red-400 flex-shrink-0">
                                                            <X className="w-3.5 h-3.5" />
                                                          </button>
                                                        </div>
                                                      ))}
                                                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] cursor-pointer hover:opacity-80 transition-opacity" style={{ background: C.card, border: `1px dashed ${C.cardBorder}`, color: C.muted }}>
                                                        <Paperclip className="w-3.5 h-3.5" /> Attach file
                                                        <input type="file" className="hidden" onChange={async e => {
                                                          const file = e.target.files?.[0];
                                                          if (!file) return;
                                                          try {
                                                            const url = await uploadToCloudinary(file, 've-email-attachments');
                                                            updateReq(mod.id, les.id, req.id, { attachments: [...(req.attachments || []), { name: file.name, url, mimeType: file.type }] });
                                                          } catch { alert('Upload failed'); }
                                                          e.target.value = '';
                                                        }} />
                                                      </label>
                                                    </div>
                                                  )}
                                                </>
                                              ) : (
                                                <>
                                                  {req.emailFrame && (
                                                    <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.cardBorder}` }}>
                                                      <div style={{ padding: '6px 12px', background: C.card, borderBottom: `1px solid ${C.cardBorder}`, fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.4 }}>
                                                        EMAIL BODY
                                                      </div>
                                                      <RichTextEditor
                                                        value={req.emailBody || ''}
                                                        onChange={html => updateReq(mod.id, les.id, req.id, { emailBody: html })}
                                                        placeholder="Write the email the manager sends to the student..."
                                                        onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
                                                        enableAiAssist
                                                        enableNameTag
                                                      />
                                                    </div>
                                                  )}
                                                  {req.emailFrame && (
                                                    <p className="text-[11px]" style={{ color: C.faint }}>
                                                      {'Tip: insert {{first_name}} (or type {{name}} for the full name) to greet each student by name.'}
                                                    </p>
                                                  )}
                                                  <input value={req.description}
                                                    onChange={e => updateReq(mod.id, les.id, req.id, { description: e.target.value })}
                                                    style={{ ...inp, background: C.card, fontSize: 12 }}
                                                    placeholder={req.type === 'mcq' ? 'Hint: which column(s) to analyse…' : req.type === 'upload' ? 'Instructions for the student…' : req.type === 'linkedin_share' ? 'What should they post about?' : 'Prompt or context…'} />
                                                  {req.type === 'linkedin_share' && (
                                                    <>
                                                      <textarea value={req.sharePrompt || ''}
                                                        onChange={e => updateReq(mod.id, les.id, req.id, { sharePrompt: e.target.value })}
                                                        rows={4}
                                                        style={{ ...inp, background: C.card, fontSize: 12, resize: 'vertical' }}
                                                        placeholder="Optional suggested post text the student can copy…" />
                                                      <button
                                                        type="button"
                                                        onClick={() => updateReq(mod.id, les.id, req.id, { shareRequired: req.shareRequired !== true })}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all self-start"
                                                        style={req.shareRequired !== true
                                                          ? { background: C.card, border: `1px solid ${C.cardBorder}`, color: C.muted }
                                                          : { background: C.cta, color: 'white' }}>
                                                        {req.shareRequired !== true ? 'Optional' : 'Required to finish the lesson'}
                                                      </button>
                                                      {/* Independent of the toggle: an optional share can still pay a bonus. */}
                                                      <label className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: C.muted }}>
                                                        Bonus XP
                                                        <input
                                                          type="number" min={0} max={MAX_LINKEDIN_SHARE_POINTS}
                                                          value={req.sharePoints ?? 0}
                                                          onChange={e => updateReq(mod.id, les.id, req.id, {
                                                            sharePoints: clampLinkedInSharePoints(e.target.value),
                                                          })}
                                                          style={{ ...inp, background: C.card, fontSize: 12, width: 90, padding: '4px 8px' }} />
                                                        <span style={{ color: C.faint, fontWeight: 500 }}>0 to {MAX_LINKEDIN_SHARE_POINTS}; 0 awards nothing</span>
                                                      </label>
                                                      <p className="text-[11px]" style={{ color: C.faint }}>
                                                        The student pastes the link to their own LinkedIn post. It is checked as a real post
                                                        written by them, and a post someone else already submitted is rejected.
                                                        {req.shareRequired !== true
                                                          ? ' Optional: the lesson completes whether or not they share.'
                                                          : ' Required: the lesson will not complete until they share. A student with no LinkedIn account cannot finish, and there is no way to exempt one.'}
                                                      </p>
                                                    </>
                                                  )}
                                                </>
                                              )}
                                              {req.type === 'mcq' && (
                                                <div className="space-y-1">
                                                  {opts.map((opt, oi) => {
                                                    const letter = String.fromCharCode(65 + oi);
                                                    const isCorrect = req.correctAnswer === opt && opt !== '';
                                                    return (
                                                      <div key={oi} className="flex items-center gap-2">
                                                        <button
                                                          onClick={() => opt && updateReq(mod.id, les.id, req.id, { correctAnswer: opt })}
                                                          title={opt ? `Mark "${letter}" as correct answer` : 'Fill in this option first'}
                                                          className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all"
                                                          style={{ background: isCorrect ? C.cta : C.input, border: `1.5px solid ${isCorrect ? C.cta : C.cardBorder}`, color: isCorrect ? 'white' : C.muted }}>
                                                          {letter}
                                                        </button>
                                                        <input value={opt}
                                                          onChange={e => {
                                                            const newOpts = [...opts]; newOpts[oi] = e.target.value;
                                                            updateReq(mod.id, les.id, req.id, { options: newOpts, correctAnswer: req.correctAnswer === opt ? e.target.value : req.correctAnswer });
                                                          }}
                                                          className="flex-1 bg-transparent text-[13px] outline-none"
                                                          style={{ ...inp, background: C.card, padding: '4px 8px', fontSize: 12, borderColor: isCorrect ? C.cta : C.cardBorder, color: isCorrect ? C.cta : C.text, fontWeight: isCorrect ? 600 : 400 }}
                                                          placeholder={`Option ${letter}…`} />
                                                      </div>
                                                    );
                                                  })}
                                                  {req.correctAnswer && <p className="text-[12px] pt-1" style={{ color: C.muted }}>✓ Correct: {req.correctAnswer}</p>}
                                                </div>
                                              )}
                                              {req.type === 'scenario_update' && (
                                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
                                                  <Clock className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
                                                  <span>Renders as a Slack/Teams-style project-room message. Use it for client changes, new constraints, or stakeholder requests.</span>
                                                </div>
                                              )}
                                              {req.type === 'decision' && (() => {
                                                const decisionOptions = req.options?.length ? req.options : ['', '', ''];
                                                const decisionFeedback = decisionOptions.map((_, i) => req.optionFeedback?.[i] ?? '');
                                                const updateDecisionOption = (index: number, value: string) => {
                                                  const nextOptions = [...decisionOptions];
                                                  nextOptions[index] = value;
                                                  updateReq(mod.id, les.id, req.id, {
                                                    options: nextOptions,
                                                    optionFeedback: decisionFeedback,
                                                    correctAnswer: req.correctAnswer === decisionOptions[index] ? value : req.correctAnswer,
                                                  });
                                                };
                                                const updateDecisionFeedback = (index: number, value: string) => {
                                                  const nextFeedback = [...decisionFeedback];
                                                  nextFeedback[index] = value;
                                                  updateReq(mod.id, les.id, req.id, { optionFeedback: nextFeedback });
                                                };
                                                const addDecisionOption = () => {
                                                  updateReq(mod.id, les.id, req.id, {
                                                    options: [...decisionOptions, ''],
                                                    optionFeedback: [...decisionFeedback, ''],
                                                  });
                                                };
                                                const removeDecisionOption = (index: number) => {
                                                  const removed = decisionOptions[index];
                                                  updateReq(mod.id, les.id, req.id, {
                                                    options: decisionOptions.filter((_, i) => i !== index),
                                                    optionFeedback: decisionFeedback.filter((_, i) => i !== index),
                                                    correctAnswer: req.correctAnswer === removed ? '' : req.correctAnswer,
                                                  });
                                                };

                                                return (
                                                  <div className="space-y-2">
                                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
                                                      <PenLine className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
                                                      Renders as a team-chat thread. Students reply with one option and see scripted stakeholder feedback.
                                                    </div>
                                                    {decisionOptions.map((opt, oi) => {
                                                      const letter = String.fromCharCode(65 + oi);
                                                      const recommended = req.correctAnswer === opt && opt !== '';
                                                      return (
                                                        <div key={oi} className="rounded-lg p-2 space-y-1.5" style={{ background: C.card, border: `1px solid ${recommended ? tc.color : C.cardBorder}` }}>
                                                          <div className="flex items-center gap-2">
                                                            <button
                                                              type="button"
                                                              onClick={() => opt && updateReq(mod.id, les.id, req.id, { correctAnswer: opt })}
                                                              title={opt ? `Mark option ${letter} as the recommended path` : 'Fill in this option first'}
                                                              className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all"
                                                              style={{ background: recommended ? tc.color : C.input, border: `1.5px solid ${recommended ? tc.color : C.cardBorder}`, color: recommended ? 'white' : C.muted }}>
                                                              {letter}
                                                            </button>
                                                            <input
                                                              value={opt}
                                                              onChange={e => updateDecisionOption(oi, e.target.value)}
                                                              className="flex-1 bg-transparent text-[13px] outline-none"
                                                              style={{ ...inp, background: C.input, padding: '4px 8px', fontSize: 12, color: C.text }}
                                                              placeholder={`Decision option ${letter}...`}
                                                            />
                                                            {decisionOptions.length > 2 && (
                                                              <button type="button" onClick={() => removeDecisionOption(oi)} className="hover:text-red-400 flex-shrink-0" style={{ color: C.faint }}>
                                                                <X className="w-3.5 h-3.5" />
                                                              </button>
                                                            )}
                                                          </div>
                                                          <input
                                                            value={decisionFeedback[oi] || ''}
                                                            onChange={e => updateDecisionFeedback(oi, e.target.value)}
                                                            style={{ ...inp, background: C.input, fontSize: 12 }}
                                                            placeholder="Scripted feedback shown after this choice..."
                                                          />
                                                        </div>
                                                      );
                                                    })}
                                                    <div className="flex items-center justify-between gap-2">
                                                      {req.correctAnswer && <p className="text-[12px]" style={{ color: C.muted }}>Recommended path: {req.correctAnswer}</p>}
                                                      {decisionOptions.length < 5 && (
                                                        <button type="button" onClick={addDecisionOption}
                                                          className="ml-auto text-[12px] flex items-center gap-1 hover:opacity-70 font-medium" style={{ color: C.muted }}>
                                                          <Plus className="w-3 h-3" /> Add option
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                              {req.type === 'debrief' && (
                                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
                                                  <FileText className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
                                                  Renders as an email composer addressed to the manager. Students send their update or recommendation.
                                                </div>
                                              )}
                                              {req.type === 'upload' && (
                                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: `${C.cta}0a`, color: C.muted }}>
                                                  <LinkIcon className="w-3 h-3 flex-shrink-0" />Students will upload a file or paste a link
                                                </div>
                                              )}
                                              {req.type === 'text' && (
                                                <div className="space-y-1.5">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(139,92,246,0.06)', color: C.muted }}>
                                                    <FileText className="w-3 h-3 flex-shrink-0" />Students will type a written response
                                                  </div>
                                                  {/* AI Review toggle */}
                                                  <button
                                                    type="button"
                                                    onClick={() => updateReq(mod.id, les.id, req.id, { aiReview: !req.aiReview, expectedAnswer: undefined })}
                                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                                                    style={{
                                                      background: req.aiReview ? 'rgba(0,185,92,0.12)' : 'rgba(0,0,0,0.04)',
                                                      color: req.aiReview ? '#00b95c' : C.muted,
                                                      border: `1px solid ${req.aiReview ? '#00b95c40' : 'transparent'}`,
                                                    }}>
                                                    <span style={{ width: 26, height: 14, borderRadius: 7, background: req.aiReview ? '#00b95c' : '#ccc', display: 'inline-flex', alignItems: 'center', padding: '0 2px', transition: 'background 0.2s', flexShrink: 0 }}>
                                                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', marginLeft: req.aiReview ? 'auto' : 0, transition: 'margin 0.2s', display: 'block' }} />
                                                    </span>
                                                    AI Review {req.aiReview ? 'on -- Gemini will grade student answers' : 'off -- using exact match'}
                                                  </button>
                                                  {req.aiReview ? (
                                                    <input value={req.context || ''} onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })}
                                                      style={{ ...inp, background: C.card, fontSize: 12 }} placeholder="Rubric / grading guidance for AI (e.g. 'Award points for mentioning X and Y…')…" />
                                                  ) : (
                                                    <input value={req.expectedAnswer || ''} onChange={e => updateReq(mod.id, les.id, req.id, { expectedAnswer: e.target.value })}
                                                      style={{ ...inp, background: C.card, fontSize: 12 }} placeholder="Expected answer for exact match (optional -- leave blank to accept any response)…" />
                                                  )}
                                                </div>
                                              )}
                                              {req.type === 'task' && (
                                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                  <Check className="w-3 h-3 flex-shrink-0" />Students tick a checkbox to confirm completion
                                                </div>
                                              )}
                                              {req.type === 'dashboard_critique' && (
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                    <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
                                                    Students upload a dashboard screenshot. AI critiques every element and delivers a full audit report
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    C={C}
                                                    inp={inp}
                                                    sessionToken={sessionToken}
                                                  />
                                                </div>
                                              )}
                                              {req.type === 'code_review' && (
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                    <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
                                                    Students paste their code. AI reviews correctness, quality, efficiency, and best practices with line-level feedback
                                                  </div>
                                                  <div>
                                                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Table Schema / Data Context (optional)</p>
                                                    <textarea
                                                      value={req.schema ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { schema: e.target.value })}
                                                      rows={4}
                                                      spellCheck={false}
                                                      placeholder="Paste CREATE TABLE statements or describe the DataFrame columns. The AI uses this to validate student code against the actual schema."
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-2.5 rounded-lg"
                                                      style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}`, lineHeight: 1.6 }}
                                                    />
                                                  </div>
                                                  <div className="flex items-center gap-3">
                                                    <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>Minimum pass score</p>
                                                    <input
                                                      type="number" min={0} max={10} step={0.5}
                                                      value={req.minScore ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                                      placeholder="0"
                                                      className="w-20 outline-none text-[12px] font-mono px-2 py-1 rounded-lg"
                                                      style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }}
                                                    />
                                                    <p className="text-[11px]" style={{ color: C.muted }}>out of 10 · leave blank for no gate</p>
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    C={C}
                                                    inp={inp}
                                                    sessionToken={sessionToken}
                                                  />
                                                </div>
                                              )}
                                              {req.type === 'excel_review' && (
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                    <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
                                                    Students upload their .xlsx file. AI reviews formula correctness, formula choice, and value accuracy.
                                                  </div>
                                                  <div>
                                                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Spreadsheet Context (optional)</p>
                                                    <textarea
                                                      value={req.context ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })}
                                                      rows={4}
                                                      spellCheck={false}
                                                      placeholder="Include the domain so the AI applies the right expertise. e.g. This is a financial model for a retail business. B5 should calculate total revenue using SUMIF on column D, C10 should show profit margin as a percentage. Or: This is an HR payroll sheet. Column F should calculate net pay after tax deductions. Or: This is a BI sales dashboard for a fintech company. D12 should show month-on-month growth using XLOOKUP."
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-2.5 rounded-lg"
                                                      style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}`, lineHeight: 1.6 }}
                                                    />
                                                  </div>
                                                  <div className="flex items-center gap-3">
                                                    <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>Minimum pass score</p>
                                                    <input
                                                      type="number" min={0} max={10} step={0.5}
                                                      value={req.minScore ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                                      placeholder="0"
                                                      className="w-20 outline-none text-[12px] font-mono px-2 py-1 rounded-lg"
                                                      style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }}
                                                    />
                                                    <p className="text-[11px]" style={{ color: C.muted }}>out of 10 · leave blank for no gate</p>
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    C={C}
                                                    inp={inp}
                                                    sessionToken={sessionToken}
                                                  />
                                                </div>
                                              )}
                                              {req.type === 'document_review' && (
                                                <div className="space-y-3">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                    <FileText className="w-3 h-3 flex-shrink-0" />Students upload a PDF, Word document, or text file for rubric-based review.
                                                  </div>
                                                  <div>
                                                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.muted }}>Document context</p>
                                                    <textarea value={req.context ?? ''} onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })} rows={3}
                                                      placeholder="Describe the intended audience, purpose, and any important requirements."
                                                      className="w-full resize-none outline-none text-[12px] px-3 py-2.5 rounded-lg" style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }} />
                                                  </div>
                                                  <div className="flex flex-wrap items-center gap-3">
                                                    <select value={req.documentReviewMode ?? 'ai_only'} onChange={e => updateReq(mod.id, les.id, req.id, { documentReviewMode: e.target.value as Requirement['documentReviewMode'] })} style={{ ...inp, width: 'auto', fontSize: 12 }}>
                                                      <option value="ai_only">AI review</option><option value="manual">Instructor review</option><option value="hybrid">AI + instructor review</option>
                                                    </select>
                                                    <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>Pass score</label>
                                                    <input type="number" min={0} max={100} value={req.minScore ?? ''} onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                      placeholder="70" className="w-20 outline-none text-[12px] px-2 py-1.5 rounded-lg" style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }} />
                                                    <span className="text-[11px]" style={{ color: C.muted }}>out of 100</span>
                                                  </div>
                                                  <RubricBuilder criteria={req.rubric ?? []} onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })} C={C} inp={inp} sessionToken={sessionToken} />
                                                </div>
                                              )}
                                            </div>
                                            )}
                                            </SortableVEShell>
                                          );
                                        })}
                                        </SortableContext>
                                        </DndContext>
                                        <button onClick={() => addReq(mod.id, les.id)}
                                          className="text-[12px] flex items-center gap-1 hover:opacity-70 font-medium" style={{ color: C.muted }}>
                                          <Plus className="w-3 h-3" /> Add task
                                        </button>
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

                            {/* Solution video + Add lesson */}
                            <div className="space-y-2 pt-1">
                              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                                style={{ background: C.card }}>
                                <LinkIcon className="w-3 h-3 flex-shrink-0" style={{ color: C.faint }} />
                                <input
                                  value={mod.solutionVideo || ''}
                                  onChange={e => updateModule(mod.id, { solutionVideo: e.target.value })}
                                  className="flex-1 bg-transparent text-[12px] outline-none"
                                  style={{ color: C.muted }}
                                  placeholder={`Solution video or file link for "${mod.title}" (YouTube, Bunny, Google Drive, PDF…)`} />
                              </div>
                              <button onClick={() => addLesson(mod.id)}
                                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2.5 rounded-xl w-full justify-center transition-opacity hover:opacity-80"
                                style={{ background: C.card, color: C.muted }}>
                                <Plus className="w-3 h-3" /> Add mission to {mod.title}
                              </button>
                            </div>
                          </div>
                        </div>
                        )}
                      </SortableVEShell>
                      );
                    })}
                    </SortableContext>
                    </DndContext>
                  </div>
                </div>
                </div>)}
                {activeSection === 'setup' && (
                <div className="space-y-4">

                {/* Industry card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Industry</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {INDUSTRIES.map(ind => (
                      <button key={ind.id} onClick={() => { setIndustry(ind.id); setConfig(c => c ? { ...c, industry: ind.id } : c); }}
                        className="flex items-center gap-2 px-3 py-3 rounded-xl text-left transition-all"
                        style={{ border: '1px solid transparent', background: industry === ind.id ? `${C.cta}12` : C.card, boxShadow: industry === ind.id ? `0 0 0 2px ${C.cta}` : 'none' }}>
                        <span className="text-base">{ind.emoji}</span>
                        <span className="text-[12px] font-semibold" style={{ color: C.text }}>{ind.label}</span>
                        {industry === ind.id && <Check className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: C.cta }} />}
                      </button>
                    ))}
                    <button onClick={() => setIndustry('other')}
                      className="flex items-center gap-2 px-3 py-3 rounded-xl text-left transition-all"
                      style={{ border: '1px solid transparent', background: industry === 'other' ? `${C.cta}12` : C.card, boxShadow: industry === 'other' ? `0 0 0 2px ${C.cta}` : 'none' }}>
                      <span className="text-base">✏️</span>
                      <span className="text-[12px] font-semibold" style={{ color: C.text }}>Other</span>
                      {industry === 'other' && <Check className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: C.cta }} />}
                    </button>
                  </div>
                  {industry === 'other' && (
                    <input
                      type="text"
                      value={customIndustry}
                      onChange={e => {
                        setCustomIndustry(e.target.value);
                        setConfig(c => c ? { ...c, industry: e.target.value } : c);
                      }}
                      placeholder="e.g. Logistics, Agriculture, Real Estate…"
                      style={{ ...inp, fontSize: 13 }}
                      autoFocus
                    />
                  )}
                </div>

                {/* Duration card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Duration</p>
                  <div className="flex flex-wrap gap-2">
                    {['1-2 hours', '3-4 hours', '1 day', '1 week'].map(option => {
                      const selected = config.duration === option;
                      return (
                        <button key={option} type="button" onClick={() => setConfig(c => c ? { ...c, duration: option } : c)}
                          className="rounded-xl px-3 py-2 text-[12px] font-semibold transition-all"
                          style={{ background: selected ? `${C.cta}14` : C.card, color: selected ? C.cta : C.muted, boxShadow: selected ? `0 0 0 2px ${C.cta}` : 'none' }}>
                          {option}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    value={config.duration || ''}
                    onChange={e => setConfig(c => c ? { ...c, duration: e.target.value } : c)}
                    style={{ ...inp, fontSize: 13 }}
                    placeholder="e.g. 4-6 hours, 2 weeks, 3 days…"
                  />
                  <p className="text-[11px]" style={{ color: C.faint }}>Shown to students as an estimate of how long this experience takes to complete.</p>
                </div>
                </div>)}
                {activeSection === 'branding' && (
                <div className="space-y-4">

                {/* Tool Logos card */}
                {(config.tools || []).length > 0 && (
                  <div style={card} className="p-5 space-y-3">
                    <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Tool Logos</p>
                    <p className="text-[11px]" style={{ color: C.faint }}>Upload or paste a logo URL for each tool. Shown to students on the experience page.</p>
                    <div className="space-y-2">
                      {(config.tools || []).map(t => {
                        const logo = (config.toolLogos || {})[t];
                        return (
                          <div key={t} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl p-3" style={{ background: C.card }}>
                            {/* Logo preview */}
                            <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
                              style={{ background: C.pill }}>
                              {logo
                                ? <img src={logo} alt={t} className="w-full h-full object-contain p-0.5" />
                                : <span className="text-[10px] font-bold" style={{ color: C.muted }}>{t[0]}</span>
                              }
                            </div>
                            {/* Tool name */}
                            <span className="text-[13px] font-medium flex-1 min-w-0 truncate" style={{ color: C.text }}>{t}</span>
                            {/* URL input */}
                            <input
                              value={logo || ''}
                              onChange={e => setConfig(c => c ? { ...c, toolLogos: { ...(c.toolLogos || {}), [t]: e.target.value } } : c)}
                              placeholder="Paste URL or upload"
                              style={{ ...inp, fontSize: 12, padding: '6px 10px', width: 'auto', flex: 1 }}
                            />
                            {/* Upload button */}
                            <button
                              onClick={() => { (toolLogoRef.current as any)._toolName = t; toolLogoRef.current?.click(); }}
                              disabled={uploadingToolLogo === t}
                              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 transition-all hover:opacity-70"
                              style={{ color: C.muted, background: C.pill }}>
                              {uploadingToolLogo === t ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            </button>
                            {/* Remove logo */}
                            {logo && (
                              <button onClick={() => setConfig(c => {
                                if (!c) return c;
                                const logos = { ...(c.toolLogos || {}) };
                                delete logos[t];
                                return { ...c, toolLogos: logos };
                              })} style={{ color: C.faint }} className="hover:text-red-400 transition-colors flex-shrink-0">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <input
                      ref={toolLogoRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const name = (e.target as any)._toolName as string;
                        if (name) handleToolLogoUpload(e, name);
                      }}
                    />
                  </div>
                )}

                {/* Cover image card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Cover Image</p>
                  {coverImage && (
                    <img src={resolveCoverUrl(coverImage)} alt="cover" className="w-full object-cover rounded-2xl"
                      style={{ height: 180 }} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                  )}
                  {!coverImage && (
                    <button type="button" onClick={() => coverRef.current?.click()}
                      className="w-full min-h-36 rounded-2xl flex flex-col items-center justify-center gap-2 transition-opacity hover:opacity-75"
                      style={{ background: C.card, border: `1px dashed ${C.cardBorder}`, color: C.muted }}>
                      <Images className="w-6 h-6" />
                      <span className="text-[13px] font-semibold">Upload or choose a cover image</span>
                      <span className="text-[11px]" style={{ color: C.faint }}>Recommended 16:9 landscape image</span>
                    </button>
                  )}
                  <div className="flex gap-2">
                    <input style={{ ...inp, fontSize: 13 }} value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="Paste image URL…" />
                    <button onClick={() => coverRef.current?.click()} disabled={uploadingCover}
                      className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 transition-all hover:opacity-70"
                      style={{ color: C.muted, background: C.card }}>
                      {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library"
                      className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 transition-all hover:opacity-70"
                      style={{ color: C.muted, background: C.card }}>
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

                {/* Completion badge card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Completion Badge</p>
                  <p className="text-[12px] leading-relaxed" style={{ color: C.faint }}>
                    Students earn this badge on completing the virtual experience, alongside their certificate.
                  </p>
                  {config?.badgeImageUrl && (
                    <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.card }}>
                      <img src={config.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0"
                        style={{ border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                      <button onClick={() => setConfig(c => c ? { ...c, badgeImageUrl: null } : c)}
                        className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:opacity-70 disabled:opacity-50"
                      style={{ color: C.muted, background: C.card }}>
                      {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {uploadingBadge ? 'Uploading...' : config?.badgeImageUrl ? 'Change badge' : 'Upload badge'}
                    </button>
                  </div>
                  <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeUpload} />
                </div>
                </div>)}
                {activeSection === 'delivery' && (
                <div className="space-y-4">

                {/* Target Audience card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Target Audience</p>
                  {cohorts.length === 0
                    ? <p className="text-[13px]" style={{ color: C.faint }}>No cohorts available.</p>
                    : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {cohorts.map(c => {
                          const sel = selectedCohorts.includes(c.id);
                          return (
                            <button key={c.id}
                              onClick={() => setSelectedCohorts(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                              className="flex items-center gap-2 px-3 py-3 rounded-xl text-[13px] font-semibold text-left transition-all"
                              style={{ border: '1px solid transparent', background: sel ? `${C.cta}14` : C.card, color: sel ? C.cta : C.muted, boxShadow: sel ? `0 0 0 2px ${C.cta}` : 'none' }}>
                              <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ background: sel ? C.cta : C.pill, color: sel ? C.ctaText : C.faint }}>
                                {sel && <Check className="w-3 h-3" />}
                              </span>
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                  }
                </div>

                {/* Deadline card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.muted }}>Deadline</p>
                  <div className="flex flex-wrap gap-2">
                    {['', '7', '14', '30'].map(days => {
                      const selected = deadlineDays === days;
                      return (
                        <button key={days || 'none'} type="button" onClick={() => setDeadlineDays(days)}
                          className="rounded-xl px-3 py-2 text-[12px] font-semibold transition-all"
                          style={{ background: selected ? `${C.cta}14` : C.card, color: selected ? C.cta : C.muted, boxShadow: selected ? `0 0 0 2px ${C.cta}` : 'none' }}>
                          {days ? `${days} days` : 'No deadline'}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      style={{ ...inp, width: 80, textAlign: 'center' }}
                      type="number"
                      min={1}
                      max={365}
                      placeholder=""
                      value={deadlineDays}
                      onChange={e => setDeadlineDays(e.target.value.replace(/\D/g, ''))}
                    />
                    <span className="text-[13px]" style={{ color: C.muted }}>days from assignment</span>
                  </div>
                  <p className="text-[11px]" style={{ color: C.faint }}>Students have this many days from when their cohort is assigned to complete the experience. Leave blank for no deadline.</p>
                </div>

                {/* Save section */}
                <div className="space-y-2 rounded-2xl p-5 pb-16 sm:pb-5" style={{ background: C.pill }}>
                  {saveError && (
                    <div className="px-4 py-3 rounded-xl text-[13px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {saveError}
                    </div>
                  )}
                  {saveSuccess && (
                    <div className="px-4 py-3 rounded-xl text-[13px] flex items-center gap-2" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a', border: '1px solid rgba(22,163,74,0.2)' }}>
                      <Check className="w-4 h-4" /> Saved. Your changes are kept and you can continue editing.
                    </div>
                  )}
                  <button onClick={() => handleSave('published')} disabled={saving}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 disabled:opacity-60"
                    style={{ background: C.cta, color: C.ctaText }}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {effectiveId ? 'Update Program' : 'Publish Program'}
                  </button>
                  <button onClick={() => handleSave('draft')} disabled={saving}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-[15px] transition-all hover:opacity-70 disabled:opacity-60"
                    style={{ color: C.muted, background: C.card }}>
                    <Save className="w-4 h-4" /> Save as Draft
                  </button>
                </div>
                </div>)}

                </motion.div>
                </AnimatePresence>
              </div>
              );
            })()}
          </div>
          );
        })()}

      {/* Bunny Video Picker Modal */}
      <AnimatePresence>
        {bunnyPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            onClick={() => setBunnyPickerOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col"
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, maxHeight: '82vh' }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: '#FF6B35' }}>
                    <Video className="w-3.5 h-3.5 text-white"/>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: C.text }}>Pick from Bunny Library</span>
                </div>
                <button onClick={() => setBunnyPickerOpen(false)} style={{ color: C.faint }}><X className="w-4 h-4"/></button>
              </div>
              {/* Search */}
              <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-xl" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
                    <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                    <input type="text" value={bunnySearch}
                      onChange={e => setBunnySearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && openBunnyPicker(bunnyPickerTarget!, bunnySearch, bunnyCollection)}
                      placeholder="Search videos..."
                      className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.text }}/>
                  </div>
                  <button onClick={() => openBunnyPicker(bunnyPickerTarget!, bunnySearch, bunnyCollection)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: '#FF6B35', color: 'white' }}>Search</button>
                </div>
              </div>
              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {bunnyCollections.length > 0 && (
                  <div className="w-44 flex-shrink-0 overflow-y-auto py-2" style={{ borderRight: `1px solid ${C.cardBorder}` }}>
                    <button onClick={() => { setBunnyCollection(''); openBunnyPicker(bunnyPickerTarget!, bunnySearch, ''); }}
                      className="w-full text-left px-4 py-2 text-xs font-medium"
                      style={{ background: bunnyCollection === '' ? `${C.cta}18` : 'transparent', color: bunnyCollection === '' ? C.cta : C.muted }}>
                      All videos
                    </button>
                    {bunnyCollections.map(col => (
                      <button key={col.guid}
                        onClick={() => { setBunnyCollection(col.guid); openBunnyPicker(bunnyPickerTarget!, bunnySearch, col.guid); }}
                        className="w-full text-left px-4 py-2 text-xs"
                        style={{ background: bunnyCollection === col.guid ? `${C.cta}18` : 'transparent', color: bunnyCollection === col.guid ? C.cta : C.muted }}>
                        <span className="block font-medium truncate">{col.name}</span>
                        <span className="text-[10px]" style={{ color: C.faint }}>{col.videoCount} videos</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4">
                  {bunnyLoading && <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>}
                  {bunnyError && !bunnyLoading && <div className="text-center py-10 text-sm" style={{ color: '#ef4444' }}>{bunnyError}</div>}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.faint }}>No videos found.</div>}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {bunnyVideos.map(v => (
                        <button key={v.guid} onClick={() => selectBunnyVideo(v.embedUrl)}
                          className="text-left rounded-xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg group"
                          style={{ border: `1px solid ${C.cardBorder}`, background: C.input }}>
                          <div className="relative aspect-video bg-black overflow-hidden">
                            {v.thumbnail
                              ? <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex'; }}/>
                              : null}
                            <div className="w-full h-full items-center justify-center" style={{ display: v.thumbnail ? 'none' : 'flex' }}>
                              <Video className="w-6 h-6 opacity-30" style={{ color: C.faint }}/>
                            </div>
                            {v.status !== 4 && (
                              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                                <span className="text-xs text-white font-medium">Processing...</span>
                              </div>
                            )}
                            {v.duration > 0 && (
                              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(0,0,0,0.75)', color: 'white' }}>
                                {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                              </span>
                            )}
                          </div>
                          <div className="px-2.5 py-2">
                            <p className="text-xs font-medium line-clamp-2 leading-snug" style={{ color: C.text }}>{v.title}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
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
