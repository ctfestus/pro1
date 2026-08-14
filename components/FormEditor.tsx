'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { safeEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { useTheme } from '@/components/ThemeProvider';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, Save, Check, Plus, Trash2, Image as ImageIcon, Images, Sun, Moon,
  X, MapPin, ArrowUpRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Sparkles,
  Building2, GripVertical, BookOpen, Pencil, Monitor, Smartphone, RotateCcw, ExternalLink, Video, Search,
  HelpCircle, CalendarDays, ClipboardList, Share2, CheckCircle2, Zap, Settings, Upload, Download, Link2, FileText,
  Lock, LockOpen, Users, Music, FileCode,
  ArrowUp, ArrowDown, PenLine, Blocks,
} from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import type { ThemeColor, ThemeMode } from '@/lib/theme-types';
import type {
  FieldType, FormField, QuestionType, DownloadItem, CourseQuestion,
  Speaker, EventDetails, PostSubmission, PointsMilestone, PointsSystem, FormConfig,
} from '@/lib/course-schema';
import { pointsSystemFromCourseRow, newLinkedInShareSlide, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';
import dynamic from 'next/dynamic';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { ImageCropModal } from '@/components/ImageCropModal';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AiTextarea } from '@/components/AiTextarea';
import { LessonEditor } from '@/components/lesson/LessonEditor';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';
import { lessonHtmlToDoc } from '@/components/lesson/extensions';
import { QuestionTypePicker, TYPE_LABELS } from '@/components/create/QuestionTypePicker';
import type { QuestionTypeOrDownloads } from '@/components/create/QuestionTypePicker';
import { getFontById, loadGoogleFont } from '@/lib/fonts';
import { FontPickerModal } from '@/components/FontPickerModal';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary, uploadToCloudinaryWithMeta, deleteFromCloudinary, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/uploadToCloudinary';
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

const buttonThemes: Record<ThemeColor, string> = {
  forest:  'bg-[#00bf63] hover:bg-[#00994f] text-white',
  lime:    'bg-[#ADEE66] hover:bg-[#9ad94d] text-black',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  rose:    'bg-rose-500 hover:bg-rose-600 text-white',
  amber:   'bg-amber-500 hover:bg-amber-600 text-white',
  ocean:   'bg-[#3E93FF] hover:bg-[#2f7fe0] text-white',
};

const themeAccentColors: Record<ThemeColor, string> = {
  forest:  '#00bf63',
  lime:    '#ADEE66',
  emerald: '#10b981',
  rose:    '#f43f5e',
  amber:   '#f59e0b',
  ocean:   '#3E93FF',
};

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
const formatDateParts = (dateString?: string) => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return {
      monthShort: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString('en-US', { day: 'numeric' }),
      fullDate: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    };
  } catch { return null; }
};

const formatLocation = (locationString?: string) => {
  if (!locationString) return { main: '', sub: '' };
  const parts = locationString.split(',');
  return parts.length > 1
    ? { main: parts[0].trim(), sub: parts.slice(1).join(',').trim() }
    : { main: locationString, sub: '' };
};

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
const FE_LIGHT = {
  page: '#f1f3f5', card: '#ffffff', cardBorder: 'rgba(0,0,0,0.08)', cardShadow: '0 1px 4px rgba(0,0,0,0.06)',
  input: '#f4f5f7', inputBorder: 'rgba(0,0,0,0.10)',
  text: '#111827', muted: '#4b5563', faint: '#9ca3af',
  section: '#ffffff', sectionBorder: 'rgba(0,0,0,0.07)',
  divider: 'rgba(0,0,0,0.07)', pill: '#eef0f3',
  toggleOff: '#d1d5db',
  segmentBg: '#eef0f3', segmentActive: '#ffffff', segmentActiveText: '#111827',
  groupBg: '#f4f5f7', groupBorder: 'transparent',
  cta: '#00bf63', ctaText: 'white',
};
const FE_DARK = {
  page: '#080808', card: '#1E1F26', cardBorder: 'rgba(255,255,255,0.07)', cardShadow: '0 4px 24px rgba(0,0,0,0.40)',
  input: 'rgba(255,255,255,0.05)', inputBorder: 'rgba(255,255,255,0.08)',
  text: '#f0f0f0', muted: '#aaa', faint: '#555',
  section: 'transparent', sectionBorder: 'rgba(255,255,255,0.06)',
  divider: 'rgba(255,255,255,0.06)', pill: '#27272a',
  toggleOff: '#3f3f46',
  segmentBg: '#09090b', segmentActive: '#3f3f46', segmentActiveText: '#f0f0f0',
  groupBg: 'rgba(255,255,255,0.04)', groupBorder: 'transparent',
  cta: '#ADEE66', ctaText: '#111',
};
function useFEC() { const { theme } = useTheme(); return theme === 'dark' ? FE_DARK : FE_LIGHT; }

// --- UI primitives ---
const inputCls = "w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-zinc-400";
const labelCls = "block text-[13.5px] font-medium mb-2";

