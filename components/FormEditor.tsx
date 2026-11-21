'use client';

import { contentPath } from '@/lib/content-link';
import { THEME_ACCENT_COLORS } from '@/lib/theme-types';
import { LIGHT_C as DASH_LIGHT, DARK_C as DASH_DARK } from '@/lib/theme';
import { btnClass, btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { VenueFields } from '@/components/VenueFields';
import { SpeakersEditor, useSpeakerDraft } from '@/components/SpeakersEditor';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MenuSelect } from '@/components/MenuSelect';
import { safeEmbedUrl, isHtmlEmbedUrl, HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';
import { useTheme } from '@/components/ThemeProvider';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { RubricFileImportActions } from '@/components/RubricFileImportActions';
import { mergeRubricCriteria, type RubricImportKind } from '@/lib/rubric-criteria';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, Save, Check, Plus, Trash2, Image as ImageIcon, Images, Sun, Moon,
  X, MapPin, ArrowUpRight, ChevronDown, ChevronUp, ChevronRight, Sparkles,
  GripVertical, BookOpen, Monitor, ExternalLink, Video, Search,
  CalendarDays, ClipboardList, CheckCircle2, Settings, Upload, Download, Link2, FileText,
  Lock, LockOpen, Users, Music, FileCode,
  ArrowUp, ArrowDown, Blocks,
} from 'lucide-react';
import type {
  FieldType, FormField, QuestionType, DownloadItem, CourseQuestion,
  PointsSystem, FormConfig,
} from '@/lib/course-schema';
import { questionNumbers, itemIssues, courseIssues } from '@/lib/course-validation';
import { groupOutline, moveModule, moduleIds } from '@/lib/course-outline';
import { pointsSystemFromCourseRow, newLinkedInShareSlide, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS, COURSE_DIFFICULTIES } from '@/lib/course-schema';
import { useToolIconMap } from '@/lib/use-tool-icons';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AiTextarea } from '@/components/AiTextarea';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';
import { loadLessonHtmlToDoc } from '@/components/lesson/loadLessonHtmlToDoc';
import { QuestionTypePicker, TYPE_LABELS } from '@/components/create/QuestionTypePicker';
import type { QuestionTypeOrDownloads } from '@/components/create/QuestionTypePicker';
import { getFontById } from '@/lib/fonts';
import { FontPickerModal } from '@/components/FontPickerModal';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinaryWithMeta, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/uploadToCloudinary';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { deleteUploadedFile } from '@/lib/storage-cleanup';
import { ImageLibrary } from '@/components/ImageLibrary';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { isPdfFile } from '@/lib/cloudinary-pdf';
import { executeQuery, initSQLRuntime } from '@/lib/sql-engine';
import { formatSQLPreflightIssue, preflightSQLExercises } from '@/lib/sql-exercise-preflight';
import { formatPythonPreflightIssue, preflightPythonExercises } from '@/lib/python-exercise-preflight';
import { initPythonRuntime, loadPythonDatasets, runPython } from '@/lib/python-engine';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DateField, TimeField } from '@/components/DatePicker';

// --- Types: the content contract is canonical in lib/course-schema (imported above) ---

const DEFAULT_POINTS: PointsSystem = {
  enabled: false,
  basePoints: 100,
  timeBonusEnabled: true,
  timeBonusSeconds: 10,
  timeBonusMultiplier: 1.5,
  streakEnabled: true,
  streakCount: 3,
  streakBonus: 50,
  hintPenalty: 20,
  solutionPenalty: 30,
  milestones: [],
};

// --- Constants ---
const COURSE_CATEGORIES = ['Excel', 'Power BI', 'SQL', 'Tableau', 'AI'] as const;


const themeAccentColors = THEME_ACCENT_COLORS;

const SOCIAL_PLATFORMS = [
  { id: 'linkedin',  name: 'LinkedIn',    placeholder: 'linkedin.com/in/username' },
  { id: 'twitter',   name: 'X (Twitter)', placeholder: 'x.com/username'           },
  { id: 'instagram', name: 'Instagram',   placeholder: 'instagram.com/username'   },
  { id: 'facebook',  name: 'Facebook',    placeholder: 'facebook.com/username'    },
  { id: 'tiktok',    name: 'TikTok',      placeholder: 'tiktok.com/@username'     },
  { id: 'youtube',   name: 'YouTube',     placeholder: 'youtube.com/@channel'     },
  { id: 'github',    name: 'GitHub',      placeholder: 'github.com/username'      },
  { id: 'website',   name: 'Website',     placeholder: 'https://yourwebsite.com' },
];

const SOCIAL_SVGS: Record<string, React.ReactNode> = {
  linkedin: (
    <svg viewBox="0 0 24 24" fill="#0A66C2" className="w-full h-full">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  twitter: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <defs>
        <linearGradient id="ig-grad-fe" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433"/>
          <stop offset="25%" stopColor="#e6683c"/>
          <stop offset="50%" stopColor="#dc2743"/>
          <stop offset="75%" stopColor="#cc2366"/>
          <stop offset="100%" stopColor="#bc1888"/>
        </linearGradient>
      </defs>
      <path fill="url(#ig-grad-fe)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="#1877F2" className="w-full h-full">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z"/>
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" fill="#FF0000" className="w-full h-full">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  ),
  website: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>
  ),
};

function SocialIcon({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="inline-flex flex-shrink-0">
      {SOCIAL_SVGS[id] ?? null}
    </span>
  );
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  email: 'Email',
  textarea: 'Long Text',
  number: 'Number',
  select: 'Dropdown',
  phone: 'Phone',
  company: 'Company',
  social: 'Social Profile',
  description: 'Description Block',
};

// --- Helpers ---


const isRequired = (f: FormField) => f.required !== false;

const parseJsonResponse = async (res: Response) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'AI request failed');
  return data;
};

const MIN_BADGE_IMAGE_SIZE = 400;
const RECOMMENDED_BADGE_IMAGE_SIZE = 800;

const getImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image dimensions'));
    };
    img.src = url;
  });

const normalizeGeneratedQuestion = (question: any): CourseQuestion => ({
  id: question?.id || Math.random().toString(36).slice(2, 9),
  type: question?.type || 'multiple_choice',
  question: question?.question || 'Untitled question',
  options: Array.isArray(question?.options) ? question.options : [],
  correctAnswer: question?.correctAnswer || '',
  explanation: question?.explanation || '',
  hint: question?.hint || '',
  lesson: question?.lesson,
  optionImages: Array.isArray(question?.optionImages) ? question.optionImages : undefined,
  codeSnippet: question?.codeSnippet || '',
  codeLanguage: question?.codeLanguage || 'javascript',
  // SQL exercise fields
  ...(question?.sqlSolution    !== undefined && { sqlSolution:    question.sqlSolution }),
  ...(question?.sqlStarterCode !== undefined && { sqlStarterCode: question.sqlStarterCode }),
  ...(question?.sqlHints       !== undefined && { sqlHints:       question.sqlHints }),
  // Python exercise fields
  ...(question?.pythonStarterCode    !== undefined && { pythonStarterCode:    question.pythonStarterCode }),
  ...(question?.pythonSolution       !== undefined && { pythonSolution:       question.pythonSolution }),
  ...(question?.pythonExpectedOutput !== undefined && { pythonExpectedOutput: question.pythonExpectedOutput }),
  ...(question?.pythonSetupCode      !== undefined && { pythonSetupCode:      question.pythonSetupCode }),
  ...(question?.pythonHints          !== undefined && { pythonHints:          question.pythonHints }),
});

const normalizeGeneratedField = (field: any): FormField => ({
  id: field?.id || Math.random().toString(36).slice(2, 9),
  name: field?.name || (field?.label || 'field').toLowerCase().replace(/\s+/g, '_'),
  label: field?.label || 'Untitled Field',
  type: field?.type || 'text',
  placeholder: field?.placeholder,
  options: Array.isArray(field?.options) ? field.options : undefined,
  required: field?.required !== false,
  socialPlatforms: Array.isArray(field?.socialPlatforms) ? field.socialPlatforms : undefined,
  description: field?.description,
});

const buildBaseEventFields = (): FormField[] => [
  { id: 'default_first_name', name: 'first_name', label: 'First Name', type: 'text', placeholder: 'Enter your first name...', required: true },
  { id: 'default_last_name', name: 'last_name', label: 'Last Name', type: 'text', placeholder: 'Enter your last name...', required: true },
  { id: 'default_email', name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', required: true },
  { id: 'default_phone', name: 'phone', label: 'Mobile Phone', type: 'phone', required: true },
];

const mergeEventFields = (existingFields: FormField[] = [], generatedFields: any[] = []) => {
  const baseFields = buildBaseEventFields();
  const normalizedGenerated = generatedFields.map(normalizeGeneratedField);
  const byName = new Map<string, FormField>();

  [...baseFields, ...existingFields, ...normalizedGenerated].forEach(field => {
    const key = (field.name || field.label).toLowerCase();
    if (!byName.has(key)) byName.set(key, field);
  });

  return Array.from(byName.values());
};

// --- Design tokens (light / dark) ---
// The editor sits on the dashboard theme (lib/theme): its page, cards, fields and text, with the
// shared blue for buttons and selection controls. The course's own accent colour is for learners
// only and is chosen on the Design step.
const FE_LIGHT = {
  page: DASH_LIGHT.page, card: '#ffffff', cardBorder: 'transparent', cardShadow: 'none',
  input: DASH_LIGHT.input, inputBorder: 'rgba(0,0,0,0.08)',
  text: DASH_LIGHT.text, muted: DASH_LIGHT.muted, faint: DASH_LIGHT.faint,
  section: '#ffffff', sectionBorder: 'transparent',
  divider: DASH_LIGHT.divider, pill: DASH_LIGHT.pill,
  toggleOff: '#d1d5db',
  segmentBg: DASH_LIGHT.page, segmentActive: DASH_DARK.cta, segmentActiveText: '#ffffff',
  groupBg: DASH_LIGHT.page, groupBorder: 'transparent',
  cta: DASH_DARK.cta, ctaText: '#ffffff',
};
const FE_DARK = {
  page: DASH_DARK.page, card: DASH_DARK.card, cardBorder: 'transparent', cardShadow: 'none',
  input: DASH_DARK.input, inputBorder: 'rgba(255,255,255,0.08)',
  text: DASH_DARK.text, muted: DASH_DARK.muted, faint: DASH_DARK.faint,
  section: DASH_DARK.card, sectionBorder: 'transparent',
  divider: DASH_DARK.divider, pill: DASH_DARK.pill,
  toggleOff: '#3f3f46',
  segmentBg: DASH_DARK.page, segmentActive: DASH_DARK.cta, segmentActiveText: '#ffffff',
  groupBg: DASH_DARK.page, groupBorder: 'transparent',
  cta: DASH_DARK.cta, ctaText: '#ffffff',
};

// The dashboard theme (with the shared blue) for the shared buttons, matching the FE tokens.
const DASH_LIGHT_BLUE = { ...DASH_LIGHT, cta: DASH_DARK.cta };

function useFEC() { const { theme } = useTheme(); return theme === 'dark' ? FE_DARK : FE_LIGHT; }

// --- UI primitives ---
const inputCls = "w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400";
const labelCls = "block text-xs font-semibold mb-2";

function Toggle({ checked, onChange, accentColor }: { checked: boolean; onChange: () => void; accentColor?: string }) {
  const FE = useFEC();
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-2">
      <span className="relative inline-flex w-7 h-4 rounded-full transition-colors"
        style={{ background: checked ? (accentColor ?? '#10b981') : FE.toggleOff }}>
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-3' : ''}`} />
      </span>
      <span className="text-[11px] font-medium" style={{ color: checked ? (accentColor ?? '#10b981') : FE.faint }}>
        {checked ? 'Required' : 'Optional'}
      </span>
    </button>
  );
}

