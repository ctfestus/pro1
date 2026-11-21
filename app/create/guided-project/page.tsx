'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LOCKABLE_CODE_REVIEW_LANGUAGES } from '@/lib/code-review-languages';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary, uploadCoverImage } from '@/lib/uploadToCloudinary';
import { DEFAULT_VE_ACCENT } from '@/lib/ve-accent';
import { THEME_ACCENT_COLORS, accentColorFor, type ThemeColor } from '@/lib/theme-types';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ImageLibrary } from '@/components/ImageLibrary';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import type { LessonDoc } from '@/lib/lesson-doc';
import { safeEmbedUrl, isHtmlEmbedUrl, HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';
import { clampLinkedInSharePoints, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';
import { validateVirtualExperienceForPublish } from '@/lib/virtual-experience-validation';
import {
  attachDeliverableDescriptionDoc,
  convertLegacyEmailDeliverable,
  htmlToPlainText,
  plainTextToRichHtml,
  reconcileImprovedDeliverableDescription,
} from '@/lib/ve-deliverable-content';
import { useTheme } from '@/components/ThemeProvider';
import {
  ArrowLeft, MoreHorizontal, Sparkles, Loader2, Save, ChevronDown, ChevronUp, ChevronRight, Plus, X, Check, Upload, Star, Clock, Link as LinkIcon, FileText, FileCode, Database, PenLine, Table, GripVertical, Video, Search, Eye, Images, Paperclip, Mail, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { RubricFileImportActions } from '@/components/RubricFileImportActions';
import { mergeRubricCriteria, type RubricImportKind } from '@/lib/rubric-criteria';
import { useToolIcons } from '@/lib/use-tool-icons';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { AiTextarea } from '@/components/AiTextarea';
import { loadLessonHtmlToDoc } from '@/components/lesson/loadLessonHtmlToDoc';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

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

// Like attachLessonDocs, but preserves canonical interactive docs through global AI Improve.
// Mission docs are retained when their HTML fallback is unchanged. Deliverable docs are always
// retained because the Improve endpoint only receives their lossy HTML fallback; authors use the
// document-aware AI tools inside the interactive instructions editor to change those safely.
function preserveLessonDocs<T extends { modules?: unknown[] }>(cfg: T, prior: { modules?: any[] } | null | undefined, lessonHtmlToDoc: (html: string) => LessonDoc): T {
  if (!cfg?.modules) return cfg;
  // Compare bodies ignoring whitespace so harmless reformatting by the AI is not
  // mistaken for a rewrite (which would trigger a lossy doc rebuild).
  const norm = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();
  const priorById = new Map<string, { body?: string; doc?: LessonDoc }>();
  const priorRequirementById = new Map<string, {
    type?: string;
    description?: string;
    descriptionFormat?: 'rich';
    descriptionDoc?: LessonDoc;
  }>();
  (prior?.modules || []).forEach((m: any) => (m?.lessons || []).forEach((l: any) => {
    if (l?.id) priorById.set(l.id, { body: l.body, doc: l.doc });
    (l?.requirements || []).forEach((r: any) => {
      if (r?.id) priorRequirementById.set(r.id, {
        type: r.type,
        description: r.description,
        descriptionFormat: r.descriptionFormat,
        descriptionDoc: r.descriptionDoc,
      });
    });
  }));
  return {
    ...cfg,
    modules: (cfg.modules as any[]).map((m: any) => ({
      ...m,
      lessons: Array.isArray(m?.lessons)
        ? m.lessons.map((l: any) => {
            let lesson = l;
            const prev = l.id ? priorById.get(l.id) : undefined;
            if (l?.body) {
              if (prev?.doc && norm(prev.body) === norm(l.body)) lesson = { ...lesson, doc: prev.doc };
              else {
                try { lesson = { ...lesson, doc: lessonHtmlToDoc(l.body) }; }
                catch { /* keep body-only if the HTML cannot be parsed */ }
              }
            }
            if (!Array.isArray(l?.requirements)) return lesson;
            const requirements = l.requirements.map((r: any) =>
              reconcileImprovedDeliverableDescription(
                r,
                r.id ? priorRequirementById.get(r.id) : undefined,
                lessonHtmlToDoc,
              ));
            return { ...lesson, requirements };
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
  divider: 'rgba(0,0,0,0.07)', input: '#F8F8F8', pill: '#F2F4F2', field: '#F4F6F9',
  nav: '#F2F5FA', navBorder: 'rgba(0,0,0,0.07)',
  modeBorder: 'rgba(0,0,0,0.09)',
};
const DARK_C = {
  page: '#17181E', card: '#1E1F26', cardBorder: 'rgba(255,255,255,0.07)',
  cardShadow: '0 1px 4px rgba(0,0,0,0.40)', green: '#00bf63', lime: '#00bf63',
  cta: '#00bf63', ctaText: 'white', text: '#f0f0f0', muted: '#aaa', faint: '#777',
  divider: 'rgba(255,255,255,0.07)', input: 'rgba(255,255,255,0.05)', pill: '#242630', field: 'rgba(255,255,255,0.055)',
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
  descriptionFormat?: 'rich';
  descriptionDoc?: LessonDoc;
  type: 'task' | 'deliverable' | 'reflection' | 'mcq' | 'text' | 'upload' | 'briefing' | 'scenario_update' | 'decision' | 'debrief' | 'dashboard_critique' | 'code_review' | 'excel_review' | 'document_review' | 'linkedin_share';
  options?: string[];
  optionFeedback?: string[];
  correctAnswer?: string;
  expectedAnswer?: string;
  rubric?: string[];
  schema?: string;
  reviewLanguage?: string;   // code_review: fixed language; unset = the learner chooses
  context?: string;
  reviewSheetNames?: string[];
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  aiReview?: boolean;
  emailFrame?: boolean;
  emailBody?: string;
  attachments?: ReqAttachment[];
  accentColor?: string;   // task/deliverable: own color; unset follows the experience accent
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
  // The experience's accent, as a course has one: a theme colour, or a custom colour that wins.
  theme?: ThemeColor;
  customAccent?: string;
  industry: string;
  difficulty: string;
  role: string;
  company: string;
  duration: string;
  tools: string[];
  /** Topics the experience covers (migration 248), shown on cards and the hover preview. */
  tags?: string[];
  // Legacy per-experience logo map. Nothing renders or edits it any more -- logos resolve by
  // name through the shared tool-icon registry, as a course's category does. It is still loaded
  // and saved so that saving an experience does not blank a column other tenants may still hold
  // data in; a later migration can drop it once that is confirmed everywhere.
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
  // 'overview' is the Details tab: the experience card, then industry, duration and level, then
  // the cover image and badge. They were three tabs (Overview, Setup, Branding) for one subject.
  { id: 'overview',   label: 'Details' },
  { id: 'brief',      label: 'Brief' },
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'delivery',   label: 'Publish' },
] as const;

function uid() { return Math.random().toString(36).slice(2, 10); }

// What each task type is called in the editor, matching the type list.
const REQ_TYPE_NAMES: Record<string, string> = {
  mcq: 'Multiple choice', text: 'Short answer', reflection: 'Reflection', upload: 'File upload',
  task: 'Deliverable', deliverable: 'Deliverable', linkedin_share: 'LinkedIn share',
  briefing: 'Manager email', debrief: 'Email reply to manager', scenario_update: 'Team chat update',
  decision: 'Team chat decision', dashboard_critique: 'AI review: dashboard', code_review: 'AI review: code',
  excel_review: 'AI review: Excel', document_review: 'AI review: document',
};

type EditorTheme = { card: string; text: string; muted: string; faint: string; field: string; divider: string };

/** The "..." menu on a milestone, mission or task row: Move to (when there is somewhere to go)
 * and Delete. Keeps the row itself to its title and type. */
function RowMenu({ C, label, onDelete, moveTargets }: {
  C: EditorTheme;
  label: string;
  onDelete: () => void;
  moveTargets?: { group?: string; label: string; onPick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setMoving(false); };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const item = 'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors';
  const groups = Array.from(new Set((moveTargets ?? []).map(t => t.group ?? '')));
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(v => !v); setMoving(false); }}
        className="w-8 h-8 rounded-lg grid place-items-center transition-opacity hover:opacity-70" style={{ color: C.faint }}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 min-w-[200px] max-h-72 overflow-auto rounded-xl p-2"
          style={{ background: C.card, boxShadow: `0 0 0 1px ${C.divider}, 0 12px 28px rgba(15,23,42,0.16)` }}>
          {!moving ? (
            <>
              {!!moveTargets?.length && (
                <button type="button" role="menuitem" className={item} style={{ color: C.text }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.field)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => setMoving(true)}>Move to...</button>
              )}
              <button type="button" role="menuitem" className={item} style={{ color: '#dc2626' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.field)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
            </>
          ) : (
            groups.map(g => (
              <div key={g || 'all'}>
                {g && <p className="px-3 pt-2 pb-1 text-xs font-semibold" style={{ color: C.faint }}>{g}</p>}
                {(moveTargets ?? []).filter(t => (t.group ?? '') === g).map((t, i) => (
                  <button key={`${g}-${i}`} type="button" role="menuitem" className={item} style={{ color: C.text }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.field)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { setOpen(false); setMoving(false); t.onPick(); }}>{t.label || 'Untitled'}</button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Quick picks under "Skills you will use", mirroring COURSE_CATEGORIES in the course editor.
// These are only shortcuts: any name can be typed, and its logo resolves through the shared
// tool-icon registry if one has been uploaded for it.
const VE_TOOL_SUGGESTIONS = ['Excel', 'Power BI', 'SQL', 'Tableau', 'Python', 'PowerPoint'] as const;

/**
 * Skill names are free text typed inline, so a rename can leave a blank or a duplicate of another
 * row -- `addTool` guards against both, renaming cannot. Harmless in the editor, not on the
 * experience page: a blank renders an empty chip, and two rows sharing a name collide because the
 * chips are keyed by it. Trim, drop blanks, and dedupe case-insensitively, keeping the spelling
 * that appears first. Applied when a field loses focus and again on save, so nothing reaches the
 * database unnormalized even if focus never moved.
 */
function normalizeToolList(tools: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tools ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}


function RubricBuilder({ criteria, onChange, onImport, C, inp, sessionToken, note, sheetNames, grader = 'AI grades each criterion as pass or fail' }: {
  criteria: string[];
  // The requirement's worksheets, so a workbook upload is read the same way the review reads it.
  sheetNames?: string[];
  onChange: (rubric: string[]) => void;
  onImport: (criteria: string[]) => void;
  C: typeof LIGHT_C;
  inp: React.CSSProperties;
  sessionToken?: string;
  // Only the review types whose pass gate reads the rubric pass one, so the copy stays true
  // for the types still gated on the AI quality score.
  note?: string;
  // Who marks the criteria, shown beside the heading.
  grader?: string;
}) {
  const [draft, setDraft] = useState('');
  const [extracting, setExtracting] = useState<RubricImportKind | null>(null);
  const [extractError, setExtractError] = useState('');

  const add = () => {
    const val = draft.trim();
    if (!val) return;
    onChange([...criteria, val]);
    setDraft('');
  };

  const handleFile = async (label: RubricImportKind, file: File) => {
    if (!file || !sessionToken) return;
    setExtracting(label);
    setExtractError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      form.append('reviewSheetNames', JSON.stringify(sheetNames ?? []));
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Rubric import failed.');
      if (!json.criteria?.length) throw new Error('No rubric criteria were found in this file.');
      onImport(json.criteria);
    } catch (error: any) {
      setExtractError(error?.message || 'Rubric import failed. Please try again.');
    } finally {
      setExtracting(null);
    }
  };

  return (
    <div className="space-y-2" style={{ background: 'transparent' }}>
      <p className="text-xs font-semibold" style={{ color: C.muted }}>
        Grading rubric
        <span className="ml-2 font-normal" style={{ color: C.faint }}>
          (optional) {grader}
        </span>
      </p>
      {note && <p className="text-[11px]" style={{ color: C.faint }}>{note}</p>}
      {sessionToken && (
        <div className="space-y-2">
          <RubricFileImportActions
            busy={extracting}
            background={C.card}
            color={C.muted}
            border={`1px solid ${C.cardBorder}`}
            onSelect={handleFile}
          />
          <p className="text-[11px]" style={{ color: C.faint }}>
            Upload completed work or your own rubric file to set the criteria.
          </p>
          {extractError && <p className="text-[11px]" style={{ color: '#ef4444' }}>{extractError}</p>}
        </div>
      )}
      {criteria.map((crit, ci) => (
        <div key={ci} className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: C.pill }}>
          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: C.card }}>
            <span className="text-[11px] font-black" style={{ color: C.muted }}>{ci + 1}</span>
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
  const toolIcon = useToolIcons();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  // Step 1 state
  const [creationMode, setCreationMode] = useState<'ai' | 'data' | 'manual' | null>(null);
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
  const [editingField, setEditingField] = useState<string | null>(null);

  // AI improve state
  const [improveInstruction, setImproveInstruction] = useState('');
  const [improving,   setImproving]   = useState(false);
  const [showImprove, setShowImprove] = useState(false);

  const coverRef = useRef<HTMLInputElement>(null);

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
        setConfig(preserveLessonDocs(json.config, config, await loadLessonHtmlToDoc()) as ProjectConfig);
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

  // Dataset download
  const downloadDataset = () => {
    const dataset = (config as any)?.dataset;
    if (!dataset) return;
    if (dataset.url) {
      window.open(dataset.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const content = dataset.csvContent || '';
    if (content) {
      const blob = new Blob([content], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = dataset.filename || 'dataset.csv'; a.click();
      URL.revokeObjectURL(url);
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
        setActiveSection(readinessIssues[0].section === 'branding' ? 'overview' : readinessIssues[0].section);
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
    border: '1.5px solid transparent', background: C.field, boxShadow: 'none',
    color: C.text, fontSize: 14, outline: 'none', transition: 'background 160ms ease',
  } as React.CSSProperties;

  // A section of a tab: no panel of its own, set off from the one above by a hairline and space.
  const card = {
    background: 'transparent', border: 'none', borderTop: `1px solid ${C.divider}`,
    borderRadius: 0, boxShadow: 'none', paddingLeft: 0, paddingRight: 0, paddingTop: 20, paddingBottom: 20,
  } as React.CSSProperties;

  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text, fontFamily: "'Google Sans', 'Inter', sans-serif" }}>
      {/* The first section on a tab has no line above it (the tab bar draws one). Editors in this
                    page show the common tools and Add interactive; the rest sit under More, which the
                    shared lesson editor already offers on narrow screens. */}
                <style>{`.ve-tab > .space-y-4 > div:first-child { border-top: none !important; padding-top: 4px !important; }
.ve-tab .lesson-editor-toolbar__secondary, .ve-tab .lesson-editor-toolbar__media { display: none !important; }
.ve-tab .lesson-editor-toolbar__more { display: inline-flex !important; }
.ve-tab input:focus-visible, .ve-tab textarea:focus-visible, .ve-tab select:focus-visible { outline: none !important; box-shadow: inset 0 0 0 2px ${C.cta} !important; }
.ve-tab .ve-shell > input:focus-visible, .ve-tab [contenteditable="true"]:focus-visible { outline: none !important; box-shadow: none !important; }
.ve-tab .ve-shell:focus-within, .ve-tab .lesson-editor-shell:focus-within { outline: 2px solid ${C.cta}; outline-offset: -2px; }`}</style>
      {/* Experience Studio header */}
      <header className="px-4 sm:px-6 pt-6" style={{ background: C.page }}>
        <div className={`${step === 2 ? 'max-w-6xl' : 'max-w-4xl'} mx-auto px-4 sm:px-6 pt-5 pb-3 rounded-t-2xl`}
          style={{ background: C.card }}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard" aria-label="Back to dashboard"
                onClick={e => { if (hasUnsavedChanges() && !window.confirm('You have unsaved changes. Leave without saving?')) e.preventDefault(); }}
                className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-70 flex-shrink-0"
                style={{ color: C.muted, background: C.pill }}>
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="min-w-0">
                <p className="text-[12px] mb-0.5" style={{ color: C.faint }}>Virtual experience</p>
                <h1 className="text-base sm:text-[18px] font-bold leading-tight truncate" style={{ color: C.text }}>
                  {step === 2 ? (title || 'Untitled experience') : (effectiveId ? 'Edit Virtual Experience' : 'New Virtual Experience')}
                </h1>
              </div>
            </div>
            {step === 2 ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                {veSlug ? (
                  <a href={`/${veSlug}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all hover:opacity-70"
                    style={{ color: C.muted, background: C.pill, textDecoration: 'none' }}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </a>
                ) : (
                  <span title="Save the experience first to preview it"
                    className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold cursor-not-allowed opacity-40"
                    style={{ color: C.muted, background: C.pill }}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </span>
                )}
                <button disabled={saving}
                  onClick={() => { if (savedStatus !== 'published' || window.confirm('Unpublish this experience? Learners lose access until you publish it again.')) handleSave('draft'); }}
                  title={savedStatus === 'published' ? 'Takes it away from learners and their cohorts until you publish it again' : undefined}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors hover:opacity-70"
                  style={{ color: C.muted, background: 'transparent' }}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  {savedStatus === 'published' ? 'Unpublish' : 'Save draft'}
                </button>
                <button onClick={() => handleSave('published')} disabled={saving}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-[12px] font-bold transition-all hover:opacity-85"
                  style={{ background: saveSuccess ? '#16a34a' : C.cta, color: C.ctaText }}>
                  {saveSuccess ? <Check className="w-3.5 h-3.5"/> : <CheckCircle2 className="w-3.5 h-3.5"/>}
                  {saveSuccess ? 'Saved' : savedStatus === 'published' ? 'Publish changes' : 'Publish'}
                </button>
              </div>
            ) : (
              null
            )}
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 pb-4 pt-0">
        {step === 2 && (saveError || saveWarning) && (
          <div className="max-w-6xl mx-auto pt-3">
            <div className="px-4 py-3 rounded-xl text-sm flex items-start gap-2"
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
          <div className="max-w-4xl mx-auto pb-6">
          <div className="rounded-b-2xl" style={{ background: C.card, boxShadow: C === DARK_C ? '0 16px 38px rgba(0,0,0,0.12)' : '0 16px 38px rgba(15,23,42,0.045)' }}>
            <div className="px-6 sm:px-8 pt-2 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
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
                            style={{ background: selected ? `${C.cta}1a` : C.field, color: selected ? C.cta : C.text, boxShadow: selected ? `inset 0 0 0 1.5px ${C.cta}` : 'none' }}>
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
                    <div className="inline-flex rounded-[10px] p-[3px]" style={{ background: C.field }}>
                      {([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] as const).map(([id, label]) => {
                        const selected = difficulty === id;
                        return (
                          <button key={id} type="button" aria-pressed={selected} onClick={() => setDifficulty(id)}
                            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                            style={{ background: selected ? C.card : 'transparent', color: selected ? C.text : C.muted, boxShadow: selected ? '0 1px 2px rgba(15,23,42,0.12)' : 'none' }}>
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
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 0 2px' }}>
                        <input
                          type="checkbox"
                          checked={emailStyle}
                          onChange={e => setEmailStyle(e.target.checked)}
                          style={{ marginTop: 2, accentColor: C.cta, flexShrink: 0 }}
                        />
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Present tasks as workplace emails</span>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                            Wraps every task, upload, and AI review in an email thread from the manager. The AI will also write the email body for each one.
                          </p>
                        </div>
                      </label>
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
                      <div className="flex rounded-[10px] overflow-hidden text-[12px] p-[3px]" style={{ background: C.field }}>
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
                            style={{ border: 'none', color: C.text, background: C.field }}>
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
                          placeholder={"Paste CSV data here, or upload a file above…\n\ndate,region,amount,status\n2024-01-01,Lagos,45000,Completed\n2024-01-02,Abuja,32000,Pending"}
                        />
                        {datasetCsv.trim() && (
                          <div className="flex items-center gap-2 text-sm" style={{ color: C.faint }}>
                            <Table className="w-3.5 h-3.5"/>
                            {datasetCsv.trim().split('\n').length} rows detected
                            {creationMode === 'ai' && ' · AI will generate questions from these exact values'}
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
                          placeholder="https://docs.google.com/spreadsheets/… or any public CSV/sheet URL"
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
                          placeholder={creationMode === 'ai' ? 'Leave blank to let AI write one, or describe the dataset yourself…' : 'e.g. Q3 regional sales transactions with status and amount columns.'}
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
                      ? <><Loader2 className="w-5 h-5 animate-spin"/> Generating…</>
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
                      {datasetCsv.trim() ? 'Analysing your data and generating questions…' : 'Creating company scenario, milestones, missions and dataset…'}
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
          const dataset = config.dataset;
          const experienceAccent = accentColorFor(config.customAccent, config.theme) ?? DEFAULT_VE_ACCENT;

          return (
          <div className="max-w-6xl mx-auto py-0">
            {/* Carousel: navigable sections */}
            {(() => {
              const ids = VE_SECTIONS.map(s => s.id) as readonly string[];
              const si = ids.indexOf(activeSection);
              return (
              <div className="rounded-b-2xl overflow-hidden" style={{ background: C.card, border: 'none', boxShadow: C === DARK_C ? '0 16px 38px rgba(0,0,0,0.12)' : '0 16px 38px rgba(15,23,42,0.045)' }}>
                <nav className="flex items-center gap-6 overflow-x-auto px-6 sm:px-8" aria-label="Virtual experience editor sections"
                  style={{ scrollbarWidth: 'none', borderBottom: `1px solid ${C.divider}` }}>
                  {VE_SECTIONS.map(section => {
                    const active = activeSection === section.id;
                    return (
                      <button key={section.id} type="button" onClick={() => goToSection(section.id)} aria-current={active ? 'page' : undefined}
                        className="flex-shrink-0 pt-3 pb-3 text-[14px] font-semibold transition-colors"
                        style={{ color: active ? C.text : C.faint, borderBottom: `2px solid ${active ? C.cta : 'transparent'}`, marginBottom: -1 }}>
                        {section.label}
                      </button>
                    );
                  })}
                </nav>
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
                            <div key={i} className="ve-shell flex items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: C.field }}>
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
                          <button type="button" onClick={() => addTool()} disabled={!newToolDraft.trim()}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0 disabled:opacity-35"
                            style={{ background: C.cta, color: C.ctaText }}>
                            <Plus className="w-3 h-3" /> Add
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
                    <div className="p-4 rounded-xl" style={{ background: C.field, border: `1.5px dashed ${C.cardBorder}` }}>
                      <input ref={datasetReplaceRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.zip,.json" className="hidden" onChange={handleDatasetReplace} />
                      {dataset ? (
                        <div className="flex items-start gap-2">
                          <span className="text-base flex-shrink-0 mt-0.5">📊</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[12px] font-bold flex-1 min-w-0 truncate" style={{ color: C.text }}>{dataset.filename || 'Linked Dataset'}</p>
                              <button onClick={() => datasetReplaceRef.current?.click()} disabled={uploadingDatasetReplace}
                                className="flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 hover:opacity-70 transition-opacity" style={{ color: C.cta }}>
                                {uploadingDatasetReplace ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                {uploadingDatasetReplace ? 'Uploading...' : 'Replace file'}
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
                            <div className="flex items-center gap-2 mt-2">
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
                <div style={card}>
                  {/* Header strip */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: C.field }}>
                    <div style={{ width: 32, height: 32, borderRadius: 999, overflow: 'hidden', background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.text, flexShrink: 0 }}>
                      {managerPhoto ? <img src={managerPhoto} alt={managerName} className="w-full h-full object-cover" /> : managerInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: C.text }}>{managerName} <span className="font-normal" style={{ color: C.muted }}>| {managerTitle}</span></p>
                      <p className="text-[11px]" style={{ color: C.faint }}>To: New {config.role} · Your Brief</p>
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
                            className="text-[12px] font-semibold px-3 py-2 rounded-xl" style={{ color: C.muted, background: C.pill }}>Manage profiles</button>
                          <button type="button" onClick={() => { setEditingGuideId(null); setGuideDraft(emptyGuideDraft); setShowGuideForm(true); setGuideError(''); }}
                            className="text-[12px] font-bold flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ color: C.cta, background: `${C.cta}12` }}>
                            <Plus className="w-3.5 h-3.5" /> Add professional
                          </button>
                        </div>
                      </div>
                      <select disabled={guidesLoading} value={config.guideId || ''} onChange={e => selectExperienceGuide(e.target.value)} style={{ ...inp, fontSize: 14, opacity: guidesLoading ? 0.7 : 1 }}>
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
                          <p className="text-sm font-bold" style={{ color: C.text }}>Experience guide profiles</p>
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
                            <p className="text-sm font-bold truncate" style={{ color: C.text }}>{g.full_name}</p>
                            <p className="text-[11px] truncate" style={{ color: C.muted }}>{[g.professional_title, g.company].filter(Boolean).join(' · ') || 'Professional profile'}</p>
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
                        <button type="button" disabled={savingGuide} onClick={editingGuideId ? updateExperienceGuide : createExperienceGuide} className="px-3 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50" style={{ background: C.cta }}>{savingGuide ? 'Saving…' : editingGuideId ? 'Update profile' : 'Save profile'}</button>
                      </div>
                      {guideError && <p className="sm:col-start-2 sm:col-span-2 text-[11px] text-red-500">{guideError}</p>}
                      <label className="sm:col-start-2 sm:col-span-2 flex items-start gap-2 text-[11px] cursor-pointer" style={{ color: C.muted }}>
                        <input type="checkbox" checked={guideDraft.consent_confirmed} onChange={e => setGuideDraft(d => ({ ...d, consent_confirmed: e.target.checked }))} className="mt-0.5 accent-emerald-500" />
                        <span>I confirm I have permission to use this person’s name and profile photo in learner-facing experiences.</span>
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

                  {/* Scenario / background */}
                  <div className="pb-1">
                    <label className="text-xs font-semibold block mb-1" style={{ color: C.muted }}>Scenario</label>
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
                    <p className="text-xs font-semibold" style={{ color: C.muted }}>Learning outcomes</p>
                    <div className="space-y-2">
                      {(config.learnOutcomes || []).map((o, i) => (
                        <div key={i} className="ve-shell flex items-center gap-2 rounded-[10px] px-3 py-3" style={{ background: C.field }}>
                          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: `${C.cta}18` }}>
                            <Check className="w-3 h-3" style={{ color: C.cta }} />
                          </div>
                          <input value={o} onChange={e => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.map((x, j) => j === i ? e.target.value : x) } : c)}
                            ref={el => { if (el && focusOutcome === i) { el.focus(); setFocusOutcome(null); } }}
                            aria-label={`Learning outcome ${i + 1}`} placeholder="Describe what the learner will be able to do (empty rows are not saved)"
                            className="flex-1 bg-transparent text-[14px] outline-none" style={{ color: C.text }} />
                          <button onClick={() => setConfig(c => c ? { ...c, learnOutcomes: c.learnOutcomes.filter((_, j) => j !== i) } : c)}
                            style={{ color: C.faint }} className="hover:text-red-400 transition-colors flex-shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setFocusOutcome((config.learnOutcomes || []).length); setConfig(c => c ? { ...c, learnOutcomes: [...(c.learnOutcomes||[]), ''] } : c); }}
                      className="text-sm font-semibold flex items-center gap-2 px-2 py-2 hover:opacity-70" style={{ color: C.muted }}>
                      <Plus className="w-3.5 h-3.5" /> Add outcome
                    </button>
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
                        <div className="group py-4" style={{ borderTop: mi > 0 ? `1px solid ${C.divider}` : 'none' }}>

                          {/* Milestone heading */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-shrink-0" title="Drag to reorder milestone">{moduleDragHandle}</div>
                            <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: C.faint }}>Milestone {mi + 1}</span>
                            <input
                              value={mod.title}
                              onChange={e => updateModule(mod.id, { title: e.target.value })}
                              aria-label={`Milestone ${mi + 1} title`}
                              className="flex-1 bg-transparent text-base font-semibold outline-none min-w-0 rounded-lg px-2 -mx-2 py-1"
                              style={{ color: C.text }}
                              placeholder="Milestone title"
                            />
                            <RowMenu C={C} label={`Milestone ${mi + 1} options`} onDelete={() => removeModule(mod.id)} />
                          </div>

                          {/* Missions */}
                          <div className="space-y-1">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd(mod.id)}>
                            <SortableContext items={(mod.lessons || []).map(l => l.id)} strategy={verticalListSortingStrategy}>
                            {(mod.lessons || []).map((les, li) => {
                              const reqCount  = les.requirements?.length || 0;
                              const expandKey = `${mod.id}-${les.id}`;
                              return (
                              <SortableVEShell key={les.id} id={les.id}>
                                {({ dragHandle: lessonDragHandle }) => (
                                <div className="rounded-xl group" style={{ background: expandedModules.has(expandKey) ? C.field : 'transparent' }}>

                                  {/* Mission row: open it to edit the content and tasks */}
                                  <div className="flex items-center gap-2 px-2 py-2">
                                    <div className="flex-shrink-0" title="Drag to reorder mission">{lessonDragHandle}</div>
                                    <button type="button" onClick={() => toggleModule(expandKey)} aria-expanded={expandedModules.has(expandKey)}
                                      aria-label={expandedModules.has(expandKey) ? 'Close mission' : 'Open mission'}
                                      className="flex items-center gap-2 flex-shrink-0" style={{ color: C.muted }}>
                                      {expandedModules.has(expandKey) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold"
                                        style={{ background: expandedModules.has(expandKey) ? C.card : C.field, color: C.muted }}>{li + 1}</span>
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
                                          isDark={C === DARK_C}
                                          accentColor={experienceAccent}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input style={{ ...inp, fontSize: 14, flex: 1, background: C.card }} value={les.videoUrl || ''} placeholder="Video link (YouTube, Vimeo, Bunny or Canva)"
                                          aria-label="Video link" onChange={e => updateLesson(mod.id, les.id, { videoUrl: e.target.value })} />
                                        <button type="button" onClick={() => openBunnyPicker(`${mod.id}::${les.id}`)}
                                          title="Choose a video from the Bunny library"
                                          className="flex items-center gap-2 px-1 py-2 text-sm font-semibold flex-shrink-0 whitespace-nowrap transition-opacity hover:opacity-70"
                                          style={{ color: '#FF6B35' }}>
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
                                          <div className="flex items-center gap-2 px-1 py-2 text-sm font-semibold flex-shrink-0 whitespace-nowrap transition-opacity hover:opacity-70"
                                            style={{ color: C.muted }}>
                                            <FileCode className="w-3.5 h-3.5"/> HTML
                                          </div>
                                        </label>
                                      </div>
                                      {(() => {
                                        const embedUrl = safeEmbedUrl(les.videoUrl || '');
                                        return embedUrl ? (
                                          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
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
                                          const opts = req.options?.length ? req.options : ['', '', '', ''];
                                          // One neutral style for the notes that say what a task type does.
                                          const tc = { bg: C.pill, color: C.muted };
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
                                                  <span className="flex-shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ background: C.field, color: C.muted }}>
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
                                              {openReqs.has(req.id) && (<>
                                              <div className="flex flex-wrap items-center gap-2">
                                                <select value={req.type}
                                                  onChange={e => {
                                                    const type = e.target.value as Requirement['type'];
                                                    const wasDeliverable = req.type === 'task' || req.type === 'deliverable';
                                                    const isDeliverable = type === 'task' || type === 'deliverable';
                                                    updateReq(mod.id, les.id, req.id, {
                                                      type,
                                                      description: wasDeliverable && !isDeliverable && req.descriptionFormat === 'rich'
                                                        ? htmlToPlainText(req.description)
                                                        : req.description,
                                                      descriptionFormat: isDeliverable && wasDeliverable ? req.descriptionFormat : undefined,
                                                      descriptionDoc: isDeliverable && wasDeliverable ? req.descriptionDoc : undefined,
                                                      accentColor: undefined,
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
                                                      emailFrame: isDeliverable ? false : req.emailFrame,
                                                      // Grading settings belong to the old type: a pass mark or rubric
                                                      // carried over would grade the new one without showing it.
                                                      ...(type !== req.type ? {
                                                        rubric: undefined, context: undefined, schema: undefined, minScore: undefined,
                                                        reviewSheetNames: undefined, documentReviewMode: undefined, reviewLanguage: undefined,
                                                      } : {}),
                                                    });
                                                  }}
                                                  style={{ padding: '6px 9px', borderRadius: 9, border: '1px solid transparent', background: C.input, color: C.text, fontSize: 11, fontWeight: 700 }}>
                                                  <option value="mcq">Multiple choice</option>
                                                  <option value="text">Short answer</option>
                                                  <option value="reflection">Reflection</option>
                                                  <option value="upload">File upload</option>
                                                  <option value="task">Deliverable</option>
                                                  {/* The older deliverable type: listed only where a task still has it, so it shows correctly. */}
                                                  {req.type === 'deliverable' && <option value="deliverable">Deliverable (older)</option>}
                                                  <option value="linkedin_share">LinkedIn share</option>
                                                  <option value="briefing">Manager email</option>
                                                  <option value="debrief">Email reply to manager</option>
                                                  <option value="scenario_update">Team chat update</option>
                                                  <option value="decision">Team chat decision</option>
                                                  <option value="dashboard_critique">AI review: dashboard</option>
                                                  <option value="code_review">AI review: code</option>
                                                  <option value="excel_review">AI review: Excel</option>
                                                  <option value="document_review">AI review: document</option>
                                                </select>
                                                {!['briefing','scenario_update','decision','debrief','task','deliverable'].includes(req.type) && (
                                                  <button
                                                    type="button"
                                                    onClick={() => updateReq(mod.id, les.id, req.id, { emailFrame: !req.emailFrame })}
                                                    role="switch" aria-checked={!!req.emailFrame}
                                                    title={req.emailFrame ? 'This task arrives as an email from the manager. Click to show it as a plain card.' : 'Click to send this task as an email from the manager.'}
                                                    className="flex-shrink-0 flex items-center gap-2 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all"
                                                    style={{ background: req.emailFrame ? `${C.cta}1f` : C.card, color: req.emailFrame ? C.cta : C.muted, border: `1px solid ${req.emailFrame ? C.cta : C.cardBorder}` }}>
                                                    <Mail className="w-3 h-3" /> {req.emailFrame ? 'Sent as email' : 'Send as email'}
                                                  </button>
                                                )}
                                                {(req.type === 'task' || req.type === 'deliverable') && req.emailFrame && (
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      updateReq(mod.id, les.id, req.id, convertLegacyEmailDeliverable(req));
                                                    }}
                                                    title="Convert the email into the deliverable brief and checkbox presentation"
                                                    className="flex flex-shrink-0 items-center gap-2 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all"
                                                    style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309', border: '1px solid rgba(245,158,11,0.35)' }}>
                                                    <Mail className="h-3 w-3" /> Convert from email
                                                  </button>
                                                )}
                                              </div>
                                              <div>
                                                <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>
                                                  Title <span className="font-normal" style={{ color: C.faint }}>(the heading learners see)</span>
                                                </label>
                                                <input value={req.label}
                                                  onChange={e => updateReq(mod.id, les.id, req.id, { label: e.target.value })}
                                                  autoFocus={!req.label.trim()}
                                                  style={{ ...inp, fontWeight: 600, boxShadow: req.label.trim() ? 'none' : 'inset 0 0 0 1.5px #f59e0b' }}
                                                  placeholder={['mcq', 'text', 'decision'].includes(req.type) ? 'e.g. What is the churn rate for March?' : 'e.g. Send the cleaned customer file'} />
                                              </div>
                                              {(req.type === 'briefing' || req.type === 'debrief') ? (
                                                <>
                                                  <RichTextEditor
                                                    className="ve-shell"
                                                    value={req.description}
                                                    onChange={html => updateReq(mod.id, les.id, req.id, { description: html })}
                                                    placeholder={req.type === 'briefing' ? 'Write the email body - formatting, bullet points, and images are all supported...' : 'Describe what students should write in their debrief update...'}
                                                    onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
                                                    onRequestImage={requestRichTextImage}
                                                    enableAiAssist
                                                    enableNameTag
                                                  />
                                                  <p className="text-[11px]" style={{ color: C.faint }}>
                                                    {'Tip: insert {{first_name}} (or type {{name}} for the full name) to greet each student by name.'}
                                                  </p>
                                                  {req.type === 'briefing' && (
                                                    <div className="space-y-2">
                                                      {(req.attachments || []).map((att, ai) => (
                                                        <div key={ai} className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.field }}>
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
                                                            const { url } = await uploadToGithub(file, 've-email-attachments');
                                                            updateReq(mod.id, les.id, req.id, r => ({ attachments: [...(r.attachments || []), { name: file.name, url, mimeType: file.type }] }));
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
                                                    className="ve-shell"
                                                        value={req.emailBody || ''}
                                                        onChange={html => updateReq(mod.id, les.id, req.id, { emailBody: html })}
                                                        placeholder="Write the email the manager sends to the student..."
                                                        onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
                                                        onRequestImage={requestRichTextImage}
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
                                                  {req.type === 'task' || req.type === 'deliverable' ? req.emailFrame ? (
                                                    <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(245,158,11,0.10)', color: '#b45309' }}>
                                                      This legacy deliverable still uses its email body and attachments. Convert it from email to edit the new deliverable brief without losing the instructions learners currently see.
                                                    </p>
                                                  ) : (
                                                    <div className="space-y-3">
                                                      <div>
                                                        <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>
                                                          Deliverable instructions
                                                        </p>
                                                        <LessonEditor
                                                          key={`${req.id}-instructions`}
                                                          doc={req.descriptionDoc}
                                                          bodyFallback={req.descriptionFormat === 'rich' ? req.description : plainTextToRichHtml(req.description)}
                                                          onChange={({ doc, body }) => updateReq(mod.id, les.id, req.id, {
                                                            descriptionDoc: doc,
                                                            description: body,
                                                            descriptionFormat: 'rich',
                                                          })}
                                                          placeholder="Explain the work clearly. Add interactive prompts, steps, tables, images, code, or examples..."
                                                          isDark={C === DARK_C}
                                                          accentColor={experienceAccent}
                                                        />
                                                      </div>
                                                      <div className="space-y-2">
                                                        <p className="text-xs font-semibold" style={{ color: C.muted }}>
                                                          Resources
                                                        </p>
                                                        {(req.attachments || []).map((att, ai) => (
                                                          <div key={`${att.url}-${ai}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: C.field }}>
                                                            <Paperclip className="h-3.5 w-3.5 flex-shrink-0" style={{ color: C.muted }} />
                                                            <span className="flex-1 truncate" style={{ color: C.text }}>{att.name}</span>
                                                            <button
                                                              type="button"
                                                              aria-label={`Remove resource ${att.name}`}
                                                              title={`Remove resource ${att.name}`}
                                                              onClick={() => updateReq(mod.id, les.id, req.id, { attachments: req.attachments?.filter((_, i) => i !== ai) })}
                                                              className="flex-shrink-0 hover:text-red-400"
                                                              style={{ color: C.faint }}>
                                                              <X className="h-3.5 w-3.5" />
                                                            </button>
                                                          </div>
                                                        ))}
                                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-opacity hover:opacity-80" style={{ background: C.card, border: `1px dashed ${C.cardBorder}`, color: C.muted }}>
                                                          <Paperclip className="h-3.5 w-3.5" /> Attach resource
                                                          <input type="file" className="hidden" onChange={async e => {
                                                            const file = e.target.files?.[0];
                                                            if (!file) return;
                                                            try {
                                                              const { url } = await uploadToGithub(file, 've-email-attachments');
                                                              updateReq(mod.id, les.id, req.id, r => ({ attachments: [...(r.attachments || []), { name: file.name, url, mimeType: file.type }] }));
                                                            } catch { alert('Upload failed'); }
                                                            e.target.value = '';
                                                          }} />
                                                        </label>
                                                      </div>
                                                      <p className="text-[11px]" style={{ color: C.faint }}>
                                                        Students see these instructions and resources, then use one checkbox to confirm the whole deliverable is complete.
                                                      </p>
                                                    </div>
                                                  ) : (
                                                    <input value={req.description}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { description: e.target.value })}
                                                      style={{ ...inp, background: C.field, fontSize: 12 }}
                                                      placeholder="Instructions (shown to the learner)" aria-label="Instructions shown to the learner" />
                                                  )}
                                                  {req.type === 'linkedin_share' && (
                                                    <>
                                                      <textarea value={req.sharePrompt || ''}
                                                        onChange={e => updateReq(mod.id, les.id, req.id, { sharePrompt: e.target.value })}
                                                        rows={4}
                                                        style={{ ...inp, background: C.field, fontSize: 12, resize: 'vertical' }}
                                                        placeholder="Optional suggested post text the student can copy…" />
                                                      <button
                                                        type="button"
                                                        onClick={() => updateReq(mod.id, les.id, req.id, { shareRequired: req.shareRequired !== true })}
                                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all self-start"
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
                                                          style={{ ...inp, background: C.field, fontSize: 12, width: 90, padding: '4px 8px' }} />
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
                                                          style={{ background: isCorrect ? C.cta : C.field, border: `1.5px solid ${isCorrect ? C.cta : 'transparent'}`, color: isCorrect ? 'white' : C.muted }}>
                                                          {letter}
                                                        </button>
                                                        <input value={opt}
                                                          onChange={e => {
                                                            const newOpts = [...opts]; newOpts[oi] = e.target.value;
                                                            // The answer follows its option when that option is renamed. An empty option is never
                                                            // the answer, so typing into one cannot pick it by accident.
                                                            updateReq(mod.id, les.id, req.id, { options: newOpts, correctAnswer: opt && req.correctAnswer === opt ? e.target.value : req.correctAnswer });
                                                          }}
                                                          className="flex-1 bg-transparent text-sm outline-none"
                                                          style={{ ...inp, background: C.field, padding: '4px 8px', fontSize: 12, borderColor: isCorrect ? C.cta : 'transparent', color: isCorrect ? C.cta : C.text, fontWeight: isCorrect ? 600 : 400 }}
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
                                                    correctAnswer: decisionOptions[index] && req.correctAnswer === decisionOptions[index] ? value : req.correctAnswer,
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
                                                        <div key={oi} className="rounded-lg p-2 space-y-2" style={{ background: C.card, border: `1px solid ${recommended ? tc.color : C.cardBorder}` }}>
                                                          <div className="flex items-center gap-2">
                                                            <button
                                                              type="button"
                                                              onClick={() => opt && updateReq(mod.id, les.id, req.id, { correctAnswer: opt })}
                                                              title={opt ? `Mark option ${letter} as the recommended path` : 'Fill in this option first'}
                                                              className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all"
                                                              style={{ background: recommended ? C.cta : C.field, border: `1.5px solid ${recommended ? C.cta : 'transparent'}`, color: recommended ? 'white' : C.muted }}>
                                                              {letter}
                                                            </button>
                                                            <input
                                                              value={opt}
                                                              onChange={e => updateDecisionOption(oi, e.target.value)}
                                                              className="flex-1 bg-transparent text-sm outline-none"
                                                              style={{ ...inp, background: C.field, padding: '4px 8px', fontSize: 12, color: C.text }}
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
                                                            style={{ ...inp, background: C.field, fontSize: 12 }}
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
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.pill, color: C.muted }}>
                                                    <LinkIcon className="w-3 h-3 flex-shrink-0" />Students will upload a file or paste a link
                                                  </div>
                                                  {/* Read by the AI draft of the instructor report when the student uploads an Excel workbook. */}
                                                  <div>
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Worksheets to review (optional, Excel uploads)</p>
                                                    <textarea
                                                      value={(req.reviewSheetNames ?? []).join('\n')}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { reviewSheetNames: e.target.value.split('\n') })}
                                                      rows={3}
                                                      spellCheck={false}
                                                      placeholder={'One worksheet per line\nRevenue Forecast\nSummary Dashboard'}
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
                                                    />
                                                    <p className="text-[11px] mt-1" style={{ color: C.muted }}>When you draft a report with AI, only these worksheets are read. Leave blank to read the first 5.</p>
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
                                                    C={C}
                                                    inp={inp}
                                                    sessionToken={sessionToken}
                                                    sheetNames={req.reviewSheetNames}
                                                    grader="you mark each criterion as met or not met"
                                                    note="With criteria set, your file report is graded on them: the AI draft gives each one a verdict, and the score is the share of criteria met."
                                                  />
                                                </div>
                                              )}
                                              {req.type === 'text' && (
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.pill, color: C.muted }}>
                                                    <FileText className="w-3 h-3 flex-shrink-0" />Students will type a written response
                                                  </div>
                                                  {/* AI Review toggle */}
                                                  <button
                                                    type="button"
                                                    onClick={() => updateReq(mod.id, les.id, req.id, { aiReview: !req.aiReview, expectedAnswer: undefined })}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all"
                                                    style={{
                                                      background: req.aiReview ? 'rgba(0,185,92,0.12)' : 'rgba(0,0,0,0.04)',
                                                      color: req.aiReview ? '#00b95c' : C.muted,
                                                      border: `1px solid ${req.aiReview ? '#00b95c40' : 'transparent'}`,
                                                    }}>
                                                    <span style={{ width: 26, height: 14, borderRadius: 7, background: req.aiReview ? '#00b95c' : '#ccc', display: 'inline-flex', alignItems: 'center', padding: '0 2px', transition: 'background 0.2s', flexShrink: 0 }}>
                                                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', marginLeft: req.aiReview ? 'auto' : 0, transition: 'margin 0.2s', display: 'block' }} />
                                                    </span>
                                                    AI Review {req.aiReview ? 'on -- AI will grade student answers' : 'off -- using exact match'}
                                                  </button>
                                                  {req.aiReview ? (<>
                                                    <input value={req.context || ''} onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })}
                                                      style={{ ...inp, background: C.field, fontSize: 12 }} placeholder="Rubric / grading guidance for AI (e.g. 'Award points for mentioning X and Y...')..." />
                                                    <div className="flex items-center gap-3">
                                                      <p className="text-xs font-semibold" style={{ color: C.muted }}>Minimum pass score</p>
                                                      <input
                                                        type="number" min={0} max={100} step={5}
                                                        value={req.minScore ?? ''}
                                                        onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                                        placeholder="60"
                                                        className="w-20 outline-none text-[12px] font-mono px-2 py-1 rounded-lg"
                                                        style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }}
                                                      />
                                                      <p className="text-[11px]" style={{ color: C.muted }}>out of 100 - leave blank for 60</p>
                                                    </div>
                                                    <RubricBuilder
                                                      criteria={req.rubric ?? []}
                                                      onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                      onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
                                                      C={C}
                                                      inp={inp}
                                                      sessionToken={sessionToken}
                                                      note="With criteria set, the answer is marked met or not met on each one, and the score is the share of criteria met."
                                                    />
                                                  </>) : (
                                                    <input value={req.expectedAnswer || ''} onChange={e => updateReq(mod.id, les.id, req.id, { expectedAnswer: e.target.value })}
                                                      style={{ ...inp, background: C.field, fontSize: 12 }} placeholder="Expected answer for exact match (optional -- leave blank to accept any response)..." />
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
                                                    onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
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
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Language</p>
                                                    <select
                                                      value={req.reviewLanguage ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { reviewLanguage: e.target.value || undefined })}
                                                      aria-label="Language for this code task"
                                                      className="outline-none text-[12px] px-3 py-2 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }}>
                                                      <option value="">Learner chooses</option>
                                                      {LOCKABLE_CODE_REVIEW_LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                                                    </select>
                                                    <p className="text-[11px] mt-1" style={{ color: C.muted }}>Pick a language to fix it for learners. They will not be able to switch.</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Table schema or data context (optional)</p>
                                                    <textarea
                                                      value={req.schema ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { schema: e.target.value })}
                                                      rows={4}
                                                      spellCheck={false}
                                                      placeholder="Paste CREATE TABLE statements or describe the DataFrame columns. The AI uses this to validate student code against the actual schema."
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
                                                    />
                                                  </div>
                                                  <div className="flex items-center gap-3">
                                                    <p className="text-xs font-semibold" style={{ color: C.muted }}>Minimum pass score</p>
                                                    <input
                                                      type="number" min={0} max={100} step={5}
                                                      value={req.minScore ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                                      placeholder="70"
                                                      className="w-20 outline-none text-[12px] font-mono px-2 py-1 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }}
                                                    />
                                                    <p className="text-[11px]" style={{ color: C.muted }}>out of 100 - leave blank for no gate</p>
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
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
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Spreadsheet context (optional)</p>
                                                    <textarea
                                                      value={req.context ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })}
                                                      rows={4}
                                                      spellCheck={false}
                                                      placeholder="Include the domain so the AI applies the right expertise. e.g. This is a financial model for a retail business. B5 should calculate total revenue using SUMIF on column D, C10 should show profit margin as a percentage. Or: This is an HR payroll sheet. Column F should calculate net pay after tax deductions. Or: This is a BI sales dashboard for a fintech company. D12 should show month-on-month growth using XLOOKUP."
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
                                                    />
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Worksheets to evaluate (optional)</p>
                                                    <textarea
                                                      value={(req.reviewSheetNames ?? []).join('\n')}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { reviewSheetNames: e.target.value.split('\n') })}
                                                      rows={3}
                                                      spellCheck={false}
                                                      placeholder={'One worksheet per line\nRevenue Forecast\nSummary Dashboard'}
                                                      className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
                                                    />
                                                  </div>
                                                  <div className="flex items-center gap-3">
                                                    <p className="text-xs font-semibold" style={{ color: C.muted }}>Minimum pass score</p>
                                                    <input
                                                      type="number" min={0} max={100} step={5}
                                                      value={req.minScore ?? ''}
                                                      onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                                      placeholder="70"
                                                      className="w-20 outline-none text-[12px] font-mono px-2 py-1 rounded-lg"
                                                      style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }}
                                                    />
                                                    <p className="text-[11px]" style={{ color: C.muted }}>out of 100 - leave blank for no gate</p>
                                                  </div>
                                                  <RubricBuilder
                                                    criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
                                                    C={C}
                                                    inp={inp}
                                                    sessionToken={sessionToken}
                                                    sheetNames={req.reviewSheetNames}
                                                    note="With criteria set, the pass mark measures the share of criteria the workbook meets, not the general quality score."
                                                  />
                                                </div>
                                              )}
                                              {req.type === 'document_review' && (
                                                <div className="space-y-3">
                                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
                                                    <FileText className="w-3 h-3 flex-shrink-0" />Students upload a PDF, Word document, or text file for rubric-based review.
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Document context</p>
                                                    <textarea value={req.context ?? ''} onChange={e => updateReq(mod.id, les.id, req.id, { context: e.target.value })} rows={3}
                                                      placeholder="Describe the intended audience, purpose, and any important requirements."
                                                      className="w-full resize-none outline-none text-[12px] px-3 py-3 rounded-lg" style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }} />
                                                  </div>
                                                  <div className="flex flex-wrap items-center gap-3">
                                                    <select value={req.documentReviewMode ?? 'ai_only'} onChange={e => updateReq(mod.id, les.id, req.id, { documentReviewMode: e.target.value as Requirement['documentReviewMode'] })} style={{ ...inp, width: 'auto', fontSize: 12 }}>
                                                      <option value="ai_only">AI review</option><option value="manual">Instructor review</option><option value="hybrid">AI + instructor review</option>
                                                    </select>
                                                    <label className="text-xs font-semibold" style={{ color: C.muted }}>Pass score</label>
                                                    <input type="number" min={0} max={100} value={req.minScore ?? ''} onChange={e => updateReq(mod.id, les.id, req.id, { minScore: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                      placeholder="70" className="w-20 outline-none text-[12px] px-2 py-2 rounded-lg" style={{ background: C.field, color: C.text, border: '1.5px solid transparent' }} />
                                                    <span className="text-[11px]" style={{ color: C.muted }}>out of 100</span>
                                                  </div>
                                                  <RubricBuilder criteria={req.rubric ?? []}
                                                    onChange={rubric => updateReq(mod.id, les.id, req.id, { rubric })}
                                                    onImport={incoming => updateReq(mod.id, les.id, req.id, current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) }))}
                                                    C={C} inp={inp} sessionToken={sessionToken} />
                                                </div>
                                              )}
                                              </>)}
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

                            {/* Add mission, then the milestone's optional solution link */}
                            <div className="space-y-2 pt-1">
                              <button onClick={() => addLesson(mod.id)}
                                className="flex items-center gap-2 text-sm font-semibold px-2 py-2 transition-opacity hover:opacity-70"
                                style={{ color: C.muted }}>
                                <Plus className="w-3.5 h-3.5" /> Add mission
                              </button>
                              <div className="ve-shell flex items-center gap-2 px-3 rounded-[10px]" style={{ background: C.field }}>
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
                        </div>
                        )}
                      </SortableVEShell>
                      );
                    })}
                    </SortableContext>
                    </DndContext>
                  </div>
                  <button onClick={addModule}
                    className="flex items-center gap-2 text-sm font-semibold px-2 py-2 mt-1 transition-opacity hover:opacity-70"
                    style={{ color: C.muted }}>
                    <Plus className="w-3.5 h-3.5" /> Add milestone
                  </button>
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
                            style={{ background: selected ? `${C.cta}1a` : C.field, color: selected ? C.cta : C.text, boxShadow: selected ? `inset 0 0 0 1.5px ${C.cta}` : 'none' }}>
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
                      <div className="inline-flex rounded-[10px] p-[3px]" style={{ background: C.field }}>
                        {([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] as const).map(([id, label]) => {
                          const selected = (config.difficulty || 'intermediate') === id;
                          return (
                            <button key={id} type="button" aria-pressed={selected} onClick={() => setConfig(c => c ? { ...c, difficulty: id } : c)}
                              className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                              style={{ background: selected ? C.card : 'transparent', color: selected ? C.text : C.muted, boxShadow: selected ? '0 1px 2px rgba(15,23,42,0.12)' : 'none' }}>
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
                      style={{ background: C.field, border: `1px dashed ${C.cardBorder}`, color: C.muted }}>
                      <Images className="w-6 h-6" />
                      <span className="text-sm font-semibold">Upload or choose a cover image</span>
                      <span className="text-[11px]" style={{ color: C.faint }}>Recommended 16:9 landscape image</span>
                    </button>
                  )}
                  <div className="flex gap-2">
                    <input style={{ ...inp, fontSize: 14 }} value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="Paste image URL..." />
                    <button onClick={() => coverRef.current?.click()} disabled={uploadingCover}
                      className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 transition-all hover:opacity-70"
                      style={{ color: C.muted, background: C.field }}>
                      {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library"
                      className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 transition-all hover:opacity-70"
                      style={{ color: C.muted, background: C.field }}>
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
                    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.field }}>
                      <img src={config.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0"
                        style={{ border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                      <button onClick={() => setConfig(c => c ? { ...c, badgeImageUrl: null } : c)}
                        className="text-xs px-3 py-2 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                      className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-70 disabled:opacity-50"
                      style={{ color: C.muted, background: C.field }}>
                      {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {uploadingBadge ? 'Uploading...' : config?.badgeImageUrl ? 'Change badge' : 'Upload badge'}
                    </button>
                  </div>
                  <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeUpload} />
                </div>
                </div>
                </div>)}
                {activeSection === 'delivery' && (
                <div className="space-y-4">

                {/* Target Audience card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-xs font-semibold" style={{ color: C.muted }}>Target audience</p>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={availableToEveryone}
                    onClick={() => setAvailableToEveryone(v => !v)}
                    className="w-full flex items-start justify-between gap-4 px-3 py-3 rounded-xl text-left transition-all"
                    style={{ background: availableToEveryone ? `${C.cta}14` : C.card, boxShadow: availableToEveryone ? `0 0 0 2px ${C.cta}` : 'none' }}
                  >
                    <span className="space-y-1">
                      <span className="block text-sm font-semibold" style={{ color: availableToEveryone ? C.cta : C.text }}>
                        Available to everyone
                      </span>
                      <span className="block text-[11px] leading-relaxed" style={{ color: C.faint }}>
                        Anyone with an account can open this, including learners who are not in a cohort.
                        Cohort targeting is replaced while this is on.
                      </span>
                    </span>
                    <span className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
                      style={{ background: availableToEveryone ? C.cta : C.pill }}>
                      <span className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
                        style={{ left: availableToEveryone ? 23 : 3, background: '#ffffff' }} />
                    </span>
                  </button>

                  {availableToEveryone
                    ? <p className="text-sm" style={{ color: C.faint }}>Open to every account, so no cohort is selected.</p>
                    : cohorts.length === 0
                    ? <p className="text-sm" style={{ color: C.faint }}>No cohorts available.</p>
                    : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cohorts.map(c => {
                          const sel = selectedCohorts.includes(c.id);
                          return (
                            <button key={c.id}
                              onClick={() => setSelectedCohorts(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                              className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold text-left transition-all"
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

                {/* Subscription plans card */}
                <div style={card} className="p-5">
                  <PlanAccessPicker
                    contentTable="virtual_experiences"
                    contentId={effectiveId}
                    availableToEveryone={availableToEveryone}
                    onPublicAccessClosed={() => setAvailableToEveryone(false)}
                  />
                </div>

                {/* Deadline card */}
                <div style={card} className="p-5 space-y-3">
                  <p className="text-xs font-semibold" style={{ color: C.muted }}>Deadline</p>
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
                    <span className="text-sm" style={{ color: C.muted }}>days from assignment</span>
                  </div>
                  <p className="text-[11px]" style={{ color: C.faint }}>Students have this many days from when their cohort is assigned to complete the experience. Leave blank for no deadline.</p>
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
        {richTextImageLibraryOpen && (
          <ImageLibrary
            uploadFolder="ve-email-images"
            initialFolder="ve-email-images"
            onSelect={url => resolveRichTextImage(url)}
            onClose={() => resolveRichTextImage(null)}
          />
        )}
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
                        <span className="text-[11px]" style={{ color: C.faint }}>{col.videoCount} videos</span>
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
                              <span className="absolute bottom-1.5 right-1.5 text-[11px] font-semibold px-2 py-0.5 rounded"
                                style={{ background: 'rgba(0,0,0,0.75)', color: 'white' }}>
                                {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                              </span>
                            )}
                          </div>
                          <div className="px-3 py-2">
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