function Toggle({ checked, onChange, accentColor }: { checked: boolean; onChange: () => void; accentColor?: string }) {
  const FE = useFEC();
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-1.5">
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
      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
      style={locked ? { background: accentColor ?? '#10b981', color: 'white' } : { background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
    >
      {locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />} Lock
    </button>
  );
}

function EditorSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const FE = useFEC();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="last:border-b-0" style={{ borderBottom: `1px solid ${FE.divider}` }}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-3 px-1 group">
        <span className="text-[12.5px] font-semibold tracking-widest uppercase transition-colors" style={{ color: FE.faint }}>{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" style={{ color: FE.faint }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: FE.faint }} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="pb-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      <div className="flex items-center gap-2 px-3 py-2.5">
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
          <span className="text-[10px]" style={{ color: FE.faint }}>{FIELD_TYPE_LABELS[f.type]}</span>
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
}

export default function FormEditor({ formId, contentType, onSaved }: FormEditorProps) {
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
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
  const [newQuestionType, setNewQuestionType] = useState<QuestionType | 'downloads'>('multiple_choice');
  const [pickerCtx, setPickerCtx] = useState<
    | { mode: 'bottom' }
    | { mode: 'insert'; afterIndex: number }
    | { mode: 'change'; qId: string }
    | null
  >(null);
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
  const rubricFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [lessonPrompts, setLessonPrompts] = useState<Record<string, string>>({});
  const [lessonPromptModal, setLessonPromptModal] = useState<{ q: CourseQuestion } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [closedLessons, setClosedLessons] = useState<Set<string>>(new Set());
  const [availableForms, setAvailableForms] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [cohorts, setCohorts]               = useState<{ id: string; name: string }[]>([]);
  const [partners, setPartners]               = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [courseAvailableToEveryone, setCourseAvailableToEveryone] = useState(false);
  const savedCohortIds = useRef<string[]>([]);
  const toggleCohort = (id: string) => {
    if (contentType === 'course') setCourseAvailableToEveryone(false);
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const [speakerAddOpen, setSpeakerAddOpen] = useState(false);
  const [speakerEditId, setSpeakerEditId] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState({ name: '', title: '', bio: '', avatar_url: '', linkedin_url: '' });
  const [speakerImgUploading, setSpeakerImgUploading] = useState(false);
  const [speakerCropSrc, setSpeakerCropSrc] = useState<string | null>(null);
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
        const { data: course } = await supabase.from('courses').select('id, title, description, slug, cohort_ids, available_to_everyone, questions, fields, passmark, course_timer, learn_outcomes, points_enabled, points_base, points_system, post_submission, cover_image, badge_image_url, deadline_days, theme, mode, font, custom_accent, category, partner_id, show_answers, lesson_timing, max_attempts').eq('id', formId).maybeSingle();
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
          });
          setCustomSlug(course.slug || '');
          const loadedCohorts = course.cohort_ids ?? [];
          setSelectedCohortIds(loadedCohorts);
          setCourseAvailableToEveryone(course.available_to_everyone === true);
          savedCohortIds.current = loadedCohorts;
        }
      } else {
        const { data: event } = await supabase.from('events').select('id, title, description, slug, cohort_ids, fields, post_submission, cover_image, deadline_days, theme, mode, font, custom_accent, event_date, event_time, timezone, location, event_type, capacity, meeting_link, is_private, speakers, recurrence, recurrence_end_date, recurrence_days').eq('id', formId).maybeSingle();
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
      const { data } = await supabase
        .from('events')
        .select('id, title, slug')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      if (data) setAvailableForms(data.filter((f: any) => f.id !== formId));
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
                doc: newBody ? lessonHtmlToDoc(newBody) : undefined,
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
  const handleSave = async () => {
    if (!formConfig) return;
    setIsSaving(true);
    try {
      let configToSave = await prepareSqlExpectedResultsForSave(formConfig);
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
    const id = Math.random().toString(36).substring(7);
    const defaults: Record<QuestionType, Partial<CourseQuestion>> = {
      multiple_choice:     { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A' },
      fill_blank:          { options: [], correctAnswer: '' },
      arrange:             { options: ['Step 1', 'Step 2', 'Step 3', 'Step 4'], correctAnswer: 'Step 1|||Step 2|||Step 3|||Step 4' },
      image:               { options: ['0', '1'], correctAnswer: '0', optionImages: ['', ''] },
      image_choice:        { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A', imageUrl: '' },
      code:                { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A', codeSnippet: '', codeLanguage: 'javascript' },
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
        question: 'New Question',
        ...defaults[type],
      } as CourseQuestion],
    });
  };

  const handleAddSection = () => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    updateConfig({
      questions: [...(formConfig.questions || []), {
        id, isSection: true, sectionTitle: 'New Section', sectionDescription: '', question: '', options: [], correctAnswer: '',
      } as CourseQuestion],
    });
  };

  const insertSectionAt = (afterIndex: number) => {
    if (!formConfig) return;
    const id = Math.random().toString(36).substring(7);
    const qs = [...(formConfig.questions || [])];
    qs.splice(afterIndex + 1, 0, {
      id, isSection: true, sectionTitle: 'New Section', sectionDescription: '', question: '', options: [], correctAnswer: '',
    } as CourseQuestion);
    updateConfig({ questions: qs });
  };

  const insertQuestionAt = (afterIndex: number, overrideType?: QuestionTypeOrDownloads) => {
    const type = overrideType ?? newQuestionType;
    if (!formConfig) return;
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
      multiple_choice:     { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A' },
      fill_blank:          { options: [], correctAnswer: '' },
      arrange:             { options: ['Step 1', 'Step 2', 'Step 3', 'Step 4'], correctAnswer: 'Step 1|||Step 2|||Step 3|||Step 4' },
      image:               { options: ['0', '1'], correctAnswer: '0', optionImages: ['', ''] },
      image_choice:        { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A', imageUrl: '' },
      code:                { options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A', codeSnippet: '', codeLanguage: 'javascript' },
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
      question: 'New Question',
      ...defaults[type],
    } as CourseQuestion);
    updateConfig({ questions: qs });
  };

  const handlePickerSelect = (type: QuestionTypeOrDownloads) => {
    if (!pickerCtx) return;
    setPickerCtx(null);
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

  const handleRemoveQuestion = (id: string) => {
    if (!formConfig) return;
    updateConfig({ questions: formConfig.questions?.filter(q => q.id !== id) || [] });
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

  const handleExtractRubric = async (questionId: string, label: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const key = `${questionId}:${label}`;
    setExtractingRubric(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || 'Extraction failed.', 'error'); return; }
      const incoming: string[] = json.criteria ?? [];
      if (!formConfig) return;
      const q = formConfig.questions?.find(q => q.id === questionId);
      handleUpdateQuestion(questionId, { rubric: [...(q?.rubric ?? []), ...incoming] });
      showToast(`${incoming.length} criteria extracted`, 'success');
    } catch {
      showToast('Failed to extract rubric. Please try again.', 'error');
    } finally {
      setExtractingRubric(null);
      e.target.value = '';
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

  const accentColor = formConfig.customAccent ?? themeAccentColors[formConfig.theme] ?? '#00bf63';
  const inputStyle = { background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text };
  const labelStyle = { color: FE.faint };
  const studioPanelClass = 'rounded-2xl p-4 sm:p-5 space-y-5';
  const studioPanelStyle = { background: FE.card, border: `1px solid ${FE.cardBorder}` };

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
  const courseStudioModes = [
    { id: 'build', label: 'Build', Icon: Blocks, sections: ['info'] },
    { id: 'content', label: 'Content', Icon: Video, sections: ['curriculum'] },
    { id: 'design', label: 'Design', Icon: Monitor, sections: ['cover', 'appearance'] },
    { id: 'settings', label: 'Settings', Icon: Settings, sections: ['course_settings', 'points', 'cohorts'] },
    { id: 'publish', label: 'Publish', Icon: CheckCircle2, sections: ['share', 'submission'] },
  ] as const;
  const activeStudioMode = courseStudioModes.find(mode => mode.sections.includes(activeSection as never)) ?? courseStudioModes[0];
  const readinessChecks = formConfig.isCourse ? [
    { label: 'Course title', complete: Boolean(formConfig.title?.trim()) },
    { label: 'Description', complete: Boolean(formConfig.description?.replace(/<[^>]*>/g, '').trim()) },
    { label: 'Cover image', complete: Boolean(formConfig.coverImage) },
    { label: 'Lesson content', complete: Boolean(formConfig.questions?.length) },
  ] : [];
  const readinessComplete = readinessChecks.filter(check => check.complete).length;

  return (
    <div className="flex flex-col" style={{ background: 'transparent', color: FE.text, colorScheme: FE === FE_DARK ? 'dark' : 'light' }}>
      {/* -- Content Area (no left pane -- section nav is the horizontal stepper below) -- */}
      <div className="flex-1 flex flex-col">
        {/* Persistent save control remains reachable throughout the editor. */}
        <div className="fixed left-4 right-4 bottom-4 sm:left-auto sm:right-6 sm:bottom-6 z-[90] flex items-center justify-between sm:justify-end gap-3 p-2 rounded-xl" style={{ border: `1px solid ${FE.cardBorder}`, background: FE.card, boxShadow: FE === FE_DARK ? '0 14px 38px rgba(0,0,0,0.48)' : '0 14px 38px rgba(15,23,42,0.16)' }}>
          <span className="text-[11px] pl-2 whitespace-nowrap" style={{ color: FE.faint }}>
            {saved ? '✓ All changes saved' : 'Unsaved changes'}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60 hover:opacity-90"
            style={{ background: accentColor, color: 'white' }}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
        {formConfig.isCourse && (
          <div className="relative z-10" style={{ background: FE.card, borderBottom: `1px solid ${FE.cardBorder}` }}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0 mr-auto">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden="true">
                    <span className="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-20 motion-reduce:animate-none" style={{ background: accentColor }} />
                    <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: accentColor }} />
                  </span>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: accentColor }}>Course Studio</p>
                </div>
                <p className="mt-1 truncate text-base font-semibold leading-tight sm:text-lg" style={{ color: FE.text }}>{formConfig.title || 'Untitled course'}</p>
              </div>
              <button type="button" onClick={() => window.open(`/${customSlug || formId}`, '_blank', 'noopener,noreferrer')}
                className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:flex"
                style={{ background: FE.groupBg, color: FE.muted }}>
                <ExternalLink className="h-3.5 w-3.5" /> Preview
              </button>
              <span className="hidden text-[11px] sm:inline" style={{ color: FE.faint }}>{isSaving ? 'Saving changes…' : saved ? 'All changes saved' : 'Editing course'}</span>
            </div>
            <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-3 sm:px-6" aria-label="Course studio modes" style={{ scrollbarWidth: 'none' }}>
              {courseStudioModes.map(mode => {
                const active = mode.id === activeStudioMode.id;
                return (
                  <button key={mode.id} type="button" onClick={() => goToSection(mode.sections[0], editorSectionIds)}
                    className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                    style={{ background: active ? `${accentColor}14` : 'transparent', color: active ? accentColor : FE.faint }}>
                    <mode.Icon className="h-3.5 w-3.5" /> {mode.label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}
        <div className="flex-1">
          <div>
          <div>
          {(() => {
            const navSections = editorSections;
            const ids = formConfig.isCourse ? courseStudioModes.map(mode => mode.sections[0]) : editorSectionIds;
            const i = formConfig.isCourse ? courseStudioModes.findIndex(mode => mode.id === activeStudioMode.id) : ids.indexOf(activeSection);
            const currentLabel = formConfig.isCourse ? activeStudioMode.label : navSections[editorSectionIds.indexOf(activeSection)]?.label;
            return (
              <div className="px-5 py-4 sm:px-8" style={{ borderBottom: `1px solid ${FE.cardBorder}` }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold leading-tight sm:text-xl" style={{ color: FE.text }}>{currentLabel}</h2>
                    <p className="mt-1 text-[11px] font-medium" style={{ color: FE.faint }}>{formConfig.isCourse ? `${activeStudioMode.label} workspace` : `Step ${i + 1} of ${ids.length}`}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button type="button" disabled={i <= 0} onClick={() => goToSection(ids[i - 1], ids)} aria-label="Previous"
                      className="grid h-9 w-9 place-items-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-30"
                      style={{ border: `1px solid ${FE.cardBorder}`, color: FE.muted }}>
                      <ChevronLeft className="h-4 w-4"/>
                    </button>
                    <button type="button" disabled={i >= ids.length - 1} onClick={() => goToSection(ids[i + 1], ids)} aria-label="Next"
                      className="grid h-9 w-9 place-items-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-30"
                      style={{ border: `1px solid ${FE.cardBorder}`, color: FE.muted }}>
                      <ChevronRight className="h-4 w-4"/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
          <AnimatePresence mode="wait" custom={secDir}>
          <motion.div key={activeSection} custom={secDir}
            initial={{ opacity: 0, x: secDir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: secDir * -28 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="px-6 sm:px-8 py-7 space-y-5">
            <div>
            <div className="flex min-w-0 flex-col gap-5">

            {formConfig.isCourse && activeStudioMode.id === 'publish' && (
              <section className="rounded-2xl p-4 sm:p-5" style={{ background: FE.groupBg }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Publish readiness</p>
                    <h3 className="mt-1 text-base font-semibold" style={{ color: FE.text }}>{readinessComplete === readinessChecks.length ? 'Your course is ready to share' : `${readinessChecks.length - readinessComplete} items need attention`}</h3>
                  </div>
                  <span className="rounded-xl px-3 py-1.5 text-xs font-bold tabular-nums" style={{ background: readinessComplete === readinessChecks.length ? '#22c55e18' : `${accentColor}14`, color: readinessComplete === readinessChecks.length ? '#22c55e' : accentColor }}>{readinessComplete}/{readinessChecks.length}</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {readinessChecks.map(check => (
                    <div key={check.label} className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: FE.card }}>
                      <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold" style={{ background: check.complete ? '#22c55e' : FE.pill, color: check.complete ? '#fff' : FE.faint }}>{check.complete ? '✓' : '·'}</span>
                      <span className="text-[11px] font-medium" style={{ color: check.complete ? FE.text : FE.faint }}>{check.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeSection === 'info' && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course identity</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Give learners a clear promise before they begin.</p>
              </div>}
              <div>
                <label className={labelCls} style={labelStyle}>{formConfig.isCourse ? 'Course title' : 'Form title'}</label>
                <input type="text" value={formConfig.title} onChange={e => updateConfig({ title: e.target.value })} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Description</label>
                  {formConfig.isCourse && (
                    <button
                      type="button"
                      onClick={() => setDescriptionModalOpen(true)}
                      disabled={!!aiLoadingLabel}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity disabled:opacity-50"
                      style={{ background: `${accentColor}16`, color: accentColor, border: `1px solid ${accentColor}22` }}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      AI Description
                    </button>
                  )}
                </div>
                <RichTextEditor value={formConfig.description} onChange={html => updateConfig({ description: html })} enableAiAssist />
                {formConfig.isCourse && (
                  <p className="mt-1.5 text-[11px]" style={{ color: FE.faint }}>
                    Recommended: keep your description under 250 characters for best display on your profile page.
                  </p>
                )}
              </div>
              </div>
            )}

            {activeSection === 'event_details' && formConfig.eventDetails?.isEvent && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4 rounded-2xl p-4" style={{ background: `${accentColor}0e` }}>
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accentColor}1f`, color: accentColor }}>
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: FE.text }}>AI Event Assistant</p>
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: FE.faint }}>Generate the setup, registration fields, and confirmation copy from a short brief.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEventAssistantOpen(true)} disabled={!!aiLoadingLabel}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50 flex-shrink-0"
                    style={{ background: accentColor, color: 'white' }}>
                    <Sparkles className="w-3.5 h-3.5" /> Open Assistant
                  </button>
                </div>
                {/* FORMAT -- type + location */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: FE.faint }}>Format</p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { type: 'in-person', Icon: MapPin, label: 'In-Person', desc: 'A physical venue' },
                      { type: 'virtual',   Icon: Video,  label: 'Virtual',   desc: 'An online meeting' },
                    ] as const).map(({ type, Icon, label, desc }) => {
                      const active = (formConfig.eventDetails!.eventType ?? 'in-person') === type;
                      return (
                        <button key={type} type="button"
                          onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, eventType: type } })}
                          className="relative flex flex-col items-start gap-2.5 p-4 rounded-2xl text-left transition-all"
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
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: FE.faint }}>
                      {(formConfig.eventDetails.eventType ?? 'in-person') === 'virtual' ? <Link2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                    </span>
                    {(formConfig.eventDetails.eventType ?? 'in-person') === 'virtual' ? (
                      <input type="url" value={formConfig.eventDetails.meetingLink || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, meetingLink: e.target.value } })} placeholder="https://meet.google.com/..." className={`${inputCls} pl-9`} style={inputStyle} />
                    ) : (
                      <input type="text" value={formConfig.eventDetails.location || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, location: e.target.value } })} placeholder="Address or venue name" className={`${inputCls} pl-9`} style={inputStyle} />
                    )}
                  </div>
                </div>

                {/* SCHEDULE */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: FE.faint }}>Schedule</p>
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Date</label>
                    <input type="date" value={formConfig.eventDetails.date || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, date: e.target.value } })} className={`${inputCls}`} style={inputStyle} />
                  </div>
                  <div>
                    <label className={labelCls} style={labelStyle}>Time</label>
                    <input type="time" value={formConfig.eventDetails.time || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, time: e.target.value } })} className={`${inputCls}`} style={inputStyle} />
                  </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} style={labelStyle}>Timezone</label>
                    <select value={formConfig.eventDetails.timezone || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, timezone: e.target.value } })} className={inputCls} style={inputStyle}>
                      <option value="">Select timezone…</option>
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
                    <input type="date" value={formConfig.eventDetails.recurrenceEndDate || ''} onChange={e => updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrenceEndDate: e.target.value } })} className={`${inputCls}`} style={inputStyle} />
                  </div>
                  )}
                  </div>
                </div>

                {/* REPEATS */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: FE.faint }}>Repeats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['once', 'daily', 'weekly'] as const).map(freq => {
                      const active = (formConfig.eventDetails!.recurrence ?? 'once') === freq;
                      const labels = { once: 'One-time', daily: 'Daily', weekly: 'Weekly' };
                      return (
                        <button key={freq} type="button"
                          onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrence: freq } })}
                          className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: active ? `${accentColor}14` : FE.input, color: active ? accentColor : FE.muted }}>
                          {labels[freq]}
                        </button>
                      );
                    })}
                  </div>

                {(formConfig.eventDetails!.recurrence ?? 'once') === 'weekly' && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Repeat on</label>
                    <div className="flex gap-1.5 flex-wrap mt-1">
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

            {activeSection === 'visibility' && formConfig.eventDetails?.isEvent && (
              <div className="space-y-5">
                <button
                  type="button"
                  onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, isPrivate: !formConfig.eventDetails!.isPrivate } })}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200"
                  style={{
                    background: formConfig.eventDetails.isPrivate ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)',
                    borderColor: formConfig.eventDetails.isPrivate ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{formConfig.eventDetails.isPrivate ? '🔒' : '🌐'}</span>
                    <div className="text-left">
                      <p className="text-xs font-semibold" style={{ color: formConfig.eventDetails.isPrivate ? '#f87171' : '#34d399' }}>
                        {formConfig.eventDetails.isPrivate ? 'Private event' : 'Public event'}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: FE.faint }}>
                        {formConfig.eventDetails.isPrivate ? 'Hidden from your profile page' : 'Visible on your public profile'}
                      </p>
                    </div>
                  </div>
                  <div
                    className="relative w-10 h-5 rounded-full transition-all duration-300 flex-shrink-0"
                    style={{ background: formConfig.eventDetails.isPrivate ? '#ef4444' : '#10b981' }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300"
                      style={{ left: formConfig.eventDetails.isPrivate ? '1.25rem' : '0.125rem' }}
                    />
                  </div>
                </button>
              </div>
            )}

            {activeSection === 'speakers' && formConfig.eventDetails?.isEvent && (() => {
              const speakers: Speaker[] = formConfig.eventDetails!.speakers ?? [];
              const updateSpeakers = (next: Speaker[]) =>
                updateConfig({ eventDetails: { ...formConfig.eventDetails!, speakers: next } });

              const handleSpeakerPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) { showToast('Image must be 8MB or smaller.'); return; }
                const url = URL.createObjectURL(file);
                setSpeakerCropSrc(url);
                // reset input so same file can be re-selected
                e.target.value = '';
              };

              const deleteSpeakerPhoto = (url: string) => {
                if (url) deleteFromCloudinary(url).catch(() => {});
              };

              const handleSpeakerCropConfirm = async (blob: Blob) => {
                setSpeakerCropSrc(null);
                setSpeakerImgUploading(true);
                const oldUrl = speakerDraft.avatar_url;
                try {
                  const publicUrl = await uploadToCloudinary(new File([blob], 'speaker.jpg', { type: 'image/jpeg' }), 'speakers');
                  setSpeakerDraft(d => ({ ...d, avatar_url: publicUrl }));
                  if (oldUrl) deleteSpeakerPhoto(oldUrl);
                } catch { /* ignore */ }
                setSpeakerImgUploading(false);
              };

              const openEdit = (sp: Speaker) => {
                setSpeakerEditId(sp.id);
                setSpeakerDraft({ name: sp.name, title: sp.title ?? '', bio: sp.bio ?? '', avatar_url: sp.avatar_url ?? '', linkedin_url: sp.linkedin_url ?? '' });
                setSpeakerAddOpen(true);
              };

              const isEditing = speakerEditId !== null;

              return (
                <div className="space-y-5">
                  {/* Crop modal */}
                  {speakerCropSrc && (
                    <ImageCropModal
                      src={speakerCropSrc}
                      aspect={1}
                      shape="round"
                      title="Crop speaker photo"
                      onConfirm={handleSpeakerCropConfirm}
                      onCancel={() => { URL.revokeObjectURL(speakerCropSrc); setSpeakerCropSrc(null); }}
                    />
                  )}

                  {/* Existing speakers list */}
                  {speakers.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {speakers.map((sp) => (
                        <div key={sp.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: FE.groupBg, border: `1px solid ${FE.groupBorder}` }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${accentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: accentColor }}>
                            {sp.avatar_url
                              ? <img src={sp.avatar_url} alt={sp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : (sp.name || '?').slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className="text-sm font-semibold truncate" style={{ color: FE.text }}>{sp.name}</p>
                            {sp.title && <p className="text-xs truncate" style={{ color: FE.faint }}>{sp.title}</p>}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => openEdit(sp)}
                              className="p-1 rounded-lg transition-colors hover:bg-black/10"
                              title="Edit speaker"
                            >
                              <Pencil className="w-3.5 h-3.5" style={{ color: FE.faint }} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (sp.avatar_url) deleteSpeakerPhoto(sp.avatar_url);
                                updateSpeakers(speakers.filter(s => s.id !== sp.id));
                              }}
                              className="p-1 rounded-lg transition-colors hover:bg-red-500/10"
                              title="Remove speaker"
                            >
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add / Edit speaker form */}
                  {!speakerAddOpen ? (
                    <button
                      type="button"
                      onClick={() => { setSpeakerEditId(null); setSpeakerDraft({ name: '', title: '', bio: '', avatar_url: '', linkedin_url: '' }); setSpeakerAddOpen(true); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold"
                      style={{ border: `1.5px dashed ${FE.inputBorder}`, color: FE.faint }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Speaker
                    </button>
                  ) : (
                    <div className="rounded-xl p-3 space-y-2.5" style={{ background: FE.groupBg, border: `1px solid ${FE.groupBorder}` }}>
                      {/* Photo */}
                      <div className="flex items-center gap-3">
                        <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${accentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: accentColor }}>
                          {speakerDraft.avatar_url
                            ? <img src={speakerDraft.avatar_url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : speakerDraft.name ? speakerDraft.name.slice(0, 2).toUpperCase() : <ImageIcon className="w-4 h-4" />}
                        </div>
                        <label className="flex-1 cursor-pointer">
                          <input type="file" accept="image/*" className="hidden" onChange={handleSpeakerPhoto} disabled={speakerImgUploading} />
                          <span className="text-xs font-medium" style={{ color: accentColor }}>
                            {speakerImgUploading ? 'Uploading…' : speakerDraft.avatar_url ? 'Change photo' : 'Upload photo'}
                          </span>
                        </label>
                      </div>

                      {/* Name */}
                      <div>
                        <label className={labelCls} style={labelStyle}>Name <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          value={speakerDraft.name}
                          onChange={e => setSpeakerDraft(d => ({ ...d, name: e.target.value }))}
                          placeholder="e.g. Jane Doe"
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                        />
                      </div>

                      {/* Title / Role */}
                      <div>
                        <label className={labelCls} style={labelStyle}>Title / Role</label>
                        <input
                          type="text"
                          value={speakerDraft.title}
                          onChange={e => setSpeakerDraft(d => ({ ...d, title: e.target.value }))}
                          placeholder="e.g. CEO at Acme · Keynote Speaker"
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                        />
                      </div>

                      {/* Bio */}
                      <div>
                        <label className={labelCls} style={labelStyle}>Short bio</label>
                        <AiTextarea
                          value={speakerDraft.bio}
                          onValueChange={value => setSpeakerDraft(d => ({ ...d, bio: value }))}
                          placeholder="A sentence or two about this speaker…"
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                          style={{ background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                        />
                      </div>

                      {/* LinkedIn */}
                      <div>
                        <label className={labelCls} style={labelStyle}>LinkedIn URL</label>
                        <input
                          type="url"
                          value={speakerDraft.linkedin_url}
                          onChange={e => setSpeakerDraft(d => ({ ...d, linkedin_url: e.target.value }))}
                          placeholder="https://linkedin.com/in/username"
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ background: FE.input, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!speakerDraft.name.trim()) return;
                            const updated = {
                              id: isEditing ? speakerEditId! : crypto.randomUUID(),
                              name: speakerDraft.name.trim(),
                              title: speakerDraft.title.trim() || undefined,
                              bio: speakerDraft.bio.trim() || undefined,
                              avatar_url: speakerDraft.avatar_url || undefined,
                              linkedin_url: speakerDraft.linkedin_url.trim() || undefined,
                            };
                            updateSpeakers(isEditing
                              ? speakers.map(s => s.id === speakerEditId ? updated : s)
                              : [...speakers, updated]);
                            setSpeakerDraft({ name: '', title: '', bio: '', avatar_url: '', linkedin_url: '' });
                            setSpeakerEditId(null);
                            setSpeakerAddOpen(false);
                          }}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold"
                          style={{ background: accentColor, color: 'white', opacity: speakerDraft.name.trim() ? 1 : 0.45 }}
                        >
                          {isEditing ? 'Save Changes' : 'Add Speaker'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSpeakerAddOpen(false); setSpeakerEditId(null); setSpeakerDraft({ name: '', title: '', bio: '', avatar_url: '', linkedin_url: '' }); }}
                          className="px-3 py-2 rounded-lg text-xs font-medium"
                          style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {((formConfig.isCourse && activeStudioMode.id === 'settings') || (activeSection === 'cohorts' && formConfig?.eventDetails?.isEvent)) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 2 } : undefined}>
                {formConfig.isCourse && <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Learner access</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Choose Everyone or the cohorts that can access this course.</p>
                </div>}
                {formConfig.isCourse && <button
                  type="button"
                  onClick={() => { setCourseAvailableToEveryone(true); setSelectedCohortIds([]); }}
                  className="w-full rounded-xl px-3.5 py-3 text-left text-sm font-semibold"
                  style={{ background: courseAvailableToEveryone ? `${accentColor}18` : FE.groupBg, border: `1px solid ${courseAvailableToEveryone ? accentColor : FE.groupBorder}`, color: courseAvailableToEveryone ? accentColor : FE.text }}
                >Everyone</button>}
                {cohorts.length === 0 ? (
                  <div className="rounded-xl px-4 py-6 text-center" style={{ background: FE.groupBg }}>
                    <Users className="mx-auto h-5 w-5" style={{ color: FE.faint }} />
                    <p className="mt-2 text-xs" style={{ color: FE.faint }}>No cohorts found. Create cohorts from the admin dashboard first.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {cohorts.map(c => (
                      <label key={c.id} className="flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-xl px-3.5 py-3 transition-colors" style={{ background: selectedCohortIds.includes(c.id) ? `${accentColor}10` : FE.groupBg, border: `1px solid ${selectedCohortIds.includes(c.id) ? `${accentColor}55` : FE.groupBorder}` }}>
                        <input
                          type="checkbox"
                          checked={selectedCohortIds.includes(c.id)}
                          onChange={() => toggleCohort(c.id)}
                          className="accent-current w-4 h-4 rounded"
                          style={{ accentColor: accentColor }}
                        />
                        <span className="min-w-0 text-sm font-semibold" style={{ color: FE.text }}>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                {formConfig.isCourse && <p className="text-xs" style={{ color: FE.faint }}>
                  {courseAvailableToEveryone
                    ? 'Available to every signed-in student.'
                    : selectedCohortIds.length > 0
                      ? 'Only the selected cohorts can access this course.'
                      : 'Nobody can access this yet. Choose Everyone or select at least one cohort.'}
                </p>}
                {selectedCohortIds.length > 0 && (
                  <div className="pt-2 border-t" style={{ borderColor: FE.inputBorder }}>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: FE.muted }}>Deadline (days from assignment)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={1} max={365} placeholder="--"
                        value={formConfig.deadline_days ?? ''}
                        onChange={e => updateConfig({ deadline_days: e.target.value ? Number(e.target.value) : null })}
                        className="w-20 bg-transparent px-2 py-1.5 text-sm outline-none rounded-lg text-center"
                        style={{ border: `1px solid ${FE.inputBorder}`, color: FE.text, background: FE.input }}
                      />
                      <span className="text-xs" style={{ color: FE.faint }}>days · leave blank for no deadline</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {((formConfig.isCourse && activeStudioMode.id === 'publish') || (!formConfig.isCourse && activeSection === 'share')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 0 } : undefined}>
              {formConfig.isCourse && <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course link</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Create a short, recognizable URL for sharing your course.</p>
              </div>}
              <div>
                <label className={labelCls} style={labelStyle}>Custom slug (optional)</label>
                <div className="flex min-h-12 items-center overflow-hidden rounded-xl transition-colors" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                  <span className="self-stretch px-3 text-xs whitespace-nowrap flex items-center" style={{ color: FE.faint, borderRight: `1px solid ${FE.inputBorder}` }}>/</span>
                  <input type="text" value={customSlug} onChange={e => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="my-course" className="w-full bg-transparent px-3 py-3 text-sm font-medium outline-none placeholder:text-zinc-400" style={{ color: FE.text }} />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: FE.faint }}><Link2 className="h-3 w-3" /> /{customSlug || formId}</p>
              </div>
              </div>
            )}

            {(activeSection === 'cover' || (formConfig.isCourse && activeStudioMode.id === 'design')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Cover &amp; media</p>
                <p className="mt-1 text-xs" style={{ color: FE.faint }}>Choose the visual learners see before opening the course.</p>
              </div>}
              {formConfig.coverImage ? (
                <div className="space-y-3">
                  <div className="relative h-32 w-full overflow-hidden rounded-xl group sm:h-40" style={{ border: `1px solid ${FE.cardBorder}` }}>
                    <img src={resolveCoverUrl(formConfig.coverImage)} alt="Course cover" className="h-full w-full object-cover" onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" onClick={() => setShowCoverLibrary(true)} className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white" style={{ color: '#111' }}>
                        <ImageIcon className="w-3.5 h-3.5" /> Change
                      </button>
                      <button type="button" onClick={() => { deleteUploadedFile(formConfig?.coverImage); updateConfig({ coverImage: '' }); }} className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-white">
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setShowCoverLibrary(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:opacity-80" style={{ background: FE.groupBg, color: FE.text }}>
                      <ImageIcon className="h-3.5 w-3.5" /> Change cover
                    </button>
                    <button type="button" onClick={() => { deleteUploadedFile(formConfig?.coverImage); updateConfig({ coverImage: '' }); }} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10">
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

            {(activeSection === 'appearance' || (formConfig.isCourse && activeStudioMode.id === 'design')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5 pt-2'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Appearance</p>
                <p className="mt-1 text-xs" style={{ color: FE.faint }}>Set the course theme, typography, and accent color.</p>
              </div>}
              <div>
                <label className={labelCls} style={labelStyle}>Mode</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([{ value: 'light', label: 'Light', description: 'Bright canvas', Icon: Sun }, { value: 'dark', label: 'Dark', description: 'Low-light canvas', Icon: Moon }, { value: 'auto', label: 'Automatic', description: 'Match learner device', Icon: Monitor }] as const).map(({ value, label, description, Icon }) => {
                    const active = formConfig.mode === value;
                    return <button key={value} type="button" onClick={() => updateConfig({ mode: value })} className="flex min-h-20 items-start gap-3 rounded-xl p-3 text-left transition-all" style={{ background: active ? `${accentColor}10` : FE.groupBg, border: `1px solid ${active ? `${accentColor}55` : FE.groupBorder}`, color: active ? accentColor : FE.muted }}>
                      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: active ? `${accentColor}18` : FE.pill }}><Icon className="h-4 w-4" /></span>
                      <span><span className="block text-xs font-bold" style={{ color: active ? accentColor : FE.text }}>{label}</span><span className="mt-1 block text-[10px] leading-snug" style={{ color: FE.faint }}>{description}</span></span>
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
                      <button key={key} onClick={() => updateConfig({ theme: key, customAccent: undefined })} title={label} className="flex flex-col items-center gap-1.5 group">
                        <span
                          className={`w-7 h-7 rounded-full transition-transform group-hover:scale-110 ${isSelected ? 'scale-110' : ''}`}
                          style={{
                            background: color,
                            boxShadow: isSelected ? `0 0 0 2.5px var(--swatch-ring, ${FE.card}), 0 0 0 4.5px ${color}` : undefined,
                          }}
                        />
                        <span className="text-[10px] transition-colors group-hover:opacity-60" style={{ color: FE.faint }}>{label}</span>
                      </button>
                    );
                  })}
                  <div className="flex flex-col items-center gap-1.5 group">
                    <div
                      title="Custom color"
                      className={`relative grid h-7 w-7 cursor-pointer place-items-center rounded-full transition-transform group-hover:scale-110 ${formConfig.customAccent ? 'scale-110' : ''}`}
                      style={{
                        background: formConfig.customAccent ?? 'conic-gradient(from 90deg, #f43f5e, #f59e0b, #a3e635, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)',
                        boxShadow: formConfig.customAccent ? `0 0 0 2.5px var(--swatch-ring, ${FE.card}), 0 0 0 4.5px ${formConfig.customAccent}` : undefined,
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
                        value={formConfig.customAccent || accentColor || '#6366f1'}
                        onChange={e => updateConfig({ customAccent: e.target.value })}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
                      />
                    </div>
                    <span className="text-[10px] transition-colors group-hover:opacity-60" style={{ color: FE.faint }}>Custom</span>
                  </div>
                </div>
              </div>
              </div>
            )}

            {/* Course settings */}
            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 0 }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course rules</p>
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
                    <div className="mt-2 flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {COURSE_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => updateConfig({ category: formConfig.category === cat ? null : cat })}
                          className="min-h-8 rounded-lg px-3 py-1 text-[11px] font-semibold transition-all"
                          style={{
                            background: formConfig.category === cat ? accentColor : 'transparent',
                            color: formConfig.category === cat ? '#fff' : FE.muted,
                            boxShadow: formConfig.category === cat ? '0 1px 3px rgba(15,23,42,0.12)' : undefined,
                          }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: FE.faint }}>
                      Students can filter courses by category on their dashboard.
                    </p>
                  </div>

                  {/* Partner */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Partner</label>
                    <select
                      value={formConfig.partnerId ?? ''}
                      onChange={e => updateConfig({ partnerId: e.target.value || null })}
                      className={inputCls}
                      style={inputStyle}
                    >
                      <option value="">Select partner</option>
                      {partners
                        .filter(partner => partner.is_active || partner.id === formConfig.partnerId)
                        .map(partner => (
                          <option key={partner.id} value={partner.id}>
                            {partner.name}{partner.is_active ? '' : ' (inactive)'}
                          </option>
                        ))}
                    </select>
                    <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: FE.faint }}>
                      Displayed as &quot;Offered by&quot; attribution on catalog cards and certificates.
                    </p>
                  </div>

                  {/* Completion badge */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Completion Badge</label>
                    <p className="text-[10px] mb-2 leading-relaxed" style={{ color: FE.faint }}>
                      Students earn this badge when they pass the course assessment. It appears in their Badges section alongside their certificate.
                    </p>
                    <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeImageUpload}/>
                    {formConfig.badgeImageUrl ? (
                      <div className="flex items-center gap-3">
                        <img src={formConfig.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0" style={{ border: `1px solid ${FE.inputBorder}`, background: FE.groupBg }}/>
                        <div className="flex flex-col gap-1.5">
                          <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                            {uploadingBadge ? <Loader2 className="w-3 h-3 animate-spin"/> : <Upload className="w-3 h-3"/>}
                            {uploadingBadge ? 'Uploading...' : 'Change'}
                          </button>
                          <button type="button" onClick={() => updateConfig({ badgeImageUrl: null })}
                            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                            style={{ color: '#ef4444', background: '#ef444412' }}>Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ border: `1.5px dashed ${FE.inputBorder}`, color: FE.faint, background: FE.groupBg, width: '100%', justifyContent: 'center' }}>
                        {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                        {uploadingBadge ? 'Uploading...' : 'Upload badge image'}
                      </button>
                    )}
                  </div>

                  {/* Show answers setting */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <label className={labelCls} style={labelStyle}>Show correct answers</label>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {([
                        { value: 'per_question', label: 'Per question' },
                        { value: 'after_quiz', label: 'After course' },
                        { value: 'none', label: 'Never' },
                      ] as const).map(({ value, label }) => (
                        <button key={value} type="button" onClick={() => updateConfig({ showAnswers: value })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.showAnswers ?? 'per_question') === value ? accentColor : 'transparent', color: (formConfig.showAnswers ?? 'per_question') === value ? '#fff' : FE.muted, boxShadow: (formConfig.showAnswers ?? 'per_question') === value ? '0 1px 3px rgba(15,23,42,0.12)' : undefined }}
                        >{label}</button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: FE.faint }}>
                      {(formConfig.showAnswers ?? 'per_question') === 'per_question' && 'Students see correct/incorrect after each question.'}
                      {formConfig.showAnswers === 'after_quiz' && 'Students see all answers after submitting.'}
                      {formConfig.showAnswers === 'none' && 'Students only see their final score.'}
                    </p>
                  </div>
                  {/* Lesson timing */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <label className={labelCls} style={labelStyle}>Lesson timing</label>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {([{ value: 'before', label: 'Before question' }, { value: 'after', label: 'After answer' }] as const).map(({ value, label }) => (
                        <button key={value} type="button" onClick={() => updateConfig({ lessonTiming: value })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.lessonTiming ?? 'after') === value ? accentColor : 'transparent', color: (formConfig.lessonTiming ?? 'after') === value ? '#fff' : FE.muted, boxShadow: (formConfig.lessonTiming ?? 'after') === value ? '0 1px 3px rgba(15,23,42,0.12)' : undefined }}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                  {/* Pass mark */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Pass mark</label>
                      <span className="text-xs font-semibold" style={{ color: accentColor }}>{formConfig.passmark ?? 50}%</span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {[50, 60, 70, 80].map(pct => (
                        <button key={pct} type="button" onClick={() => updateConfig({ passmark: pct })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.passmark ?? 50) === pct ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' } : { background: 'transparent', color: FE.muted }}
                        >{pct}%</button>
                      ))}
                    </div>
                  </div>
                  {/* Timer */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Time limit</label>
                      <span className="text-xs font-semibold" style={{ color: FE.muted }}>{formConfig.courseTimer ? `${formConfig.courseTimer} min` : 'None'}</span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {[0, 5, 10, 15, 20, 30, 45, 60].map(t => (
                        <button key={t} type="button" onClick={() => updateConfig({ courseTimer: t || undefined })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.courseTimer ?? 0) === t ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' } : { background: 'transparent', color: FE.muted }}
                        >{t === 0 ? 'None' : `${t}m`}</button>
                      ))}
                    </div>
                  </div>
                  {/* Max attempts */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: FE.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Max attempts</label>
                      <span className="text-xs font-semibold" style={{ color: FE.muted }}>{formConfig.maxAttempts ? formConfig.maxAttempts : 'Unlimited'}</span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                      {[0, 1, 2, 3, 5].map(n => (
                        <button key={n} type="button" onClick={() => updateConfig({ maxAttempts: n || undefined })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.maxAttempts ?? 0) === n ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' } : { background: 'transparent', color: FE.muted }}
                        >{n === 0 ? '∞' : n}</button>
                      ))}
                    </div>
                    <p className="text-[10px]" style={{ color: FE.faint }}>Tracked per email address via submission records.</p>
                  </div>
              </div>
            )}

            {/* Curriculum section */}
            {activeSection === 'curriculum' && formConfig.isCourse && (
              <div className={studioPanelClass} style={studioPanelStyle}>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course curriculum</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Shape the learning journey, add lessons, and create practice activities.</p>
                </div>
                <div className="space-y-3">
                  <div className="p-3 rounded-xl space-y-3" style={{ background: FE.card }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>AI Course Builder</label>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: FE.faint }}>
                          Generate questions and learning outcomes from a topic, then refine each question with AI.
                        </p>
                      </div>
                      <div className="px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ background: `${accentColor}18`, color: accentColor }}>
                        AI
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setAiError(''); setAiPromptModalOpen(true); }}
                        disabled={!!aiLoadingLabel}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                        style={{ background: accentColor, color: 'white' }}
                      >
                        {aiLoadingLabel === 'Generating questions...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Generate Questions
                      </button>
                      <button
                        type="button"
                        onClick={generateOutcomes}
                        disabled={!!aiLoadingLabel}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                        style={{ background: FE.pill, color: FE.text, border: `1px solid ${FE.inputBorder}` }}
                      >
                        {aiLoadingLabel === 'Generating learning outcomes...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                        Generate Outcomes
                      </button>
                    </div>

                    {aiError && <p className="text-[11px]" style={{ color: '#ef4444' }}>{aiError}</p>}
                    {!aiError && aiSuccess && <p className="text-[11px]" style={{ color: '#10b981' }}>{aiSuccess}</p>}

                    {!!formConfig.learnOutcomes?.length && (
                      <div className="space-y-2 pt-1" style={{ borderTop: `1px solid ${FE.divider}` }}>
                        <div className="flex items-center justify-between">
                          <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Learning outcomes</label>
                          <button
                            type="button"
                            onClick={() => updateConfig({ learnOutcomes: [...(formConfig.learnOutcomes || []), ''] })}
                            className="text-[10px] font-medium transition-colors hover:opacity-70"
                            style={{ color: accentColor }}
                          >
                            Add outcome
                          </button>
                        </div>
                        {(formConfig.learnOutcomes || []).map((outcome, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={outcome}
                              onChange={e => {
                                const next = [...(formConfig.learnOutcomes || [])];
                                next[idx] = e.target.value;
                                updateConfig({ learnOutcomes: next });
                              }}
                              className={`${inputCls} py-1.5 flex-1`}
                              style={inputStyle}
                              placeholder={`Outcome ${idx + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => updateConfig({ learnOutcomes: (formConfig.learnOutcomes || []).filter((_, i) => i !== idx) })}
                              className="transition-colors hover:text-red-400"
                              style={{ color: FE.faint }}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleQuestionDragStart} onDragEnd={handleQuestionDragEnd}>
                    <SortableContext items={(formConfig.questions ?? []).map(q => q.id)} strategy={verticalListSortingStrategy}>
                  {formConfig.questions?.map((q, qIdx) => {
                    const qType: QuestionType = q.type ?? 'multiple_choice';
                    const isExpanded = expandedQuestions.has(q.id);

                    const insertDivider = (
                      <div key={`insert-${q.id}`} className="group relative flex items-center justify-center gap-1.5 h-5 my-0.5">
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px transition-colors" style={{ background: FE.divider }} />
                        <button
                          type="button"
                          onClick={() => setPickerCtx({ mode: 'insert', afterIndex: qIdx })}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: accentColor, color: 'white', zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Add
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSectionAt(qIdx)}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: FE.pill, color: FE.muted, border: `1px solid ${FE.cardBorder}`, zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Section
                        </button>
                      </div>
                    );

                    // -- Section divider card --
                    if (q.isSection) {
                      return (
                        <React.Fragment key={q.id}>
                        <SortableQuestionShell id={q.id}>
                          {({ dragHandle }) => (
                          <div className="rounded-xl overflow-hidden" style={{ background: FE.card, border: `1px solid ${accentColor}40`, borderLeft: `3px solid ${accentColor}` }}>
                            <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                              {dragHandle}
                              <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left">
                                <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>
                                  {q.sectionTitle || 'Section'}
                                </span>
                              </button>
                              <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                                className="p-1 rounded transition-colors hover:bg-red-500/10">
                                <X className="w-3.5 h-3.5 text-red-400" />
                              </button>
                              <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: FE.faint }}>
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            {isExpanded && (
                            <div className="px-3.5 py-3 space-y-2">
                              <input
                                value={q.sectionTitle || ''}
                                onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, sectionTitle: e.target.value } : qq) })}
                                placeholder="Section title…"
                                className={`${inputCls} font-semibold`}
                                style={inputStyle}
                              />
                              <input
                                value={q.sectionDescription || ''}
                                onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, sectionDescription: e.target.value } : qq) })}
                                placeholder="Optional description…"
                                className={inputCls}
                                style={inputStyle}
                              />
                            </div>
                            )}
                          </div>
                          )}
                        </SortableQuestionShell>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    // -- LinkedIn share block card --
                    // Keep in sync with the identical card in app/create/page.tsx: create and edit
                    // are two separate editors.
                    if (q.isLinkedInShare) {
                      const patch = (changes: Partial<CourseQuestion>) =>
                        updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, ...changes } : qq) });
                      const required = q.linkedInShareRequired === true;

                      return (
                        <React.Fragment key={q.id}>
                        <SortableQuestionShell id={q.id}>
                          {({ dragHandle }) => (
                        <div className="rounded-xl overflow-hidden" style={{ background: FE.card, border: `1px solid #0A66C240`, borderLeft: '3px solid #0A66C2' }}>
                          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                            {dragHandle}
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left">
                              <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5" style={{ color: '#0A66C2' }}>
                                <LinkedInIcon className="w-3 h-3" /> {q.linkedInShareTitle || 'LinkedIn Share'}
                              </span>
                            </button>
                            <LockToggle
                              locked={!!q.lockUntilPrevious}
                              onToggle={() => patch({ lockUntilPrevious: !q.lockUntilPrevious })}
                              accentColor={accentColor}
                            />
                            <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                              className="p-1 rounded transition-colors hover:bg-red-500/10">
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: FE.faint }}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {isExpanded && <div className="px-3.5 py-3 space-y-3">
                            <input
                              value={q.linkedInShareTitle || ''}
                              onChange={e => patch({ linkedInShareTitle: e.target.value })}
                              placeholder="Slide title e.g. Share your certificate on LinkedIn"
                              className={`${inputCls} font-semibold`}
                              style={inputStyle}
                            />
                            <RichTextEditor
                              value={q.linkedInShareDescription || ''}
                              onChange={html => patch({ linkedInShareDescription: html })}
                              placeholder="Tell students what to post and why it helps them..."
                              enableAiAssist
                            />
                            {/* Suggested caption the student can copy straight into LinkedIn. */}
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold tracking-widest uppercase" style={{ color: FE.faint }}>
                                Suggested post text
                              </label>
                              <textarea
                                value={q.linkedInSharePrompt || ''}
                                onChange={e => patch({ linkedInSharePrompt: e.target.value })}
                                placeholder="Optional. Students can copy this as a starting point for their post."
                                rows={4}
                                className={inputCls}
                                style={inputStyle}
                              />
                            </div>
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold tracking-widest uppercase" style={{ color: FE.faint }}>
                                  Bonus XP (max {MAX_LINKEDIN_SHARE_POINTS})
                                </label>
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
                              <button
                                type="button"
                                onClick={() => patch({ linkedInShareRequired: !required })}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all"
                                style={required
                                  ? { background: accentColor, color: 'white' }
                                  : { background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                              >
                                {required ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                                {required ? 'Required to continue' : 'Optional'}
                              </button>
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
                        <div className="rounded-xl overflow-hidden" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                            {dragHandle}
                            <span className="w-8 h-8 inline-flex flex-shrink-0 items-center justify-center rounded-lg" style={{ color: accentColor, background: `${accentColor}15` }}><Download className="w-4 h-4" /></span>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 min-w-0 text-left">
                              <span className="text-xs font-semibold truncate block" style={{ color: FE.text }}>{q.downloadsTitle || 'Downloads'}</span>
                              <span className="text-[9px]" style={{ color: FE.faint }}>{dlItems.length} resource{dlItems.length === 1 ? '' : 's'}</span>
                            </button>
                            <LockToggle
                              locked={!!q.lockUntilPrevious}
                              onToggle={() => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, lockUntilPrevious: !qq.lockUntilPrevious } : qq) })}
                              accentColor={accentColor}
                            />
                            <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                              className="p-1 rounded transition-colors hover:bg-red-500/10">
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: FE.faint }}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {isExpanded && <div className="px-3.5 py-3 space-y-3">
                            <input
                              value={q.downloadsTitle || ''}
                              onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsTitle: e.target.value } : qq) })}
                              placeholder="Section title e.g. Course Materials"
                              className={`${inputCls} font-semibold`}
                              style={inputStyle}
                            />
                            <RichTextEditor
                              value={q.downloadsDescription || ''}
                              onChange={html => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsDescription: html } : qq) })}
                              placeholder="Describe what students will find here..."
                              enableAiAssist
                            />
                            {dlItems.length > 0 ? (
                              <div className="space-y-2 pt-1">
                                {dlItems.map((item, itemIdx) => (
                                  <div key={item.id} className="rounded-xl p-3 space-y-2.5" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="w-7 h-7 inline-flex flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold" style={{ color: accentColor, background: `${accentColor}15` }}>{itemIdx + 1}</span>
                                        <div className="flex items-center gap-1">
                                        {(['file', 'link'] as const).map(t => (
                                          <button key={t} type="button"
                                            onClick={() => updateItems(dlItems.map(it => it.id === item.id ? { ...it, type: t } : it))}
                                            className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize transition-all"
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
                                    <input
                                      value={item.title}
                                      onChange={e => updateItems(dlItems.map(it => it.id === item.id ? { ...it, title: e.target.value } : it))}
                                      placeholder={item.type === 'file' ? 'File name or label...' : 'Link label...'}
                                      className={inputCls}
                                      style={inputStyle}
                                    />
                                    <RichTextEditor
                                      value={item.description || ''}
                                      onChange={html => updateItems(dlItems.map(it => it.id === item.id ? { ...it, description: html } : it))}
                                      placeholder="Short description (optional)..."
                                      enableAiAssist
                                    />
                                    {item.type === 'file' ? (
                                      item.fileUrl ? (
                                        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}30` }}>
                                          <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
                                          <span className="text-xs flex-1 truncate" style={{ color: FE.text }}>{item.fileName || 'Uploaded file'}{item.pdfPages ? ` · inline preview (${item.pdfPages}p)` : ''}</span>
                                          <button type="button" onClick={() => { deleteUploadedFile(item.fileUrl); updateItems(dlItems.map(it => it.id === item.id ? { ...it, fileUrl: '', fileName: '', pdfPages: undefined } : it)); }} className="text-red-400 text-[10px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
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
                                            <span className="w-7 h-7 inline-flex items-center justify-center rounded-lg" style={{ color: accentColor, background: `${accentColor}15` }}><Upload className="w-3.5 h-3.5" /></span> Upload file <span className="text-[9px]" style={{ color: FE.faint }}>Max 20 MB</span>
                                          </div>
                                        </label>
                                      )
                                    ) : (
                                      <input
                                        value={item.linkUrl || ''}
                                        onChange={e => updateItems(dlItems.map(it => it.id === item.id ? { ...it, linkUrl: e.target.value } : it))}
                                        placeholder="https://..."
                                        className={inputCls}
                                        style={inputStyle}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: FE.groupBg, border: `1px dashed ${FE.inputBorder}` }}>
                                <span className="w-9 h-9 inline-flex items-center justify-center rounded-lg" style={{ color: accentColor, background: `${accentColor}15` }}><Download className="w-4 h-4" /></span>
                                <div><p className="text-xs font-semibold" style={{ color: FE.text }}>Add the first resource</p><p className="text-[9px]" style={{ color: FE.faint }}>Upload a file or link to an external resource.</p></div>
                              </div>
                            )}
                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'file' }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all hover:opacity-80"
                                style={{ background: `${accentColor}12`, color: accentColor }}>
                                <Upload className="w-3 h-3" /> Add File
                              </button>
                              <button type="button" onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'link' }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all hover:opacity-80"
                                style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                                <Link2 className="w-3 h-3" /> Add Link
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
                      <div className="rounded-xl overflow-hidden" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                        <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${FE.divider}` : 'none' }}>
                          {dragHandle}
                          <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left min-w-0">
                            <span className="text-xs font-medium truncate block" style={{ color: FE.faint }}>
                              {q.lessonOnly
                                ? (q.lesson?.title || 'Untitled lesson')
                                : `Q${qIdx + 1}${q.question ? ` · ${q.question}` : ''}`}
                            </span>
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPickerCtx({ mode: 'change', qId: q.id })}
                              className="flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 transition-opacity hover:opacity-70 cursor-pointer"
                              style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}
                            >
                              {TYPE_LABELS[qType] ?? qType}
                              <ChevronDown className="w-3 h-3 ml-0.5 flex-shrink-0" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateQuestion(q.id, {
                                lessonOnly: !q.lessonOnly,
                                ...(!q.lessonOnly && !q.lesson ? { lesson: { title: '', body: '', imageUrl: '', videoUrl: '' } } : {}),
                              })}
                              title="Lesson only (no question)"
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
                              style={q.lessonOnly ? { background: accentColor, color: 'white' } : { background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.faint }}
                            >
                              <BookOpen className="w-3 h-3" /> Lesson only
                            </button>
                            <LockToggle
                              locked={!!q.lockUntilPrevious}
                              onToggle={() => handleUpdateQuestion(q.id, { lockUntilPrevious: !q.lockUntilPrevious })}
                              accentColor={accentColor}
                            />
                            <button type="button" onClick={() => handleRemoveQuestion(q.id)} className="p-1 transition-colors hover:text-red-400" style={{ color: FE.faint }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: FE.faint }}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && <div className="p-3.5 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {!q.lessonOnly && ['multiple_choice', 'code'].includes(qType) && (<>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_distractors')}
                              disabled={!!aiLoadingLabel}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                              style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                            >
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating distractors...' ? 'Generating...' : 'AI Distractors'}
                            </button>
                            </>)}
                            <button
                              type="button"
                              onClick={() => setLessonPromptModal({ q })}
                              disabled={!!aiLoadingLabel}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                              style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                            >
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating lesson...' ? 'Generating…' : 'AI Lesson'}
                            </button>
                            {!q.lessonOnly && !(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (<>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_hint')}
                              disabled={!!aiLoadingLabel}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                              style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                            >
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating hint...' ? 'Generating...' : 'AI Hint'}
                            </button>
                            <button
                              type="button"
                              onClick={() => generateQuestionAsset(q, 'generate_explanation')}
                              disabled={!!aiLoadingLabel}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
                              style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.text }}
                            >
                              {busyQuestionId === q.id && aiLoadingLabel === 'Generating explanation...' ? 'Generating...' : 'AI Explanation'}
                            </button>
                            </>)}
                          </div>
                          {!q.lessonOnly && (<>

                          {/* Question text -- hidden for review types; they use the project brief field inside the config panel */}
                          {!(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (
                          <div>
                            <label className={labelCls} style={labelStyle}>Question</label>
                            <input type="text" value={q.question} onChange={e => handleUpdateQuestion(q.id, { question: e.target.value })} className={inputCls} style={inputStyle}
                              placeholder={qType === 'fill_blank' ? 'e.g. The capital of France is ___' : 'Enter your question...'} />
                            {qType === 'fill_blank' && (
                              <div className="mt-2 rounded-lg px-3 py-2" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: FE.faint }}>Learner preview</span>
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
                                <div className="flex items-center gap-2.5">
                                  <span className="flex items-center gap-1.5" aria-hidden="true">
                                    <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                                    <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
                                    <span className="relative w-2 h-2 rounded-full bg-[#28c840]"><span className="absolute inset-0 rounded-full bg-[#28c840] animate-ping motion-reduce:animate-none opacity-35" /></span>
                                  </span>
                                  <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: FE.muted }}>Code snippet</span>
                                </div>
                                <select value={q.codeLanguage || 'javascript'} onChange={e => handleUpdateQuestion(q.id, { codeLanguage: e.target.value })}
                                  className="rounded-md border-0 px-2 py-1 text-[10px] font-mono outline-none" style={{ background: FE.input, color: FE.text }}>
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
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Image options</label>
                                <span className="text-[9px] font-semibold" style={{ color: FE.faint }}>Choose the correct image</span>
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
                                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                                            <button type="button" onClick={() => setOptionImageLibrary({ qId: q.id, optionIdx: optIdx })}
                                              className="rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] font-semibold flex items-center gap-1" style={{ color: '#111' }}>
                                              <Images className="w-3 h-3" /> Change
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const newImages = [...(q.optionImages || q.options.map(() => ''))];
                                                newImages[optIdx] = '';
                                                handleUpdateQuestion(q.id, { optionImages: newImages });
                                              }}
                                              className="rounded-lg bg-black/40 px-2.5 py-1.5 text-red-300 text-[10px] font-semibold flex items-center gap-1"
                                            >
                                              <Trash2 className="w-3 h-3" /> Remove
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button type="button" className="block w-full cursor-pointer" onClick={() => setOptionImageLibrary({ qId: q.id, optionIdx: optIdx })}>
                                          <div className="aspect-[16/10] w-full flex flex-col items-center justify-center gap-1.5 text-[10px] font-semibold transition-colors hover:opacity-70" style={{ color: FE.faint }}>
                                            <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ color: accentColor, background: `${accentColor}14` }}><Images className="w-4 h-4" /></span>
                                            Choose image
                                            <span className="text-[8px] font-medium" style={{ color: FE.faint }}>Library · Pexels · Upload</span>
                                          </div>
                                        </button>
                                      )}
                                      <div className="flex items-center gap-2 px-2 py-2" style={{ borderTop: `1px solid ${FE.divider}` }}>
                                        <button type="button" onClick={() => handleUpdateQuestion(q.id, { correctAnswer: opt })}
                                          aria-label={`Mark image option ${optIdx + 1} as correct`} aria-pressed={isCorrectOption}
                                          className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-[10px] font-bold"
                                          style={{ color: isCorrectOption ? '#fff' : FE.faint, background: isCorrectOption ? accentColor : FE.pill }}>
                                          {isCorrectOption ? <Check className="w-3.5 h-3.5" /> : optIdx + 1}
                                        </button>
                                        <span className="text-[10px] font-semibold" style={{ color: isCorrectOption ? FE.text : FE.faint }}>Option {optIdx + 1}</span>
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
                              }} className="text-xs transition-colors inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add option
                              </button>
                            </div>
                          )}

                          {(qType === 'multiple_choice' || qType === 'code') && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Answer options</label>
                                <span className="text-[9px] font-semibold" style={{ color: FE.faint }}>Select the correct answer</span>
                              </div>
                              {q.options.map((opt, optIdx) => (
                                <div key={optIdx} className="flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors"
                                  style={{ background: q.correctAnswer === opt ? `${accentColor}10` : FE.groupBg, border: `1px solid ${q.correctAnswer === opt ? `${accentColor}55` : FE.inputBorder}` }}>
                                  <button type="button" onClick={() => handleUpdateQuestion(q.id, { correctAnswer: opt })}
                                    aria-label={`Mark option ${optIdx + 1} as correct`} aria-pressed={q.correctAnswer === opt}
                                    className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-[10px] font-bold transition-all"
                                    style={{ color: q.correctAnswer === opt ? '#fff' : FE.faint, background: q.correctAnswer === opt ? accentColor : FE.pill }}>
                                    {q.correctAnswer === opt ? <Check className="w-3.5 h-3.5" /> : optIdx + 1}
                                  </button>
                                  <input type="text" value={opt}
                                    onChange={e => {
                                      const newOpts = [...q.options]; newOpts[optIdx] = e.target.value;
                                      const u: Partial<CourseQuestion> = { options: newOpts };
                                      if (q.correctAnswer === opt) u.correctAnswer = e.target.value;
                                      handleUpdateQuestion(q.id, u);
                                    }}
                                    className={`${inputCls} py-1.5 flex-1`} style={{ ...inputStyle, background: 'transparent', border: 'none', paddingLeft: 2 }} />
                                  {q.options.length > 2 && (
                                    <button type="button" onClick={() => {
                                      const newOpts = q.options.filter((_, i) => i !== optIdx);
                                      const u: Partial<CourseQuestion> = { options: newOpts };
                                      if (q.correctAnswer === opt) u.correctAnswer = newOpts[0] ?? '';
                                      handleUpdateQuestion(q.id, u);
                                    }} className="transition-colors flex-shrink-0 hover:text-red-400" style={{ color: FE.faint }}>
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button type="button" onClick={() => {
                                const newOpts = [...q.options, `Option ${q.options.length + 1}`];
                                handleUpdateQuestion(q.id, { options: newOpts });
                              }} className="text-xs transition-colors inline-flex items-center gap-1.5 mt-1 rounded-lg px-2.5 py-1.5 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add answer option
                              </button>
                            </div>
                          )}

                          {qType === 'fill_blank' && (
                            <div className="rounded-xl p-3 space-y-2.5" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                              <div className="flex items-center gap-2">
                                <span className="w-8 h-8 inline-flex items-center justify-center rounded-lg" style={{ color: accentColor, background: `${accentColor}16` }}><PenLine className="w-4 h-4" /></span>
                                <div><p className="text-xs font-semibold" style={{ color: FE.text }}>Accepted answers</p><p className="text-[9px]" style={{ color: FE.faint }}>Learners can enter any answer separated by |</p></div>
                              </div>
                              <input type="text" value={q.correctAnswer}
                                onChange={e => handleUpdateQuestion(q.id, { correctAnswer: e.target.value })}
                                className={inputCls} style={inputStyle} placeholder="e.g. Paris" />
                              {q.correctAnswer.trim() && (
                                <div className="flex flex-wrap gap-1.5">
                                  {q.correctAnswer.split('|').map(answer => answer.trim()).filter(Boolean).map((answer, answerIdx) => (
                                    <span key={`${answer}-${answerIdx}`} className="rounded-md px-2 py-1 text-[9px] font-semibold" style={{ color: accentColor, background: `${accentColor}12` }}>{answer}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {qType === 'arrange' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <label className={labelCls} style={labelStyle}>Correct sequence</label>
                                <span className="text-[9px] font-semibold" style={{ color: FE.faint }}>Top item appears first</span>
                              </div>
                              {q.options.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: FE.groupBg, border: `1px solid ${FE.inputBorder}` }}>
                                  <span className="w-7 h-7 inline-flex flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold" style={{ color: accentColor, background: `${accentColor}15` }}>{itemIdx + 1}</span>
                                  <input type="text" value={item}
                                    onChange={e => {
                                      const newOpts = [...q.options]; newOpts[itemIdx] = e.target.value;
                                      handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                    }}
                                    className={`${inputCls} py-1.5 flex-1`} style={{ ...inputStyle, background: 'transparent', border: 'none', paddingLeft: 2 }} />
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
                              }} className="text-xs transition-colors inline-flex items-center gap-1.5 mt-1 rounded-lg px-2.5 py-1.5 hover:opacity-70" style={{ color: FE.muted, background: FE.pill }}>
                                <Plus className="w-3 h-3" /> Add item
                              </button>
                            </div>
                          )}

                          {/* AI Review config */}
                          {(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'] as const).includes(qType as any) && (
                            <div className="space-y-3 rounded-xl p-3" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                              <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>
                                {qType === 'code_review' ? 'Code Review' : qType === 'excel_review' ? 'Excel Review' : qType === 'dashboard_critique' ? 'Dashboard Critique' : qType === 'written_response' ? 'Written Response' : 'Document Review'} Config
                              </p>

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
                                    className={`${inputCls} py-1.5`}
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
                                    className={`${inputCls} w-24`}
                                    style={inputStyle}
                                  />
                                </div>
                              </>)}

                              {qType === 'document_review' && (
                                <div>
                                  <label className={labelCls} style={labelStyle}>Review mode</label>
                                  <select
                                    value={(q as any).documentReviewMode || 'ai_only'}
                                    onChange={e => handleUpdateQuestion(q.id, { documentReviewMode: e.target.value as any })}
                                    className={`${inputCls} py-1.5`}
                                    style={inputStyle}
                                  >
                                    <option value="ai_only">AI Only -- AI reviews and auto-grades</option>
                                    <option value="manual">Manual -- Instructor reviews and grades</option>
                                    <option value="hybrid">Hybrid -- AI reviews, instructor can override grade</option>
                                  </select>
                                </div>
                              )}

                              <div>
                                <label className={labelCls} style={labelStyle}>Rubric criteria</label>
                                <div className="mb-2">
                                  {(() => { const key = `${q.id}:reference_solution`; const busy = extractingRubric === key; return (
                                    <>
                                      <input type="file" accept=".xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.docx"
                                        style={{ display: 'none' }}
                                        ref={el => { rubricFileRefs.current[key] = el; }}
                                        onChange={e => handleExtractRubric(q.id, 'reference_solution', e)}
                                      />
                                      <button type="button" disabled={!!extractingRubric}
                                        onClick={() => rubricFileRefs.current[key]?.click()}
                                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity"
                                        style={{ background: FE.pill, color: FE.muted, opacity: extractingRubric && !busy ? 0.5 : 1, cursor: extractingRubric ? 'not-allowed' : 'pointer' }}>
                                        {busy ? <><Loader2 className="w-3 h-3 animate-spin"/> Extracting...</> : <><Upload className="w-3 h-3"/> Upload Reference Solution</>}
                                      </button>
                                    </>
                                  ); })()}
                                </div>
                                <p className="text-xs mb-2" style={{ color: FE.faint }}>Upload the completed reference file to auto-extract rubric criteria.</p>
                                <div className="space-y-1.5">
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
                                        className={`${inputCls} py-1.5 flex-1`}
                                        style={inputStyle}
                                        placeholder={`Criterion ${cIdx + 1}`}
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
                                  <label className={labelCls} style={labelStyle}>Minimum passing score (%)</label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={q.minScore ?? 70}
                                    onChange={e => handleUpdateQuestion(q.id, { minScore: Number(e.target.value) })}
                                    className={`${inputCls} w-24`}
                                    style={inputStyle}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {qType === 'sql_exercise' && (
                            <div className="space-y-3 rounded-xl p-3" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                              <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>SQL Exercise Config</p>
                              <div>
                                <label className={labelCls} style={labelStyle}>Student task</label>
                                <AiTextarea value={q.question} onValueChange={value => handleUpdateQuestion(q.id, { question: value })} className={`${inputCls} min-h-[72px] resize-y`} style={inputStyle} placeholder="Ask the student to write a query..." />
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className={labelCls} style={labelStyle}>Tables</label>
                                  <button type="button" onClick={() => handleUpdateQuestion(q.id, { sqlTables: [...(q.sqlTables ?? []), { id: Math.random().toString(36).slice(2, 9), tableName: 'table_name', fileName: '', fileUrl: '', csvUrl: '' }] })} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: FE.pill, color: FE.muted }}>
                                    <Plus className="w-3 h-3 inline mr-1" /> Add table
                                  </button>
                                </div>
                                {(q.sqlTables ?? []).map((table, tableIdx) => (
                                  <div key={table.id ?? tableIdx} className="grid gap-2 rounded-lg p-2" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                                    <div className="flex gap-2">
                                      <input value={table.tableName} onChange={e => {
                                        const tables = [...(q.sqlTables ?? [])];
                                        tables[tableIdx] = { ...table, tableName: e.target.value };
                                        handleUpdateQuestion(q.id, { sqlTables: tables });
                                      }} className={`${inputCls} flex-1 py-1.5`} style={inputStyle} placeholder="orders" />
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
                                              className="px-2.5 py-1.5 text-xs font-semibold"
                                              style={{ background: active ? accentColor : FE.pill, color: active ? 'white' : FE.muted }}
                                            >
                                              {mode === 'upload' ? 'Upload' : 'Seed SQL'}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: FE.pill, color: FE.muted }}>
                                        <Upload className="w-3 h-3" /> Upload CSV/XLSX
                                        <input type="file" className="hidden" accept=".csv,.tsv,.xlsx" onChange={e => handleSqlDatasetUpload(q.id, table.id ?? String(tableIdx), e)} />
                                      </label>
                                      <span className="text-xs truncate" style={{ color: FE.faint }}>{table.fileName || table.fileUrl || 'No file uploaded'}</span>
                                    </div>
                                    {table.seedSql?.trim() || (!table.fileUrl && !table.csvUrl && !table.fileName) ? (
                                      <div>
                                        <label className={labelCls} style={labelStyle}>CREATE TABLE / INSERT seed SQL</label>
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
                                  <button type="button" onClick={() => computeSqlExpectedResult(q.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: 'white' }}>Compute expected result</button>
                                  <span className="text-xs" style={{ color: q.sqlExpectedResult ? '#10b981' : FE.faint }}>{q.sqlExpectedResult ? `${q.sqlExpectedResult.rows.length} expected row(s) saved` : 'Expected result not computed'}</span>
                                </div>
                              </div>
                              <div className="grid sm:grid-cols-2 gap-2">
                                <label className="flex items-center gap-2 text-xs" style={{ color: FE.muted }}>
                                  <input type="checkbox" checked={!!q.sqlResultOrdered} onChange={e => handleUpdateQuestion(q.id, { sqlResultOrdered: e.target.checked })} />
                                  Require row order
                                </label>
                                <input type="number" value={q.sqlNumericTolerance ?? 0} onChange={e => handleUpdateQuestion(q.id, { sqlNumericTolerance: Number(e.target.value) })} className={`${inputCls} py-1.5`} style={inputStyle} placeholder="Numeric tolerance" />
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
                                <label className={labelCls} style={labelStyle}>Hints</label>
                                <AiTextarea value={(q.sqlHints ?? []).join('\n')} onValueChange={value => handleUpdateQuestion(q.id, { sqlHints: value.split('\n').map(s => s.trim()).filter(Boolean) })} className={`${inputCls} min-h-[70px] resize-y`} style={inputStyle} placeholder="One hint per line" />
                              </div>
                            </div>
                          )}

                          {qType === 'python_exercise' && (
                            <div className="space-y-3 rounded-xl p-3" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                              <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>Python Exercise Config</p>
                              <div>
                                <label className={labelCls} style={labelStyle}>Student task</label>
                                <RichTextEditor value={q.question} onChange={html => handleUpdateQuestion(q.id, { question: html })} placeholder="Ask the student to write a Python script..." enableAiAssist />
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className={labelCls} style={labelStyle}>Datasets</label>
                                  <button type="button" onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: [...(q.pythonDatasets ?? []), { id: Math.random().toString(36).slice(2, 9), variableName: 'df', fileName: '', fileUrl: '', csvUrl: '' }] })} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: FE.pill, color: FE.muted }}>
                                    <Plus className="w-3 h-3 inline mr-1" /> Add dataset
                                  </button>
                                </div>
                                {(q.pythonDatasets ?? []).map((ds, dsIdx) => (
                                  <div key={ds.id} className="grid gap-2 rounded-lg p-2" style={{ background: FE.card, border: `1px solid ${FE.cardBorder}` }}>
                                    <div className="flex gap-2">
                                      <input value={ds.variableName} onChange={e => { const datasets = [...(q.pythonDatasets ?? [])]; datasets[dsIdx] = { ...ds, variableName: e.target.value }; handleUpdateQuestion(q.id, { pythonDatasets: datasets }); }} className={`${inputCls} flex-1 py-1.5 font-mono`} style={inputStyle} placeholder="df" />
                                      <button type="button" onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: (q.pythonDatasets ?? []).filter((_, i) => i !== dsIdx) })} className="px-2 rounded-lg hover:text-red-400" style={{ color: FE.faint }}>
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: FE.pill, color: FE.muted }}>
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
                                  <button type="button" onClick={() => computePythonExpectedOutput(q.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: 'white' }}>Compute expected output</button>
                                  <span className="text-xs" style={{ color: q.pythonExpectedOutput ? '#10b981' : FE.faint }}>{q.pythonExpectedOutput ? 'Expected output saved' : 'Expected output not computed'}</span>
                                </div>
                                {q.pythonExpectedOutput && (
                                  <pre className="mt-2 p-2 rounded-lg text-xs font-mono whitespace-pre-wrap" style={{ background: '#1e1e2e', color: '#cdd6f4' }}>{q.pythonExpectedOutput}</pre>
                                )}
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Hints</label>
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
                              const lessonOpen = !!(q.lesson && !closedLessons.has(q.id));
                              return (<>
                            <button
                              type="button"
                              onClick={() => {
                                if (lessonOpen) {
                                  setClosedLessons(prev => new Set([...prev, q.id]));
                                } else {
                                  setClosedLessons(prev => { const next = new Set(prev); next.delete(q.id); return next; });
                                  if (!q.lesson) handleUpdateQuestion(q.id, { lesson: { title: '', body: '', imageUrl: '', videoUrl: '' } });
                                }
                              }}
                              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium transition-colors hover:opacity-70"
                              style={{ color: FE.muted }}
                            >
                              <span className="flex items-center gap-1.5">
                                <BookOpen className="w-3.5 h-3.5" />
                                Lesson <span style={{ color: FE.faint }}>(optional)</span>
                              </span>
                              {lessonOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            {lessonOpen && q.lesson && (
                              <div className="px-3 py-3 space-y-2" style={{ borderTop: `1px solid ${FE.divider}` }}>
                                <input
                                  type="text"
                                  value={q.lesson.title || ''}
                                  onChange={e => handleUpdateQuestion(q.id, { lesson: { ...q.lesson, title: e.target.value } })}
                                  className={inputCls}
                                  style={inputStyle}
                                  placeholder="Lesson title (optional)..."
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
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setLessonImageQId(q.id)}
                                        className="text-[10px] font-medium flex items-center gap-1 bg-white/90 px-2 py-1 rounded-lg"
                                        style={{ color: '#111' }}
                                      >
                                        <ImageIcon className="w-3 h-3" /> Change
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { deleteUploadedFile(q.lesson?.imageUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, imageUrl: '' } }); }}
                                        className="text-red-400 text-[10px] font-medium flex items-center gap-1 bg-white/80 px-2 py-1 rounded-lg"
                                      >
                                        <Trash2 className="w-3 h-3" /> Remove
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" className="block w-full" onClick={() => setLessonImageQId(q.id)}>
                                    <div className="w-full h-10 flex items-center justify-center gap-1.5 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
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
                                  <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: '#f59e0b15', border: '1px solid #f59e0b30' }}>
                                    <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                                    <span className="text-xs flex-1 truncate" style={{ color: FE.text }}>
                                      {q.lesson.pdfName || 'PDF'}{q.lesson.pdfPages ? ` · ${q.lesson.pdfPages} page${q.lesson.pdfPages > 1 ? 's' : ''}` : ''}
                                    </span>
                                    <button type="button" onClick={() => { deleteUploadedFile(q.lesson?.pdfUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, pdfUrl: '', pdfName: '', pdfPages: undefined } }); }} className="text-red-400 text-[10px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
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
                                    <div className="w-full h-10 flex items-center justify-center gap-1.5 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
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
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70 flex-shrink-0"
                                    style={{ background: '#FF6B35', color: 'white' }}
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
                                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
                                      <FileCode className="w-3.5 h-3.5"/> HTML
                                    </div>
                                  </label>
                                </div>
                                {(() => {
                                  const vurl = q.lesson.videoUrl || '';
                                  const embedUrl = safeEmbedUrl(vurl);
                                  return embedUrl ? (
                                    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${FE.cardBorder}` }}>
                                      <iframe src={embedUrl} className={isHtmlEmbedUrl(embedUrl) ? 'w-full' : 'w-full aspect-video'} style={isHtmlEmbedUrl(embedUrl) ? { height: 480 } : undefined} sandbox={isHtmlEmbedUrl(embedUrl) ? 'allow-scripts allow-popups' : undefined} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
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
                                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: FE.groupBg, color: FE.muted }}>
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
                                    <button type="button" onClick={() => { deleteUploadedFile(q.lesson?.audioUrl); handleUpdateQuestion(q.id, { lesson: { ...q.lesson, audioUrl: '', audioName: '' } }); }} className="text-red-400 text-[10px] font-medium hover:opacity-70 flex-shrink-0">Remove</button>
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
                  })}
                    </SortableContext>
                    <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
                      {activeQuestionId ? (() => {
                        const aq = formConfig.questions?.find(q => q.id === activeQuestionId);
                        if (!aq) return null;
                        return (
                          <div style={{ background: FE.card, border: `1.5px solid ${accentColor}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: `0 16px 40px rgba(0,0,0,0.25)`, cursor: 'grabbing', transform: 'rotate(1deg) scale(1.02)' }}>
                            <GripVertical className="w-3.5 h-3.5" style={{ color: accentColor }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: FE.text, flex: 1 }}>{aq.isSection ? (aq.sectionTitle || 'Section') : (aq.question || 'Untitled question')}</span>
                          </div>
                        );
                      })() : null}
                    </DragOverlay>
                  </DndContext>
                  {(!formConfig.questions || formConfig.questions.length === 0) && <p className="text-xs text-center py-3" style={{ color: FE.faint }}>No questions yet.</p>}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPickerCtx({ mode: 'bottom' })}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all flex-1 hover:opacity-80"
                      style={{ background: accentColor, color: 'white' }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Content
                    </button>
                    <button type="button" onClick={handleAddSection} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all flex-shrink-0 hover:opacity-80" style={{ background: FE.pill, border: `1px solid ${FE.inputBorder}`, color: FE.muted }}>
                      <Plus className="w-3.5 h-3.5" /> Section
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'fields' && !formConfig.isCourse && (
              <div className="space-y-2">
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
                            <span style={{ fontSize: 13, fontWeight: 600, color: FE.text, flex: 1 }}>{field.label || 'Untitled field'}</span>
                            <span style={{ fontSize: 10, fontWeight: 500, color: FE.faint, textTransform: 'uppercase', letterSpacing: '0.06em', background: FE.pill, padding: '2px 7px', borderRadius: 5 }}>{field.type}</span>
                          </div>
                        );
                      })() : null}
                    </DragOverlay>
                  </DndContext>

                  {formConfig.fields.length === 0 && <p className="text-xs text-center py-3" style={{ color: FE.faint }}>No fields yet.</p>}

                  <div className="pt-3 space-y-2.5 mt-2" style={{ borderTop: `1px solid ${FE.divider}` }}>
                    <p className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: FE.faint }}>Add Field</p>
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
                        <div className="grid grid-cols-2 gap-1.5">
                          {SOCIAL_PLATFORMS.map(p => (
                            <label key={p.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors" style={{ background: newSocialPlatforms.includes(p.id) ? `${accentColor}18` : FE.input, border: `1px solid ${newSocialPlatforms.includes(p.id) ? accentColor : FE.inputBorder}`, color: newSocialPlatforms.includes(p.id) ? accentColor : FE.muted }}>
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

                    <button type="button" onClick={handleAddField} disabled={newFieldType !== 'description' && !newFieldLabel.trim()} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80" style={{ background: accentColor, color: 'white' }}>
                      <Plus className="w-4 h-4" /> {newFieldType === 'description' ? 'Add Description Block' : 'Add Field'}
                    </button>
                  </div>
                </div>
            )}

            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Points &amp; rewards</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Use XP, streaks, and milestones to recognize meaningful progress.</p>
                </div>
                {/* Enable toggle */}
                <div className="flex items-center justify-between rounded-xl p-4" style={{ background: formConfig.pointsSystem?.enabled ? `${accentColor}0e` : FE.groupBg, border: `1px solid ${formConfig.pointsSystem?.enabled ? `${accentColor}40` : FE.groupBorder}` }}>
                  <div>
                    <p className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Enable points system</p>
                    <p className="text-[10px] mt-0.5" style={{ color: FE.faint }}>Gamify your course with XP, streaks &amp; rewards</p>
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
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Base points per question</label>
                        <span className="text-xs font-semibold" style={{ color: accentColor }}>{formConfig.pointsSystem?.basePoints ?? 100} pts</span>
                      </div>
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                        {[50, 100, 200, 500].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, basePoints: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.basePoints ?? 100) === n ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' } : { background: 'transparent', color: FE.muted }}
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
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <label className={labelCls} style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>Within (seconds)</label>
                            <input type="number" min="3" max="60"
                              value={formConfig.pointsSystem?.timeBonusSeconds ?? 10}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusSeconds: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`}
                              style={inputStyle}
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className={labelCls} style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>Multiplier</label>
                            <select
                              value={formConfig.pointsSystem?.timeBonusMultiplier ?? 1.5}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusMultiplier: Number(e.target.value) } })}
                              className={`${inputCls} w-24 py-1.5`}
                              style={inputStyle}
                            >
                              {[1.2, 1.5, 2.0, 3.0].map(m => <option key={m} value={m}>{m}x</option>)}
                            </select>
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
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <label className={labelCls} style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>Trigger after N correct</label>
                            <input type="number" min="2" max="10"
                              value={formConfig.pointsSystem?.streakCount ?? 3}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakCount: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`}
                              style={inputStyle}
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className={labelCls} style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>Bonus points</label>
                            <input type="number" min="10" max="500"
                              value={formConfig.pointsSystem?.streakBonus ?? 50}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakBonus: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`}
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
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                        {[10, 20, 50, 100].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, hintPenalty: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.hintPenalty ?? 20) === n
                              ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' }
                              : { background: 'transparent', color: FE.muted }}
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
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: FE.groupBg }}>
                        {[10, 20, 30, 50].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, solutionPenalty: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.solutionPenalty ?? 30) === n
                              ? { background: accentColor, color: 'white', boxShadow: '0 1px 3px rgba(15,23,42,0.12)' }
                              : { background: 'transparent', color: FE.muted }}
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
                            <span className="text-xs font-semibold" style={{ color: accentColor }}>{m.points} pts</span>
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
                            className={`${inputCls} py-1.5`}
                            style={inputStyle}
                          />
                          <input type="text" placeholder="Label (e.g. SQL Cheat Sheet)"
                            value={m.label}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], label: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`}
                            style={inputStyle}
                          />
                          <input type="text" placeholder="Description (e.g. Downloadable cheat sheet)"
                            value={m.description}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], description: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`}
                            style={inputStyle}
                          />
                          <input type="url" placeholder="Reward URL (optional)"
                            value={m.rewardUrl ?? ''}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], rewardUrl: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`}
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
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs transition-colors"
                        style={{ borderColor: FE.groupBorder, color: FE.muted }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add milestone
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {((formConfig.isCourse && activeStudioMode.id === 'publish') || (!formConfig.isCourse && activeSection === 'submission')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-3'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 1 } : undefined}>
                {formConfig.isCourse && <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Completion experience</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: FE.faint }}>Choose what learners see and where they can go after finishing.</p>
                </div>}
                {/* Type selector */}
                <div>
                  <label className={labelCls} style={labelStyle}>What happens after submission</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { value: 'default', label: 'Thank you', description: 'Show the standard completion screen', Icon: CheckCircle2 },
                      { value: 'redirect', label: 'Redirect URL', description: 'Send learners to another page', Icon: ExternalLink },
                      { value: 'button', label: 'CTA Button', description: 'Offer one clear next action', Icon: ArrowUpRight },
                      { value: 'events', label: 'Show Events', description: 'Recommend related experiences', Icon: CalendarDays },
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
                        <span><span className="block text-xs font-bold" style={{ color: (formConfig.postSubmission?.type ?? 'default') === value ? accentColor : FE.text }}>{label}</span><span className="mt-1 block text-[10px] leading-snug" style={{ color: FE.faint }}>{description}</span></span>
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
                    <p className="text-[10px] mt-1" style={{ color: FE.faint }}>Users will be automatically redirected after submitting.</p>
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
                    <label className={labelCls} style={labelStyle}>Select forms/events to show</label>
                    {availableForms.length === 0 ? (
                      <p className="text-[11px] py-2" style={{ color: FE.faint }}>No other forms found.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                        {availableForms.map(f => {
                          const selected = (formConfig.postSubmission?.relatedEventIds || []).includes(f.id);
                          return (
                            <label key={f.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors" style={{ background: FE.groupBg, border: `1px solid ${FE.groupBorder}` }}>
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
                              <span className="text-xs truncate" style={{ color: FE.text }}>{(f as any).config?.title || f.title || f.slug}</span>
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

            </div>
            </div>

          </motion.div>
          </AnimatePresence>
          </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {pickerCtx && (
          <QuestionTypePicker
            key="qtype-picker"
            onSelect={handlePickerSelect}
            onClose={() => setPickerCtx(null)}
            includeDownloads={pickerCtx.mode !== 'change'}
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
                      className={`${inputCls} py-1.5`}
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
                      className={`${inputCls} py-1.5`}
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
                      className={`${inputCls} py-1.5`}
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
                      className={`${inputCls} py-1.5`}
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
            className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-xl w-[calc(100%-2rem)] max-h-[45vh] overflow-auto rounded-2xl px-4 py-3.5 flex items-start gap-3"
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
                <button type="button" onClick={() => setLessonPromptModal(null)} className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10">
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
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
                        <span className="text-[10px]" style={{ color: FE.faint }}>{col.videoCount} videos</span>
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
                              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(0,0,0,0.75)', color: 'white' }}>
                                {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                              </span>
                            )}
                          </div>
                          <div className="px-2.5 py-2">
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