function SwitchToggle({ checked, onChange, accentColor }: { checked: boolean; onChange: (v: boolean) => void; accentColor?: string }) {
  const FE = useFEC();
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0">
      <span
        className="relative inline-flex w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? (accentColor ?? '#10b981') : FE.toggleOff }}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

// Toggle: lock this slide until the previous lesson is completed
function LockToggle({ locked, onToggle, accentColor }: { locked: boolean; onToggle: () => void; accentColor?: string }) {
  const FE = useFEC();
  return (
    <button
      type="button"
      onClick={onToggle}
      title={locked ? 'Locked until the previous lesson is completed' : 'Lock until the previous lesson is completed'}
      aria-pressed={locked}
      aria-label={locked ? 'Unlock' : 'Lock until the previous item is completed'}
      className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-all"
      style={locked ? { background: `${accentColor ?? '#10b981'}1a`, color: accentColor ?? '#10b981' } : { color: FE.faint }}
    >
      {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
    </button>
  );
}


// --- Sortable Field Card ---
interface FieldCardProps {
  f: FormField;
  isExpanded: boolean;
  toggleExpand: () => void;
  onRemove: () => void;
  onUpdate: (updates: Partial<FormField>) => void;
}

function SortableFieldCard({ f, isExpanded, toggleExpand, onRemove, onUpdate, index = 0, accentColor }: FieldCardProps & { index?: number; accentColor?: string }) {
  const FE = useFEC();
  const inputStyle = { background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text };
  const labelStyle = { color: FE.faint };
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1, borderRadius: 12, border: isDragging ? `2px dashed ${FE.cardBorder}` : undefined };

  return (
    <motion.div
      ref={setNodeRef}
      style={{ ...style, background: FE.card, border: `1px solid ${isExpanded ? 'rgba(0,0,0,0.15)' : FE.cardBorder}` }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="group rounded-xl overflow-hidden transition-all"
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-colors"
          style={{ color: FE.faint }}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={toggleExpand} className="flex-1 text-left min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: FE.text }}>{f.label || <span className="italic" style={{ color: FE.faint }}>Untitled</span>}</span>
          <span className="text-[11px]" style={{ color: FE.faint }}>{FIELD_TYPE_LABELS[f.type]}</span>
        </button>
        <div className="flex items-center flex-shrink-0">
          <button onClick={onRemove} title="Remove" className="p-1 transition-colors opacity-0 group-hover:opacity-100 hover:text-red-400" style={{ color: FE.faint }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={toggleExpand} className="p-1 transition-colors" style={{ color: FE.faint }}>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
            style={{ borderTop: `1px solid ${FE.divider}` }}
          >
            <div className="px-3 pt-3 pb-3 space-y-3">
              <div>
                <label className={labelCls} style={labelStyle}>{f.type === 'description' ? 'Heading (optional)' : 'Label'}</label>
                <input
                  type="text"
                  value={f.label}
                  onChange={e => onUpdate({ label: e.target.value, name: e.target.value.toLowerCase().replace(/\s+/g, '_') || f.id })}
                  className={inputCls}
                  style={inputStyle}
                  placeholder={f.type === 'description' ? 'Section heading...' : 'Field label...'}
                />
              </div>
              {f.type === 'description' ? (
                <div>
                  <label className={labelCls} style={labelStyle}>Content</label>
                  <RichTextEditor
                    value={f.description ?? ''}
                    onChange={html => onUpdate({ description: html })}
                    placeholder="Write your description here..."
                    enableAiAssist
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className={labelCls} style={labelStyle}>Helper text (optional)</label>
                    <RichTextEditor
                      value={f.description ?? ''}
                      onChange={html => onUpdate({ description: html || undefined })}
                      placeholder="Add helper text below the label..."
                      enableAiAssist
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Required</span>
                    <Toggle checked={isRequired(f)} onChange={() => onUpdate({ required: !isRequired(f) })} accentColor={accentColor} />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Sortable wrapper for question/section cards ---
function SortableQuestionShell({ id, children }: {
  id: string;
  children: (bag: { dragHandle: React.ReactNode; isDragging: boolean }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const FE = useFEC();
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 };
  const dragHandle = (
    <button
      type="button"
      className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-colors"
      style={{ color: FE.faint }}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );
  return <div ref={setNodeRef} style={style}>{children({ dragHandle, isDragging })}</div>;
}

// --- FormEditor Component ---
interface FormEditorProps {
  formId: string;
  contentType: 'course' | 'event';
  onSaved?: (id: string) => void;
  /** Course Publish step: the Draft or Published switch, given whether the course is ready and saved. */
  publishControls?: (state: { ready: boolean; unsaved: boolean }) => React.ReactNode;
  /** Course Publish step: shown last (Duplicate). */
  publishFooter?: React.ReactNode;
  /** Publish step, after the link: the wider sharing kit (events: share buttons, embed, QR code). */
  publishShare?: React.ReactNode;
}

export default function FormEditor({ formId, contentType, onSaved, publishControls, publishFooter, publishShare }: FormEditorProps) {
  // The course page puts the save status and button in its header (see app/dashboard/[id]).
  const [saveSlots, setSaveSlots] = useState<{ status: HTMLElement; button: HTMLElement } | null>(null);
  useEffect(() => {
    const status = document.getElementById('editor-save-status');
    const button = document.getElementById('editor-save-button');
    if (status && button) setSaveSlots({ status, button });
  }, []);
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [lessonImageQId, setLessonImageQId] = useState<string | null>(null);
  const [optionImageLibrary, setOptionImageLibrary] = useState<{ qId: string; optionIdx: number } | null>(null);
  const [customSlug, setCustomSlug] = useState('');
  const [activeSection, setActiveSection] = useState<string>('info');
  const [secDir, setSecDir] = useState(1); // carousel slide direction: 1 = forward, -1 = back
  const goToSection = (id: string, ids: string[]) => {
    setSecDir(ids.indexOf(id) >= ids.indexOf(activeSection) ? 1 : -1);
    setActiveSection(id);
  };

  // Add-field state
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(true);
  const [newSocialPlatforms, setNewSocialPlatforms] = useState<string[]>(['linkedin', 'twitter']);
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [newQuestionType] = useState<QuestionType | 'downloads'>('multiple_choice');
  const [pickerCtx, setPickerCtx] = useState<
    | { mode: 'bottom' }
    | { mode: 'insert'; afterIndex: number }
    | { mode: 'change'; qId: string }
    | null
  >(null);
  // Every delete in the outline asks first: one click used to remove a question for good.
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; title: string; body: string; confirm: string; alt?: { label: string; ids: string[] } } | null>(null);
  const [aiTopic, setAiTopic] = useState('');
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [aiQuestionType, setAiQuestionType] = useState<'multiple_choice' | 'fill_blank' | 'arrange' | 'sql_exercise' | 'python_exercise'>('multiple_choice');
  const [aiPromptModalOpen, setAiPromptModalOpen] = useState(false);
  const [aiCustomPrompt, setAiCustomPrompt] = useState('');
  const [aiDescriptionStyle, setAiDescriptionStyle] = useState<'professional' | 'casual' | 'friendly'>('professional');
  const [aiDescriptionLength, setAiDescriptionLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [aiDescriptionPrompt, setAiDescriptionPrompt] = useState('');
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [eventAssistantOpen, setEventAssistantOpen] = useState(false);
  const [eventAssistantPrompt, setEventAssistantPrompt] = useState('');
  const [aiLoadingLabel, setAiLoadingLabel] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSuccess, setAiSuccess] = useState('');
  const [aiFailed, setAiFailed] = useState(false);
  // Bunny video picker
  const [bunnyPickerOpen, setBunnyPickerOpen] = useState(false);
  const [bunnyPickerQId, setBunnyPickerQId] = useState<string | null>(null);
  const [bunnyVideos, setBunnyVideos] = useState<any[]>([]);
  const [bunnyCollections, setBunnyCollections] = useState<any[]>([]);
  const [bunnyCollection, setBunnyCollection] = useState('');
  const [bunnyLoading, setBunnyLoading] = useState(false);
  const [bunnySearch, setBunnySearch] = useState('');
  const [bunnyError, setBunnyError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info'; persistent?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error', options?: { persistent?: boolean }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, persistent: options?.persistent });
    toastTimer.current = options?.persistent ? null : setTimeout(() => setToast(null), 5000);
  };
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const [extractingRubric, setExtractingRubric] = useState<string | null>(null);
  const [lessonPrompts, setLessonPrompts] = useState<Record<string, string>>({});
  const [lessonPromptModal, setLessonPromptModal] = useState<{ q: CourseQuestion } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  // Modules folded to their heading in the outline (editor view only, not saved).
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [closedLessons, setClosedLessons] = useState<Set<string>>(new Set());
  const [availableForms, setAvailableForms] = useState<{ id: string; title: string; slug: string; kind: 'Course' | 'Event' }[]>([]);
  const [cohorts, setCohorts]               = useState<{ id: string; name: string }[]>([]);
  const [partners, setPartners]               = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  // Course tags are typed one at a time; tools are picked from the tool icon library.
  const [tagDraft, setTagDraft]               = useState('');
  const toolIconMap = useToolIconMap();
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [courseAvailableToEveryone, setCourseAvailableToEveryone] = useState(false);

  // Real unsaved-change tracking: what is on screen compared with what was last loaded or saved.
  // (The label used to read "Unsaved changes" whenever it was not briefly showing "Saved!".)
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const currentSnapshot = useMemo(
    () => (formConfig ? JSON.stringify([formConfig, customSlug, selectedCohortIds, courseAvailableToEveryone]) : null),
    [formConfig, customSlug, selectedCohortIds, courseAvailableToEveryone],
  );
  useEffect(() => {
    if (!isLoading && savedSnapshot === null && currentSnapshot) setSavedSnapshot(currentSnapshot);
  }, [isLoading, currentSnapshot, savedSnapshot]);
  const isDirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  // Whatever is added to the outline (a question, lesson, module, downloads or LinkedIn step,
  // at the end or between rows) opens at once, ready to fill in. Only a single new item:
  // AI generation adds many at once and is left closed.
  const knownItemIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (isLoading || !formConfig) return;
    const ids = (formConfig.questions ?? []).map(q => q.id);
    if (knownItemIds.current === null) { knownItemIds.current = new Set(ids); return; }
    const added = ids.filter(id => !knownItemIds.current!.has(id));
    knownItemIds.current = new Set(ids);
    if (added.length !== 1) return;
    setExpandedQuestions(prev => new Set([...prev, added[0]]));
    setTimeout(() => document.querySelector(`[data-item-id="${added[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  }, [formConfig, isLoading]);
  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  const savedCohortIds = useRef<string[]>([]);
  const toggleCohort = (id: string) => {
    if (contentType === 'course') setCourseAvailableToEveryone(false);
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const speakerDraft = useSpeakerDraft();
  const badgeInputRef = useRef<HTMLInputElement>(null);
  const [uploadingBadge, setUploadingBadge] = useState(false);
  const handleBadgeImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingBadge(true);
    try {
      const { width, height } = await getImageDimensions(file);
      const shortestSide = Math.min(width, height);
      if (shortestSide < MIN_BADGE_IMAGE_SIZE) {
        alert(`Please upload a sharper badge image. Badges should be at least ${MIN_BADGE_IMAGE_SIZE} x ${MIN_BADGE_IMAGE_SIZE}px.`);
        return;
      }
      if (shortestSide < RECOMMENDED_BADGE_IMAGE_SIZE) {
        const shouldContinue = window.confirm(`This badge is ${width} x ${height}px. It will work, but ${RECOMMENDED_BADGE_IMAGE_SIZE} x ${RECOMMENDED_BADGE_IMAGE_SIZE}px or higher will look sharper on student screens. Continue with this image?`);
        if (!shouldContinue) return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const ext  = file.name.split('.').pop() ?? 'png';
      const path = `badges/${session?.user.id ?? 'anon'}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      updateConfig({ badgeImageUrl: publicUrl });
    } catch {
      alert('Badge upload failed. Please try again.');
    } finally {
      setUploadingBadge(false);
    }
  };

  // Load form on mount
  useEffect(() => {
    setIsLoading(true);
    (async () => {
      if (contentType === 'course') {
        const { data: course } = await supabase.from('courses').select('id, title, description, slug, cohort_ids, available_to_everyone, questions, fields, passmark, course_timer, learn_outcomes, points_enabled, points_base, points_system, post_submission, cover_image, badge_image_url, deadline_days, theme, mode, font, custom_accent, category, partner_id, show_answers, lesson_timing, max_attempts, ai_tutor_enabled, difficulty, tags, tools').eq('id', formId).maybeSingle();
        if (course) {
          setFormConfig({
            isCourse: true,
            title: course.title,
            description: course.description ?? '',
            coverImage: course.cover_image,
            questions: course.questions ?? [],
            fields: course.fields ?? [],
            passmark: course.passmark,
            courseTimer: course.course_timer,
            showAnswers: course.show_answers ?? undefined,
            lessonTiming: course.lesson_timing ?? undefined,
            enableAiTutor: course.ai_tutor_enabled ?? false,
            maxAttempts: course.max_attempts ?? undefined,
            learnOutcomes: course.learn_outcomes ?? [],
            pointsSystem: pointsSystemFromCourseRow(course),
            postSubmission: course.post_submission,
            deadline_days: course.deadline_days,
            theme: course.theme,
            mode: course.mode,
            font: course.font,
            customAccent: course.custom_accent,
            category: course.category ?? null,
            badgeImageUrl: course.badge_image_url ?? null,
            partnerId: course.partner_id ?? null,
            difficulty: course.difficulty ?? null,
            tags: course.tags ?? [],
            tools: course.tools ?? [],
          });
          setCustomSlug(course.slug || '');
          const loadedCohorts = course.cohort_ids ?? [];
          setSelectedCohortIds(loadedCohorts);
          setCourseAvailableToEveryone(course.available_to_everyone === true);
          savedCohortIds.current = loadedCohorts;
        }
      } else {
        const { data: event } = await supabase.from('events').select('id, title, description, slug, cohort_ids, fields, post_submission, cover_image, deadline_days, theme, mode, font, custom_accent, event_date, event_time, timezone, location, event_type, capacity, meeting_link, is_private, public_registration, speakers, recurrence, recurrence_end_date, recurrence_days').eq('id', formId).maybeSingle();
        if (event) {
          setFormConfig({
            isCourse: false,
            title: event.title,
            description: event.description ?? '',
            coverImage: event.cover_image,
            fields: event.fields ?? [],
            postSubmission: event.post_submission,
            deadline_days: event.deadline_days,
            theme: event.theme,
            mode: event.mode,
            font: event.font,
            customAccent: event.custom_accent,
            eventDetails: {
              isEvent: true,
              date: event.event_date ?? '',
              time: event.event_time ?? '',
              timezone: event.timezone ?? '',
              location: event.location ?? '',
              eventType: event.event_type ?? 'in-person',
              capacity: event.capacity ?? null,
              meetingLink: event.meeting_link ?? '',
              isPrivate: event.is_private ?? false,
              publicRegistration: event.public_registration === true,
              speakers: event.speakers ?? [],
              recurrence: event.recurrence ?? 'once',
              recurrenceEndDate: event.recurrence_end_date ?? '',
              recurrenceDays: event.recurrence_days ?? [],
            },
          });
          setCustomSlug(event.slug || '');
          const loadedCohorts = event.cohort_ids ?? [];
          if (loadedCohorts.length) setSelectedCohortIds(loadedCohorts);
          savedCohortIds.current = loadedCohorts;
        }
      }
      setIsLoading(false);
    })();
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name').then(({ data }) => {
      if (data) setCohorts(data);
    });
    supabase.from('partners').select('id, name, is_active').order('name').then(({ data }) => {
      if (data) setPartners(data);
    });
  }, [formId, contentType]);

  useEffect(() => {
    if (formConfig?.postSubmission?.type !== 'events') return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      // Your events and courses: learners who finish can be pointed at either.
      const [{ data: events }, { data: courses }] = await Promise.all([
        supabase.from('events').select('id, title, slug').eq('user_id', session.user.id).order('created_at', { ascending: false }),
        supabase.from('courses').select('id, title, slug').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      ]);
      setAvailableForms([
        ...(courses ?? []).map((c: any) => ({ ...c, kind: 'Course' as const })),
        ...(events ?? []).map((e: any) => ({ ...e, kind: 'Event' as const })),
      ].filter(f => f.id !== formId));
    })();
  }, [formConfig?.postSubmission?.type, formId]);

  const updateConfig = (updates: Partial<FormConfig>) => {
    if (formConfig) setFormConfig({ ...formConfig, ...updates });
  };

  const runAiAction = async <T,>(label: string, task: () => Promise<T>) => {
    setAiError('');
    setAiSuccess('');
    setAiFailed(false);
    setAiLoadingLabel(label);
    try {
      const result = await task();
      setAiSuccess(label);
      return result;
    } catch (e: any) {
      const msg = e?.message || 'AI request failed';
      setAiError(msg);
      setAiFailed(true);
      showToast(msg);
      return null;
    } finally {
      setAiLoadingLabel('');
      setBusyQuestionId(null);
    }
  };

  const generateQuestions = async (customPrompt?: string) => {
    const topic = aiTopic.trim();
    if (!topic) {
      setAiError('Enter a topic first so AI knows what to generate.');
      return;
    }

    const data = await runAiAction('Generating questions...', async () => {
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          action: 'generate_questions',
          topic,
          count: aiQuestionCount,
          type: aiQuestionType,
          customPrompt: customPrompt?.trim().slice(0, 800) || undefined,
        }),
      });
      return parseJsonResponse(res);
    });

    if (!data?.questions) return;
    setFormConfig(prev => prev ? {
      ...prev,
      questions: [...(prev.questions || []), ...data.questions.map(normalizeGeneratedQuestion)],
    } : prev);
    setAiPromptModalOpen(false);
  };

  const generateOutcomes = async () => {
    const questions = formConfig?.questions || [];
    if (!questions.length) {
      setAiError('Add at least one question before generating learning outcomes.');
      return;
    }

    const data = await runAiAction('Generating learning outcomes...', async () => {
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          action: 'generate_outcomes',
          questions: questions.map(q => ({ question: q.question, correctAnswer: q.correctAnswer })),
        }),
      });
      return parseJsonResponse(res);
    });

    if (!data?.outcomes) return;
    setFormConfig(prev => prev ? { ...prev, learnOutcomes: data.outcomes } : prev);
  };

  const generateCourseDescription = async () => {
    if (!formConfig?.isCourse) return;

    const hasCourseContext =
      formConfig.title.trim() ||
      (formConfig.questions || []).length > 0 ||
      (formConfig.learnOutcomes || []).length > 0;

    if (!hasCourseContext) {
      setAiError('Add a course title, questions, or outcomes before generating a description.');
      return;
    }

    setDescriptionModalOpen(false);
    const data = await runAiAction('Generating course description...', async () => {
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          action: 'generate_course_description',
          title: formConfig.title,
          description: formConfig.description,
          style: aiDescriptionStyle,
          length: aiDescriptionLength,
          prompt: aiDescriptionPrompt.trim(),
          questions: (formConfig.questions || []).map(q => ({
            question: q.question,
            correctAnswer: q.correctAnswer,
          })),
          learnOutcomes: formConfig.learnOutcomes || [],
        }),
      });
      return parseJsonResponse(res);
    });

    if (!data?.description) return;
    setFormConfig(prev => prev ? { ...prev, description: data.description } : prev);
  };

  const generateEventSetup = async () => {
    if (!formConfig?.eventDetails?.isEvent) return;
    const brief = eventAssistantPrompt.trim();
    if (!brief) {
      setAiError('Describe the event so AI can generate the setup.');
      return;
    }

    setEventAssistantOpen(false);
    const data = await runAiAction('Generating event setup...', async () => {
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          action: 'generate_event_setup',
          brief,
          existingTitle: formConfig.title,
          existingDescription: formConfig.description,
          eventDetails: formConfig.eventDetails,
        }),
      });
      return parseJsonResponse(res);
    });

    if (!data) return;
    setFormConfig(prev => prev ? {
      ...prev,
      title: data.title || prev.title,
      description: data.description || prev.description,
      fields: mergeEventFields(prev.fields || [], data.fields || []),
      eventDetails: {
        ...prev.eventDetails,
        ...data.eventDetails,
        isEvent: true,
      },
      postSubmission: data.postSubmission?.type
        ? {
            ...prev.postSubmission,
            ...data.postSubmission,
          }
        : prev.postSubmission,
    } : prev);
  };

  const generateQuestionAsset = async (
    q: CourseQuestion,
    action: 'generate_distractors' | 'generate_lesson' | 'generate_hint' | 'generate_explanation',
    instruction?: string
  ) => {
    const isLessonAction = action === 'generate_lesson';
    const prompt = instruction ?? lessonPrompts[q.id] ?? '';
    if (!isLessonAction && (!q.question.trim() || !q.correctAnswer.trim())) {
      setAiError('Each AI action needs both the question text and a correct answer.');
      return;
    }
    if (isLessonAction && !q.question.trim() && !prompt.trim()) {
      setAiError('Add a question or type a topic/instructions for the lesson.');
      return;
    }

    setBusyQuestionId(q.id);
    const labelMap = {
      generate_distractors: 'Generating distractors...',
      generate_lesson: 'Generating lesson...',
      generate_hint: 'Generating hint...',
      generate_explanation: 'Generating explanation...',
    } as const;

    const data = await runAiAction(labelMap[action], async () => {
      const payload: any = {
        action,
        question: q.question,
        correctAnswer: q.correctAnswer,
      };
      if (isLessonAction && prompt.trim()) payload.instruction = prompt.trim();
      if (action === 'generate_distractors') payload.count = Math.max(0, 4 - q.options.length) || 3;

      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify(payload),
      });
      return parseJsonResponse(res);
    });

    if (!data) return;
    const lessonHtmlToDoc = action === 'generate_lesson' ? await loadLessonHtmlToDoc() : null;

    setFormConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: (prev.questions || []).map(item => {
          if (item.id !== q.id) return item;
          if (action === 'generate_distractors') {
            const wrongAnswers = (data.distractors || []).filter((opt: string) => opt && opt !== item.correctAnswer);
            const existingWrong = item.options.filter(opt => opt !== item.correctAnswer);
            return {
              ...item,
              options: [item.correctAnswer, ...existingWrong, ...wrongAnswers].slice(0, 4),
            };
          }
          if (action === 'generate_lesson') {
            const newBody = data.body || item.lesson?.body || '';
            return {
              ...item,
              lesson: {
                // preserve existing lesson assets (imageUrl, pdfUrl/pdfName/pdfPages)
                ...item.lesson,
                title: data.title || item.lesson?.title || '',
                body: newBody,
                videoUrl: data.videoUrl || item.lesson?.videoUrl || '',
                // rebuild the canonical doc from the regenerated HTML so the lesson
                // stays doc-canonical (not body-only) and renders interactively.
                doc: newBody && lessonHtmlToDoc ? lessonHtmlToDoc(newBody) : undefined,
              },
            };
          }
          if (action === 'generate_hint') return { ...item, hint: data.hint || item.hint || '' };
          return { ...item, explanation: data.explanation || item.explanation || '' };
        }),
      };
    });
  };

  const prepareSqlExpectedResultsForSave = async (config: FormConfig): Promise<FormConfig | null> => {
    if (!config.isCourse) return config;
    const questions = config.questions ?? [];
    if (!questions.some(q => q.type === 'sql_exercise')) return config;

    try {
      showToast('Checking SQL exercises...', 'info');
      const preflight = await preflightSQLExercises(questions, { requireComplete: true });
      if (preflight.issues.length) {
        showToast(`SQL warning: ${formatSQLPreflightIssue(preflight.issues[0])}`, 'info', { persistent: true });
      }

      if (preflight.computedCount) {
        const nextConfig = { ...config, questions: preflight.questions };
        setFormConfig(nextConfig);
        showToast(`Computed expected results for ${preflight.computedCount} SQL exercise${preflight.computedCount === 1 ? '' : 's'}.`, 'success');
        return nextConfig;
      }

      return config;
    } catch (err: any) {
      console.error('[sql-exercise] save-time preflight failed', err);
      showToast(err?.message || 'Could not validate SQL exercises before saving. Saving will continue, but review SQL expected results before assigning this course.', 'info', { persistent: true });
      return config;
    }
  };

  const preparePythonExpectedOutputsForSave = async (config: FormConfig): Promise<FormConfig | null> => {
    if (!config.isCourse) return config;
    const questions = config.questions ?? [];
    if (!questions.some(q => q.type === 'python_exercise')) return config;

    try {
      showToast('Checking Python exercises...', 'info');
      const preflight = await preflightPythonExercises(questions, { requireComplete: true });
      if (preflight.issues.length) {
        showToast(`Python warning: ${formatPythonPreflightIssue(preflight.issues[0])}`, 'error', { persistent: true });
        return null;
      }

      if (preflight.computedCount) {
        const nextConfig = { ...config, questions: preflight.questions };
        setFormConfig(nextConfig);
        showToast(`Computed expected output for ${preflight.computedCount} Python exercise${preflight.computedCount === 1 ? '' : 's'}.`, 'success');
        return nextConfig;
      }

      return config;
    } catch (err: any) {
      console.error('[python-exercise] save-time preflight failed', err);
      showToast(err?.message || 'Could not validate Python exercises before saving.', 'error', { persistent: true });
      return null;
    }
  };

  // Save handler
  // A speaker typed into the Speakers form but not yet added: Save adds it (components/SpeakersEditor).
  const withPendingSpeaker = (config: FormConfig): FormConfig => {
    if (!config.eventDetails?.isEvent) return config;
    const speakers = speakerDraft.applyTo(config.eventDetails.speakers ?? []);
    if (!speakers) return config;
    const next = { ...config, eventDetails: { ...config.eventDetails, speakers } };
    setFormConfig(next);
    return next;
  };

  const handleSave = async () => {
    if (!formConfig) return;
    setIsSaving(true);
    try {
      let configToSave = await prepareSqlExpectedResultsForSave(withPendingSpeaker(formConfig));
      if (!configToSave) { setIsSaving(false); return; }
      configToSave = await preparePythonExpectedOutputsForSave(configToSave);
      if (!configToSave) { setIsSaving(false); return; }
      const slugValue = customSlug.trim() || undefined;
      const { data: { session: saveSession } } = await supabase.auth.getSession();
      if (!saveSession?.access_token) throw new Error('Not authenticated');

      const res = await fetch('/api/forms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saveSession.access_token}` },
        body: JSON.stringify({
          id: formId,
          title: configToSave.title,
          description: configToSave.description,
          config: configToSave,
          cohort_ids: selectedCohortIds,
          ...(contentType === 'course' ? { available_to_everyone: courseAvailableToEveryone } : {}),
          ...(slugValue ? { slug: slugValue } : {}),
        }),
      });
      const resJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (resJson?.error?.includes('slug')) {
          showToast('This URL slug is already taken. Try a different one.');
          return;
        }
        throw new Error(resJson?.error || `Save failed (HTTP ${res.status})`);
      }
      if (resJson.registrationWarning) showToast(resJson.registrationWarning, 'info');
      // For events, PUT /api/forms handles auto-registration + notifications.
      // For courses, call /api/notify-assignment for newly added cohorts.
      if (contentType !== 'event') {
        const addedCohortIds = selectedCohortIds.filter(id => !savedCohortIds.current.includes(id));
        if (addedCohortIds.length) {
          const { data: { session: notifySession } } = await supabase.auth.getSession();
          if (notifySession?.access_token) {
            const notifyRes = await fetch('/api/notify-assignment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${notifySession.access_token}` },
              body: JSON.stringify({ formId, cohortIds: addedCohortIds }),
            });
            if (!notifyRes.ok) {
              const notifyErr = await notifyRes.json().catch(() => ({}));
              showToast(notifyErr.error || 'Saved, but notification emails failed to send.');
            }
          }
        }
      }
      savedCohortIds.current = [...selectedCohortIds];
      setSavedSnapshot(JSON.stringify([configToSave, customSlug, selectedCohortIds, courseAvailableToEveryone]));

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.(formId);
    } catch (e: any) {
      console.error('Failed to save form', e);
      showToast('Failed to save. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Field management
  const handleUpdateField = (id: string, updates: Partial<FormField>) => {
    if (!formConfig) return;
    updateConfig({ fields: formConfig.fields.map(f => f.id === id ? { ...f, ...updates } : f) });
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !formConfig) return;
    const oldIdx = formConfig.fields.findIndex(f => f.id === active.id);
    const newIdx = formConfig.fields.findIndex(f => f.id === over.id);
    updateConfig({ fields: arrayMove(formConfig.fields, oldIdx, newIdx) });
  };

  const handleQuestionDragStart = (event: DragStartEvent) => setActiveQuestionId(String(event.active.id));

  const handleQuestionDragEnd = (event: DragEndEvent) => {
    setActiveQuestionId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !formConfig?.questions) return;
    const moving = formConfig.questions.find(q => q.id === active.id);
    // A module moves as a whole: its heading and everything in it.
    if (moving?.isSection) {
      updateConfig({ questions: moveModule(formConfig.questions, String(active.id), String(over.id)) });
      return;
    }
    const oldIdx = formConfig.questions.findIndex(q => q.id === active.id);
    const newIdx = formConfig.questions.findIndex(q => q.id === over.id);
    updateConfig({ questions: arrayMove(formConfig.questions, oldIdx, newIdx) });
  };

  const toggleQuestion = (id: string) => setExpandedQuestions(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleRemoveField = (id: string) => {
    if (!formConfig) return;
    updateConfig({ fields: formConfig.fields.filter(f => f.id !== id) });
  };

  const handleAddField = () => {
    if (newFieldType !== 'description' && !newFieldLabel.trim()) return;
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    const label = newFieldLabel.trim() || (newFieldType === 'description' ? 'Section' : '');
    const newField: FormField = {
      id,
      name: label.toLowerCase().replace(/\s+/g, '_') || id,
      label,
      type: newFieldType,
      placeholder: newFieldType === 'phone' || newFieldType === 'company' || newFieldType === 'social' || newFieldType === 'description' ? undefined : `Enter ${label.toLowerCase()}...`,
      options: newFieldType === 'select' ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
      required: newFieldRequired,
      socialPlatforms: newFieldType === 'social' ? [...newSocialPlatforms] : undefined,
      description: newFieldType === 'description' ? '' : undefined,
    };
    updateConfig({ fields: [...formConfig.fields, newField] });
    setExpandedFields(prev => new Set(prev).add(id));
    setNewFieldLabel('');
    setNewFieldOptions('');
    setNewSocialPlatforms(['linkedin', 'twitter']);
    setNewFieldRequired(true);
  };

  const handleAddDownloads = () => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    updateConfig({
      questions: [...(formConfig.questions || []), {
        id, isDownloads: true, downloadsTitle: 'Downloads', downloadsDescription: '', downloadItems: [], question: '', options: [], correctAnswer: '',
      } as CourseQuestion],
    });
  };

  const handleAddLinkedInShare = () => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    updateConfig({ questions: [...(formConfig.questions || []), newLinkedInShareSlide(id)] });
  };

  // Course management
  const handleAddQuestion = (overrideType?: QuestionTypeOrDownloads) => {
    const type = overrideType ?? newQuestionType;
    if (!formConfig) return;
    if (type === 'downloads') { handleAddDownloads(); return; }
    if (type === 'linkedin_share') { handleAddLinkedInShare(); return; }
    if (type === 'lesson') { insertLessonAt((formConfig.questions?.length ?? 0) - 1); return; }
    const id = Math.random().toString(36).substring(7);
    const defaults: Record<QuestionType, Partial<CourseQuestion>> = {
      multiple_choice:     { options: ['', '', '', ''], correctAnswer: '' },
      fill_blank:          { options: [], correctAnswer: '' },
      arrange:             { options: ['Step 1', 'Step 2', 'Step 3', 'Step 4'], correctAnswer: 'Step 1|||Step 2|||Step 3|||Step 4' },
      image:               { options: ['0', '1'], correctAnswer: '0', optionImages: ['', ''] },
      image_choice:        { options: ['', '', '', ''], correctAnswer: '', imageUrl: '' },
      code:                { options: ['', '', '', ''], correctAnswer: '', codeSnippet: '', codeLanguage: 'javascript' },
      code_review:         { options: [], correctAnswer: '', rubric: ['Code runs without errors', 'Follows naming conventions', 'Logic is correct'], reviewLanguage: 'javascript', minScore: 70 },
      excel_review:        { options: [], correctAnswer: '', rubric: ['Correct formulas used', 'Data is accurate', 'Formatting is clean'], context: '', minScore: 70 },
      dashboard_critique:  { options: [], correctAnswer: '', rubric: ['Visuals are appropriate', 'Insights are accurate', 'Layout is clear'], context: '', minScore: 70 },
      document_review:     { options: [], correctAnswer: '', rubric: ['Report addresses the brief', 'Analysis is evidence-based', 'Recommendations are actionable', 'Writing is clear and professional'], context: '', minScore: 70, documentReviewMode: 'ai_only' },
      written_response:    { options: [], correctAnswer: '', rubric: ['Answers the question directly', 'Reasoning is explained, not just asserted', 'Supported with a specific example or evidence', 'Clear and well organised'], context: '', expectedAnswer: '', writtenMaxWords: 200, minScore: 70 },
      sql_exercise:        { options: [], correctAnswer: '', sqlTables: [], sqlStarterCode: 'SELECT * FROM table_name LIMIT 10;', sqlSolution: '', sqlExpectedResult: undefined, sqlHints: [], sqlResultOrdered: false, sqlNumericTolerance: 0, sqlRequiredPatterns: [] },
      python_exercise:     { options: [], correctAnswer: '', pythonDatasets: [], pythonStarterCode: '# Write your solution here\n', pythonSolution: '', pythonExpectedOutput: '', pythonSetupCode: '', pythonHints: [] },
    };
    updateConfig({
      questions: [...(formConfig.questions || []), {
        id,
        type,
        question: '',
        ...defaults[type],
      } as CourseQuestion],
    });
  };

  /** A new, empty lesson: it opens at once so the title can be typed. */
  const newLesson = (): CourseQuestion => ({
    id: Math.random().toString(36).substring(7), type: 'multiple_choice', question: '', options: [], correctAnswer: '',
    lessonOnly: true, lesson: { title: '', body: '', imageUrl: '', videoUrl: '' },
  } as CourseQuestion);
  const insertLessonAt = (afterIndex: number) => {
    if (!formConfig) return;
    const lesson = newLesson();
    const qs = [...(formConfig.questions || [])];
    qs.splice(afterIndex + 1, 0, lesson);
    updateConfig({ questions: qs });
  };

  const handleAddSection = () => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    updateConfig({
      questions: [...(formConfig.questions || []), {
        id, isSection: true, sectionTitle: '', sectionDescription: '', question: '', options: [], correctAnswer: '',
      } as CourseQuestion],
    });
  };

  const insertSectionAt = (afterIndex: number) => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    const qs = [...(formConfig.questions || [])];
    qs.splice(afterIndex + 1, 0, {
      id, isSection: true, sectionTitle: '', sectionDescription: '', question: '', options: [], correctAnswer: '',
    } as CourseQuestion);
    updateConfig({ questions: qs });
  };

  const insertQuestionAt = (afterIndex: number, overrideType?: QuestionTypeOrDownloads) => {
    const type = overrideType ?? newQuestionType;
    if (!formConfig) return;
    if (type === 'lesson') { insertLessonAt(afterIndex); return; }
    if (type === 'downloads') {
      const id = Math.random().toString(36).substring(7);
      const qs = [...(formConfig.questions || [])];
      qs.splice(afterIndex + 1, 0, { id, isDownloads: true, downloadsTitle: 'Downloads', downloadsDescription: '', downloadItems: [], question: '', options: [], correctAnswer: '' } as CourseQuestion);
      updateConfig({ questions: qs });
      return;
    }
    if (type === 'linkedin_share') {
      const qs = [...(formConfig.questions || [])];
      qs.splice(afterIndex + 1, 0, newLinkedInShareSlide(Math.random().toString(36).substring(7)));
      updateConfig({ questions: qs });
      return;
    }
    const id = Math.random().toString(36).substring(7);
    const defaults: Record<QuestionType, Partial<CourseQuestion>> = {
      multiple_choice:     { options: ['', '', '', ''], correctAnswer: '' },
      fill_blank:          { options: [], correctAnswer: '' },
      arrange:             { options: ['Step 1', 'Step 2', 'Step 3', 'Step 4'], correctAnswer: 'Step 1|||Step 2|||Step 3|||Step 4' },
      image:               { options: ['0', '1'], correctAnswer: '0', optionImages: ['', ''] },
      image_choice:        { options: ['', '', '', ''], correctAnswer: '', imageUrl: '' },
      code:                { options: ['', '', '', ''], correctAnswer: '', codeSnippet: '', codeLanguage: 'javascript' },
      code_review:         { options: [], correctAnswer: '', rubric: ['Code runs without errors', 'Follows naming conventions', 'Logic is correct'], reviewLanguage: 'javascript', minScore: 70 },
      excel_review:        { options: [], correctAnswer: '', rubric: ['Correct formulas used', 'Data is accurate', 'Formatting is clean'], context: '', minScore: 70 },
      dashboard_critique:  { options: [], correctAnswer: '', rubric: ['Visuals are appropriate', 'Insights are accurate', 'Layout is clear'], context: '', minScore: 70 },
      document_review:     { options: [], correctAnswer: '', rubric: ['Report addresses the brief', 'Analysis is evidence-based', 'Recommendations are actionable', 'Writing is clear and professional'], context: '', minScore: 70, documentReviewMode: 'ai_only' },
      written_response:    { options: [], correctAnswer: '', rubric: ['Answers the question directly', 'Reasoning is explained, not just asserted', 'Supported with a specific example or evidence', 'Clear and well organised'], context: '', expectedAnswer: '', writtenMaxWords: 200, minScore: 70 },
      sql_exercise:        { options: [], correctAnswer: '', sqlTables: [], sqlStarterCode: 'SELECT * FROM table_name LIMIT 10;', sqlSolution: '', sqlExpectedResult: undefined, sqlHints: [], sqlResultOrdered: false, sqlNumericTolerance: 0, sqlRequiredPatterns: [] },
      python_exercise:     { options: [], correctAnswer: '', pythonDatasets: [], pythonStarterCode: '# Write your solution here\n', pythonSolution: '', pythonExpectedOutput: '', pythonSetupCode: '', pythonHints: [] },
    };
    const qs = [...(formConfig.questions || [])];
    qs.splice(afterIndex + 1, 0, {
      id,
      type,
      question: '',
      ...defaults[type],
    } as CourseQuestion);
    updateConfig({ questions: qs });
  };

  const handlePickerSelect = (type: QuestionTypeOrDownloads) => {
    if (!pickerCtx) return;
    setPickerCtx(null);
    if (type === 'lesson') {
      if (pickerCtx.mode === 'insert') insertLessonAt(pickerCtx.afterIndex);
      else if (pickerCtx.mode === 'bottom') insertLessonAt((formConfig?.questions?.length ?? 0) - 1);
      return;
    }
    if (pickerCtx.mode === 'bottom') {
      handleAddQuestion(type);
    } else if (pickerCtx.mode === 'insert') {
      insertQuestionAt(pickerCtx.afterIndex, type);
    } else if (pickerCtx.mode === 'change') {
      // Slide kinds carry no answer, so an existing question cannot be converted into one.
      if (type === 'downloads' || type === 'linkedin_share') return;
      const q = formConfig?.questions?.find(qq => qq.id === pickerCtx.qId);
      if (!q) return;
      const qType = q.type ?? 'multiple_choice';
      const v = type as QuestionType;
      const isReview = ['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'].includes(v);
      const isSql = v === 'sql_exercise';
      const isPython = v === 'python_exercise';
      handleUpdateQuestion(q.id, {
        type: v,
        ...(isReview || isSql || isPython ? { options: [], correctAnswer: '' } : {}),
        ...(isSql ? { sqlTables: q.sqlTables ?? [], sqlStarterCode: q.sqlStarterCode ?? 'SELECT * FROM table_name LIMIT 10;', sqlSolution: q.sqlSolution ?? '', sqlHints: q.sqlHints ?? [], sqlResultOrdered: q.sqlResultOrdered ?? false, sqlNumericTolerance: q.sqlNumericTolerance ?? 0, sqlRequiredPatterns: q.sqlRequiredPatterns ?? [] } : {}),
        ...(isPython ? { pythonDatasets: q.pythonDatasets ?? [], pythonStarterCode: q.pythonStarterCode ?? '# Write your solution here\n', pythonSolution: q.pythonSolution ?? '', pythonExpectedOutput: q.pythonExpectedOutput ?? '', pythonSetupCode: q.pythonSetupCode ?? '', pythonHints: q.pythonHints ?? [] } : {}),
        ...(!isReview && !isSql && !isPython && v === 'fill_blank' ? { options: [] } : {}),
        ...(!isReview && !isSql && !isPython && v === 'arrange' && qType !== 'arrange' ? { correctAnswer: q.options.join('|||') } : {}),
      });
    }
  };

  const handleQuestionOptionImageSelect = (qId: string, optionIdx: number, src: string) => {
    const q = formConfig?.questions?.find(question => question.id === qId);
    if (!q) return;
    const newImages = [...(q.optionImages || q.options.map(() => ''))];
    if (newImages[optionIdx] && newImages[optionIdx] !== src) deleteUploadedFile(newImages[optionIdx]);
    newImages[optionIdx] = src;
    handleUpdateQuestion(qId, { optionImages: newImages });
  };

  /** Ask before deleting an outline item; the dialog says exactly what goes. */
  const askDelete = (q: CourseQuestion) => {
    const qs = formConfig?.questions ?? [];
    const nums = questionNumbers(qs);
    const idx = qs.findIndex(x => x.id === q.id);
    const plain = (t?: string) => (t ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.isSection) {
      const name = q.sectionTitle || 'Untitled';
      const withContent = moduleIds(qs, q.id, true);
      const count = withContent.length - 1;
      setPendingDelete(count > 0
        ? { ids: withContent, confirm: 'Delete with content', title: `Delete the module "${name}"?`,
            body: `It holds ${count === 1 ? '1 lesson or question' : `${count} lessons and questions`}.`,
            alt: { label: 'Keep its content', ids: [q.id] } }
        : { ids: [q.id], confirm: 'Delete module', title: `Delete the module "${name}"?`, body: 'It has no content. Only the heading is removed.' });
    } else if (q.lessonOnly) {
      setPendingDelete({ ids: [q.id], confirm: 'Delete', title: `Delete the lesson "${q.lesson?.title || 'Untitled'}"?`, body: 'Its content will be removed from the course.' });
    } else if (q.isDownloads || q.isLinkedInShare) {
      setPendingDelete({ ids: [q.id], confirm: 'Delete', title: `Delete "${(q.isDownloads ? q.downloadsTitle : q.linkedInShareTitle) || (q.isDownloads ? 'Downloads' : 'LinkedIn share')}"?`, body: 'It will be removed from the course.' });
    } else {
      const text = plain(q.question);
      setPendingDelete({ ids: [q.id], confirm: 'Delete', title: `Delete Q${nums[idx] || ''}?`.replace('Q?', 'this question?'),
        body: text ? `"${text.length > 80 ? `${text.slice(0, 80)}...` : text}" and its answers will be removed from the course.` : 'It will be removed from the course.' });
    }
  };

  const handleUpdateQuestion = (id: string, updates: Partial<CourseQuestion>) => {
    if (!formConfig) return;
    updateConfig({ questions: formConfig.questions?.map(q => q.id === id ? { ...q, ...updates } : q) || [] });
  };

  const handleSqlDatasetUpload = async (questionId: string, tableId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(csv|tsv|xlsx)$/i.test(file.name)) {
      showToast('Upload a CSV, TSV, or Excel file for SQL exercises.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast('Dataset too large. Keep SQL exercise files under 25MB.', 'error');
      return;
    }
    try {
      const { url } = await uploadToGithub(file, 'sql-datasets');
      const q = formConfig?.questions?.find(q => q.id === questionId);
      const tables = (q?.sqlTables ?? []).map(t => t.id === tableId ? { ...t, fileName: file.name, fileUrl: url, csvUrl: url } : t);
      handleUpdateQuestion(questionId, { sqlTables: tables, sqlExpectedResult: undefined });
      showToast('Dataset uploaded.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Dataset upload failed.', 'error');
    }
  };

  const handlePythonDatasetUpload = async (questionId: string, datasetId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(csv|tsv)$/i.test(file.name)) {
      showToast('Upload a CSV or TSV file for Python datasets.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast('Dataset too large. Keep files under 25MB.', 'error');
      return;
    }
    try {
      const { url } = await uploadToGithub(file, 'python-datasets');
      // Use functional update so we always read the latest state, not the stale closure
      setFormConfig(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: (prev.questions ?? []).map(q => {
            if (q.id !== questionId) return q;
            return {
              ...q,
              pythonDatasets: (q.pythonDatasets ?? []).map(d =>
                d.id === datasetId ? { ...d, fileName: file.name, fileUrl: url, csvUrl: url } : d
              ),
            };
          }),
        };
      });
      showToast('Dataset uploaded.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Dataset upload failed.', 'error');
    }
  };

  const computeSqlExpectedResult = async (questionId: string) => {
    const q = formConfig?.questions?.find(q => q.id === questionId);
    if (!q?.sqlSolution?.trim()) {
      showToast('Add a solution query first.', 'error');
      return;
    }
    try {
      showToast('Computing expected SQL result...');
      const tableMap = new Map<string, NonNullable<CourseQuestion['sqlTables']>[number]>();
      for (const question of formConfig?.questions ?? []) {
        if (question.type !== 'sql_exercise') continue;
        for (const table of question.sqlTables ?? []) {
          const key = `${table.tableName}|${table.fileUrl || table.csvUrl || table.seedSql || ''}`;
          if (table.tableName && !tableMap.has(key)) tableMap.set(key, table);
        }
      }
      const runtime = await initSQLRuntime(Array.from(tableMap.values()));
      try {
        const expected = await executeQuery(runtime.conn, q.sqlSolution, false, { limit: null });
        handleUpdateQuestion(questionId, { sqlExpectedResult: expected });
        showToast(`Expected result saved (${expected.rows.length} rows).`, 'success');
      } finally {
        await runtime.close();
      }
    } catch (err: any) {
      console.error('[sql-exercise] compute expected result failed', err);
      showToast(err?.message || 'Could not compute expected result.', 'error');
    }
  };

  const computePythonExpectedOutput = async (questionId: string) => {
    const q = formConfig?.questions?.find(q => q.id === questionId);
    if (!q?.pythonSolution?.trim()) {
      showToast('Add a solution first.', 'error');
      return;
    }
    try {
      showToast('Running Python solution...');
      const runtime = await initPythonRuntime(q.pythonSetupCode?.trim() || undefined);
      await loadPythonDatasets(runtime, q.pythonDatasets ?? [], 0);
      const res = await runPython(runtime, q.pythonSolution);
      if (res.error) throw new Error(res.error);
      const out = res.stdout + (res.returnValue !== null && !res.stdout.trim() ? `Out: ${res.returnValue}` : '');
      handleUpdateQuestion(questionId, { pythonExpectedOutput: out });
      showToast('Expected output saved.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not compute expected output.', 'error');
    }
  };

  const handleExtractRubric = async (questionId: string, label: RubricImportKind, file: File) => {
    const key = `${questionId}:${label}`;
    setExtractingRubric(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      const question = formConfig?.questions?.find(q => q.id === questionId);
      form.append('reviewSheetNames', JSON.stringify(question?.type === 'excel_review' ? question.reviewSheetNames ?? [] : []));
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || 'Extraction failed.', 'error'); return; }
      const incoming: string[] = json.criteria ?? [];
      setFormConfig(current => current ? {
        ...current,
        questions: current.questions?.map(question => question.id === questionId
          ? { ...question, rubric: mergeRubricCriteria(question.rubric ?? [], incoming) }
          : question) ?? [],
      } : current);
      showToast(`${incoming.length} criteria extracted`, 'success');
    } catch {
      showToast('Failed to extract rubric. Please try again.', 'error');
    } finally {
      setExtractingRubric(null);
    }
  };

  const openBunnyPicker = async (qId: string, search = '', collection = '') => {
    setBunnyPickerQId(qId);
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
    if (!bunnyPickerQId || !formConfig) return;
    const q = formConfig.questions?.find(q => q.id === bunnyPickerQId);
    if (!q) return;
    handleUpdateQuestion(bunnyPickerQId, { lesson: { ...q.lesson, videoUrl: embedUrl } });
    setBunnyPickerOpen(false);
    setBunnyPickerQId(null);
    setBunnySearch('');
    setBunnyCollection('');
  };


  const FE = useFEC();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (!formConfig) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-zinc-500 text-sm">Could not load form configuration.</p>
      </div>
    );
  }

  // The course's own colour, for learners; the editor's controls use the shared blue.
  const courseAccent = formConfig.customAccent ?? themeAccentColors[formConfig.theme] ?? '#00bf63';
  const accentColor = FE.cta;
  const DC = FE === FE_DARK ? DASH_DARK : DASH_LIGHT_BLUE;
  const inputStyle = { background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text };
  const labelStyle = { color: FE.faint };
  // Every section is a flat block of one white card, with a divider line above it (the card clips
  // the first one).
  const studioPanelClass = 'p-5 space-y-5';
  const studioPanelStyle = { borderTop: `1px solid ${FE.divider}` };

  const defaultPoints = DEFAULT_POINTS;
  const editorSections = ([
    { id: 'info', label: 'Basic Info' },
    ...(contentType === 'course' ? [{ id: 'curriculum', label: 'Lessons' }] : []),
    { id: 'cover', label: contentType === 'course' ? 'Cover & Media' : 'Cover Image' },
    ...(contentType === 'event' ? [{ id: 'fields', label: 'Registration Fields' }] : []),
    ...(contentType === 'event' ? [
      { id: 'event_details', label: 'Event Details' },
      { id: 'speakers', label: 'Speakers' },
      { id: 'visibility', label: 'Visibility' },
    ] : []),
    ...(contentType === 'course' ? [{ id: 'course_settings', label: 'Learning Rules' }] : []),
    { id: 'appearance', label: 'Appearance' },
    ...(contentType === 'course' ? [{ id: 'points', label: 'Points & Rewards' }] : []),
    { id: 'cohorts', label: 'Access' },
    { id: 'share', label: 'Share URL' },
    { id: 'submission', label: 'Completion' },
  ] as { id: string; label: string }[]);
  const editorSectionIds = editorSections.map(section => section.id);
  // The editor's steps: each shows one or more sections, and the step bar switches between them.
  type StudioMode = { id: string; label: string; Icon: typeof Blocks; sections: string[] };
  const studioModes: StudioMode[] = formConfig.isCourse ? [
    { id: 'build', label: 'Build', Icon: Blocks, sections: ['info'] },
    { id: 'content', label: 'Content', Icon: Video, sections: ['curriculum'] },
    { id: 'design', label: 'Design', Icon: Monitor, sections: ['cover', 'appearance'] },
    { id: 'settings', label: 'Settings', Icon: Settings, sections: ['course_settings', 'points', 'cohorts'] },
    { id: 'publish', label: 'Publish', Icon: CheckCircle2, sections: ['share', 'submission'] },
  ] : [
    { id: 'details', label: 'Details', Icon: CalendarDays, sections: ['info', 'cover', 'event_details', 'speakers'] },
    { id: 'registration', label: 'Registration', Icon: ClipboardList, sections: ['fields'] },
    { id: 'design', label: 'Design', Icon: Monitor, sections: ['appearance'] },
    { id: 'settings', label: 'Settings', Icon: Settings, sections: ['visibility', 'cohorts'] },
    { id: 'publish', label: 'Publish', Icon: CheckCircle2, sections: ['share', 'submission'] },
  ];
  const activeStudioMode = studioModes.find(mode => mode.sections.includes(activeSection)) ?? studioModes[0];
  const inStep = (sectionId: string) => activeStudioMode.sections.includes(sectionId);
  // Learner numbering (Q1, Q2 ...) for the outline, and what still blocks publishing.
  const qNumbers = questionNumbers(formConfig.questions ?? []);
  const outlineGroups = groupOutline(formConfig.questions ?? []);
  const visibleOutlineIds = outlineGroups.flatMap(g => [
    ...(g.section ? [g.section.id] : []),
    ...(g.section && collapsedModules.has(g.section.id) ? [] : g.items.map(i => i.id)),
  ]);
  const publishIssues = formConfig.isCourse ? courseIssues(formConfig) : [];
  const contentCount = (formConfig.questions ?? []).filter(q => !q.isSection).length;
  /** "Go to it": open the tab and the outline row the issue is about. */
  const goToIssue = (itemId: string) => {
    if (!itemId) { setActiveSection('info'); return; }
    setActiveSection('curriculum');
    setExpandedQuestions(prev => new Set([...prev, itemId]));
    setTimeout(() => document.querySelector(`[data-item-id="${itemId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  };

  return (
    <div className={`flex flex-col ${saveSlots ? 'pb-12' : 'pb-28'}`} style={{ background: 'transparent', color: FE.text, colorScheme: FE === FE_DARK ? 'dark' : 'light' }}>
      {/* -- Content Area (no left pane -- section nav is the horizontal stepper below) -- */}
      <div className="flex-1 flex flex-col">
        {/* Save: in the page header when the host gives it a place (the course page does), else floating. */}
        {(() => {
          const status = (
            <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: FE.muted }}>
              {!isDirty && <Check className="w-3.5 h-3.5" style={{ color: FE === FE_DARK ? '#3DD68C' : '#12A150' }} />}
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
          );
          const button = (
            <button type="button" onClick={handleSave} disabled={isSaving} className={btnClass} style={btnStyle('pri', DC)}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
              {saved ? 'Saved' : 'Save changes'}
            </button>
          );
          if (saveSlots) return <>{createPortal(status, saveSlots.status)}{createPortal(button, saveSlots.button)}</>;
          return (
            <div className="fixed left-4 right-4 bottom-4 sm:left-auto sm:right-6 sm:bottom-6 z-[90] flex items-center justify-between sm:justify-end gap-3 p-2 rounded-xl" style={{ background: FE.card, boxShadow: FE === FE_DARK ? '0 14px 38px rgba(0,0,0,0.48)' : '0 14px 38px rgba(15,23,42,0.16)' }}>
              <span className="pl-2">{status}</span>{button}
            </div>
          );
        })()}
        <nav role="tablist" aria-label="Editor steps" className="mt-4 inline-flex w-fit max-w-full gap-1 p-1 rounded-[14px] overflow-x-auto" style={{ background: FE.card, scrollbarWidth: 'none' }}>
          {studioModes.map(mode => {
            const active = mode.id === activeStudioMode.id;
            return (
              <button key={mode.id} type="button" role="tab" aria-selected={active} onClick={() => goToSection(mode.sections[0], editorSectionIds)}
                className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                style={active ? { background: accentColor, color: '#fff' } : { color: FE.muted }}>
                {mode.label}
              </button>
            );
          })}
        </nav>
        <div className="flex-1">
          <div>
          <div>
          <AnimatePresence mode="wait" custom={secDir}>
          <motion.div key={activeSection} custom={secDir}
            initial={{ opacity: 0, x: secDir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: secDir * -28 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4">
            {/* One white card; each section draws a divider above itself, and the card clips the first. */}
            <div className="rounded-2xl overflow-hidden" style={{ background: FE.card }}>
            <div className="flex min-w-0 flex-col -mt-px">

            {activeStudioMode.id === 'publish' && publishControls && (
              <div className={studioPanelClass} style={studioPanelStyle}>{publishControls({ ready: publishIssues.length === 0, unsaved: isDirty })}</div>
            )}

            {formConfig.isCourse && activeStudioMode.id === 'publish' && (
              <section className={studioPanelClass} style={studioPanelStyle}>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>
                  {publishIssues.length === 0 ? 'Ready to publish' : `${publishIssues.length} thing${publishIssues.length === 1 ? '' : 's'} to fix before publishing`}
                </h3>
                <div className="mt-4 flex flex-col gap-2">
                  {publishIssues.map((issue, i) => (
                    <div key={`${issue.id}-${i}`} className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: FE.card }}>
                      <span className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ background: '#d97706', color: '#fff' }}>!</span>
                      <span className="text-xs flex-1 min-w-0" style={{ color: FE.text }}>{issue.message}</span>
                      <button type="button" onClick={() => goToIssue(issue.id)} className={btnSmClass} style={btnStyle('ghost', DC)}>Go to it</button>
                    </div>
                  ))}
                  {[
                    { ok: !!formConfig.title?.trim() && !!formConfig.description?.replace(/<[^>]*>/g, '').trim(), label: 'Title and description' },
                    { ok: contentCount > 0, label: `${contentCount} item${contentCount === 1 ? '' : 's'} of content` },
                  ].filter(c => c.ok).map(c => (
                    <div key={c.label} className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: FE.card }}>
                      <span className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full" style={{ background: '#22c55e', color: '#fff' }}><Check className="w-3 h-3" /></span>
                      <span className="text-xs" style={{ color: FE.text }}>{c.label}</span>
                    </div>
                  ))}
                  {!formConfig.coverImage && (
                    <div className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: FE.card }}>
                      <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${FE.faint}` }} />
                      <span className="text-xs flex-1" style={{ color: FE.faint }}>Cover image (suggested)</span>
                      <button type="button" onClick={() => setActiveSection('cover')} className={btnSmClass} style={btnStyle('ghost', DC)}>Add one</button>
                    </div>
                  )}
                </div>
                {publishIssues.length > 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: FE.faint }}>Publishing waits until these are fixed. Unpublishing is always possible.</p>
                )}
              </section>
            )}

            {inStep('info') && formConfig.eventDetails?.isEvent && (
                <div className="flex items-center justify-between gap-4 rounded-2xl p-4" style={{ background: `${accentColor}0e` }}>
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: FE.pill, color: FE.muted }}>
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: FE.text }}>AI Event Assistant</p>
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: FE.faint }}>Generate the setup, registration fields, and confirmation copy from a short brief.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEventAssistantOpen(true)} disabled={!!aiLoadingLabel}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50 flex-shrink-0"
                    style={{ background: accentColor, color: 'white' }}>
                    <Sparkles className="w-3.5 h-3.5" /> Open Assistant
                  </button>
                </div>
            )}

            {inStep('info') && (
              <div className={studioPanelClass} style={studioPanelStyle}>
              {formConfig.isCourse ? <div>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>About the course</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Give learners a clear promise before they begin.</p>
              </div> : <h3 className="text-base font-semibold" style={{ color: FE.text }}>About the event</h3>}
              <div>
                <label className={labelCls} style={labelStyle}>Title</label>
                <input type="text" value={formConfig.title} onChange={e => updateConfig({ title: e.target.value })} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Description</label>
                  {formConfig.isCourse && (
                    <button
                      type="button"
                      onClick={() => setDescriptionModalOpen(true)}
                      disabled={!!aiLoadingLabel}
                      className={btnSmClass} style={btnStyle('sec', DC)}
                    >
                      <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                      Write with AI
                    </button>
                  )}
                </div>
                <RichTextEditor value={formConfig.description} onChange={html => updateConfig({ description: html })} enableAiAssist />
                {formConfig.isCourse && (
                  <p className="mt-2 text-[11px]" style={{ color: FE.faint }}>
                    Recommended: keep your description under 250 characters for best display on your profile page.
                  </p>
                )}
              </div>
              {/* What learners will learn: course identity, shown on the overview page beside the description. */}
              {formConfig.isCourse && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>What learners will learn <span style={{ color: FE.faint }}>(shown on the course overview)</span></label>
                    <button type="button" onClick={generateOutcomes} disabled={!!aiLoadingLabel}
                      className={btnSmClass} style={btnStyle('sec', DC)}>
                      {aiLoadingLabel === 'Generating learning outcomes...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />}
                      Write with AI
                    </button>
                  </div>
                  {(formConfig.learnOutcomes || []).map((outcome, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={outcome}
                        aria-label={`Outcome ${idx + 1}`}
                        onChange={e => {
                          const next = [...(formConfig.learnOutcomes || [])];
                          next[idx] = e.target.value;
                          updateConfig({ learnOutcomes: next });
                        }}
                        className={`${inputCls} flex-1`}
                        style={inputStyle}
                        placeholder="e.g. Clean a messy sales export"
                      />
                      <button type="button" aria-label={`Remove outcome ${idx + 1}`}
                        onClick={() => updateConfig({ learnOutcomes: (formConfig.learnOutcomes || []).filter((_, i) => i !== idx) })}
                        className="transition-colors hover:text-red-400" style={{ color: FE.faint }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => updateConfig({ learnOutcomes: [...(formConfig.learnOutcomes || []), ''] })}
                    className={`${btnSmClass} self-start`} style={btnStyle('sec', DC)}>
                    <Plus className="w-3.5 h-3.5" /> Add outcome
                  </button>
                  {aiError && aiLoadingLabel === '' && activeSection === 'info' && <p className="text-[11px]" style={{ color: '#D93025' }}>{aiError}</p>}
                </div>
              )}
              </div>
            )}

            {inStep('event_details') && formConfig.eventDetails?.isEvent && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>When and where</h3>
                {/* FORMAT -- type + location */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold" style={{ color: FE.muted }}>Format</p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { type: 'in-person', Icon: MapPin, label: 'In-Person', desc: 'A physical venue' },
                      { type: 'virtual',   Icon: Video,  label: 'Virtual',   desc: 'An online meeting' },
                    ] as const).map(({ type, Icon, label, desc }) => {
                      const active = (formConfig.eventDetails!.eventType ?? 'in-person') === type;
                      return (
                        <button key={type} type="button"
                          onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, eventType: type } })}
                          className="relative flex flex-col items-start gap-2 p-4 rounded-2xl text-left transition-all"
                          style={{ background: active ? `${accentColor}14` : FE.input }}>
                          {active && <Check className="w-4 h-4 absolute top-3 right-3" style={{ color: accentColor }} />}
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: active ? `${accentColor}1f` : FE.pill, color: active ? accentColor : FE.muted }}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: active ? accentColor : FE.text }}>{label}</p>
                            <p className="text-[11px]" style={{ color: FE.faint }}>{desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {(formConfig.eventDetails.eventType ?? 'in-person') === 'virtual' ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: FE.faint }}>
                        <Link2 className="w-4 h-4" />
                      </span>
                      <input type="url" value={formConfig.eventDetails.meetingLink || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, meetingLink: e.target.value } })} placeholder="https://meet.google.com/..." className={`${inputCls} pl-9`} style={inputStyle} />
                    </div>
                  ) : (
                    <VenueFields location={formConfig.eventDetails.location || ''}
                      onChange={location => updateConfig({ eventDetails: { ...formConfig.eventDetails!, location } })}
                      inputClass={inputCls} inputStyle={inputStyle} iconColor={FE.faint} />
                  )}
                </div>

                {/* SCHEDULE */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold" style={{ color: FE.muted }}>Schedule</p>
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Date</label>
                    <DateField label="Date" value={formConfig.eventDetails.date || ''} onChange={date => updateConfig({ eventDetails: { ...formConfig.eventDetails!, date } })} C={FE} />
                  </div>
                  <div>
                    <label className={labelCls} style={labelStyle}>Time</label>
                    <TimeField label="Time" value={formConfig.eventDetails.time || ''} onChange={time => updateConfig({ eventDetails: { ...formConfig.eventDetails!, time } })} C={FE} />
                  </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Timezone</label>
                    <select value={formConfig.eventDetails.timezone || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, timezone: e.target.value } })} className={inputCls} style={inputStyle}>
                      <option value="">Select timezone</option>
                      <optgroup label="Africa">
                        <option value="GMT+0 (Accra)">GMT+0 - Accra</option>
                        <option value="GMT+1 (Lagos)">GMT+1 - Lagos</option>
                        <option value="GMT+2 (Cairo)">GMT+2 - Cairo</option>
                        <option value="GMT+2 (Johannesburg)">GMT+2 - Johannesburg</option>
                        <option value="GMT+3 (Nairobi)">GMT+3 - Nairobi</option>
                      </optgroup>
                      <optgroup label="Americas">
                        <option value="GMT-5 (EST)">GMT-5 - Eastern (EST)</option>
                        <option value="GMT-4 (EDT)">GMT-4 - Eastern Daylight (EDT)</option>
                        <option value="GMT-6 (CST)">GMT-6 - Central (CST)</option>
                        <option value="GMT-5 (CDT)">GMT-5 - Central Daylight (CDT)</option>
                        <option value="GMT-7 (MST)">GMT-7 - Mountain (MST)</option>
                        <option value="GMT-8 (PST)">GMT-8 - Pacific (PST)</option>
                        <option value="GMT-7 (PDT)">GMT-7 - Pacific Daylight (PDT)</option>
                        <option value="GMT-9 (AKST)">GMT-9 - Alaska (AKST)</option>
                        <option value="GMT-10 (HST)">GMT-10 - Hawaii (HST)</option>
                        <option value="GMT-3 (BRT)">GMT-3 - Brasilia (BRT)</option>
                        <option value="GMT-5 (COT)">GMT-5 - Colombia (COT)</option>
                        <option value="GMT-4 (AMT)">GMT-4 - Amazon (AMT)</option>
                        <option value="GMT-3 (ART)">GMT-3 - Argentina (ART)</option>
                      </optgroup>
                      <optgroup label="Europe">
                        <option value="GMT+0 (GMT)">GMT+0 - London (GMT)</option>
                        <option value="GMT+1 (BST)">GMT+1 - London Daylight (BST)</option>
                        <option value="GMT+1 (CET)">GMT+1 - Central Europe (CET)</option>
                        <option value="GMT+2 (CEST)">GMT+2 - Central Europe Summer (CEST)</option>
                        <option value="GMT+2 (EET)">GMT+2 - Eastern Europe (EET)</option>
                        <option value="GMT+3 (MSK)">GMT+3 - Moscow (MSK)</option>
                      </optgroup>
                      <optgroup label="Asia">
                        <option value="GMT+3 (AST)">GMT+3 - Arabia (AST)</option>
                        <option value="GMT+4 (GST)">GMT+4 - Gulf (GST)</option>
                        <option value="GMT+5 (PKT)">GMT+5 - Pakistan (PKT)</option>
                        <option value="GMT+5:30 (IST)">GMT+5:30 - India (IST)</option>
                        <option value="GMT+6 (BST)">GMT+6 - Bangladesh (BST)</option>
                        <option value="GMT+7 (WIB)">GMT+7 - Jakarta (WIB)</option>
                        <option value="GMT+8 (CST)">GMT+8 - China/Singapore (CST)</option>
                        <option value="GMT+8 (PHT)">GMT+8 - Philippines (PHT)</option>
                        <option value="GMT+9 (JST)">GMT+9 - Japan/Korea (JST)</option>
                        <option value="GMT+5:30 (IST)">GMT+5:30 - Sri Lanka</option>
                      </optgroup>
                      <optgroup label="Pacific">
                        <option value="GMT+10 (AEST)">GMT+10 - Sydney (AEST)</option>
                        <option value="GMT+11 (AEDT)">GMT+11 - Sydney Daylight (AEDT)</option>
                        <option value="GMT+12 (NZST)">GMT+12 - New Zealand (NZST)</option>
                      </optgroup>
                    </select>
                  </div>
                  {(formConfig.eventDetails!.recurrence ?? 'once') !== 'once' && (
                  <div>
                    <label className={labelCls} style={labelStyle}>End date</label>
                    <DateField label="End date" placeholder="No end date" value={formConfig.eventDetails.recurrenceEndDate || ''} onChange={recurrenceEndDate => updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrenceEndDate } })} C={FE} />
                  </div>
                  )}
                  </div>
                </div>

                {/* REPEATS */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold" style={{ color: FE.muted }}>Repeats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['once', 'daily', 'weekly'] as const).map(freq => {
                      const active = (formConfig.eventDetails!.recurrence ?? 'once') === freq;
                      const labels = { once: 'One-time', daily: 'Daily', weekly: 'Weekly' };
                      return (
                        <button key={freq} type="button"
                          onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrence: freq } })}
                          className="py-3 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: active ? `${accentColor}14` : FE.input, color: active ? accentColor : FE.muted }}>
                          {labels[freq]}
                        </button>
                      );
                    })}
                  </div>

                {(formConfig.eventDetails!.recurrence ?? 'once') === 'weekly' && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Repeat on</label>
                    <div className="flex gap-2 flex-wrap mt-1">
                      {[
                        { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' },
                        { day: 4, label: 'Thu' }, { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' }, { day: 0, label: 'Sun' },
                      ].map(({ day, label }) => {
                        const selected = (formConfig.eventDetails!.recurrenceDays ?? []).includes(day);
                        return (
                          <button key={day} type="button"
                            onClick={() => {
                              const days = formConfig.eventDetails!.recurrenceDays ?? [];
                              const next = selected ? days.filter(d => d !== day) : [...days, day];
                              updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrenceDays: next } });
                            }}
                            className="w-10 h-9 rounded-lg text-xs font-semibold transition-all"
                            style={{ background: selected ? accentColor : FE.input, color: selected ? FE.ctaText : FE.faint }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                </div>
              </div>
            )}

            {inStep('visibility') && formConfig.eventDetails?.isEvent && (() => {
              // Two independent switches, each with a fixed label so its state is read from the
              // switch, not from wording that changes. Public registration: migration 244.
              const ev = formConfig.eventDetails!;
              const isPublic = ev.publicRegistration === true;
              const rows = [
                {
                  key: 'public', on: isPublic, title: 'Open to public registration',
                  body: 'Anyone can register on the public events page, with or without an account. Cohort members are still registered automatically.',
                  toggle: () => updateConfig({ eventDetails: { ...ev, publicRegistration: !isPublic } }),
                },
                {
                  key: 'listed', on: ev.isPrivate !== true, title: 'Listed',
                  body: `Shown on your profile${isPublic ? ' and the public events page' : ''}. Turn off to keep it unlisted, so only people with the link can find it.`,
                  toggle: () => updateConfig({ eventDetails: { ...ev, isPrivate: ev.isPrivate !== true } }),
                },
              ];
              return (
                <div className={studioPanelClass} style={studioPanelStyle}>
                  <h3 className="text-base font-semibold" style={{ color: FE.text }}>Visibility</h3>
                  {rows.map(r => (
                    <button key={r.key} type="button" role="switch" aria-checked={r.on} onClick={r.toggle}
                      className="w-full flex items-center justify-between gap-4 px-4 py-4 rounded-xl border text-left transition-colors duration-200"
                      style={{ background: FE.card, borderColor: FE.divider }}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: FE.text }}>{r.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: FE.faint }}>{r.body}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] font-semibold w-6 text-right" style={{ color: FE.muted }}>{r.on ? 'On' : 'Off'}</span>
                        <div className="relative w-10 h-5 rounded-full transition-colors duration-300" style={{ background: r.on ? accentColor : FE.toggleOff }}>
                          <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300" style={{ left: r.on ? '1.375rem' : '0.125rem' }} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}

            {inStep('speakers') && formConfig.eventDetails?.isEvent && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
              <h3 className="text-base font-semibold" style={{ color: FE.text }}>Speakers</h3>
              <SpeakersEditor
                speakers={formConfig.eventDetails.speakers ?? []}
                onChange={next => updateConfig({ eventDetails: { ...formConfig.eventDetails!, speakers: next } })}
                draft={speakerDraft}
                tokens={FE}
                accentColor={accentColor}
                labelClass={labelCls}
                labelStyle={labelStyle}
                onError={msg => showToast(msg)}
              />
              </div>
            )}

            {inStep('cohorts') && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 2 }}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold" style={{ color: FE.text }}>{formConfig.isCourse ? 'Who gets it' : 'Access'}</h3>
                  {formConfig.isCourse && <span className="text-xs" style={{ color: FE.muted }}>{courseAvailableToEveryone ? 'Everyone' : `${selectedCohortIds.length} cohort${selectedCohortIds.length === 1 ? '' : 's'}`}</span>}
                </div>
                {formConfig.isCourse && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: FE.text }}>Available to everyone</p>
                      <p className="text-xs mt-0.5" style={{ color: FE.muted }}>Anyone with an account can open it. Cohort choices are set aside while this is on.</p>
                    </div>
                    <SwitchToggle checked={courseAvailableToEveryone} accentColor={accentColor}
                      onChange={v => { setCourseAvailableToEveryone(v); if (v) setSelectedCohortIds([]); }} />
                  </div>
                )}
                {cohorts.length === 0 ? (
                  <p className="text-sm" style={{ color: FE.muted }}>No cohorts yet. Create one from the dashboard first.</p>
                ) : (
                  <div>
                    {cohorts.map((c, i) => {
                      const on = selectedCohortIds.includes(c.id);
                      return (
                        <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleCohort(c.id)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: FE.text, borderTop: i ? `1px solid ${FE.divider}` : undefined }}>
                          <span aria-hidden className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-md" style={on ? { background: accentColor, color: '#fff' } : { boxShadow: `inset 0 0 0 2px ${FE.faint}` }}>
                            {on && <Check className="w-3 h-3" strokeWidth={3} />}
                          </span>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {formConfig.isCourse && <p className="text-xs" style={{ color: FE.faint }}>
                  {courseAvailableToEveryone
                    ? 'Available to every signed-in student.'
                    : selectedCohortIds.length > 0
                      ? 'Only the selected cohorts can access this course.'
                      : 'Nobody can access this yet. Choose Everyone or select at least one cohort.'}
                </p>}
                {formConfig.isCourse && (
                  <div className="pt-3 border-t" style={{ borderColor: FE.inputBorder }}>
                    <PlanAccessPicker
                      contentTable="courses"
                      contentId={formId}
                      availableToEveryone={courseAvailableToEveryone}
                      onPublicAccessClosed={() => setCourseAvailableToEveryone(false)}
                    />
                  </div>
                )}
                {selectedCohortIds.length > 0 && (
                  <div className="pt-2 border-t" style={{ borderColor: FE.inputBorder }}>
                    <label className="block text-xs font-semibold mb-2" style={{ color: FE.muted }}>Deadline (days from assignment)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={1} max={365} placeholder="--"
                        value={formConfig.deadline_days ?? ''}
                        onChange={e => updateConfig({ deadline_days: e.target.value ? Number(e.target.value) : null })}
                        className="w-20 bg-transparent px-2 py-2 text-sm outline-none rounded-lg text-center"
                        style={{ border: `1px solid ${FE.inputBorder}`, color: FE.text, background: FE.input }}
                      />
                      <span className="text-xs" style={{ color: FE.faint }}>days · leave blank for no deadline</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {inStep('share') && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 0 }}>
              <div>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>Link</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Pasted into WhatsApp, LinkedIn or X, the link shows the cover image, title and description.</p>
              </div>
              {(() => {
                const liveUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${contentPath({ slug: customSlug || formId, config: formConfig })}`;
                const ghost = { background: FE.groupBg, color: FE.text };
                return (
                  <div className="flex flex-wrap gap-2">
                    <input readOnly value={liveUrl} aria-label={`Link to this ${formConfig.isCourse ? 'course' : 'event'}`} onFocus={e => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-[10px] px-3 py-2 font-mono text-xs outline-none" style={{ background: FE.groupBg, color: FE.muted, border: 'none' }} />
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(liveUrl).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }).catch(() => {}); }}
                      className="rounded-[10px] px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80" style={ghost}>{linkCopied ? 'Copied' : 'Copy'}</button>
                    <a href={liveUrl} target="_blank" rel="noreferrer" className="rounded-[10px] px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80" style={ghost}>Open live page</a>
                  </div>
                );
              })()}
              <div>
                <label className={labelCls} style={labelStyle}>Change the end of the link (optional)</label>
                <div className="flex min-h-12 items-center overflow-hidden rounded-xl transition-colors" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                  <span className="self-stretch px-3 text-xs whitespace-nowrap flex items-center" style={{ color: FE.faint, borderRight: `1px solid ${FE.inputBorder}` }}>/</span>
                  <input type="text" value={customSlug} onChange={e => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="my-course" className="w-full bg-transparent px-3 py-3 text-sm font-medium outline-none placeholder:text-zinc-400" style={{ color: FE.text }} />
                </div>
                <p className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: FE.faint }}><Link2 className="h-3 w-3" /> {contentPath({ slug: customSlug || formId, config: formConfig })}</p>
              </div>
              </div>
            )}

            {inStep('share') && publishShare && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 0 }}>{publishShare}</div>
            )}

            {inStep('cover') && (
              <div className={studioPanelClass} style={studioPanelStyle}>
              {formConfig.isCourse ? <div>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>Cover image</h3>
                <p className="mt-1 text-xs" style={{ color: FE.faint }}>Choose the visual learners see before opening the course.</p>
              </div> : <h3 className="text-base font-semibold" style={{ color: FE.text }}>Cover image</h3>}
              {formConfig.coverImage ? (
                <div className="space-y-3">
                  <div className="relative h-32 w-full overflow-hidden rounded-xl group sm:h-40" style={{ border: `1px solid ${FE.cardBorder}` }}>
                    <img src={resolveCoverUrl(formConfig.coverImage)} alt="Course cover" className="h-full w-full object-cover" onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" onClick={() => setShowCoverLibrary(true)} className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-xs font-medium transition-colors hover:bg-white" style={{ color: '#111' }}>
                        <ImageIcon className="w-3.5 h-3.5" /> Change
                      </button>
                      <button type="button" onClick={() => { deleteUploadedFile(formConfig?.coverImage); updateConfig({ coverImage: '' }); }} className="flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-white">
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setShowCoverLibrary(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:opacity-80" style={{ background: FE.groupBg, color: FE.text }}>
                      <ImageIcon className="h-3.5 w-3.5" /> Change cover
                    </button>
                    <button type="button" onClick={() => { deleteUploadedFile(formConfig?.coverImage); updateConfig({ coverImage: '' }); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCoverLibrary(true)} className="relative block w-full cursor-pointer">
                  <div className="w-full rounded-xl px-3 py-7 flex flex-col items-center justify-center gap-2 transition-colors hover:opacity-80" style={{ background: FE.groupBg, border: `1.5px dashed ${FE.inputBorder}` }}>
                    <ImageIcon className="w-5 h-5" style={{ color: FE.faint }} />
                    <span className="text-xs" style={{ color: FE.faint }}>Select or upload cover image</span>
                  </div>
                </button>
              )}
              {showCoverLibrary && (
                <ImageLibrary
                  uploadFolder="covers"
                  initialFolder="covers"
                  returnPublicId
                  onSelect={ref => { if (formConfig?.coverImage && formConfig.coverImage !== ref) deleteUploadedFile(formConfig.coverImage); updateConfig({ coverImage: ref }); }}
                  onClose={() => setShowCoverLibrary(false)}
                />
              )}
              </div>
            )}

            {inStep('appearance') && (
              <div className={studioPanelClass} style={studioPanelStyle}>
              <div>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>Appearance</h3>
                <p className="mt-1 text-xs" style={{ color: FE.faint }}>Set the {formConfig.isCourse ? 'course' : 'event'} theme, typography, and accent color.</p>
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Mode</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([{ value: 'light', label: 'Light', description: 'Bright canvas', Icon: Sun }, { value: 'dark', label: 'Dark', description: 'Low-light canvas', Icon: Moon }, { value: 'auto', label: 'Automatic', description: 'Match learner device', Icon: Monitor }] as const).map(({ value, label, description, Icon }) => {
                    const active = formConfig.mode === value;
                    return <button key={value} type="button" onClick={() => updateConfig({ mode: value })} className="flex min-h-20 items-start gap-3 rounded-xl p-3 text-left transition-all" style={{ background: active ? `${accentColor}10` : FE.groupBg, border: `1px solid ${active ? `${accentColor}55` : FE.groupBorder}`, color: active ? accentColor : FE.muted }}>
                      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: active ? `${accentColor}18` : FE.pill }}><Icon className="h-4 w-4" /></span>
                      <span><span className="block text-xs font-bold" style={{ color: active ? accentColor : FE.text }}>{label}</span><span className="mt-1 block text-[11px] leading-snug" style={{ color: FE.faint }}>{description}</span></span>
                    </button>;
                  })}
                </div>
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Font</label>
                <button
                  onClick={() => setFontPickerOpen(true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}`, color: FE.text, fontFamily: getFontById(formConfig.font).cssFamily }}
                >
                  <span>{getFontById(formConfig.font).name}</span>
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: FE.faint }} />
                </button>
                {fontPickerOpen && (
                  <FontPickerModal
                    currentFont={formConfig.font}
                    onSelect={id => updateConfig({ font: id })}
                    onClose={() => setFontPickerOpen(false)}
                    dark={formConfig.mode !== 'light'}
                  />
                )}
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Accent color</label>
                <div className="flex gap-3 flex-wrap pl-1 pt-1" style={{ '--swatch-ring': FE.card } as any}>
                  {([
                    { key: 'forest',  color: '#00bf63', label: 'Forest'  },
                    { key: 'lime',    color: '#ADEE66', label: 'Lime'    },
                    { key: 'emerald', color: '#10b981', label: 'Emerald' },
                    { key: 'rose',    color: '#f43f5e', label: 'Rose'    },
                    { key: 'amber',   color: '#f59e0b', label: 'Amber'   },
                    { key: 'ocean',   color: '#3E93FF', label: 'Ocean'   },
                  ] as const).map(({ key, color, label }) => {
                    const isSelected = formConfig.theme === key && !formConfig.customAccent;
                    return (
                      <button key={key} onClick={() => updateConfig({ theme: key, customAccent: undefined })} title={label} className="flex flex-col items-center gap-2 group">
                        <span
                          className={`w-7 h-7 rounded-full transition-transform group-hover:scale-110 ${isSelected ? 'scale-110' : ''}`}
                          style={{
                            background: color,
                            boxShadow: isSelected ? `0 0 0 2.5px var(--swatch-ring, ${FE.card}), 0 0 0 4.5px ${accentColor}` : undefined,
                          }}
                        />
                        <span className="text-[11px] transition-colors group-hover:opacity-60" style={{ color: FE.muted }}>{label}</span>
                      </button>
                    );
                  })}
                  <div className="flex flex-col items-center gap-2 group">
                    <div
                      title="Custom color"
                      className={`relative grid h-7 w-7 cursor-pointer place-items-center rounded-full transition-transform group-hover:scale-110 ${formConfig.customAccent ? 'scale-110' : ''}`}
                      style={{
                        background: formConfig.customAccent ?? 'conic-gradient(from 90deg, #f43f5e, #f59e0b, #a3e635, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)',
                        boxShadow: formConfig.customAccent ? `0 0 0 2.5px var(--swatch-ring, ${FE.card}), 0 0 0 4.5px ${accentColor}` : undefined,
                      }}
                    >
                      {!formConfig.customAccent && (
                        <span className="pointer-events-none grid h-[18px] w-[18px] place-items-center rounded-full" style={{ background: FE.card, color: FE.faint }}>
                          <Plus className="h-2.5 w-2.5" strokeWidth={2.4} />
                        </span>
                      )}
                      <input
                        type="color"
                        aria-label="Choose a custom accent color"
                        value={formConfig.customAccent || courseAccent}
                        onChange={e => updateConfig({ customAccent: e.target.value })}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
                      />
                    </div>
                    <span className="text-[11px] transition-colors group-hover:opacity-60" style={{ color: FE.faint }}>Custom</span>
                  </div>
                </div>
              </div>
              </div>
            )}

            {/* Course settings */}
            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 0 }}>
                  <div>
                    <h3 className="text-base font-semibold" style={{ color: FE.text }}>Course rules</h3>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Define assessment behavior, timing, attempts, and learner feedback.</p>
                  </div>
                  {/* Category */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Category</label>
                    <input
                      type="text"
                      value={formConfig.category ?? ''}
                      onChange={e => updateConfig({ category: e.target.value || null })}
                      placeholder="e.g. Excel, Power BI, SQL..."
                      className={inputCls}
                      style={inputStyle}
                    />
                    <div className="mt-2 flex max-w-full flex-wrap gap-2">
                      {COURSE_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => updateConfig({ category: formConfig.category === cat ? null : cat })}
                          className="min-h-8 rounded-full px-3 py-1 text-xs font-semibold transition-all"
                          style={{
                            background: formConfig.category === cat ? accentColor : FE.card,
                            color: formConfig.category === cat ? '#fff' : FE.muted,
                            boxShadow: formConfig.category === cat ? 'none' : `inset 0 0 0 1px ${FE.divider}`,
                          }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] mt-2 leading-relaxed" style={{ color: FE.faint }}>
                      Students can filter courses by category on their dashboard.
                    </p>
                  </div>

                  {/* Level */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Level</label>
                    <div className="flex max-w-full flex-wrap gap-2" role="radiogroup" aria-label="Level">
                      {[null, ...COURSE_DIFFICULTIES].map(level => {
                        const on = (formConfig.difficulty ?? null) === level;
                        return (
                          <button key={level ?? 'none'} type="button" role="radio" aria-checked={on}
                            onClick={() => updateConfig({ difficulty: level })}
                            className="min-h-8 rounded-full px-3 py-1 text-xs font-semibold transition-all"
                            style={{ background: on ? accentColor : FE.card, color: on ? '#fff' : FE.muted, boxShadow: on ? 'none' : `inset 0 0 0 1px ${FE.divider}` }}>
                            {level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Not set'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] mt-2 leading-relaxed" style={{ color: FE.faint }}>
                      Shown on the course card and its pop-up on the home page.
                    </p>
                  </div>

                  {/* Tags: topics, typed */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Tags</label>
                    {(formConfig.tags ?? []).length > 0 && (
                      <div className="mb-2 flex max-w-full flex-wrap gap-2">
                        {(formConfig.tags ?? []).map(tag => (
                          <span key={tag} className="inline-flex min-h-8 items-center gap-1.5 rounded-full pl-3 pr-1.5 text-xs font-semibold" style={{ background: FE.card, color: FE.text, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}>
                            {tag}
                            <button type="button" aria-label={`Remove ${tag}`} onClick={() => updateConfig({ tags: (formConfig.tags ?? []).filter(t => t !== tag) })}
                              className="grid h-5 w-5 place-items-center rounded-full transition-opacity hover:opacity-70" style={{ color: FE.muted }}>
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      type="text"
                      value={tagDraft}
                      onChange={e => setTagDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ',') return;
                        e.preventDefault();
                        const tag = tagDraft.trim();
                        const tags = formConfig.tags ?? [];
                        if (tag && !tags.some(t => t.toLowerCase() === tag.toLowerCase())) updateConfig({ tags: [...tags, tag] });
                        setTagDraft('');
                      }}
                      placeholder="Type a tag and press Enter, e.g. AI, Automation"
                      className={inputCls}
                      style={inputStyle}
                    />
                    <p className="text-[11px] mt-2 leading-relaxed" style={{ color: FE.faint }}>
                      Topics the course covers. The card shows as many as fit; the pop-up shows them all.
                    </p>
                  </div>

                  {/* Tools: the software the course uses, picked from the tool icon library so each has
                      a logo. Separate from Category, which groups courses into the home page's tabs. */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Tools</label>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {Object.keys(toolIconMap).sort((a, b) => a.localeCompare(b)).map(name => {
                        const on = (formConfig.tools ?? []).includes(name);
                        return (
                          <button key={name} type="button" aria-pressed={on}
                            onClick={() => updateConfig({ tools: on ? (formConfig.tools ?? []).filter(t => t !== name) : [...(formConfig.tools ?? []), name] })}
                            className="inline-flex min-h-8 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-all"
                            style={{ background: on ? accentColor : FE.card, color: on ? '#fff' : FE.muted, boxShadow: on ? 'none' : `inset 0 0 0 1px ${FE.divider}` }}>
                            <img src={toolIconMap[name]} alt="" className="h-4 w-4 object-contain" />
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] mt-2 leading-relaxed" style={{ color: FE.faint }}>
                      Software the course uses, such as Claude or Excel. Pick as many as apply; their logos show on the course card and pop-up.
                    </p>
                  </div>


                  {/* Partner */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Partner</label>
                    <MenuSelect label="Partner" field searchable value={formConfig.partnerId ?? ''} C={DC} placeholder="No partner"
                      onChange={v => updateConfig({ partnerId: v || null })}
                      options={[{ value: '', label: 'No partner' }, ...partners
                        .filter(partner => partner.is_active || partner.id === formConfig.partnerId)
                        .map(partner => ({ value: partner.id as string, label: `${partner.name}${partner.is_active ? '' : ' (inactive)'}` }))]} />
                    <p className="text-[11px] mt-2 leading-relaxed" style={{ color: FE.faint }}>
                      Displayed as &quot;Offered by&quot; attribution on catalog cards and certificates.
                    </p>
                  </div>

                  {/* Completion badge */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Completion Badge</label>
                    <p className="text-[11px] mb-2 leading-relaxed" style={{ color: FE.faint }}>
                      Students earn this badge when they pass the course assessment. It appears in their Badges section alongside their certificate.
                    </p>
                    <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeImageUpload}/>
                    {formConfig.badgeImageUrl ? (
                      <div className="flex items-center gap-3">
                        <img src={formConfig.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0" style={{ border: `1px solid ${FE.inputBorder}`, background: FE.groupBg }}/>
                        <div className="flex flex-col gap-2">
                          <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                            {uploadingBadge ? <Loader2 className="w-3 h-3 animate-spin"/> : <Upload className="w-3 h-3"/>}
                            {uploadingBadge ? 'Uploading...' : 'Change'}
                          </button>
                          <button type="button" onClick={() => updateConfig({ badgeImageUrl: null })}
                            className="text-xs px-3 py-2 rounded-lg transition-opacity hover:opacity-70"
                            style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ border: `1.5px dashed ${FE.inputBorder}`, color: FE.faint, background: FE.groupBg, width: '100%', justifyContent: 'center' }}>
                        {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                        {uploadingBadge ? 'Uploading...' : 'Upload badge image'}
                      </button>
                    )}
                  </div>

                  {/* Show answers setting */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <label className={labelCls} style={labelStyle}>Show correct answers</label>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {([
                        { value: 'per_question', label: 'Per question' },
                        { value: 'after_quiz', label: 'After course' },
                        { value: 'none', label: 'Never' },
                      ] as const).map(({ value, label }) => (
                        <button key={value} type="button" onClick={() => updateConfig({ showAnswers: value })}
                          className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.showAnswers ?? 'per_question') === value ? accentColor : FE.card, color: (formConfig.showAnswers ?? 'per_question') === value ? '#fff' : FE.muted, boxShadow: (formConfig.showAnswers ?? 'per_question') === value ? 'none' : `inset 0 0 0 1px ${FE.divider}` }}
                        >{label}</button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: FE.faint }}>
                      {(formConfig.showAnswers ?? 'per_question') === 'per_question' && 'Students see correct/incorrect after each question.'}
                      {formConfig.showAnswers === 'after_quiz' && 'Students see all answers after submitting.'}
                      {formConfig.showAnswers === 'none' && 'Students only see their final score.'}
                    </p>
                  </div>
                  {/* Lesson timing */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <label className={labelCls} style={labelStyle}>Lesson timing</label>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {([{ value: 'before', label: 'Before question' }, { value: 'after', label: 'After answer' }] as const).map(({ value, label }) => (
                        <button key={value} type="button" onClick={() => updateConfig({ lessonTiming: value })}
                          className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.lessonTiming ?? 'after') === value ? accentColor : FE.card, color: (formConfig.lessonTiming ?? 'after') === value ? '#fff' : FE.muted, boxShadow: (formConfig.lessonTiming ?? 'after') === value ? 'none' : `inset 0 0 0 1px ${FE.divider}` }}
                        >{label}</button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: FE.faint }}>
                      {(formConfig.lessonTiming ?? 'after') === 'before'
                        ? 'Lesson opens automatically before each question. Students read first, then answer.'
                        : 'Lesson is offered after answering. "Why?" if wrong, "Review Lesson" if right.'}
                    </p>
                  </div>
                  {/* AI tutor */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: FE.text }}>AI tutor</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: FE.muted }}>
                          {formConfig.enableAiTutor
                            ? 'Lesson slides show an Ask AI button. It answers from that lesson only and never gives away answers.'
                            : 'Learners read lesson slides on their own. No AI help is offered.'}
                        </p>
                      </div>
                      <SwitchToggle checked={formConfig.enableAiTutor ?? false} onChange={v => updateConfig({ enableAiTutor: v })} accentColor={accentColor} />
                    </div>
                  </div>
                  {/* Pass mark */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Pass mark</label>
                      <span className="text-xs font-bold" style={{ color: FE.text }}>{formConfig.passmark ?? 50}%</span>
                    </div>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {[50, 60, 70, 80].map(pct => (
                        <button key={pct} type="button" onClick={() => updateConfig({ passmark: pct })}
                          className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.passmark ?? 50) === pct ? { background: accentColor, color: 'white' } : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                        >{pct}%</button>
                      ))}
                      {/* Any other mark from 1 to 100. */}
                      <input
                        type="number"
                        min="1"
                        max="100"
                        aria-label="Custom pass mark"
                        placeholder="Custom"
                        value={![50, 60, 70, 80].includes(formConfig.passmark ?? 50) ? (formConfig.passmark ?? '') : ''}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v >= 1 && v <= 100) updateConfig({ passmark: v });
                        }}
                        className="min-h-9 w-24 rounded-lg border px-3 py-2 text-xs font-semibold outline-none transition-all placeholder:font-medium"
                        style={{ background: FE.input, borderColor: FE.inputBorder, color: FE.text }}
                      />
                    </div>
                  </div>
                  {/* Timer */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Time limit</label>
                      <span className="text-xs font-semibold" style={{ color: FE.muted }}>{formConfig.courseTimer ? `${formConfig.courseTimer} min` : 'None'}</span>
                    </div>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {[0, 5, 10, 15, 20, 30, 45, 60].map(t => (
                        <button key={t} type="button" onClick={() => updateConfig({ courseTimer: t || undefined })}
                          className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.courseTimer ?? 0) === t ? { background: accentColor, color: 'white' } : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                        >{t === 0 ? 'None' : `${t}m`}</button>
                      ))}
                    </div>
                  </div>
                  {/* Max attempts */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Attempts</label>
                      <span className="text-xs font-semibold" style={{ color: FE.muted }}>{formConfig.maxAttempts ? formConfig.maxAttempts : 'Unlimited'}</span>
                    </div>
                    <div className="flex max-w-full flex-wrap gap-2">
                      {[0, 1, 2, 3, 5].map(n => (
                        <button key={n} type="button" onClick={() => updateConfig({ maxAttempts: n || undefined })}
                          className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.maxAttempts ?? 0) === n ? { background: accentColor, color: 'white' } : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                        >{n === 0 ? 'Unlimited' : n}</button>
                      ))}
                    </div>
                    <p className="text-[11px]" style={{ color: FE.faint }}>Tracked per email address via submission records.</p>
                  </div>
              </div>
            )}

            {/* Curriculum section */}
            {activeSection === 'curriculum' && formConfig.isCourse && (
              <div className={studioPanelClass} style={studioPanelStyle}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: FE.text }}>Curriculum</h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Shape the learning journey, add lessons, and create practice activities.</p>
                </div>
                <div className="space-y-3">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleQuestionDragStart} onDragEnd={handleQuestionDragEnd}>
                    <SortableContext items={visibleOutlineIds} strategy={verticalListSortingStrategy}>
                  {(() => {
                  // Each row renders as before; the module groups below place it under its module.
                  const renderItem = (q: CourseQuestion, qIdx: number) => {
                    const qType: QuestionType = q.type ?? 'multiple_choice';
                    const qNo = qNumbers[qIdx];
                    const isExpanded = expandedQuestions.has(q.id);

                    const insertDivider = (
                      <div key={`insert-${q.id}`} className="group relative flex items-center justify-center gap-2 h-1.5 hover:h-6 transition-all">
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: FE.divider }} />
                        <button
                          type="button"
                          onClick={() => setPickerCtx({ mode: 'insert', afterIndex: qIdx })}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: accentColor, color: 'white', zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Add
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSectionAt(qIdx)}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: FE.pill, color: FE.muted, border: `1px solid ${FE.cardBorder}`, zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Module
                        </button>
                      </div>
                    );

                    // Shared by the downloads and LinkedIn steps: the same row header as lessons and questions.
                    const stepRowStyle = { background: FE.card };
                    const stepHeader = (dragHandle: React.ReactNode, title: string, kind: string) => (
                      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                        {dragHandle}
                        <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left min-w-0">
                          <span className="text-sm truncate block" style={{ color: FE.text }}>{title}</span>
                        </button>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const issue = itemIssues(q, qNo)[0];
                            return issue ? <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}>{issue.flag}</span> : null;
                          })()}
                          <span className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: FE.card, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>{kind}</span>
                          <LockToggle locked={!!q.lockUntilPrevious} onToggle={() => handleUpdateQuestion(q.id, { lockUntilPrevious: !q.lockUntilPrevious })} accentColor={accentColor} />
                          <button type="button" onClick={() => toggleQuestion(q.id)} aria-label={isExpanded ? 'Close' : 'Open'} className="p-1 transition-colors" style={{ color: FE.faint }}>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                    const stepDelete = (label: string) => (
                      <div className="flex justify-end">
                        <button type="button" onClick={() => askDelete(q)}
                          className={btnSmClass} style={btnStyle('danger', DC)}>
                          <Trash2 className="w-3.5 h-3.5" /> {label}
                        </button>
                      </div>
                    );
                    const fieldLabel = (text: string, note?: string) => (
                      <label className={labelCls} style={labelStyle}>{text}{note && <span style={{ color: FE.faint, fontWeight: 500 }}> ({note})</span>}</label>
                    );

                    // -- Section divider card --
                    if (q.isSection) {
                      return (
                        <React.Fragment key={q.id}>
                        <SortableQuestionShell id={q.id}>
                          {({ dragHandle }) => (
                          <div data-item-id={q.id} className="overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                              {dragHandle}
                              <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left">
                                <span className="flex items-center gap-2.5">
                                  <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: accentColor, color: '#fff' }}>
                                    {outlineGroups.filter(g => g.section).findIndex(g => g.section!.id === q.id) + 1}
                                  </span>
                                  <span className="text-[15px] font-semibold" style={{ color: FE.text }}>{q.sectionTitle || 'Untitled module'}</span>
                                </span>
                              </button>
                              {!q.sectionTitle?.trim() && (
                                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}>Needs a name</span>
                              )}
                              {(() => {
                                const n = outlineGroups.find(g => g.section?.id === q.id)?.items.length ?? 0;
                                return <span className="text-xs whitespace-nowrap" style={{ color: FE.muted }}>{n} item{n === 1 ? '' : 's'}</span>;
                              })()}
                              <button type="button" onClick={() => askDelete(q)} aria-label="Delete module"
                                className="grid h-8 w-8 place-items-center rounded-[10px] transition-opacity hover:opacity-80" style={{ background: 'rgba(217,45,32,0.10)', color: '#D92D20' }}>
                                <Trash2 className="w-4 h-4" />
                              </button>
                              {/* Folds the module to its heading; clicking the name opens its name and description. */}
                              <button type="button" aria-label={collapsedModules.has(q.id) ? 'Expand module' : 'Collapse module'} aria-expanded={!collapsedModules.has(q.id)}
                                onClick={() => setCollapsedModules(prev => { const next = new Set(prev); if (next.has(q.id)) next.delete(q.id); else next.add(q.id); return next; })}
                                className="p-1 transition-colors" style={{ color: FE.faint }}>
                                {collapsedModules.has(q.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            {isExpanded && (
                            // White like every other open row, below the tinted heading strip.
                            <div className="px-4 py-3 space-y-3" style={{ background: FE.card, borderBottom: `1px solid ${FE.divider}` }}>
                              <div>
                              <label htmlFor={`module-name-${q.id}`} className={labelCls} style={labelStyle}>Module name</label>
                              <input
                                id={`module-name-${q.id}`}
                                value={q.sectionTitle || ''}
                                onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, sectionTitle: e.target.value } : qq) })}
                                placeholder="e.g. Week 1: Cleaning the data"
                                autoFocus={!q.sectionTitle}
                                className={inputCls}
                                style={!q.sectionTitle?.trim() ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.55)' } : inputStyle}
                              />
                              </div>
                              <div>
                              <label htmlFor={`module-desc-${q.id}`} className={labelCls} style={labelStyle}>Description <span style={{ color: FE.faint }}>(optional, shown when the module starts)</span></label>
                              <input
                                id={`module-desc-${q.id}`}
                                value={q.sectionDescription || ''}
                                onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, sectionDescription: e.target.value } : qq) })}
                                placeholder="What learners will do in this module"
                                className={inputCls}
                                style={inputStyle}
                              />
                              </div>
                            </div>
                            )}
                          </div>
                          )}
                        </SortableQuestionShell>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    // -- LinkedIn share step --
                    if (q.isLinkedInShare) {
                      const patch = (changes: Partial<CourseQuestion>) =>
                        updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, ...changes } : qq) });
                      const required = q.linkedInShareRequired === true;

                      return (
                        <React.Fragment key={q.id}>
                        <SortableQuestionShell id={q.id}>
                          {({ dragHandle }) => (
                        <div data-item-id={q.id} className="rounded-xl overflow-hidden transition-colors" style={stepRowStyle}>
                          {stepHeader(dragHandle, q.linkedInShareTitle || 'LinkedIn share', 'LinkedIn share')}
                          {isExpanded && <div className="px-4 py-3 space-y-3">
                            {stepDelete('Delete step')}
                            <div>
                            {fieldLabel('Title', 'the heading learners see')}
                            <input
                              value={q.linkedInShareTitle || ''}
                              onChange={e => patch({ linkedInShareTitle: e.target.value })}
                              placeholder="e.g. Share your certificate on LinkedIn"
                              className={inputCls}
                              style={inputStyle}
                            />
                            </div>
                            <div>
                            {fieldLabel('Instructions', 'optional')}
                            <RichTextEditor
                              value={q.linkedInShareDescription || ''}
                              onChange={html => patch({ linkedInShareDescription: html })}
                              placeholder="Tell students what to post and why it helps them..."
                              enableAiAssist
                            />
                            </div>
                            {/* Suggested caption the student can copy straight into LinkedIn. */}
                            <div>
                              {fieldLabel('Suggested post text', 'optional, learners can copy it')}
                              <textarea
                                value={q.linkedInSharePrompt || ''}
                                onChange={e => patch({ linkedInSharePrompt: e.target.value })}
                                placeholder="e.g. I just finished a course on cleaning sales data. Here is what I built..."

                                rows={4}
                                className={inputCls}
                                style={inputStyle}
                              />
                            </div>
                            <div className="flex flex-wrap items-end gap-5">
                              <div>
                                {fieldLabel('Bonus XP', `max ${MAX_LINKEDIN_SHARE_POINTS}`)}
                                <input
                                  type="number"
                                  min={0}
                                  max={MAX_LINKEDIN_SHARE_POINTS}
                                  value={q.linkedInSharePoints ?? DEFAULT_LINKEDIN_SHARE_POINTS}
                                  onChange={e => patch({ linkedInSharePoints: Math.min(MAX_LINKEDIN_SHARE_POINTS, Math.max(0, Number(e.target.value) || 0)) })}
                                  className={inputCls}
                                  style={{ ...inputStyle, width: 110 }}
                                />
                              </div>
                              <div>
                                {fieldLabel('Learners must share to continue')}
                                <div className="flex w-fit gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                                  {([{ v: false, label: 'Optional' }, { v: true, label: 'Required' }] as const).map(({ v, label }) => (
                                    <button key={label} type="button" onClick={() => patch({ linkedInShareRequired: v })} aria-pressed={required === v}
                                      className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                                      style={required === v ? { background: accentColor, color: '#fff' } : { background: 'transparent', color: FE.muted }}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <p className="text-[11px] leading-relaxed" style={{ color: FE.faint }}>
                              Students paste the link to their own LinkedIn post. The link is checked, and a post
                              already submitted by someone else is rejected. This slide is not scored.
                            </p>
                          </div>}
                        </div>
                          )}
                        </SortableQuestionShell>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    // -- Downloads block card --
                    if (q.isDownloads) {
                      const dlItems: DownloadItem[] = q.downloadItems || [];
                      const updateItems = (newItems: DownloadItem[]) =>
                        updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadItems: newItems } : qq) });

                      return (
                        <React.Fragment key={q.id}>
                        <SortableQuestionShell id={q.id}>
                          {({ dragHandle }) => (
                        <div data-item-id={q.id} className="rounded-xl overflow-hidden transition-colors" style={stepRowStyle}>
                          {stepHeader(dragHandle, q.downloadsTitle || 'Downloads', `Downloads (${dlItems.length})`)}
                          {isExpanded && <div className="px-4 py-3 space-y-3">
                            {stepDelete('Delete downloads')}
                            <div>
                            {fieldLabel('Title', 'the heading learners see')}
                            <input
                              value={q.downloadsTitle || ''}
                              onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsTitle: e.target.value } : qq) })}
                              placeholder="e.g. Course files"
                              className={inputCls}
                              style={inputStyle}
                            />
                            </div>
                            <div>
                            {fieldLabel('Description', 'optional')}
                            <RichTextEditor
                              value={q.downloadsDescription || ''}
                              onChange={html => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsDescription: html } : qq) })}
                              placeholder="What learners will find here"
                              enableAiAssist
                            />
                            </div>
                            {fieldLabel('Files and links')}
                            {dlItems.length > 0 ? (
                              <div className="space-y-2 pt-1">
                                {dlItems.map((item, itemIdx) => (
                                  <div key={item.id} className="rounded-xl p-3 space-y-3" style={{ background: FE.groupBg }}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="w-7 h-7 inline-flex flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={{ color: FE.muted, background: FE.pill }}>{itemIdx + 1}</span>
                                        <div className="flex items-center gap-1">
                                        {(['file', 'link'] as const).map(t => (
                                          <button key={t} type="button"
                                            onClick={() => updateItems(dlItems.map(it => it.id === item.id ? { ...it, type: t } : it))}
                                            className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize transition-all"
                                            style={item.type === t ? { background: accentColor, color: 'white' } : { background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                                          >
                                            {t === 'file' ? <span className="flex items-center gap-1"><Upload className="w-2.5 h-2.5" />File</span> : <span className="flex items-center gap-1"><Link2 className="w-2.5 h-2.5" />Link</span>}
                                          </button>
                                        ))}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button type="button" disabled={itemIdx === 0} aria-label={`Move resource ${itemIdx + 1} up`} onClick={() => updateItems(arrayMove(dlItems, itemIdx, itemIdx - 1))} className="w-7 h-7 inline-flex items-center justify-center rounded-lg disabled:opacity-20" style={{ color: FE.muted, background: FE.pill }}><ArrowUp className="w-3.5 h-3.5" /></button>
                                        <button type="button" disabled={itemIdx === dlItems.length - 1} aria-label={`Move resource ${itemIdx + 1} down`} onClick={() => updateItems(arrayMove(dlItems, itemIdx, itemIdx + 1))} className="w-7 h-7 inline-flex items-center justify-center rounded-lg disabled:opacity-20" style={{ color: FE.muted, background: FE.pill }}><ArrowDown className="w-3.5 h-3.5" /></button>
                                        <button type="button" aria-label={`Remove resource ${itemIdx + 1}`} onClick={() => updateItems(dlItems.filter(it => it.id !== item.id))} className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors hover:bg-red-500/10"><X className="w-3.5 h-3.5 text-red-400" /></button>
                                      </div>
                                    </div>
                                    <div>
                                    {fieldLabel('Name', 'what learners see')}
                                    <input
                                      value={item.title}
                                      onChange={e => updateItems(dlItems.map(it => it.id === item.id ? { ...it, title: e.target.value } : it))}
                                      placeholder={item.type === 'file' ? 'e.g. March sales export' : 'e.g. Excel shortcuts guide'}
                                      className={inputCls}
                                      style={!item.title?.trim() ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.55)' } : inputStyle}
                                    />
                                    </div>
                                    <div>
                                    {fieldLabel('Description', 'optional')}
                                    <RichTextEditor
                                      value={item.description || ''}
                                      onChange={html => updateItems(dlItems.map(it => it.id === item.id ? { ...it, description: html } : it))}
                                      placeholder="What this file is for"
                                      enableAiAssist
                                    />
                                    </div>
                                    {item.type === 'file' ? (
                                      item.fileUrl ? (
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}30` }}>
                                          <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: FE.muted }} />
                                          <span className="text-xs flex-1 truncate" style={{ color: FE.text }}>{item.fileName || 'Uploaded file'}{item.pdfPages ? ` · inline preview (${item.pdfPages}p)` : ''}</span>
                                          <button type="button" onClick={() => { deleteUploadedFile(item.fileUrl); updateItems(dlItems.map(it => it.id === item.id ? { ...it, fileUrl: '', fileName: '', pdfPages: undefined } : it)); }} className="text-red-400 text-[11px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
                                        </div>
                                      ) : (
                                        <label className="block cursor-pointer">
                                          <input type="file" className="hidden" onChange={async e => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            e.target.value = '';
                                            // Two different ceilings: PDFs are proxied through /api/upload (Vercel caps
                                            // the request body), everything else goes direct to Supabase Storage.
                                            if (isPdfFile(file.name, file.type) && file.size > MAX_UPLOAD_BYTES) { showToast(`PDF is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_LABEL} for PDFs.`); return; }
                                            if (file.size > 20 * 1024 * 1024) { showToast(`File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 20 MB.`); return; }
                                            try {
                                              if (isPdfFile(file.name, file.type)) {
                                                // PDFs go to Cloudinary so students get an inline page viewer
                                                const { url, pages } = await uploadToCloudinaryWithMeta(file, 'course-downloads');
                                                updateItems(dlItems.map(it => it.id === item.id ? { ...it, fileUrl: url, fileName: file.name, pdfPages: pages, title: it.title || file.name } : it));
                                              } else {
                                                const { data: { session } } = await supabase.auth.getSession();
                                                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                                                const path = `course-downloads/${session?.user.id ?? 'anon'}/${Date.now()}-${safeName}`;
                                                const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true, contentType: file.type || undefined });
                                                if (error) throw error;
                                                const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
                                                updateItems(dlItems.map(it => it.id === item.id ? { ...it, fileUrl: publicUrl, fileName: file.name, pdfPages: undefined, title: it.title || file.name } : it));
                                              }
                                            } catch (err: any) { showToast(err?.message || 'Upload failed. Please try again.'); }
                                          }} />
                                          <div className="w-full min-h-12 flex items-center justify-center gap-2 rounded-xl text-xs transition-colors hover:opacity-70 cursor-pointer" style={{ border: `1px dashed ${accentColor}55`, color: FE.muted, background: `${accentColor}08` }}>
                                            <span className="w-7 h-7 inline-flex items-center justify-center rounded-lg" style={{ color: FE.muted, background: FE.pill }}><Upload className="w-3.5 h-3.5" /></span> Upload file <span className="text-[11px]" style={{ color: FE.faint }}>Max 20 MB</span>
                                          </div>
                                        </label>
                                      )
                                    ) : (
                                      <div>
                                      {fieldLabel('Link')}
                                      <input
                                        value={item.linkUrl || ''}
                                        onChange={e => updateItems(dlItems.map(it => it.id === item.id ? { ...it, linkUrl: e.target.value } : it))}
                                        placeholder="https://..."
                                        className={inputCls}
                                        style={!item.linkUrl?.trim() ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.55)' } : inputStyle}
                                      />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: FE.groupBg, border: `1px dashed ${FE.inputBorder}` }}>
                                <span className="w-9 h-9 inline-flex items-center justify-center rounded-lg" style={{ color: FE.muted, background: FE.pill }}><Download className="w-4 h-4" /></span>
                                <div><p className="text-xs font-semibold" style={{ color: FE.text }}>Add the first resource</p><p className="text-[11px]" style={{ color: FE.faint }}>Upload a file or link to an external resource.</p></div>
                              </div>
                            )}
                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'file' }])}
                                className={btnSmClass} style={btnStyle('sec', DC)}>
                                <Plus className="w-3.5 h-3.5" /> Add file
                              </button>
                              <button type="button" onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'link' }])}
                                className={btnSmClass} style={btnStyle('sec', DC)}>
                                <Plus className="w-3.5 h-3.5" /> Add link
                              </button>
                            </div>
                          </div>}
                        </div>
                          )}
                        </SortableQuestionShell>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    return (
                      <React.Fragment key={q.id}>
                      <SortableQuestionShell id={q.id}>
                        {({ dragHandle }) => (
                      <div data-item-id={q.id} className="rounded-xl overflow-hidden transition-colors" style={{ background: FE.card }}>
                        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                          {dragHandle}
                          <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left min-w-0">
                            <span className="text-sm truncate block" style={{ color: (q.lessonOnly ? q.lesson?.title : q.question) ? FE.text : FE.faint }}>
                              {q.lessonOnly
                                ? (q.lesson?.title || 'No title yet')
                                : <><span className="font-semibold mr-1" style={{ color: FE.faint }}>Q{qNo}</span>{q.question?.replace(/<[^>]*>/g, ' ') || 'No question text yet'}</>}
                            </span>
                          </button>
                          <div className="flex items-center gap-2">
                            {(() => {
                              const issue = itemIssues(q, qNo)[0];
                              return issue ? (
                                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}>{issue.flag}</span>
                              ) : null;
                            })()}
                            {q.lessonOnly ? (
                              <span className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: FE.card, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                                {q.lesson?.videoUrl ? (isHtmlEmbedUrl(q.lesson.videoUrl) ? 'Interactive' : 'Video') : 'Reading'}
                              </span>
                            ) : (
                            <button
                              type="button"
                              onClick={() => setPickerCtx({ mode: 'change', qId: q.id })}
                              className="flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 transition-opacity hover:opacity-70 cursor-pointer"
                              style={{ background: FE.card, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}
                            >
                              {TYPE_LABELS[qType] ?? qType}
                              <ChevronDown className="w-3 h-3 ml-0.5 flex-shrink-0" />
                            </button>
                            )}
                            <LockToggle
                              locked={!!q.lockUntilPrevious}
                              onToggle={() => handleUpdateQuestion(q.id, { lockUntilPrevious: !q.lockUntilPrevious })}
                              accentColor={accentColor}
                            />
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: FE.faint }}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && <div className="p-4 space-y-3">
                          {!q.lessonOnly && <p className="text-xs font-semibold -mb-1" style={{ color: FE.muted }}>Write with AI</p>}
                          <div className="flex flex-wrap gap-2">
                            {/* Delete sits with the content it removes, and always asks first. */}
                            <button type="button" onClick={() => askDelete(q)}
                              className={`order-last ml-auto ${btnSmClass}`} style={btnStyle('danger', DC)}>
                              <Trash2 className="w-3.5 h-3.5" /> {q.lessonOnly ? 'Delete lesson' : 'Delete question'}
                            </button>
                            {!q.lessonOnly && ['multiple_choice', 'code'].includes(qType) && (<>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_distractors')}
                              disabled={!!aiLoadingLabel}
                              className={btnSmClass} style={btnStyle('sec', DC)}
                            >
                              <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating distractors...' ? 'Generating...' : 'Wrong answers'}
                            </button>
                            </>)}
                            <button
                              type="button"
                              onClick={() => setLessonPromptModal({ q })}
                              disabled={!!aiLoadingLabel}
                              className={btnSmClass} style={btnStyle('sec', DC)}
                            >
                              <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating lesson...' ? 'Generating...' : (q.lessonOnly ? 'Write lesson with AI' : 'Lesson')}
                            </button>
                            {!q.lessonOnly && !(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (<>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_hint')}
                              disabled={!!aiLoadingLabel}
                              className={btnSmClass} style={btnStyle('sec', DC)}
                            >
                              <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating hint...' ? 'Generating...' : 'Hint'}
                            </button>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_explanation')}
                              disabled={!!aiLoadingLabel}
                              className={btnSmClass} style={btnStyle('sec', DC)}
                            >
                              <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating explanation...' ? 'Generating...' : 'Explanation'}
                            </button>
                            </>)}
                          </div>
                          {!q.lessonOnly && (<>

                          {/* Question text -- hidden for review types; they use the project brief field inside the config panel */}
                          {!(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (
                          <div>
                            <label className={labelCls} style={labelStyle}>Question</label>
                            <input type="text" value={q.question} onChange={e => handleUpdateQuestion(q.id, { question: e.target.value })} className={inputCls} style={inputStyle}
                              autoFocus={!q.question}
                              placeholder={qType === 'fill_blank' ? 'e.g. The capital of France is ___' : 'Enter your question...'} />
                            {qType === 'fill_blank' && (
                              <div className="mt-2 rounded-lg px-3 py-2" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                                <span className="text-xs font-semibold" style={{ color: FE.muted }}>Learner preview</span>
                                <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: FE.text }}>
                                  {q.question.includes('___') ? q.question.split('___').map((part, partIdx, parts) => <React.Fragment key={`${partIdx}-${part}`}>{part}{partIdx < parts.length - 1 && <span className="mx-1 inline-block min-w-12 border-b-2" style={{ borderColor: accentColor }}>&nbsp;</span>}</React.Fragment>) : 'Use ___ in the question to place the blank.'}
                                </p>
                              </div>
                            )}
                          </div>
                          )}

                          {qType === 'code' && (
                            <div className="rounded-xl overflow-hidden" style={{ background: FE.card, border: `1px solid ${FE.inputBorder}`, boxShadow: FE === FE_LIGHT ? '0 6px 18px rgba(15,23,42,0.045)' : 'none' }}>
                              <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ background: FE.groupBg, borderBottom: `1px solid ${FE.divider}` }}>
                                <div className="flex items-center gap-2">
                                  <span className="flex items-center gap-2" aria-hidden="true">
                                    <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                                    <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
                                    <span className="relative w-2 h-2 rounded-full bg-[#28c840]"><span className="absolute inset-0 rounded-full bg-[#28c840] animate-ping motion-reduce:animate-none opacity-35" /></span>
                                  </span>
                                  <span className="text-xs font-semibold" style={{ color: FE.muted }}>Code snippet</span>
                                </div>
                                <select value={q.codeLanguage || 'javascript'} onChange={e => handleUpdateQuestion(q.id, { codeLanguage: e.target.value })}
                                  className="rounded-md border-0 px-2 py-1 text-[11px] font-mono outline-none" style={{ background: FE.input, color: FE.text }}>
                                  {['javascript', 'python', 'typescript', 'java', 'c', 'cpp', 'go', 'rust', 'sql'].map(lang => <option key={lang} value={lang}>{lang}</option>)}
                                </select>
                              </div>
                              <AiTextarea
                                value={q.codeSnippet || ''}
                                onValueChange={value => handleUpdateQuestion(q.id, { codeSnippet: value })}
                                className="min-h-[150px] w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-xs leading-relaxed outline-none placeholder:text-zinc-500"
                                style={{ color: FE.text }}
                                placeholder="Paste your code snippet here..."
                              />
                            </div>
                          )}

                          {qType === 'image' && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Image options <span style={{ color: FE.faint }}>(pick the correct one)</span></label>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {q.options.map((opt, optIdx) => {
                                  const imgSrc = (q.optionImages || [])[optIdx] || '';
                                  const isCorrectOption = q.correctAnswer === opt;
                                  return (
                                    <div key={optIdx} className="relative rounded-xl overflow-hidden transition-colors" style={{ background: FE.groupBg, border: `1.5px solid ${isCorrectOption ? `${accentColor}88` : FE.inputBorder}`, boxShadow: isCorrectOption ? `0 0 0 2px ${accentColor}12` : 'none' }}>
                                      {imgSrc ? (
                                        <div className="relative group aspect-[16/10] overflow-hidden">
                                          <img src={imgSrc} alt={`Option ${optIdx + 1}`} className="w-full h-full object-cover" />
                                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <button type="button" onClick={() => setOptionImageLibrary({ qId: q.id, optionIdx: optIdx })}
                                              className="rounded-lg bg-white/90 px-3 py-2 text-[11px] font-semibold flex items-center gap-1" style={{ color: '#111' }}>
                                              <Images className="w-3 h-3" /> Change
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const newImages = [...(q.optionImages || q.options.map(() => ''))];
                                                newImages[optIdx] = '';
                                                handleUpdateQuestion(q.id, { optionImages: newImages });
                                              }}
                                              className="rounded-lg bg-black/40 px-3 py-2 text-red-300 text-[11px] font-semibold flex items-center gap-1"
                                            >
                                              <Trash2 className="w-3 h-3" /> Remove
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button type="button" className="block w-full cursor-pointer" onClick={() => setOptionImageLibrary({ qId: q.id, optionIdx: optIdx })}>
                                          <div className="aspect-[16/10] w-full flex flex-col items-center justify-center gap-2 text-[11px] font-semibold transition-colors hover:opacity-70" style={{ color: FE.faint }}>
                                            <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ color: FE.muted, background: FE.pill }}><Images className="w-4 h-4" /></span>
                                            Choose image
                                            <span className="text-[11px] font-medium" style={{ color: FE.faint }}>Library | Pexels | Upload</span>
                                          </div>
                                        </button>
                                      )}
                                      <div className="flex items-center gap-2 px-2 py-2" style={{ borderTop: `1px solid ${FE.divider}` }}>
                                        <button type="button" onClick={() => handleUpdateQuestion(q.id, { correctAnswer: opt })}
                                          aria-label={`Mark image option ${optIdx + 1} as correct`} aria-pressed={isCorrectOption}
                                          className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-[11px] font-bold"
                                          style={{ color: isCorrectOption ? '#fff' : FE.faint, background: isCorrectOption ? accentColor : FE.pill }}>
                                          {isCorrectOption ? <Check className="w-3.5 h-3.5" /> : optIdx + 1}
                                        </button>
                                        <span className="text-[11px] font-semibold" style={{ color: isCorrectOption ? FE.text : FE.faint }}>Option {optIdx + 1}</span>
                                        {q.options.length > 2 && (
                                          <button type="button" onClick={() => {
                                            deleteUploadedFile((q.optionImages || [])[optIdx]);
                                            const newOpts = q.options.filter((_, i) => i !== optIdx);
                                            const newImages = (q.optionImages || q.options.map(() => '')).filter((_, i) => i !== optIdx);
                                            const u: Partial<CourseQuestion> = { options: newOpts, optionImages: newImages };
                                            if (q.correctAnswer === opt) u.correctAnswer = newOpts[0] ?? '0';
                                            handleUpdateQuestion(q.id, u);
                                          }} className="ml-auto transition-colors hover:text-red-400" style={{ color: FE.faint }}>
                                            <X className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {optionImageLibrary?.qId === q.id && (
                                <ImageLibrary
                                  uploadFolder="course-options"
                                  initialFolder="course-options"
                                  onSelect={url => handleQuestionOptionImageSelect(optionImageLibrary.qId, optionImageLibrary.optionIdx, url)}
                                  onClose={() => setOptionImageLibrary(null)}
                                />
                              )}
                              <button type="button" onClick={() => {
                                const newIdx = String(q.options.length);
                                const newOpts = [...q.options, newIdx];
                                const newImages = [...(q.optionImages || q.options.map(() => '')), ''];
                                handleUpdateQuestion(q.id, { options: newOpts, optionImages: newImages });
                              }} className="text-xs transition-colors inline-flex items-center gap-2 rounded-lg px-3 py-2 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add option
                              </button>
                            </div>
                          )}

                          {(qType === 'multiple_choice' || qType === 'code') && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Answer options <span style={{ color: FE.faint, fontWeight: 500 }}>(pick the correct one)</span></label>
                              </div>
                              {q.options.map((opt, optIdx) => {
                                // A blank option is never the correct answer: a blank correct answer
                                // used to match every blank option and show them all as correct.
                                const isBlank = !opt.trim();
                                const isRight = !isBlank && q.correctAnswer === opt;
                                return (
                                <div key={optIdx} className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors"
                                  style={{ background: isRight ? `${accentColor}10` : isBlank ? 'rgba(217,119,6,0.08)' : FE.groupBg, border: `1px solid ${isRight ? `${accentColor}55` : isBlank ? 'rgba(217,119,6,0.55)' : FE.inputBorder}` }}>
                                  <button type="button" onClick={() => { if (!isBlank) handleUpdateQuestion(q.id, { correctAnswer: opt }); }}
                                    disabled={isBlank}
                                    aria-label={`Mark option ${optIdx + 1} as correct`} aria-pressed={isRight}
                                    className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-[11px] font-bold transition-all disabled:cursor-not-allowed"
                                    style={{ color: isRight ? '#fff' : FE.faint, background: isRight ? accentColor : FE.pill }}>
                                    {isRight ? <Check className="w-3.5 h-3.5" /> : optIdx + 1}
                                  </button>
                                  <input type="text" value={opt}
                                    placeholder="Empty option. Fill it in or remove it."
                                    onChange={e => {
                                      const newOpts = [...q.options]; newOpts[optIdx] = e.target.value;
                                      const u: Partial<CourseQuestion> = { options: newOpts };
                                      if (isRight) u.correctAnswer = e.target.value;
                                      handleUpdateQuestion(q.id, u);
                                    }}
                                    className={`${inputCls} py-2 flex-1`} style={{ ...inputStyle, background: 'transparent', border: 'none', paddingLeft: 2 }} />
                                  {q.options.length > 2 && (
                                    <button type="button" aria-label={`Remove option ${optIdx + 1}`} onClick={() => {
                                      const newOpts = q.options.filter((_, i) => i !== optIdx);
                                      const u: Partial<CourseQuestion> = { options: newOpts };
                                      if (isRight) u.correctAnswer = '';
                                      handleUpdateQuestion(q.id, u);
                                    }} className="transition-colors flex-shrink-0 hover:text-red-400" style={{ color: FE.faint }}>
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                                );
                              })}
                              {!q.options.some(opt => opt.trim() && opt === q.correctAnswer) && (
                                <p className="text-[12px] font-medium" style={{ color: '#b45309' }}>Pick the correct answer. Learners cannot be marked right until you do.</p>
                              )}
                              <button type="button" onClick={() => {
                                handleUpdateQuestion(q.id, { options: [...q.options, ''] });
                              }} className="text-xs transition-colors inline-flex items-center gap-2 mt-1 rounded-lg px-3 py-2 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add answer option
                              </button>
                            </div>
                          )}

                          {qType === 'fill_blank' && (
                            <div className="space-y-2">
                              <label className={labelCls} style={labelStyle}>Accepted answers <span style={{ color: FE.faint }}>(separate alternatives with |)</span></label>
                              <input type="text" value={q.correctAnswer}
                                onChange={e => handleUpdateQuestion(q.id, { correctAnswer: e.target.value })}
                                className={inputCls} style={!q.correctAnswer?.trim() ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid '+'rgba(217,119,6,0.55)' } : inputStyle} placeholder="e.g. TRIM | trim()" />
                              {q.correctAnswer.trim() && (
                                <div className="flex flex-wrap gap-2">
                                  {q.correctAnswer.split('|').map(answer => answer.trim()).filter(Boolean).map((answer, answerIdx) => (
                                    <span key={`${answer}-${answerIdx}`} className="rounded-md px-2 py-1 text-[11px] font-semibold" style={{ color: FE.muted, background: FE.pill }}>{answer}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {qType === 'arrange' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Correct order <span style={{ color: FE.faint }}>(top item comes first)</span></label>
                              </div>
                              {q.options.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex items-center gap-2 rounded-xl px-3 py-2" style={!item.trim() ? { background: 'rgba(217,119,6,0.08)', border: '1px solid '+'rgba(217,119,6,0.55)' } : { background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                                  <span className="w-7 h-7 inline-flex flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={{ color: FE.muted, background: FE.pill }}>{itemIdx + 1}</span>
                                  <input type="text" value={item} placeholder="Empty item. Fill it in or remove it." aria-label={`Item ${itemIdx + 1}`}
                                    onChange={e => {
                                      const newOpts = [...q.options]; newOpts[itemIdx] = e.target.value;
                                      handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                    }}
                                    className={`${inputCls} py-2 flex-1`} style={{ ...inputStyle, background: 'transparent', border: 'none', paddingLeft: 2 }} />
                                  <span className="flex items-center gap-1">
                                    <button type="button" disabled={itemIdx === 0} aria-label={`Move ${item || `item ${itemIdx + 1}`} up`} onClick={() => {
                                      const newOpts = [...q.options]; [newOpts[itemIdx - 1], newOpts[itemIdx]] = [newOpts[itemIdx], newOpts[itemIdx - 1]];
                                      handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                    }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg disabled:opacity-20" style={{ color: FE.muted, background: FE.pill }}><ArrowUp className="w-3.5 h-3.5" /></button>
                                    <button type="button" disabled={itemIdx === q.options.length - 1} aria-label={`Move ${item || `item ${itemIdx + 1}`} down`} onClick={() => {
                                      const newOpts = [...q.options]; [newOpts[itemIdx], newOpts[itemIdx + 1]] = [newOpts[itemIdx + 1], newOpts[itemIdx]];
                                      handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                    }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg disabled:opacity-20" style={{ color: FE.muted, background: FE.pill }}><ArrowDown className="w-3.5 h-3.5" /></button>
                                  </span>
                                  {q.options.length > 2 && (
                                    <button type="button" onClick={() => {
                                      const newOpts = q.options.filter((_, i) => i !== itemIdx);
                                      handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                    }} className="transition-colors flex-shrink-0 hover:text-red-400" style={{ color: FE.faint }}>
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button type="button" onClick={() => {
                                const newOpts = [...q.options, `Item ${q.options.length + 1}`];
                                handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                              }} className="text-xs transition-colors inline-flex items-center gap-2 mt-1 rounded-lg px-3 py-2 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add item
                              </button>
                            </div>
                          )}

                          {/* AI Review config */}
                          {(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'] as const).includes(qType as any) && (
                            // Fields sit directly in the open row, like every other kind of question.
                            <div className="space-y-3">

                              <div>
                                <label className={labelCls} style={labelStyle}>{qType === 'written_response' ? 'Question / prompt' : 'Project brief / prompt'}</label>
                                <AiTextarea
                                  value={q.question}
                                  onValueChange={value => handleUpdateQuestion(q.id, { question: value })}
                                  className={`${inputCls} min-h-[72px] resize-y`}
                                  style={inputStyle}
                                  placeholder={qType === 'document_review' ? 'Describe the report the student must write...' : qType === 'written_response' ? 'Ask the question the student must answer in their own words...' : 'Describe the project the student must complete...'}
                                />
                              </div>

                              {qType === 'code_review' && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Language</label>
                                  <select
                                    value={q.reviewLanguage || 'javascript'}
                                    onChange={e => handleUpdateQuestion(q.id, { reviewLanguage: e.target.value })}
                                    className={`${inputCls} py-2`}
                                    style={inputStyle}
                                  >
                                    {['javascript', 'python', 'typescript', 'java', 'c', 'cpp', 'go', 'rust', 'sql', 'r'].map(lang => (
                                      <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {qType === 'code_review' && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Expected output / schema <span style={{ color: FE.faint }}>(optional)</span></label>
                                  <AiTextarea
                                    value={q.schema || ''}
                                    onValueChange={value => handleUpdateQuestion(q.id, { schema: value })}
                                    className={`${inputCls} min-h-[60px] resize-y font-mono text-xs`}
                                    style={inputStyle}
                                    placeholder="Describe or paste the expected output..."
                                  />
                                </div>
                              )}

                              {(qType === 'excel_review' || qType === 'dashboard_critique' || qType === 'document_review' || qType === 'written_response') && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>
                                    {qType === 'document_review' ? 'Report scope / context' : qType === 'written_response' ? 'Context for the AI reviewer' : 'Dataset / context'} <span style={{ color: FE.faint }}>(optional)</span>
                                  </label>
                                  <AiTextarea
                                    value={q.context || ''}
                                    onValueChange={value => handleUpdateQuestion(q.id, { context: value })}
                                    className={`${inputCls} min-h-[60px] resize-y`}
                                    style={inputStyle}
                                    placeholder={qType === 'document_review' ? 'Describe what the report should cover, the market, industry, or company context...' : qType === 'written_response' ? 'Background the AI should judge the answer against. Students do not see this.' : 'Describe the dataset or context the student works with...'}
                                  />
                                </div>
                              )}

                              {qType === 'excel_review' && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Worksheets to evaluate <span style={{ color: FE.faint }}>(optional, one per line)</span></label>
                                  <textarea
                                    value={(q.reviewSheetNames ?? []).join('\n')}
                                    onChange={e => handleUpdateQuestion(q.id, { reviewSheetNames: e.target.value.split('\n') })}
                                    className={`${inputCls} min-h-[72px] resize-y font-mono text-xs`}
                                    style={inputStyle}
                                    placeholder={'Revenue Forecast\nSummary Dashboard'}
                                  />
                                </div>
                              )}

                              {/* Model answer + length floor (written_response only) */}
                              {qType === 'written_response' && (<>
                                <div>
                                  <label className={labelCls} style={labelStyle}>Model answer <span style={{ color: FE.faint }}>(optional, never shown to students)</span></label>
                                  <AiTextarea
                                    value={q.expectedAnswer || ''}
                                    onValueChange={value => handleUpdateQuestion(q.id, { expectedAnswer: value })}
                                    className={`${inputCls} min-h-[72px] resize-y`}
                                    style={inputStyle}
                                    placeholder="What a strong answer covers. The AI grades against this instead of guessing."
                                  />
                                </div>
                                <div>
                                  <label className={labelCls} style={labelStyle}>Maximum words <span style={{ color: FE.faint }}>(0 for no limit)</span></label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={2000}
                                    value={q.writtenMaxWords ?? 0}
                                    onChange={e => handleUpdateQuestion(q.id, { writtenMaxWords: Math.max(0, Number(e.target.value) || 0) })}
                                    className={inputCls}
                                    style={{ ...inputStyle, width: 112 }}
                                  />
                                </div>
                              </>)}

                              {qType === 'document_review' && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Review mode</label>
                                  <select
                                    value={(q as any).documentReviewMode || 'ai_only'}
                                    onChange={e => handleUpdateQuestion(q.id, { documentReviewMode: e.target.value as any })}
                                    className={`${inputCls} py-2`}
                                    style={inputStyle}
                                  >
                                    <option value="ai_only">AI only: the AI reviews and grades</option>
                                    <option value="manual">Manual: you review and grade</option>
                                    <option value="hybrid">Hybrid: the AI reviews, you can change the grade</option>
                                  </select>
                                </div>
                              )}

                              <div>
                                <label className={labelCls} style={labelStyle}>Rubric <span style={{ color: FE.faint }}>(what the AI grades against)</span></label>
                                <div className="mb-2">
                                  {(() => {
                                    const busy: RubricImportKind | null = extractingRubric === `${q.id}:reference_solution`
                                      ? 'reference_solution'
                                      : null;
                                    return (
                                      <RubricFileImportActions
                                        busy={busy}
                                        disabled={!!extractingRubric && busy === null}
                                        background={FE.pill}
                                        color={FE.muted}
                                        onSelect={(kind, file) => handleExtractRubric(q.id, kind, file)}
                                      />
                                    );
                                  })()}
                                </div>
                                <p className="text-xs mb-2" style={{ color: FE.faint }}>Upload completed work or your own rubric file to set the criteria.</p>
                                <div className="space-y-2">
                                  {(q.rubric || []).map((criterion, cIdx) => (
                                    <div key={cIdx} className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={criterion}
                                        onChange={e => {
                                          const next = [...(q.rubric || [])];
                                          next[cIdx] = e.target.value;
                                          handleUpdateQuestion(q.id, { rubric: next });
                                        }}
                                        className={`${inputCls} py-2 flex-1`}
                                        style={!criterion.trim() ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid '+'rgba(217,119,6,0.55)' } : inputStyle}
                                        placeholder="Empty criterion. Fill it in or remove it."
                                        aria-label={`Criterion ${cIdx + 1}`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateQuestion(q.id, { rubric: (q.rubric || []).filter((_, i) => i !== cIdx) })}
                                        className="transition-colors flex-shrink-0 hover:text-red-400"
                                        style={{ color: FE.faint }}
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateQuestion(q.id, { rubric: [...(q.rubric || []), ''] })}
                                    className="text-xs transition-colors flex items-center gap-1 mt-1 hover:opacity-60"
                                    style={{ color: FE.muted }}
                                  >
                                    <Plus className="w-3 h-3" /> Add criterion
                                  </button>
                                </div>
                              </div>

                              {!(qType === 'document_review' && ((q as any).documentReviewMode === 'manual')) && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Pass mark <span style={{ color: FE.faint }}>(% the AI review must give)</span></label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={q.minScore ?? 70}
                                    onChange={e => handleUpdateQuestion(q.id, { minScore: Number(e.target.value) })}
                                    className={inputCls}
                                    style={{ ...inputStyle, width: 112 }}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {qType === 'sql_exercise' && (
                            <div className="space-y-3">
                              <div>
                                <label className={labelCls} style={labelStyle}>Student task</label>
                                <AiTextarea value={q.question} onValueChange={value => handleUpdateQuestion(q.id, { question: value })} className={`${inputCls} min-h-[72px] resize-y`} style={inputStyle} placeholder="Ask the student to write a query..." />
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className={labelCls} style={labelStyle}>Tables</label>
                                  <button type="button" onClick={() => handleUpdateQuestion(q.id, { sqlTables: [...(q.sqlTables ?? []), { id: Math.random().toString(36).slice(2, 9), tableName: 'table_name', fileName: '', fileUrl: '', csvUrl: '' }] })} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: FE.pill, color: FE.muted }}>
                                    <Plus className="w-3 h-3 inline mr-1" /> Add table
                                  </button>
                                </div>
                                {(q.sqlTables ?? []).map((table, tableIdx) => (
                                  <div key={table.id ?? tableIdx} className="grid gap-2 rounded-xl p-3" style={{ background: FE.groupBg }}>
                                    <div className="flex gap-2">
                                      <input value={table.tableName} onChange={e => {
                                        const tables = [...(q.sqlTables ?? [])];
                                        tables[tableIdx] = { ...table, tableName: e.target.value };
                                        handleUpdateQuestion(q.id, { sqlTables: tables });
                                      }} className={`${inputCls} flex-1 py-2`} style={inputStyle} placeholder="orders" />
                                      <button type="button" onClick={() => { deleteUploadedFile(q.sqlTables?.[tableIdx]?.fileUrl); handleUpdateQuestion(q.id, { sqlTables: (q.sqlTables ?? []).filter((_, i) => i !== tableIdx) }); }} className="px-2 rounded-lg hover:text-red-400" style={{ color: FE.faint }}>
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${FE.inputBorder}` }}>
                                        {(['upload', 'seed'] as const).map(mode => {
                                          const active = (table.seedSql?.trim() ? 'seed' : 'upload') === mode;
                                          return (
                                            <button
                                              key={mode}
                                              type="button"
                                              onClick={() => {
                                                const tables = [...(q.sqlTables ?? [])];
                                                tables[tableIdx] = mode === 'seed'
                                                  ? { ...table, seedSql: table.seedSql ?? '', fileName: '', fileUrl: '', csvUrl: '' }
                                                  : { ...table, seedSql: '' };
                                                handleUpdateQuestion(q.id, { sqlTables: tables, sqlExpectedResult: undefined });
                                              }}
                                              className="px-3 py-2 text-xs font-semibold"
                                              style={{ background: active ? accentColor : FE.pill, color: active ? 'white' : FE.muted }}
                                            >
                                              {mode === 'upload' ? 'Upload' : 'Seed SQL'}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: FE.pill, color: FE.muted }}>
                                        <Upload className="w-3 h-3" /> Upload CSV/XLSX
                                        <input type="file" className="hidden" accept=".csv,.tsv,.xlsx" onChange={e => handleSqlDatasetUpload(q.id, table.id ?? String(tableIdx), e)} />
                                      </label>
                                      <span className="text-xs truncate" style={{ color: FE.faint }}>{table.fileName || table.fileUrl || 'No file uploaded'}</span>
                                    </div>
                                    {table.seedSql?.trim() || (!table.fileUrl && !table.csvUrl && !table.fileName) ? (
                                      <div>
                                        <label className={labelCls} style={labelStyle}>Table data as SQL <span style={{ color: FE.faint }}>(CREATE TABLE and INSERT statements)</span></label>
                                        <AiTextarea
                                          value={table.seedSql ?? ''}
                                          onValueChange={value => {
                                            const tables = [...(q.sqlTables ?? [])];
                                            tables[tableIdx] = { ...table, seedSql: value, fileName: '', fileUrl: '', csvUrl: '' };
                                            handleUpdateQuestion(q.id, { sqlTables: tables, sqlExpectedResult: undefined });
                                          }}
                                          className={`${inputCls} min-h-[120px] resize-y font-mono text-xs`}
                                          style={inputStyle}
                                          placeholder={`CREATE TABLE ${table.tableName || 'orders'} (...);\nINSERT INTO ${table.tableName || 'orders'} VALUES (...);`}
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Starter SQL</label>
                                <AiTextarea value={q.sqlStarterCode ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { sqlStarterCode: value })} className={`${inputCls} min-h-[84px] resize-y font-mono text-xs`} style={inputStyle} />
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Solution SQL <span style={{ color: FE.faint }}>(hidden from students)</span></label>
                                <AiTextarea value={q.sqlSolution ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { sqlSolution: value, sqlExpectedResult: undefined })} className={`${inputCls} min-h-[96px] resize-y font-mono text-xs`} style={inputStyle} placeholder="SELECT ..." />
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  <button type="button" onClick={() => computeSqlExpectedResult(q.id)} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: 'white' }}>Compute expected result</button>
                                  <span className="text-xs" style={{ color: q.sqlExpectedResult ? '#10b981' : FE.faint }}>{q.sqlExpectedResult ? `${q.sqlExpectedResult.rows.length} expected row(s) saved` : 'Expected result not computed'}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-end gap-5">
                                <label className="flex items-center gap-2 text-xs pb-3" style={{ color: FE.muted }}>
                                  <input type="checkbox" checked={!!q.sqlResultOrdered} onChange={e => handleUpdateQuestion(q.id, { sqlResultOrdered: e.target.checked })} />
                                  Rows must be in the same order
                                </label>
                                <div>
                                  <label htmlFor={`tol-${q.id}`} className={labelCls} style={labelStyle}>Number tolerance <span style={{ color: FE.faint }}>(how far off a number may be, 0 for exact)</span></label>
                                  <input id={`tol-${q.id}`} type="number" min={0} value={q.sqlNumericTolerance ?? 0} onChange={e => handleUpdateQuestion(q.id, { sqlNumericTolerance: Number(e.target.value) })} className={inputCls} style={{ ...inputStyle, width: 112 }} />
                                </div>
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Required SQL patterns <span style={{ color: FE.faint }}>(optional)</span></label>
                                <AiTextarea
                                  value={(q.sqlRequiredPatterns ?? []).join('\n')}
                                  onValueChange={value => handleUpdateQuestion(q.id, { sqlRequiredPatterns: value.split('\n').map(s => s.trim()).filter(Boolean) })}
                                  className={`${inputCls} min-h-[64px] resize-y font-mono text-xs`}
                                  style={inputStyle}
                                  placeholder={`LIMIT\nORDER BY\n/^SELECT\\s+\\*\\s+FROM\\s+employees\\s+LIMIT\\s+10\\s*;?$/i`}
                                />
                                <p className="mt-1 text-[11px]" style={{ color: FE.faint }}>One per line. Plain words must appear as SQL keywords; /regex/i is also supported.</p>
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Hints <span style={{ color: FE.faint }}>(optional, one per line)</span></label>
                                <AiTextarea value={(q.sqlHints ?? []).join('\n')} onValueChange={value => handleUpdateQuestion(q.id, { sqlHints: value.split('\n').map(s => s.trim()).filter(Boolean) })} className={`${inputCls} min-h-[70px] resize-y`} style={inputStyle} placeholder="One hint per line" />
                              </div>
                            </div>
                          )}

                          {qType === 'python_exercise' && (
                            <div className="space-y-3">
                              <div>
                                <label className={labelCls} style={labelStyle}>Student task</label>
                                <RichTextEditor value={q.question} onChange={html => handleUpdateQuestion(q.id, { question: html })} placeholder="Ask the student to write a Python script..." enableAiAssist />
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className={labelCls} style={labelStyle}>Datasets</label>
                                  <button type="button" onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: [...(q.pythonDatasets ?? []), { id: Math.random().toString(36).slice(2, 9), variableName: 'df', fileName: '', fileUrl: '', csvUrl: '' }] })} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: FE.pill, color: FE.muted }}>
                                    <Plus className="w-3 h-3 inline mr-1" /> Add dataset
                                  </button>
                                </div>
                                {(q.pythonDatasets ?? []).map((ds, dsIdx) => (
                                  <div key={ds.id} className="grid gap-2 rounded-lg p-2" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                                    <div className="flex gap-2">
                                      <input value={ds.variableName} onChange={e => { const datasets = [...(q.pythonDatasets ?? [])]; datasets[dsIdx] = { ...ds, variableName: e.target.value }; handleUpdateQuestion(q.id, { pythonDatasets: datasets }); }} className={`${inputCls} flex-1 py-2 font-mono`} style={inputStyle} placeholder="df" />
                                      <button type="button" onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: (q.pythonDatasets ?? []).filter((_, i) => i !== dsIdx) })} className="px-2 rounded-lg hover:text-red-400" style={{ color: FE.faint }}>
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: FE.pill, color: FE.muted }}>
                                        <Upload className="w-3 h-3" /> Upload CSV
                                        <input type="file" className="hidden" accept=".csv,.tsv" onChange={e => handlePythonDatasetUpload(q.id, ds.id, e)} />
                                      </label>
                                      <span className="text-xs truncate" style={{ color: FE.faint }}>{ds.fileName || ds.fileUrl || 'No file uploaded'}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Setup code <span style={{ color: FE.faint }}>(hidden from students)</span></label>
                                <AiTextarea value={q.pythonSetupCode ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { pythonSetupCode: value, pythonExpectedOutput: '' })} className={`${inputCls} min-h-[84px] resize-y font-mono text-xs`} style={inputStyle} placeholder="# Import libraries or define helpers before student code runs" />
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Starter code</label>
                                <AiTextarea value={q.pythonStarterCode ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { pythonStarterCode: value })} className={`${inputCls} min-h-[84px] resize-y font-mono text-xs`} style={inputStyle} />
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Solution <span style={{ color: FE.faint }}>(hidden from students)</span></label>
                                <AiTextarea value={q.pythonSolution ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { pythonSolution: value, pythonExpectedOutput: '' })} className={`${inputCls} min-h-[96px] resize-y font-mono text-xs`} style={inputStyle} placeholder="# Reference solution" />
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  <button type="button" onClick={() => computePythonExpectedOutput(q.id)} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: 'white' }}>Compute expected output</button>
                                  <span className="text-xs" style={{ color: q.pythonExpectedOutput ? '#10b981' : FE.faint }}>{q.pythonExpectedOutput ? 'Expected output saved' : 'Expected output not computed'}</span>
                                </div>
                                {q.pythonExpectedOutput && (
                                  <pre className="mt-2 p-2 rounded-lg text-xs font-mono whitespace-pre-wrap" style={{ background: '#1e1e2e', color: '#cdd6f4' }}>{q.pythonExpectedOutput}</pre>
                                )}
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Hints <span style={{ color: FE.faint }}>(optional, one per line)</span></label>
                                <AiTextarea value={(q.pythonHints ?? []).join('\n')} onValueChange={value => handleUpdateQuestion(q.id, { pythonHints: value.split('\n').map(s => s.trim()).filter(Boolean) })} className={`${inputCls} min-h-[70px] resize-y`} style={inputStyle} placeholder="One hint per line" />
                              </div>
                            </div>
                          )}

                          {/* Hint and explanation -- not shown for AI review types */}
                          {!(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (<>
                          <div>
                            <label className={labelCls} style={labelStyle}>Hint <span style={{ color: FE.faint }}>(optional)</span></label>
                            <input
                              type="text"
                              value={q.hint || ''}
                              onChange={e => handleUpdateQuestion(q.id, { hint: e.target.value })}
                              className={inputCls}
                              style={inputStyle}
                              placeholder="Optional hint shown to students on request..."
                            />
                          </div>

                          <div>
                            <label className={labelCls} style={labelStyle}>Explanation <span style={{ color: FE.faint }}>(shown after answering)</span></label>
                            <AiTextarea
                              value={q.explanation || ''}
                              onValueChange={value => handleUpdateQuestion(q.id, { explanation: value })}
                              className={`${inputCls} min-h-[84px] resize-y`}
                              style={inputStyle}
                              placeholder="Explain why this answer is correct..."
                            />
                          </div>
                          </>)}
                          </>)}

                          {/* Lesson section */}
                          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${FE.cardBorder}` }}>
                            {(() => {
                              // An item that is only a lesson opens straight onto its title and content;
                              // a question's own attached lesson stays an optional, collapsible extra.
                              const lessonOpen = q.lessonOnly ? !!q.lesson : !!(q.lesson && !closedLessons.has(q.id));
                              const needsTitle = !!q.lessonOnly && !q.lesson?.title?.trim();
                              return (<>
                            {!q.lessonOnly && <button
                              type="button"
                              onClick={() => {
                                if (lessonOpen) {
                                  setClosedLessons(prev => new Set([...prev, q.id]));
                                } else {
                                  setClosedLessons(prev => { const next = new Set(prev); next.delete(q.id); return next; });
                                  if (!q.lesson) handleUpdateQuestion(q.id, { lesson: { title: '', body: '', imageUrl: '', videoUrl: '' } });
                                }
                              }}
                              className="w-full flex items-center justify-between px-3 py-3 text-xs font-medium transition-colors hover:opacity-70"
                              style={{ color: FE.muted }}
                            >
                              <span className="flex items-center gap-2">
                                <BookOpen className="w-3.5 h-3.5" />
                                Lesson <span style={{ color: FE.faint }}>(optional)</span>
                              </span>
                              {lessonOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>}
                            {lessonOpen && q.lesson && (
                              <div className="px-3 py-3 space-y-2" style={{ borderTop: q.lessonOnly ? 'none' : `1px solid ${FE.divider}` }}>
                                {q.lessonOnly && (
                                  <label htmlFor={`lesson-title-${q.id}`} className={labelCls} style={labelStyle}>
                                    Title <span style={{ color: FE.faint, fontWeight: 500 }}>(the heading learners see)</span>
                                  </label>
                                )}
                                <input
                                  id={`lesson-title-${q.id}`}
                                  type="text"
                                  value={q.lesson.title || ''}
                                  onChange={e => handleUpdateQuestion(q.id, { lesson: { ...q.lesson, title: e.target.value } })}
                                  autoFocus={needsTitle}
                                  className={inputCls}
                                  style={needsTitle ? { ...inputStyle, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.55)' } : inputStyle}
                                  placeholder={q.lessonOnly ? 'Add a title' : 'Lesson title (optional)...'}
                                />
                                <LessonEditor
                                  key={q.id}
                                  doc={q.lesson.doc}
                                  bodyFallback={q.lesson.body}
                                  onChange={({ doc, body }) => handleUpdateQuestion(q.id, { lesson: { ...q.lesson, doc, body } })}
                                  placeholder="Explain the theory behind this question..."
                                  accentColor={accentColor}
                                />
                                <div className="grid grid-cols-2 gap-2 items-start">
                                {/* Image: upload or URL */}
                                {q.lesson.imageUrl ? (
                                  <div className="relative group rounded-lg overflow-hidden" style={{ border: `1px solid ${FE.cardBorder}` }}>
                                    <img src={q.lesson.imageUrl} alt="" className="w-full h-28 object-cover" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setLessonImageQId(q.id)}
                                        className="text-[11px] font-medium flex items-center gap-1 bg-white/90 px-2 py-1 rounded-lg"
                                        style={{ color: '#111' }}
                                      >
                                        <ImageIcon className="w-3 h-3" /> Change
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { deleteUploadedFile(q.lesson?.imageUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, imageUrl: '' } }); }}
                                        className="text-red-400 text-[11px] font-medium flex items-center gap-1 bg-white/80 px-2 py-1 rounded-lg"
                                      >
                                        <Trash2 className="w-3 h-3" /> Remove
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" className="block w-full" onClick={() => setLessonImageQId(q.id)}>
                                    <div className="w-full h-10 flex items-center justify-center gap-2 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
                                      <ImageIcon className="w-3.5 h-3.5" /> Add image (optional)
                                    </div>
                                  </button>
                                )}
                                {lessonImageQId === q.id && (
                                  <ImageLibrary
                                    uploadFolder="lesson-images"
                                    initialFolder="lesson-images"
                                    onSelect={url => { if (q.lesson?.imageUrl && q.lesson.imageUrl !== url) deleteUploadedFile(q.lesson.imageUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, imageUrl: url } }); }}
                                    onClose={() => setLessonImageQId(null)}
                                  />
                                )}
                                {/* PDF: upload (shown to students as an inline page viewer) */}
                                {q.lesson.pdfUrl ? (
                                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#f59e0b15', border: '1px solid #f59e0b30' }}>
                                    <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                                    <span className="text-xs flex-1 truncate" style={{ color: FE.text }}>
                                      {q.lesson.pdfName || 'PDF'}{q.lesson.pdfPages ? ` · ${q.lesson.pdfPages} page${q.lesson.pdfPages > 1 ? 's' : ''}` : ''}
                                    </span>
                                    <button type="button" onClick={() => { deleteUploadedFile(q.lesson?.pdfUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, pdfUrl: '', pdfName: '', pdfPages: undefined } }); }} className="text-red-400 text-[11px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
                                  </div>
                                ) : (
                                  <label className="block cursor-pointer">
                                    <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={async e => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      e.target.value = '';
                                      if (file.size > MAX_UPLOAD_BYTES) { showToast(`PDF is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_LABEL}.`); return; }
                                      try {
                                        const { url, pages } = await uploadToCloudinaryWithMeta(file, 'lesson-pdfs');
                                        handleUpdateQuestion(q.id, { lesson: { ...q.lesson, pdfUrl: url, pdfName: file.name, pdfPages: pages } });
                                      } catch (err: any) { showToast(err?.message || 'PDF upload failed. Please try again.'); }
                                    }} />
                                    <div className="w-full h-10 flex items-center justify-center gap-2 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
                                      <FileText className="w-3.5 h-3.5" /> Upload PDF (max {MAX_UPLOAD_LABEL})
                                    </div>
                                  </label>
                                )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={q.lesson.videoUrl || ''}
                                    onChange={e => handleUpdateQuestion(q.id, { lesson: { ...q.lesson, videoUrl: e.target.value } })}
                                    className={`${inputCls} flex-1`}
                                    style={inputStyle}
                                    placeholder="YouTube, Vimeo, Bunny or Canva URL..."
                                  />
                                  <button
                                    type="button"
                                    onClick={() => openBunnyPicker(q.id)}
                                    title="Pick from Bunny library"
                                    className={`${btnSmClass} flex-shrink-0`} style={btnStyle('sec', DC)}
                                  >
                                    <Video className="w-3.5 h-3.5"/> Bunny
                                  </button>
                                  {/* Interactive HTML embed: uploads to the public form-assets bucket; only
                                      URLs of that shape pass safeEmbedUrl, and players render them sandboxed */}
                                  <label className="cursor-pointer flex-shrink-0" title="Upload a self-contained HTML file with inline assets (max 10 MB)">
                                    <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={async e => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      e.target.value = '';
                                      if (file.size > 10 * 1024 * 1024) { showToast(`HTML file is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 10 MB.`); return; }
                                      try {
                                        const url = await uploadToStorage(file, 'lesson-html');
                                        handleUpdateQuestion(q.id, { lesson: { ...q.lesson, videoUrl: url } });
                                      } catch (err: any) { showToast(err?.message || 'HTML upload failed. Please try again.'); }
                                    }} />
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
                                      <FileCode className="w-3.5 h-3.5"/> HTML
                                    </div>
                                  </label>
                                </div>
                                {(() => {
                                  const vurl = q.lesson.videoUrl || '';
                                  const embedUrl = safeEmbedUrl(vurl);
                                  return embedUrl ? (
                                    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${FE.cardBorder}` }}>
                                      <iframe src={embedUrl} className={isHtmlEmbedUrl(embedUrl) ? 'w-full' : 'w-full aspect-video'} style={isHtmlEmbedUrl(embedUrl) ? { height: 480 } : undefined} sandbox={isHtmlEmbedUrl(embedUrl) ? HTML_EMBED_SANDBOX : undefined} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                                    </div>
                                  ) : null;
                                })()}
                                {/* Audio: upload (max 20 MB) or paste a direct URL -- standard lesson media, like video/PDF */}
                                <div className="flex items-center gap-2">
                                  <label className="cursor-pointer flex-shrink-0">
                                    <input type="file" accept="audio/*" className="hidden" onChange={async e => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      e.target.value = '';
                                      if (file.size > 20 * 1024 * 1024) { showToast(`Audio is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 20 MB.`); return; }
                                      try {
                                        const url = await uploadToStorage(file, 'lesson-audio');
                                        handleUpdateQuestion(q.id, { lesson: { ...q.lesson, audioUrl: url, audioName: file.name } });
                                      } catch (err: any) { showToast(err?.message || 'Audio upload failed. Please try again.'); }
                                    }} />
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
                                      <Music className="w-3.5 h-3.5" /> Audio
                                    </div>
                                  </label>
                                  <input
                                    type="text"
                                    value={q.lesson.audioUrl || ''}
                                    onChange={e => handleUpdateQuestion(q.id, { lesson: { ...q.lesson, audioUrl: e.target.value, audioName: '' } })}
                                    className={`${inputCls} flex-1`}
                                    style={inputStyle}
                                    placeholder="Or paste an audio URL (.mp3, .m4a, .wav)..."
                                  />
                                  {q.lesson.audioUrl && (
                                    <button type="button" onClick={() => { deleteUploadedFile(q.lesson?.audioUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, audioUrl: '', audioName: '' } }); }} className="text-red-400 text-[11px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
                                  )}
                                </div>
                                {q.lesson.audioUrl && <LessonAudioPlayer src={q.lesson.audioUrl} isDark={FE === FE_DARK} />}
                              </div>
                            )}
                            </>);
                            })()}
                          </div>
                        </div>}
                      </div>
                        )}
                      </SortableQuestionShell>
                      {insertDivider}
                      </React.Fragment>
                    );
                  };
                  const all = formConfig.questions ?? [];
                  return outlineGroups.map(group => {
                    const collapsed = !!group.section && collapsedModules.has(group.section.id);
                    const lastIdx = group.items.length ? all.indexOf(group.items[group.items.length - 1]) : group.start;
                    return (
                      // One box per module: its heading strip on top, its content inside, as soft rows.
                      <div key={group.section?.id ?? 'loose'} className="mb-3 rounded-[14px] overflow-hidden" style={{ background: FE.groupBg }}>
                        {group.section ? renderItem(group.section, group.start) : (
                          <p className="px-4 py-3 text-sm font-semibold" style={{ color: FE.muted }}>Not in a module</p>
                        )}
                        {!collapsed && (
                          <>
                            {group.items.length > 0 && (
                              <div className="px-3 pb-1 space-y-2">
                                {group.items.map(item => renderItem(item, all.indexOf(item)))}
                              </div>
                            )}
                            {group.section && (
                              <div className="flex gap-2 px-3 pb-3 pt-2">
                                <button type="button" onClick={() => insertLessonAt(lastIdx)} className={btnSmClass} style={btnStyle('sec', DC)}>
                                  <Plus className="w-3.5 h-3.5" /> Lesson
                                </button>
                                <button type="button" onClick={() => setPickerCtx({ mode: 'insert', afterIndex: lastIdx })} className={btnSmClass} style={btnStyle('sec', DC)}>
                                  <Plus className="w-3.5 h-3.5" /> Question
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  });
                  })()}
                    </SortableContext>
                    <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
                      {activeQuestionId ? (() => {
                        const aq = formConfig.questions?.find(q => q.id === activeQuestionId);
                        if (!aq) return null;
                        return (
                          <div style={{ background: FE.card, border: `1.5px solid ${accentColor}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: `0 16px 40px rgba(0,0,0,0.25)`, cursor: 'grabbing', transform: 'rotate(1deg) scale(1.02)' }}>
                            <GripVertical className="w-3.5 h-3.5" style={{ color: FE.muted }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: FE.text, flex: 1 }}>{aq.isSection ? (aq.sectionTitle || 'Section') : (aq.question || 'Untitled question')}</span>
                          </div>
                        );
                      })() : null}
                    </DragOverlay>
                  </DndContext>
                  {(() => {
                    const isEmpty = !formConfig.questions || formConfig.questions.length === 0;
                    const actions = (
                      <div className={`flex flex-wrap items-center gap-2 ${isEmpty ? 'justify-center' : ''}`}>
                        <button type="button" onClick={() => insertLessonAt((formConfig.questions?.length ?? 0) - 1)}
                          className={btnSmClass} style={btnStyle('sec', DC)}>
                          <Plus className="w-3.5 h-3.5" /> Add lesson
                        </button>
                        <button type="button" onClick={() => setPickerCtx({ mode: 'bottom' })}
                          className={btnSmClass} style={btnStyle('sec', DC)}>
                          <Plus className="w-3.5 h-3.5" /> Add question
                        </button>
                        <button type="button" onClick={handleAddSection}
                          className={btnSmClass} style={btnStyle('sec', DC)}>
                          <Plus className="w-3.5 h-3.5" /> Add module
                        </button>
                        <button type="button" onClick={() => { setAiError(''); setAiPromptModalOpen(true); }} disabled={!!aiLoadingLabel}
                          className={btnSmClass} style={btnStyle('sec', DC)}>
                          {aiLoadingLabel === 'Generating questions...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: FE.muted }} /> : <Sparkles className="w-3.5 h-3.5" style={{ color: FE.muted }} />}
                          Generate with AI
                        </button>
                      </div>
                    );
                    return isEmpty ? (
                      // An empty course: one centred starting point with every way to begin.
                      <div className="flex flex-col items-center text-center gap-3 rounded-xl px-6 py-10" style={{ background: FE.groupBg }}>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: FE.text }}>Start your course</p>
                          <p className="mt-1 text-xs" style={{ color: FE.muted }}>Add a lesson or a question, start a module, or let AI draft them from a topic.</p>
                        </div>
                        {actions}
                      </div>
                    ) : <div className="pt-1">{actions}</div>;
                  })()}
                  {activeSection === 'curriculum' && aiError && <p className="text-[11px]" style={{ color: '#D93025' }}>{aiError}</p>}
                  {activeSection === 'curriculum' && !aiError && aiSuccess && <p className="text-[11px]" style={{ color: '#10b981' }}>{aiSuccess}</p>}
                </div>
              </div>
            )}

            {inStep('fields') && !formConfig.isCourse && (
              <div className={studioPanelClass} style={studioPanelStyle}>
                <h3 className="text-base font-semibold" style={{ color: FE.text }}>Registration</h3>
                {formConfig.eventDetails?.isEvent && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Capacity (optional)</label>
                    <input type="number" min={1} value={formConfig.eventDetails.capacity ?? ''} placeholder="No limit"
                      onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, capacity: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined } })}
                      className={inputCls} style={{ ...inputStyle, maxWidth: 160 }} />
                  </div>
                )}
                <label className={labelCls} style={labelStyle}>Registration questions</label>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <SortableContext items={formConfig.fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {formConfig.fields.map((f, idx) => {
                          const isExpanded = expandedFields.has(f.id);
                          const toggleExpand = () => setExpandedFields(prev => {
                            const next = new Set(prev);
                            isExpanded ? next.delete(f.id) : next.add(f.id);
                            return next;
                          });
                          return (
                            <SortableFieldCard
                              key={f.id}
                              f={f}
                              index={idx}
                              isExpanded={isExpanded}
                              toggleExpand={toggleExpand}
                              onRemove={() => handleRemoveField(f.id)}
                              onUpdate={updates => handleUpdateField(f.id, updates)}
                              accentColor={accentColor}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                    <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
                      {activeId ? (() => {
                        const field = formConfig.fields.find(f => f.id === activeId);
                        if (!field) return null;
                        return (
                          <div style={{ background: FE.card, border: `1.5px solid ${accentColor}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: `0 16px 40px rgba(0,0,0,0.25), 0 0 0 1px ${accentColor}22`, cursor: 'grabbing', transform: 'rotate(1.5deg) scale(1.02)', transformOrigin: 'center' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2.5"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                            <span style={{ fontSize: 14, fontWeight: 600, color: FE.text, flex: 1 }}>{field.label || 'Untitled field'}</span>
                            <span style={{ fontSize: 11, fontWeight: 500, color: FE.faint, background: FE.pill, padding: '2px 7px', borderRadius: 5 }}>{field.type}</span>
                          </div>
                        );
                      })() : null}
                    </DragOverlay>
                  </DndContext>

                  {formConfig.fields.length === 0 && <p className="text-xs text-center py-3" style={{ color: FE.faint }}>No fields yet.</p>}

                  <div className="pt-3 space-y-3 mt-2" style={{ borderTop: `1px solid ${FE.divider}` }}>
                    <p className="text-xs font-semibold" style={{ color: FE.muted }}>Add Field</p>
                    {newFieldType !== 'description' && (
                      <input
                        type="text"
                        placeholder="Field label…"
                        value={newFieldLabel}
                        onChange={e => setNewFieldLabel(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddField()}
                        className={inputCls}
                        style={inputStyle}
                      />
                    )}
                    <select value={newFieldType} onChange={e => { setNewFieldType(e.target.value as FieldType); }} className={inputCls} style={inputStyle}>
                      {(Object.entries(FIELD_TYPE_LABELS) as [FieldType, string][]).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>

                    {newFieldType === 'select' && (
                      <input type="text" placeholder="Options: Yes, No, Maybe" value={newFieldOptions} onChange={e => setNewFieldOptions(e.target.value)} className={inputCls} style={inputStyle} />
                    )}
                    {newFieldType === 'social' && (
                      <div>
                        <label className={labelCls} style={labelStyle}>Platforms to include</label>
                        <div className="grid grid-cols-2 gap-2">
                          {SOCIAL_PLATFORMS.map(p => (
                            <label key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors" style={{ background: newSocialPlatforms.includes(p.id) ? `${accentColor}18` : FE.input, border: `1px solid ${newSocialPlatforms.includes(p.id) ? accentColor : FE.inputBorder}`, color: newSocialPlatforms.includes(p.id) ? accentColor : FE.muted }}>
                              <input type="checkbox" checked={newSocialPlatforms.includes(p.id)} onChange={e => { if (e.target.checked) setNewSocialPlatforms(prev => [...prev, p.id]); else setNewSocialPlatforms(prev => prev.filter(id => id !== p.id)); }} className="hidden" />
                              <SocialIcon id={p.id} size={14} />
                              <span className="text-xs font-medium">{p.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {newFieldType !== 'description' && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs" style={{ color: FE.muted }}>Mark as required?</span>
                        <Toggle checked={newFieldRequired} onChange={() => setNewFieldRequired(!newFieldRequired)} accentColor={accentColor} />
                      </div>
                    )}

                    <button type="button" onClick={handleAddField} disabled={newFieldType !== 'description' && !newFieldLabel.trim()} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80" style={{ background: accentColor, color: 'white' }}>
                      <Plus className="w-4 h-4" /> {newFieldType === 'description' ? 'Add Description Block' : 'Add Field'}
                    </button>
                  </div>
                </div>
            )}

            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: FE.text }}>Points and rewards</h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Use XP, streaks, and milestones to recognize meaningful progress.</p>
                </div>
                {/* Enable toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: FE.text }}>Points system</p>
                    <p className="text-xs mt-0.5" style={{ color: FE.muted }}>XP, streaks and rewards</p>
                  </div>
                  <SwitchToggle
                    checked={formConfig.pointsSystem?.enabled ?? false}
                    onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, enabled: v } })}
                    accentColor={accentColor}
                  />
                </div>

                {formConfig.pointsSystem?.enabled && (
                  <>
                    {/* Base points */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Points per question</label>
                        <span className="text-xs font-bold" style={{ color: FE.text }}>{formConfig.pointsSystem?.basePoints ?? 100} pts</span>
                      </div>
                      <div className="flex max-w-full flex-wrap gap-2">
                        {[50, 100, 200, 500].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, basePoints: n } })}
                            className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.basePoints ?? 100) === n ? { background: accentColor, color: 'white' } : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Time bonus */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Time bonus</label>
                        <SwitchToggle
                          checked={formConfig.pointsSystem?.timeBonusEnabled ?? true}
                          onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusEnabled: v } })}
                          accentColor={accentColor}
                        />
                      </div>
                      {(formConfig.pointsSystem?.timeBonusEnabled ?? true) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={labelCls} style={labelStyle}>Within (seconds)</label>
                            <input type="number" min="3" max="60"
                              value={formConfig.pointsSystem?.timeBonusSeconds ?? 10}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusSeconds: Number(e.target.value) } })}
                              className={inputCls}
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label className={labelCls} style={labelStyle}>Multiplier</label>
                            <MenuSelect label="Multiplier" field value={String(formConfig.pointsSystem?.timeBonusMultiplier ?? 1.5)} C={DC}
                              onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusMultiplier: Number(v) } })}
                              options={[1.2, 1.5, 2, 3].map(m => ({ value: String(m), label: `${m}x` }))} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Streak bonus */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Hot streak bonus</label>
                        <SwitchToggle
                          checked={formConfig.pointsSystem?.streakEnabled ?? true}
                          onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakEnabled: v } })}
                          accentColor={accentColor}
                        />
                      </div>
                      {(formConfig.pointsSystem?.streakEnabled ?? true) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={labelCls} style={labelStyle}>After this many correct</label>
                            <input type="number" min="2" max="10"
                              value={formConfig.pointsSystem?.streakCount ?? 3}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakCount: Number(e.target.value) } })}
                              className={inputCls}
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label className={labelCls} style={labelStyle}>Bonus points</label>
                            <input type="number" min="10" max="500"
                              value={formConfig.pointsSystem?.streakBonus ?? 50}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakBonus: Number(e.target.value) } })}
                              className={inputCls}
                              style={inputStyle}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hint penalty */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Hint cost (points)</label>
                        <span className="text-xs font-semibold text-rose-400">-{formConfig.pointsSystem?.hintPenalty ?? 20} pts</span>
                      </div>
                      <div className="flex max-w-full flex-wrap gap-2">
                        {[10, 20, 50, 100].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, hintPenalty: n } })}
                            className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.hintPenalty ?? 20) === n
                              ? { background: accentColor, color: 'white' }
                              : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Solution penalty */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>View solution cost (XP)</label>
                        <span className="text-xs font-semibold text-rose-400">-{formConfig.pointsSystem?.solutionPenalty ?? 30} XP</span>
                      </div>
                      <div className="flex max-w-full flex-wrap gap-2">
                        {[10, 20, 30, 50].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, solutionPenalty: n } })}
                            className="min-h-8 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.solutionPenalty ?? 30) === n
                              ? { background: accentColor, color: 'white' }
                              : { background: FE.card, color: FE.muted, boxShadow: `inset 0 0 0 1px ${FE.divider}` }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Milestones */}
                    <div className="space-y-2">
                      <label className={labelCls} style={labelStyle}>Reward milestones</label>
                      {(formConfig.pointsSystem?.milestones ?? []).map((m, i) => (
                        <div key={m.id} className="p-3 rounded-xl space-y-2" style={{ background: FE.groupBg, border: `1px solid ${FE.groupBorder}` }}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold" style={{ color: FE.text }}>{m.points} pts</span>
                            <button type="button"
                              onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: (formConfig.pointsSystem?.milestones ?? []).filter((_, j) => j !== i) } })}
                              className="hover:text-red-400 transition-colors"
                              style={{ color: FE.faint }}
                            ><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                          <input type="number" placeholder="Points threshold"
                            value={m.points}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], points: Number(e.target.value) };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-2`}
                            style={inputStyle}
                          />
                          <input type="text" placeholder="Label (e.g. SQL Cheat Sheet)"
                            value={m.label}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], label: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-2`}
                            style={inputStyle}
                          />
                          <input type="text" placeholder="Description (e.g. Downloadable cheat sheet)"
                            value={m.description}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], description: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-2`}
                            style={inputStyle}
                          />
                          <input type="url" placeholder="Reward URL (optional)"
                            value={m.rewardUrl ?? ''}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], rewardUrl: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-2`}
                            style={inputStyle}
                          />
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => updateConfig({
                          pointsSystem: {
                            ...defaultPoints, ...formConfig.pointsSystem,
                            milestones: [...(formConfig.pointsSystem?.milestones ?? []), { id: Date.now().toString(), points: 500, label: '', description: '', rewardUrl: '' }]
                          }
                        })}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs transition-colors"
                        style={{ borderColor: FE.groupBorder, color: FE.muted }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add milestone
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {inStep('submission') && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: FE.text }}>{formConfig.isCourse ? 'When learners finish' : 'When people register'}</h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>{formConfig.isCourse ? 'Choose what learners see and where they can go after finishing.' : 'Choose what people see and where they can go after registering.'}</p>
                </div>
                {/* Type selector */}
                <div>
                  <label className={labelCls} style={labelStyle}>What happens after submission</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { value: 'default', label: 'Thank you', description: 'Show the standard completion screen', Icon: CheckCircle2 },
                      { value: 'redirect', label: 'Redirect URL', description: 'Send learners to another page', Icon: ExternalLink },
                      { value: 'button', label: 'CTA Button', description: 'Offer one clear next action', Icon: ArrowUpRight },
                      { value: 'events', label: 'Recommend next', description: 'Suggest courses or events to take next', Icon: CalendarDays },
                      { value: 'notice', label: 'Notice', description: 'Display a custom final message', Icon: ClipboardList },
                    ] as const).map(({ value, label, description, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: value } as any })}
                        className="flex min-h-20 items-start gap-3 rounded-xl p-3 text-left transition-all"
                        style={(formConfig.postSubmission?.type ?? 'default') === value
                          ? { background: `${accentColor}10`, color: accentColor, border: `1px solid ${accentColor}55` }
                          : { background: FE.groupBg, border: `1px solid ${FE.groupBorder}`, color: FE.muted }}
                      >
                        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: (formConfig.postSubmission?.type ?? 'default') === value ? `${accentColor}18` : FE.pill }}><Icon className="h-4 w-4" /></span>
                        <span><span className="block text-xs font-bold" style={{ color: (formConfig.postSubmission?.type ?? 'default') === value ? accentColor : FE.text }}>{label}</span><span className="mt-1 block text-[11px] leading-snug" style={{ color: FE.faint }}>{description}</span></span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Redirect URL */}
                {(formConfig.postSubmission?.type === 'redirect') && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Redirect URL</label>
                    <input
                      type="url"
                      value={formConfig.postSubmission?.redirectUrl || ''}
                      onChange={e => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'redirect', redirectUrl: e.target.value } })}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="https://yourwebsite.com/thank-you"
                    />
                    <p className="text-[11px] mt-1" style={{ color: FE.faint }}>Users will be automatically redirected after submitting.</p>
                  </div>
                )}

                {/* CTA Button */}
                {(formConfig.postSubmission?.type === 'button') && (
                  <div className="space-y-2">
                    <div>
                      <label className={labelCls} style={labelStyle}>Button label</label>
                      <input
                        type="text"
                        value={formConfig.postSubmission?.buttonLabel || ''}
                        onChange={e => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'button', buttonLabel: e.target.value } })}
                        className={inputCls}
                        style={inputStyle}
                        placeholder="e.g. Join our community"
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={labelStyle}>Button URL</label>
                      <input
                        type="url"
                        value={formConfig.postSubmission?.buttonUrl || ''}
                        onChange={e => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'button', buttonUrl: e.target.value } })}
                        className={inputCls}
                        style={inputStyle}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                )}

                {/* Show Events */}
                {(formConfig.postSubmission?.type === 'events') && (
                  <div className="space-y-2">
                    <label className={labelCls} style={labelStyle}>Courses and events to suggest</label>
                    {availableForms.length === 0 ? (
                      <p className="text-[11px] py-2" style={{ color: FE.faint }}>You have no other courses or events yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                        {availableForms.map(f => {
                          const selected = (formConfig.postSubmission?.relatedEventIds || []).includes(f.id);
                          return (
                            <label key={f.id} className="flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-colors" style={{ background: FE.groupBg, border: `1px solid ${FE.groupBorder}` }}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => {
                                  const current = formConfig.postSubmission?.relatedEventIds || [];
                                  const next = selected ? current.filter(id => id !== f.id) : [...current, f.id];
                                  updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'events', relatedEventIds: next } });
                                }}
                                className="w-3.5 h-3.5 rounded"
                                style={{ accentColor: accentColor }}
                              />
                              <span className="text-xs truncate flex-1 min-w-0" style={{ color: FE.text }}>{f.title || f.slug}</span>
                              <span className="text-[11px] flex-shrink-0" style={{ color: FE.faint }}>{f.kind}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Notice */}
                {(formConfig.postSubmission?.type === 'notice') && (
                  <div className="space-y-2">
                    <div>
                      <label className={labelCls} style={labelStyle}>Notice title</label>
                      <input
                        type="text"
                        value={formConfig.postSubmission?.noticeTitle || ''}
                        onChange={e => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'notice', noticeTitle: e.target.value } })}
                        className={inputCls}
                        style={inputStyle}
                        placeholder="What's next?"
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={labelStyle}>Notice message</label>
                      <AiTextarea
                        value={formConfig.postSubmission?.noticeBody || ''}
                        onValueChange={value => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: 'notice', noticeBody: value } })}
                        className={`${inputCls} min-h-[80px] resize-y`}
                        style={inputStyle}
                        placeholder="e.g. We'll review your submission and get back to you within 48 hours."
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeStudioMode.id === 'publish' && publishFooter && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 2 }}>{publishFooter}</div>
            )}

            </div>
            </div>

          </motion.div>
          </AnimatePresence>
          </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
      {pendingDelete && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.35)' }}
          onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-3"
            style={{ background: FE.card, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p id="delete-title" className="text-base font-semibold" style={{ color: FE.text }}>{pendingDelete.title}</p>
            <p className="text-sm" style={{ color: FE.muted }}>{pendingDelete.body}</p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" autoFocus onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: FE.pill, color: FE.text }}>Cancel</button>
              {pendingDelete.alt && (
                <button type="button" onClick={() => {
                  const ids = new Set(pendingDelete.alt!.ids);
                  updateConfig({ questions: (formConfig.questions ?? []).filter(x => !ids.has(x.id)) });
                  setPendingDelete(null);
                }} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: FE.pill, color: FE.text }}>{pendingDelete.alt.label}</button>
              )}
              <button type="button" onClick={() => {
                const ids = new Set(pendingDelete.ids);
                updateConfig({ questions: (formConfig.questions ?? []).filter(x => !ids.has(x.id)) });
                setPendingDelete(null);
              }} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: '#D93025', color: '#fff' }}>{pendingDelete.confirm}</button>
            </div>
          </div>
        </div>
      )}
        {pickerCtx && (
          <QuestionTypePicker
            key="qtype-picker"
            onSelect={handlePickerSelect}
            onClose={() => setPickerCtx(null)}
            includeDownloads={pickerCtx.mode !== 'change'}
            includeLesson={pickerCtx.mode !== 'change'}
          />
        )}
      </AnimatePresence>
      <GeneratingOverlay visible={!!aiLoadingLabel} label={aiLoadingLabel} failed={aiFailed} />
      <AnimatePresence>
        {eventAssistantOpen && formConfig?.eventDetails?.isEvent && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
            onClick={() => setEventAssistantOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-xl rounded-3xl p-5 sm:p-6"
              style={{ background: FE.card, border: `1px solid ${FE.cardBorder}`, boxShadow: FE.cardShadow }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: FE.text }}>AI Event Assistant</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: FE.faint }}>
                    Describe the event and AI will fill the setup, suggest registration fields, and draft a confirmation notice.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEventAssistantOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className={labelCls} style={labelStyle}>Event brief</label>
                  <AiTextarea
                    value={eventAssistantPrompt}
                    onValueChange={setEventAssistantPrompt}
                    className={`${inputCls} min-h-[140px] resize-y`}
                    style={inputStyle}
                    placeholder="Example: Create a virtual workshop for beginner creators on how to pitch brands next Thursday at 6pm WAT. Keep it friendly, collect name, email, niche, and Instagram handle, and write a strong confirmation message."
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEventAssistantOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                    style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={generateEventSetup}
                    disabled={!!aiLoadingLabel}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: accentColor, color: 'white' }}
                  >
                    {aiLoadingLabel === 'Generating event setup...' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate Event Setup
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {descriptionModalOpen && formConfig?.isCourse && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
            onClick={() => setDescriptionModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-lg rounded-3xl p-5 sm:p-6"
              style={{ background: FE.card, border: `1px solid ${FE.cardBorder}`, boxShadow: FE.cardShadow }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: FE.text }}>Generate Course Description</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: FE.faint }}>
                    Pick the tone, length, and any extra direction you want the AI to follow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDescriptionModalOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Style</label>
                    <select
                      value={aiDescriptionStyle}
                      onChange={e => setAiDescriptionStyle(e.target.value as 'professional' | 'casual' | 'friendly')}
                      className={`${inputCls} py-2`}
                      style={inputStyle}
                    >
                      <option value="professional">Professional</option>
                      <option value="casual">Casual</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} style={labelStyle}>Length</label>
                    <select
                      value={aiDescriptionLength}
                      onChange={e => setAiDescriptionLength(e.target.value as 'short' | 'medium' | 'long')}
                      className={`${inputCls} py-2`}
                      style={inputStyle}
                    >
                      <option value="short">Short</option>
                      <option value="medium">Medium</option>
                      <option value="long">Long</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={labelStyle}>Extra instructions</label>
                  <AiTextarea
                    value={aiDescriptionPrompt}
                    onValueChange={setAiDescriptionPrompt}
                    className={`${inputCls} min-h-[96px] resize-y`}
                    style={inputStyle}
                    placeholder="Optional: mention the audience, outcomes to emphasize, or the exact vibe you want."
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDescriptionModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                    style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={generateCourseDescription}
                    disabled={!!aiLoadingLabel}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: accentColor, color: 'white' }}
                  >
                    {aiLoadingLabel === 'Generating course description...' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate Description
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Generate Questions modal --- */}
      <AnimatePresence>
        {aiPromptModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
            onClick={() => setAiPromptModalOpen(false)}
          >
            <style>{`
              @keyframes ai-border-flow {
                0%   { background-position: -100% 0; }
                100% { background-position: 200%  0; }
              }
              .ai-modal-glow {
                background: linear-gradient(90deg, #14532d 0%, #16a34a 25%, #4ade80 50%, #16a34a 75%, #14532d 100%);
                background-size: 300% 100%;
                animation: ai-border-flow 2.4s linear infinite;
                border-radius: 26px;
                padding: 1.5px;
                box-shadow: 0 0 40px rgba(74,222,128,0.20), 0 0 80px rgba(74,222,128,0.08);
              }
            `}</style>
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="ai-modal-glow">
                <div className="rounded-3xl p-5 sm:p-6" style={{ background: FE.card }}>
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-sm font-semibold" style={{ color: FE.text }}>Generate Questions</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: FE.faint }}>
                    Enter a topic and optional instructions to guide the AI.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiPromptModalOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Topic */}
                <div>
                  <label className={labelCls} style={labelStyle}>Topic</label>
                  <input
                    type="text"
                    value={aiTopic}
                    onChange={e => setAiTopic(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                    placeholder="e.g. Intro to digital marketing for beginners"
                    autoFocus
                  />
                </div>

                {/* Type + Count */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Question type</label>
                    <select
                      value={aiQuestionType}
                      onChange={e => setAiQuestionType(e.target.value as 'multiple_choice' | 'fill_blank' | 'arrange' | 'sql_exercise' | 'python_exercise')}
                      className={`${inputCls} py-2`}
                      style={inputStyle}
                    >
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="fill_blank">Fill in the Blank</option>
                      <option value="arrange">Arrange / Order</option>
                      <option value="sql_exercise">SQL Exercise</option>
                      <option value="python_exercise">Python Exercise</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} style={labelStyle}>Count</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={aiQuestionCount}
                      onChange={e => setAiQuestionCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      className={`${inputCls} py-2`}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Custom instructions */}
                <div>
                  <label className={labelCls} style={labelStyle}>
                    Extra instructions{' '}
                    <span style={{ color: FE.faint, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <AiTextarea
                    value={aiCustomPrompt}
                    onValueChange={value => setAiCustomPrompt(value.slice(0, 800))}
                    className={`${inputCls} min-h-[88px] resize-y`}
                    style={inputStyle}
                    placeholder="e.g. Focus on practical scenarios, avoid theory-heavy questions, use beginner-friendly language."
                  />
                  <p className="text-[11px] mt-1 text-right" style={{ color: FE.faint }}>
                    {aiCustomPrompt.length}/800
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAiPromptModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                    style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => generateQuestions(aiCustomPrompt)}
                    disabled={!!aiLoadingLabel || !aiTopic.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: accentColor, color: 'white' }}
                  >
                    {aiLoadingLabel === 'Generating questions...' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate
                  </button>
                </div>
              </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Toast notification -- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="fe-toast"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-xl w-[calc(100%-2rem)] max-h-[45vh] overflow-auto rounded-2xl px-4 py-4 flex items-start gap-3"
            style={{
              background: FE.card,
              border: `1px solid ${toast.type === 'error' ? 'rgba(239,68,68,0.25)' : toast.type === 'success' ? 'rgba(16,185,129,0.25)' : FE.cardBorder}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}
          >
            <div className="w-2 self-stretch rounded-full flex-shrink-0 mt-0.5"
              style={{ background: toast.type === 'error' ? '#ef4444' : toast.type === 'success' ? '#10b981' : '#3b82f6' }}
            />
            <p className="text-sm leading-snug flex-1" style={{ color: FE.text }}>{toast.message}</p>
            <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} className="flex-shrink-0 mt-0.5 hover:opacity-60 transition-opacity" style={{ color: FE.faint }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Lesson Prompt Modal */}
      <AnimatePresence>
        {lessonPromptModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            onClick={() => setLessonPromptModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl overflow-hidden"
              style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${FE.cardBorder}` }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: FE.text }}>Generate AI Lesson</p>
                  <p className="text-xs mt-0.5" style={{ color: FE.faint }}>
                    {lessonPromptModal.q.lessonOnly
                      ? 'Describe what this lesson should teach.'
                      : 'Add custom instructions, or leave blank to generate from the question.'}
                  </p>
                </div>
                <button type="button" onClick={() => setLessonPromptModal(null)} className="p-2 rounded-lg transition-colors hover:bg-red-500/10">
                  <X className="w-4 h-4 text-red-400" />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-4 space-y-3">
                {!lessonPromptModal.q.lessonOnly && lessonPromptModal.q.question && (
                  <div className="rounded-lg px-3 py-2 text-xs" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                    <span className="font-semibold" style={{ color: FE.faint }}>Question: </span>{lessonPromptModal.q.question}
                  </div>
                )}
                <div>
                  <label className={labelCls} style={labelStyle}>
                    {lessonPromptModal.q.lessonOnly ? 'Topic / Instructions' : 'Custom Instructions'}{' '}
                    {!lessonPromptModal.q.lessonOnly && <span style={{ color: FE.faint, fontWeight: 400 }}>(optional)</span>}
                  </label>
                  <AiTextarea
                    autoFocus
                    rows={5}
                    value={lessonPrompts[lessonPromptModal.q.id] ?? ''}
                    onValueChange={value => setLessonPrompts(prev => ({ ...prev, [lessonPromptModal!.q.id]: value }))}
                    placeholder={lessonPromptModal.q.lessonOnly
                      ? 'e.g. Explain the water cycle for secondary school students, include real-world examples…'
                      : 'e.g. Focus on common misconceptions, use analogies, keep it beginner-friendly…'}
                    className={`${inputCls} resize-none`}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${FE.cardBorder}` }}>
                <button type="button" onClick={() => setLessonPromptModal(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!!aiLoadingLabel}
                  onClick={() => {
                    const q = lessonPromptModal.q;
                    setLessonPromptModal(null);
                    generateQuestionAsset(q, 'generate_lesson');
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ background: accentColor, color: 'white' }}
                >
                  <Sparkles className="w-3.5 h-3.5" /> Generate Lesson
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
              style={{ background: FE.card, border: `1px solid ${FE.cardBorder}`, maxHeight: '80vh' }}
            >
              <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                style={{ borderBottom: `1px solid ${FE.cardBorder}` }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: '#FF6B35' }}>
                    <Video className="w-3.5 h-3.5 text-white"/>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: FE.text }}>Pick from Bunny Library</span>
                </div>
                <button onClick={() => setBunnyPickerOpen(false)} style={{ color: FE.faint }}>
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${FE.cardBorder}` }}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-xl" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                    <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: FE.faint }}/>
                    <input
                      type="text"
                      value={bunnySearch}
                      onChange={e => setBunnySearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && openBunnyPicker(bunnyPickerQId!, bunnySearch)}
                      placeholder="Search videos..."
                      className="flex-1 bg-transparent text-sm outline-none"
                      style={{ color: FE.text }}
                    />
                  </div>
                  <button
                    onClick={() => openBunnyPicker(bunnyPickerQId!, bunnySearch)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ background: '#FF6B35', color: 'white' }}
                  >Search</button>
                </div>
              </div>
              {/* Body: collections sidebar + video grid */}
              <div className="flex flex-1 overflow-hidden">
                {bunnyCollections.length > 0 && (
                  <div className="w-44 flex-shrink-0 overflow-y-auto py-2" style={{ borderRight: `1px solid ${FE.cardBorder}` }}>
                    <button
                      onClick={() => { setBunnyCollection(''); openBunnyPicker(bunnyPickerQId!, bunnySearch, ''); }}
                      className="w-full text-left px-4 py-2 text-xs font-medium transition-colors"
                      style={{ background: bunnyCollection === '' ? 'rgba(0,191,99,0.1)' : 'transparent', color: bunnyCollection === '' ? '#00bf63' : FE.muted }}
                    >All videos</button>
                    {bunnyCollections.map(col => (
                      <button
                        key={col.guid}
                        onClick={() => { setBunnyCollection(col.guid); openBunnyPicker(bunnyPickerQId!, bunnySearch, col.guid); }}
                        className="w-full text-left px-4 py-2 text-xs transition-colors"
                        style={{ background: bunnyCollection === col.guid ? 'rgba(0,191,99,0.1)' : 'transparent', color: bunnyCollection === col.guid ? '#00bf63' : FE.muted }}
                      >
                        <span className="block font-medium truncate">{col.name}</span>
                        <span className="text-[11px]" style={{ color: FE.faint }}>{col.videoCount} videos</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4">
                  {bunnyLoading && (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: FE.faint }}/>
                    </div>
                  )}
                  {bunnyError && !bunnyLoading && (
                    <div className="text-center py-10 text-sm" style={{ color: '#ef4444' }}>{bunnyError}</div>
                  )}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length === 0 && (
                    <div className="text-center py-10 text-sm" style={{ color: FE.faint }}>No videos found.</div>
                  )}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {bunnyVideos.map(v => (
                        <button
                          key={v.guid}
                          onClick={() => selectBunnyVideo(v.embedUrl)}
                          className="text-left rounded-xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg group"
                          style={{ border: `1px solid ${FE.cardBorder}`, background: FE.groupBg }}
                        >
                          <div className="relative aspect-video bg-black overflow-hidden">
                            {v.thumbnail
                              ? <img src={v.thumbnail} alt={v.title}
                                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex'; }}
                                />
                              : null}
                            <div className="w-full h-full items-center justify-center" style={{ display: v.thumbnail ? 'none' : 'flex' }}>
                              <Video className="w-6 h-6 opacity-30" style={{ color: FE.faint }}/>
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
                            <p className="text-xs font-medium line-clamp-2 leading-snug" style={{ color: FE.text }}>{v.title}</p>
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
  );
}
