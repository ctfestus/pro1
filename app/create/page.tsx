'use client';

import React, { useState, useEffect, useRef } from 'react';
import { safeEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Loader2, Check,
  Plus, Trash2, Image as ImageIcon, Sun, Moon,
  LayoutDashboard, Save, X, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Share2,
  Video, BookOpen, Search, Zap, Settings, Upload,
  Download, Link2, FileText, Database, ArrowLeft, Lock, LockOpen,
  Clock, Users, Globe, Repeat, Code2, RefreshCw, Music, FileCode, Monitor, CheckCircle2, Blocks,
} from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { ThemeColor, ThemeMode } from '@/components/AnimatedField';
import type {
  FieldType, FormField, QuestionType, DownloadItem, CourseQuestion,
  Speaker, EventDetails, PostSubmission, PointsMilestone, PointsSystem, FormConfig,
} from '@/lib/course-schema';
import { pointsSystemFromCourseRow, newLinkedInShareSlide, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';
import { useC } from '@/components/create/theme';
import { SocialIcon, FIELD_TYPE_LABELS, TEMPLATES, SOCIAL_PLATFORMS, Toggle, SwitchToggle, inputCls, labelCls } from '@/components/create/shared';
import { SortableFieldCard } from '@/components/create/SortableFieldCard';
import { FormPreview } from '@/components/create/FormPreview';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AiTextarea } from '@/components/AiTextarea';
import { LessonEditor } from '@/components/lesson/LessonEditor';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { lessonHtmlToDoc } from '@/components/lesson/extensions';
import { QuestionTypePicker, TYPE_LABELS } from '@/components/create/QuestionTypePicker';
import type { QuestionTypeOrDownloads } from '@/components/create/QuestionTypePicker';

// Convert AI-generated question lessons (HTML body) into canonical interactive docs
// so full course generation produces doc-canonical lessons, matching the per-lesson
// generate_lesson flow. Body is kept as the lossy fallback. Runs client-side.
function attachQuestionLessonDocs(questions: any[]): any[] {
  return (questions || []).map((q: any) => {
    if (!q?.lesson?.body || q.lesson.doc) return q;
    try { return { ...q, lesson: { ...q.lesson, doc: lessonHtmlToDoc(q.lesson.body) } }; }
    catch { return q; } // keep body-only if the HTML cannot be parsed
  });
}
import { getFontById } from '@/lib/fonts';
import { FontPickerModal } from '@/components/FontPickerModal';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary, uploadToCloudinaryWithMeta, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/uploadToCloudinary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { deleteUploadedFile } from '@/lib/storage-cleanup';
import { ImageLibrary } from '@/components/ImageLibrary';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { isPdfFile } from '@/lib/cloudinary-pdf';
import { executeQuery, initSQLRuntime } from '@/lib/sql-engine';
import { initPythonRuntime, loadPythonDatasets, runPython } from '@/lib/python-engine';
import { formatSQLPreflightIssue, preflightSQLExercises } from '@/lib/sql-exercise-preflight';
import { formatPythonPreflightIssue, preflightPythonExercises } from '@/lib/python-exercise-preflight';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';

// --- Types: the content contract is canonical in lib/course-schema (imported above) ---

// --- Constants ---
const COURSE_CATEGORIES = ['Excel', 'Power BI', 'SQL', 'Tableau', 'AI'] as const;


const themeAccentColors: Record<ThemeColor, string> = {
  forest:  '#00bf63',
  lime:    '#ADEE66',
  emerald: '#10b981',
  rose:    '#f43f5e',
  amber:   '#f59e0b',
  ocean:   '#3E93FF',
};


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



// --- Main Page ---
export default function Page() {
  const C = useC();
  const { toggle: toggleTheme, theme } = useTheme();
  const { logoUrl, logoDarkUrl, accentColor: brandAccent } = useTenant();
  // Calm blue accent for wizard selections / CTAs (less loud than the brand amber).
  const ctaBg     = '#3E93FF';
  const ctaFg     = '#ffffff';
  const ctaBorder = 'none';
  const router = useRouter();
  const inputStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };
  const labelStyle = { color: C.faint };
  const wizardPanelStyle = {
    background: C.card,
    border: theme === 'dark' ? `1px solid ${C.inputBorder}` : `1px solid ${C.cardBorder}`,
    boxShadow: theme === 'dark' ? 'none' : '0 18px 50px rgba(15, 23, 42, 0.06)',
  };
  const wizardSoftStyle = {
    background: C.groupBg,
    border: `1px solid ${C.inputBorder}`,
  };
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(true); // stays true until useEffect resolves
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
const [isSaving, setIsSaving] = useState(false);
  const [savingAs, setSavingAs] = useState<'draft' | 'published' | null>(null);
  const [formStatus, setFormStatus] = useState<'draft' | 'published'>('published');
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info'; persistent?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error', options?: { persistent?: boolean }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, persistent: options?.persistent });
    toastTimer.current = options?.persistent ? null : setTimeout(() => setToast(null), 5000);
  };
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [savedFormId, setSavedFormId] = useState<string | null>(null);
  const [showCoverLibrary, setShowCoverLibrary] = useState(false);
  const [lessonImageQId, setLessonImageQId] = useState<string | null>(null);
  const [customSlug, setCustomSlug] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  // Add-field state
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(true);
  const [newSocialPlatforms, setNewSocialPlatforms] = useState<string[]>(['linkedin', 'twitter']);
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const toggleQuestion = (id: string) => setExpandedQuestions(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [newQuestionType, setNewQuestionType] = useState<QuestionType | 'downloads'>('multiple_choice');
  const [pickerCtx, setPickerCtx] = useState<
    | { mode: 'bottom' }
    | { mode: 'insert'; afterIndex: number }
    | { mode: 'change'; qId: string }
    | null
  >(null);
  const [learnOutcomeInput, setLearnOutcomeInput] = useState('');
  const [aiTopic, setAiTopic] = useState('');
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [aiQuestionType, setAiQuestionType] = useState<'multiple_choice' | 'fill_blank' | 'arrange' | 'sql_exercise' | 'python_exercise'>('multiple_choice');
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
  // SQL Course AI Wizard
  const [sqlWizardStep, setSqlWizardStep] = useState<null | 'brief' | 'outline'>(null);
  const [sqlBrief, setSqlBrief] = useState({ title: '', industry: 'Finance', role: '', level: 'Beginner', promptText: '' });
  const [sqlOutline, setSqlOutline] = useState<any | null>(null);
  const [sqlModuleLoading, setSqlModuleLoading] = useState<number | null>(null);
  const [sqlExpandedTables, setSqlExpandedTables] = useState<Set<number>>(new Set());
  // Python Course AI Wizard
  const [pyWizardStep, setPyWizardStep] = useState<null | 'brief' | 'outline'>(null);
  const [pyBrief, setPyBrief] = useState({ title: '', industry: 'Finance', role: '', level: 'Beginner', focus: 'Data Analysis', promptText: '' });
  const [pyOutline, setPyOutline] = useState<any | null>(null);
  const [pyModuleLoading, setPyModuleLoading] = useState<number | null>(null);
  // Document -> Course AI Wizard
  const [docWizardStep, setDocWizardStep] = useState<null | 'input' | 'outline'>(null);
  const [docBrief, setDocBrief] = useState<{ title: string; audience: string; level: string; goal: string; focus: string; depth: 'primer' | 'balanced' | 'comprehensive'; practice: 'hands_on' | 'balanced' | 'knowledge'; tone: 'professional' | 'conversational' | 'academic'; imageMode: string[]; includeVideos: boolean; preferredChannels: string }>({ title: '', audience: '', level: 'Beginner', goal: '', focus: '', depth: 'balanced', practice: 'balanced', tone: 'professional', imageMode: ['source', 'stock'], includeVideos: true, preferredChannels: '' });
  const [docSourceMethod, setDocSourceMethod] = useState<'file' | 'text' | 'url'>('file');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docText, setDocText] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docExtract, setDocExtract] = useState<{ sourceText: string; pdfUrl?: string; pageCount?: number } | null>(null);
  const [docOutline, setDocOutline] = useState<any | null>(null);
  const [docModuleLoading, setDocModuleLoading] = useState<number | null>(null);
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const [lessonPrompts, setLessonPrompts] = useState<Record<string, string>>({});
  const [lessonPromptModal, setLessonPromptModal] = useState<{ q: CourseQuestion } | null>(null);
  const [closedLessons, setClosedLessons] = useState<Set<string>>(new Set());
  // Bunny video picker
  const [bunnyPickerOpen, setBunnyPickerOpen] = useState(false);
  const [bunnyPickerQId, setBunnyPickerQId] = useState<string | null>(null);
  const [bunnyVideos, setBunnyVideos] = useState<any[]>([]);
  const [bunnyCollections, setBunnyCollections] = useState<any[]>([]);
  const [bunnyCollection, setBunnyCollection] = useState('');
  const [bunnyLoading, setBunnyLoading] = useState(false);
  const [bunnySearch, setBunnySearch] = useState('');
  const [bunnyError, setBunnyError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [extractingRubric, setExtractingRubric] = useState<string | null>(null); // `${questionId}:${label}`
  const rubricFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [activeSection, setActiveSection] = useState<string>('info');
  const [secDir, setSecDir] = useState(1); // carousel slide direction: 1 = forward, -1 = back
  const goToSection = (id: string, ids: string[]) => {
    setSecDir(ids.indexOf(id) >= ids.indexOf(activeSection) ? 1 : -1);
    setActiveSection(id);
  };
  const [availableForms, setAvailableForms] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [courseAvailableToEveryone, setCourseAvailableToEveryone] = useState(false);
  const toggleCohort = (id: string) => {
    if (formConfig?.isCourse) setCourseAvailableToEveryone(false);
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const badgeInputRef = useRef<HTMLInputElement>(null);
  const [uploadingBadge, setUploadingBadge] = useState(false);

  const handleBadgeImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert('File size exceeds 20MB limit.'); return; }
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


  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return; }

      // Role guard -- instructors/admins can create all content; staff can create events.
      const { data: studentProfile } = await supabase
        .from('students')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!studentProfile || !['instructor', 'admin', 'staff'].includes(studentProfile.role)) {
        router.replace('/dashboard');
        return;
      }

      setUserRole(studentProfile.role);
      setUser(session.user);

      // cohorts loaded in separate effect below


    });
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!userRole) return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    const editId = params.get('edit');

    if (s) {
      try {
        setFormConfig(JSON.parse(decodeURIComponent(atob(s))));
        setIsSharedView(true);
      } catch (e) { console.error('Invalid shared schema', e); }
      setIsLoadingEdit(false);
    } else if (editId) {
      // Load existing content from purpose-built tables
      Promise.all([
        supabase.from('courses').select('id, title, description, slug, status, cohort_ids, available_to_everyone, questions, fields, passmark, course_timer, learn_outcomes, points_enabled, points_base, points_system, post_submission, cover_image, badge_image_url, deadline_days, theme, mode, font, custom_accent, category, partner_id, show_answers, lesson_timing, max_attempts, ai_tutor_enabled').eq('id', editId).maybeSingle(),
        supabase.from('events').select('id, title, description, slug, status, cohort_ids, fields, event_date, event_time, timezone, location, event_type, capacity, meeting_link, is_private, post_submission, cover_image, deadline_days, theme, mode, font, custom_accent, speakers, recurrence, recurrence_end_date, recurrence_days').eq('id', editId).maybeSingle(),
      ]).then(([{ data: course }, { data: event }]) => {
        let id: string | null = null;
        let config: any = null;
        let slug = '';
        let cohortIds: string[] = [];
        let status = '';

        if (userRole === 'staff' && course) {
          router.replace('/dashboard#events');
          return;
        }

        if (course) {
          id = course.id; slug = course.slug || ''; cohortIds = course.cohort_ids || []; status = course.status;
          setCourseAvailableToEveryone(course.available_to_everyone === true);
          config = { isCourse: true, title: course.title, description: course.description,
            questions: course.questions ?? [], fields: course.fields ?? [],
            passmark: course.passmark, courseTimer: course.course_timer,
            learnOutcomes: course.learn_outcomes,
            showAnswers: course.show_answers ?? undefined,
            lessonTiming: course.lesson_timing ?? undefined,
            enableAiTutor: course.ai_tutor_enabled ?? false,
            maxAttempts: course.max_attempts ?? undefined,
            // Partial by design: see app/[id]/page.tsx -- normalizing to a full
            pointsSystem: pointsSystemFromCourseRow(course),
            postSubmission: course.post_submission,
            coverImage: course.cover_image, badgeImageUrl: course.badge_image_url ?? null,
            deadline_days: course.deadline_days,
            theme: course.theme, mode: course.mode, font: course.font, customAccent: course.custom_accent,
            category: course.category ?? null,
            partnerId: course.partner_id ?? null };
        } else if (event) {
          id = event.id; slug = event.slug || ''; cohortIds = event.cohort_ids || []; status = event.status;
          config = { title: event.title, description: event.description,
            fields: event.fields ?? [],
            eventDetails: { isEvent: true, date: event.event_date, time: event.event_time,
              timezone: event.timezone, location: event.location, eventType: event.event_type,
              capacity: event.capacity, meetingLink: event.meeting_link, isPrivate: event.is_private,
              speakers: event.speakers ?? [],
              recurrence: event.recurrence ?? 'once',
              recurrenceEndDate: event.recurrence_end_date ?? '',
              recurrenceDays: event.recurrence_days ?? [] },
            postSubmission: event.post_submission, coverImage: event.cover_image,
            deadline_days: event.deadline_days, theme: event.theme, mode: event.mode,
            font: event.font, customAccent: event.custom_accent };
        }

        if (id && config) { setFormConfig(config); setSavedFormId(id); setCustomSlug(slug); setSelectedCohortIds(cohortIds); if (status === 'draft' || status === 'published') setFormStatus(status); }
        setIsLoadingEdit(false);
      });
    } else {
      const type = params.get('type');
      if (userRole === 'staff' && type && type !== 'event') {
        router.replace('/create?type=event');
        return;
      }
      if (type === 'sql-course') {
        setSqlWizardStep('brief');
      } else if (type === 'python-course') {
        setPyWizardStep('brief');
      } else if (type === 'doc-course') {
        setDocWizardStep('input');
      } else if (type) {
        const match = TEMPLATES.find(t => t.key === type);
        if (match) setFormConfig({ ...match.config });
      }
      setIsLoadingEdit(false);
    }
  }, [router, userRole]);

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name').then(({ data }) => {
      if (data) setCohorts(data);
    });
    supabase.from('partners').select('id, name, is_active').order('name').then(({ data }) => {
      if (data) setPartners(data);
    });
  }, []);

  useEffect(() => {
    if (formConfig?.postSubmission?.type !== 'events') return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const [{ data: events }, { data: courses }] = await Promise.all([
        supabase.from('events').select('id, title, slug, cover_image').eq('user_id', session.user.id).order('created_at', { ascending: false }),
        supabase.from('courses').select('id, title, slug, cover_image').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      ]);
      const all = [
        ...(events ?? []).map((e: any) => ({ ...e, _type: 'event', config: { title: e.title, coverImage: e.cover_image } })),
        ...(courses ?? []).map((c: any) => ({ ...c, _type: 'course', config: { title: c.title, coverImage: c.cover_image } })),
      ].filter(f => f.id !== savedFormId);
      setAvailableForms(all);
    })();
  }, [formConfig?.postSubmission?.type, savedFormId]);

  const prepareSqlExpectedResultsForSave = async (config: FormConfig, requireComplete: boolean): Promise<FormConfig | null> => {
    if (!config.isCourse) return config;
    const questions = config.questions ?? [];
    if (!questions.some(q => q.type === 'sql_exercise')) return config;

    try {
      showToast('Checking SQL exercises...', 'info');
      const preflight = await preflightSQLExercises(questions, { requireComplete });
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

  const preparePythonExpectedOutputsForSave = async (config: FormConfig, requireComplete: boolean): Promise<FormConfig | null> => {
    if (!config.isCourse) return config;
    const questions = config.questions ?? [];
    if (!questions.some(q => q.type === 'python_exercise')) return config;

    try {
      showToast('Checking Python exercises...', 'info');
      const preflight = await preflightPythonExercises(questions, { requireComplete });
      if (preflight.issues.length) {
        showToast(`Python warning: ${formatPythonPreflightIssue(preflight.issues[0])}`, requireComplete ? 'error' : 'info', { persistent: true });
        if (requireComplete) return null;
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
      showToast(err?.message || 'Could not validate Python exercises before saving.', requireComplete ? 'error' : 'info', { persistent: true });
      return requireComplete ? null : config;
    }
  };

  // -- Supabase save/share --
  const handleShare = async (saveStatus: 'draft' | 'published' = 'published') => {
    if (!formConfig) return;
    if (!user) { showToast('Please sign in to save and share your work.', 'info'); window.location.href = '/auth'; return; }
    if (userRole === 'staff' && !formConfig.eventDetails?.isEvent) {
      showToast('Staff can only create and edit live sessions.', 'error');
      return;
    }
    setIsSaving(true);
    setSavingAs(saveStatus);
    try {
      let configToSave = await prepareSqlExpectedResultsForSave(formConfig, saveStatus === 'published');
      if (!configToSave) { setIsSaving(false); setSavingAs(null); return; }
      configToSave = await preparePythonExpectedOutputsForSave(configToSave, saveStatus === 'published');
      if (!configToSave) { setIsSaving(false); setSavingAs(null); return; }
      let formId = savedFormId;
      // Use custom slug if provided, otherwise auto-generate a 5-char alphanumeric slug
      const shortSlug = () => Math.random().toString(36).slice(2, 7);
      const slugValue = customSlug.trim() || shortSlug();

      if (!formId) {
        // Create via API -- server enforces plan limits via DB trigger
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            title: configToSave.title,
            description: configToSave.description,
            config: configToSave,
            slug: slugValue,
            cohort_ids: selectedCohortIds,
            ...(configToSave.isCourse ? { available_to_everyone: courseAvailableToEveryone } : {}),
            deadline_days: configToSave.deadline_days ?? null,
            status: saveStatus,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error ?? 'Failed to save form.');
          setIsSaving(false);
          setSavingAs(null);
          return;
        }
        formId = data.id; setSavedFormId(formId);
        setFormStatus(data.status ?? saveStatus);
        if (!customSlug.trim()) setCustomSlug(data.slug);
        // Always redirect to the detail page after the first save
        router.push(`/dashboard/${formId}?tab=settings`);
        return;
      } else {
        // Fetch current cohort_ids/status to detect newly added cohorts and first publish
        const { data: { session: fetchSession } } = await supabase.auth.getSession();
        const [{ data: existingCourse }, { data: existingEvent }] = await Promise.all([
          supabase.from('courses').select('cohort_ids, status').eq('id', formId!).maybeSingle(),
          supabase.from('events').select('cohort_ids, status').eq('id', formId!).maybeSingle(),
        ]);
        const existingForm = existingCourse ?? existingEvent;
        const patchRes = await fetch('/api/forms', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fetchSession?.access_token}` },
          body: JSON.stringify({ id: formId, title: configToSave.title, description: configToSave.description, config: configToSave, slug: slugValue, cohort_ids: selectedCohortIds, ...(configToSave.isCourse ? { available_to_everyone: courseAvailableToEveryone } : {}), status: saveStatus }),
        });
        const patchData = await patchRes.json();
        const error = patchRes.ok ? null : patchData;
        if (!error) setFormStatus(saveStatus);
        if (error) { if (patchRes.status === 409 || error.error?.includes('slug')) { showToast('This URL slug is already taken. Try a different one.'); setIsSaving(false); return; } throw new Error(error.error ?? 'Update failed'); }
        if (patchData.registrationWarning) showToast(patchData.registrationWarning);
        // Re-index via authenticated proxy -- secret stays server-side
        if (saveStatus === 'published') {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session?.access_token) return;
            fetch('/api/vector/trigger-index', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body:    JSON.stringify({ formId }),
            }).catch(() => {});
          });
        }
        const { data: { session: editSession } } = await supabase.auth.getSession();
        // For events, PUT /api/forms handles cohort sync + auto-registration in one place.
        // Only call /api/cohort-assignments for non-event content (courses, VEs).
        if (!existingEvent) {
          const oldCohortIds: string[] = Array.isArray(existingForm?.cohort_ids) ? existingForm.cohort_ids : [];
          const isFirstPublish = existingForm?.status !== 'published' && saveStatus === 'published';
          const addedCohortIds = selectedCohortIds.filter((id: string) => !oldCohortIds.includes(id));
          const notifyCohortIds = isFirstPublish ? selectedCohortIds : addedCohortIds;
          const caRes = await fetch('/api/cohort-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editSession?.access_token}` },
            body: JSON.stringify({ formId, cohortIds: selectedCohortIds, newCohortIds: notifyCohortIds }),
          });
          if (!caRes.ok) {
            const caErr = await caRes.json().catch(() => ({}));
            showToast(caErr.error || 'Saved, but notification emails failed to send.');
          }
        }
      }
      const url = `${window.location.origin}/${slugValue}`;
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
        else throw new Error('');
      } catch {
        window.prompt('Copy your form link:', url);
      }
      setPreviewKey(k => k + 1);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      console.error('Failed to save form', e);
      showToast('Failed to save. Please check your connection and try again.');
    } finally { setIsSaving(false); setSavingAs(null); }
  };

  // -- Template selection --
  const handleSelectTemplate = (template: typeof TEMPLATES[number]) => {
    if (userRole === 'staff' && template.key !== 'event' && template.key !== 'webinar') {
      showToast('Staff can only create live sessions.', 'error');
      return;
    }
    setFormConfig(template.config);
    setIsSuccess(false);
    setSavedFormId(null);
    setCustomSlug('');
  };


  const handleGenerateSqlOutline = async () => {
    if (!sqlBrief.title.trim()) { showToast('Please enter a course title.', 'error'); return; }
    setAiLoadingLabel('Building your SQL course outline...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'generate_sql_course_outline', ...sqlBrief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate outline.');
      setSqlOutline(data);
      setSqlBrief(prev => ({ ...prev, title: data.courseTitle || prev.title }));
      setSqlWizardStep('outline');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed to generate outline. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  const handleRegenerateSqlModule = async (modIdx: number) => {
    if (!sqlOutline) return;
    setSqlModuleLoading(modIdx);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'generate_sql_course_outline',
          ...sqlBrief,
          moduleIndex: modIdx,
          existingOutline: sqlOutline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate module.');
      setSqlOutline((prev: any) => ({
        ...prev,
        modules: prev.modules.map((m: any, i: number) => i === modIdx ? data.module ?? m : m),
      }));
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate module.', 'error');
    } finally {
      setSqlModuleLoading(null);
    }
  };

  const handleGenerateSqlFullCourse = async () => {
    if (!sqlOutline) return;
    setAiLoadingLabel('Generating SQL exercises...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'generate_sql_course_full',
          outline: sqlOutline,
          title: sqlBrief.title,
          industry: sqlBrief.industry,
          role: sqlBrief.role,
          level: sqlBrief.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate course.');
      setFormConfig({
        title: data.title || sqlBrief.title,
        description: data.description || '',
        isCourse: true,
        coverImage: '',
        theme: 'forest',
        mode: 'dark',
        font: 'google-sans-text',
        fields: [],
        questions: attachQuestionLessonDocs(data.questions || []),
        learnOutcomes: data.learnOutcomes || [],
      });
      setSqlWizardStep(null);
      // Keep sqlOutline so the user can return to it from the editor
      showToast('SQL course generated! Review and publish when ready.', 'success');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed to generate course. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  // -- Python Course AI Wizard handlers --
  const handleGeneratePythonOutline = async () => {
    if (!pyBrief.title.trim()) { showToast('Please enter a course title.', 'error'); return; }
    setAiLoadingLabel('Generating Python course outline...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'generate_python_course_outline', ...pyBrief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate outline.');
      setPyOutline(data);
      setPyWizardStep('outline');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  const handleGeneratePythonFullCourse = async () => {
    if (!pyOutline) return;
    setAiLoadingLabel('Generating Python exercises...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'generate_python_course_full',
          outline: pyOutline,
          title: pyBrief.title,
          industry: pyBrief.industry,
          role: pyBrief.role,
          level: pyBrief.level,
          focus: pyBrief.focus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate course.');
      setFormConfig({
        title: data.title || pyBrief.title,
        description: data.description || '',
        isCourse: true,
        coverImage: '',
        theme: 'forest',
        mode: 'dark',
        font: 'google-sans-text',
        fields: [],
        questions: attachQuestionLessonDocs(data.questions || []),
        learnOutcomes: data.learnOutcomes || [],
      });
      setPyWizardStep(null);
      showToast('Python course generated! Review and publish when ready.', 'success');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed to generate course. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  // -- Document -> Course wizard --
  const handleGenerateDocOutline = async () => {
    if (docSourceMethod === 'file' && !docFile) { showToast('Please choose a document to upload.', 'error'); return; }
    if (docSourceMethod === 'text' && !docText.trim()) { showToast('Please paste some content.', 'error'); return; }
    if (docSourceMethod === 'url' && !docUrl.trim()) { showToast('Please enter a URL.', 'error'); return; }

    setAiLoadingLabel('Reading your document...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // 1. Extract source content
      let extractRes: Response;
      if (docSourceMethod === 'file') {
        const fd = new FormData();
        fd.append('file', docFile!);
        extractRes = await fetch('/api/doc-course/extract', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
      } else {
        extractRes = await fetch('/api/doc-course/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(docSourceMethod === 'text' ? { text: docText } : { url: docUrl }),
        });
      }
      const extracted = await extractRes.json();
      if (!extractRes.ok) throw new Error(extracted.error || 'Failed to read the document.');
      setDocExtract(extracted);

      // 2. Generate outline
      setAiLoadingLabel('Designing your course outline...');
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'generate_doc_course_outline',
          sourceText: extracted.sourceText,
          title: docBrief.title,
          audience: docBrief.audience,
          level: docBrief.level,
          goal: docBrief.goal,
          focus: docBrief.focus,
          depth: docBrief.depth,
          practice: docBrief.practice,
          tone: docBrief.tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate outline.');
      setDocOutline(data);
      setDocBrief(prev => ({ ...prev, title: data.courseTitle || prev.title }));
      setDocWizardStep('outline');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed to generate outline. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  const handleRegenerateDocModule = async (modIdx: number) => {
    if (!docOutline || !docExtract) return;
    setDocModuleLoading(modIdx);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'generate_doc_course_outline',
          sourceText: docExtract.sourceText,
          title: docBrief.title,
          audience: docBrief.audience,
          level: docBrief.level,
          goal: docBrief.goal,
          focus: docBrief.focus,
          depth: docBrief.depth,
          practice: docBrief.practice,
          tone: docBrief.tone,
          moduleIndex: modIdx,
          existingOutline: docOutline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate module.');
      setDocOutline((prev: any) => ({
        ...prev,
        modules: prev.modules.map((m: any, i: number) => i === modIdx ? data.module ?? m : m),
      }));
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate module.', 'error');
    } finally {
      setDocModuleLoading(null);
    }
  };

  const handleGenerateDocFullCourse = async () => {
    if (!docOutline || !docExtract) return;
    setAiLoadingLabel('Generating your course...');
    setAiFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'generate_doc_course_full',
          outline: docOutline,
          sourceText: docExtract.sourceText,
          title: docBrief.title,
          audience: docBrief.audience,
          level: docBrief.level,
          goal: docBrief.goal,
          practice: docBrief.practice,
          tone: docBrief.tone,
          pdfUrl: docExtract.pdfUrl ?? '',
          pageCount: docExtract.pageCount ?? 0,
          imageMode: docBrief.imageMode,
          includeVideos: docBrief.includeVideos,
          preferredChannels: docBrief.preferredChannels.split(',').map(c => c.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate course.');
      setFormConfig({
        title: data.title || docBrief.title,
        description: data.description || '',
        isCourse: true,
        coverImage: '',
        theme: 'forest',
        mode: 'dark',
        font: 'google-sans-text',
        fields: [],
        questions: attachQuestionLessonDocs(data.questions || []),
        learnOutcomes: data.learnOutcomes || [],
      });
      setDocWizardStep(null);
      showToast('Course generated! Review and publish when ready.', 'success');
    } catch (err: any) {
      setAiFailed(true);
      showToast(err.message || 'Failed to generate course. Please try again.', 'error');
    } finally {
      setAiLoadingLabel('');
    }
  };

  const handleSubmitForm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise(r => setTimeout(r, 1500));
    setIsSubmitting(false);
    setIsSuccess(true);
  };

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
      setAiSuccess('Done!');
      setTimeout(() => setAiSuccess(''), 2500);
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

  const generateQuestions = async () => {
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
          customPrompt: aiCustomPrompt.trim().slice(0, 800) || undefined,
        }),
      });
      return parseJsonResponse(res);
    });

    if (!data?.questions) return;
    setFormConfig(prev => prev ? {
      ...prev,
      isCourse: true,
      fields: [],
      questions: [...(prev.questions || []), ...data.questions.map(normalizeGeneratedQuestion)],
    } : prev);
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
    // For lesson generation: allow if there's a prompt OR a question; for other actions always need question+answer
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

  // -- Field management --
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

  // -- Course management --
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

  const handleQuestionImageUpload = async (qId: string, e: React.ChangeEvent<HTMLInputElement>, optionIdx?: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image too large. Maximum size is 5MB.'); return; }
    e.target.value = '';
    if (optionIdx === undefined) return;

    const applyUrl = (src: string) => {
      const q = formConfig?.questions?.find(q => q.id === qId);
      if (!q) return;
      const newImages = [...(q.optionImages || q.options.map(() => ''))];
      deleteUploadedFile(newImages[optionIdx]);   // remove the image being replaced
      newImages[optionIdx] = src;
      handleUpdateQuestion(qId, { optionImages: newImages });
    };

    try {
      const publicUrl = await uploadToCloudinary(file, 'course-options');
      applyUrl(publicUrl);
    } catch {
      const reader = new FileReader();
      reader.onload = ev => applyUrl(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
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
      const existing = q?.rubric ?? [];
      handleUpdateQuestion(questionId, { rubric: [...existing, ...incoming] });
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
      // Fetch collections + videos in parallel on first open
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


  // -- Shared view --
  if (isSharedView && formConfig) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6 py-16">
        <FormPreview config={formConfig} isSubmitting={isSubmitting} onSubmit={handleSubmitForm} isSuccess={isSuccess} onReset={() => setIsSuccess(false)} isSharedView={true} />
      </main>
    );
  }

  // -- Loading edit --
  if (isLoadingEdit) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} />
      </main>
    );
  }

  // -- Landing --
  if (!formConfig) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: C.page, color: C.text }}>
        <div className={`relative z-10 flex-1 flex flex-col items-center ${(sqlWizardStep || docWizardStep || pyWizardStep) ? 'justify-start pt-8 sm:pt-12 pb-24' : 'justify-center py-16 sm:py-20'} px-4 sm:px-6 ${(sqlWizardStep === 'outline' || docWizardStep === 'outline' || pyWizardStep === 'outline') ? 'max-w-6xl' : 'max-w-4xl'} mx-auto w-full`}>

          {/* SQL Course Wizard -- Brief step */}
          {sqlWizardStep === 'brief' && (
            <motion.div key="sql-brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-5">
                <button type="button" onClick={() => setSqlWizardStep(null)} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Course types
                </button>
                <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: '#3b82f6' }}>Course Studio</span>
              </div>
              <div className="rounded-[28px] p-6 sm:p-9" style={wizardPanelStyle}>
              <div className="flex items-start gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: '#3b82f618' }}>
                  <Database className="w-5 h-5" style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: '#3b82f6' }}>Build with AI</p>
                  <h2 className="text-2xl font-semibold tracking-tight" style={{ color: C.text }}>Create a SQL course</h2>
                  <p className="text-sm mt-1 max-w-xl" style={{ color: C.muted }}>Set the learning direction. You can review and refine every module before the course is created.</p>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Course Title</label>
                  <input type="text" value={sqlBrief.title} onChange={e => setSqlBrief(p => ({ ...p, title: e.target.value }))} placeholder="e.g. SQL for Financial Analysts" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Industry</label>
                    <select value={sqlBrief.industry} onChange={e => setSqlBrief(p => ({ ...p, industry: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                      {['Finance', 'Healthcare', 'Retail', 'Marketing', 'HR', 'EdTech', 'Logistics', 'Consulting'].map(ind => <option key={ind} value={ind}>{ind}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Skill Level</label>
                    <select value={sqlBrief.level} onChange={e => setSqlBrief(p => ({ ...p, level: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                      {['Beginner', 'Intermediate', 'Advanced'].map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Target Role</label>
                  <input type="text" value={sqlBrief.role} onChange={e => setSqlBrief(p => ({ ...p, role: e.target.value }))} placeholder="e.g. Data Analyst, Business Intelligence Developer" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Specific Focus <span style={{ color: C.faint }}>(optional)</span></label>
                  <AiTextarea value={sqlBrief.promptText} onValueChange={value => setSqlBrief(p => ({ ...p, promptText: value }))} placeholder="Any specific topics, datasets, or skills to focus on..." rows={3} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={inputStyle} />
                </div>
                <button type="button" onClick={handleGenerateSqlOutline} disabled={!!aiLoadingLabel || !sqlBrief.title.trim()} className="flex items-center justify-center gap-2 w-full py-3.5 mt-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-4 h-4" /> Generate Outline
                </button>
              </div>
              </div>
            </motion.div>
          )}

          {/* SQL Course Wizard -- Outline review step */}
          {sqlWizardStep === 'outline' && sqlOutline && (
            <motion.div key="sql-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-12">
              <div className="rounded-[24px] p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4" style={wizardPanelStyle}>
                <button type="button" onClick={() => setSqlWizardStep('brief')} className="w-10 h-10 rounded-xl flex items-center justify-center transition-opacity hover:opacity-60 shrink-0" style={wizardSoftStyle} title="Back to course brief">
                  <ArrowLeft className="w-4 h-4" style={{ color: C.muted }} />
                </button>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: '#3b82f6' }}>Outline ready · Step 2 of 2</p>
                  <h2 className="text-xl font-semibold tracking-tight" style={{ color: C.text }}>Review your SQL course</h2>
                  <p className="text-sm" style={{ color: C.muted }}>Edit titles, lesson types, and the shared dataset before generating.</p>
                </div>
                <button type="button" onClick={handleGenerateSqlFullCourse} disabled={!!aiLoadingLabel} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-3.5 h-3.5" /> Generate Full Course
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Modules -- 2/3 width */}
                <div className="lg:col-span-2 flex flex-col gap-3">
                  {(sqlOutline.modules ?? []).map((mod: any, modIdx: number) => (
                    <div key={mod.id || modIdx} className="rounded-[20px] p-5" style={wizardPanelStyle}>
                      <div className="flex items-start gap-2 mb-1">
                        <span className="text-xs font-bold mt-2 flex-shrink-0" style={{ color: C.faint }}>M{modIdx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <input value={mod.title} onChange={e => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i === modIdx ? { ...m, title: e.target.value } : m) }))} className="w-full text-sm font-semibold bg-transparent border-none outline-none py-1" style={{ color: C.text }} />
                          <input value={mod.description} onChange={e => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i === modIdx ? { ...m, description: e.target.value } : m) }))} className="w-full text-xs bg-transparent border-none outline-none pb-1" style={{ color: C.muted }} />
                        </div>
                        <button type="button" onClick={() => handleRegenerateSqlModule(modIdx)} disabled={sqlModuleLoading !== null} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg flex-shrink-0 transition-opacity disabled:opacity-40" style={{ background: C.pill, color: C.muted }}>
                          {sqlModuleLoading === modIdx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          Regenerate
                        </button>
                        <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.filter((_: any, i: number) => i !== modIdx) }))} className="flex-shrink-0 transition-opacity hover:opacity-70" title="Delete module" style={{ color: C.faint }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5 mt-2 ml-5">
                        {(mod.lessons ?? []).map((lesson: any, lessonIdx: number) => {
                          const typeBg: Record<string, string> = { sql: '#3b82f6', mcq: '#475569', debug: '#d97706', completion: '#16a34a' };
                          const col = typeBg[lesson.questionType] ?? '#475569';
                          return (
                            <div key={lesson.id || lessonIdx} className="flex items-center gap-2 group">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0" style={{ background: col, color: '#fff' }}>{lesson.questionType}</span>
                              <input value={lesson.title} onChange={e => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.map((l: any, li: number) => li === lessonIdx ? { ...l, title: e.target.value } : l) }) }))} className="flex-1 text-xs bg-transparent border-none outline-none" style={{ color: C.text }} />
                              <select value={lesson.questionType} onChange={e => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.map((l: any, li: number) => li === lessonIdx ? { ...l, questionType: e.target.value } : l) }) }))} className="text-[10px] rounded px-1 py-0.5 flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }}>
                                {['sql', 'mcq', 'debug', 'completion'].map(qt => <option key={qt} value={qt}>{qt}</option>)}
                              </select>
                              <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.filter((_: any, li: number) => li !== lessonIdx) }) }))} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: C.faint }}>
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                        <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: [...m.lessons, { id: Math.random().toString(36).slice(2, 9), title: 'New lesson', skillFocus: '', questionType: 'sql', questionSummary: '' }] }) }))} className="flex items-center gap-1 text-xs mt-1 transition-opacity hover:opacity-60" style={{ color: C.faint }}>
                          <Plus className="w-3 h-3" /> Add lesson
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Shared Dataset -- 1/3 width */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-[20px] p-5" style={wizardPanelStyle}>
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-4 h-4" style={{ color: '#3b82f6' }} />
                      <h3 className="text-sm font-semibold" style={{ color: C.text }}>Shared Dataset</h3>
                    </div>
                    <p className="text-xs mb-3" style={{ color: C.muted }}>{sqlOutline.sharedDataset?.description ?? ''}</p>
                    <div className="flex flex-col gap-2">
                      {(sqlOutline.sharedDataset?.tables ?? []).map((table: any, tableIdx: number) => (
                        <div key={tableIdx} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                          <div className="flex items-center gap-2 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <input value={table.tableName} onChange={e => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.map((t: any, i: number) => i === tableIdx ? { ...t, tableName: e.target.value } : t) } }))} className="text-xs font-mono font-semibold bg-transparent border-none outline-none w-full" style={{ color: C.text }} />
                              <input value={table.description} onChange={e => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.map((t: any, i: number) => i === tableIdx ? { ...t, description: e.target.value } : t) } }))} className="text-[10px] bg-transparent border-none outline-none w-full mt-0.5" style={{ color: C.faint }} />
                            </div>
                            <button type="button" onClick={() => setSqlExpandedTables(prev => { const next = new Set(prev); next.has(tableIdx) ? next.delete(tableIdx) : next.add(tableIdx); return next; })} className="flex-shrink-0 transition-opacity hover:opacity-60" style={{ color: C.faint }}>
                              {sqlExpandedTables.has(tableIdx) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.filter((_: any, i: number) => i !== tableIdx) } }))} className="flex-shrink-0 transition-opacity hover:opacity-60 ml-0.5" style={{ color: '#ef4444' }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {sqlExpandedTables.has(tableIdx) && (
                            <AiTextarea value={table.seedSql} onValueChange={value => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.map((t: any, i: number) => i === tableIdx ? { ...t, seedSql: value } : t) } }))} rows={8} className="w-full text-[11px] font-mono px-3 py-2 resize-none border-t outline-none" style={{ background: C.input, borderColor: C.cardBorder, color: C.text }} />
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: [...(prev.sharedDataset?.tables ?? []), { tableName: 'new_table', description: '', seedSql: 'CREATE TABLE new_table (\n  id INTEGER\n);\n' }] } }))} className="flex items-center gap-1 text-xs mt-1 transition-opacity hover:opacity-60" style={{ color: C.faint }}>
                        <Plus className="w-3 h-3" /> Add table
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Document -> Course Wizard -- Input step */}
          {docWizardStep === 'input' && (
            <motion.div key="doc-input" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-5">
                <button type="button" onClick={() => setDocWizardStep(null)} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Course types
                </button>
                <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: brandAccent }}>Course Studio</span>
              </div>
              <div className="rounded-[28px] p-6 sm:p-9" style={wizardPanelStyle}>
              <div className="flex items-start gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${brandAccent}18` }}>
                  <FileText className="w-5 h-5" style={{ color: brandAccent }} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: brandAccent }}>Transform source material</p>
                  <h2 className="text-2xl font-semibold tracking-tight" style={{ color: C.text }}>Create from a document</h2>
                  <p className="text-sm mt-1 max-w-xl" style={{ color: C.muted }}>Turn a file, page, or pasted source into a structured course with lessons and practice.</p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {/* Source method tabs */}
                <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-2xl" style={wizardSoftStyle}>
                  {([
                    { key: 'file', label: 'Upload', icon: Upload },
                    { key: 'text', label: 'Paste text', icon: FileText },
                    { key: 'url',  label: 'Web URL', icon: Link2 },
                  ] as const).map(opt => {
                    const Icon = opt.icon;
                    const active = docSourceMethod === opt.key;
                    return (
                      <button key={opt.key} type="button" onClick={() => setDocSourceMethod(opt.key)} className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all" style={active ? { background: C.card, color: C.text, boxShadow: theme === 'dark' ? 'none' : '0 4px 12px rgba(15,23,42,.08)' } : { background: 'transparent', color: C.muted }}>
                        <Icon className="w-3.5 h-3.5" /> {opt.label}
                      </button>
                    );
                  })}
                </div>

                {docSourceMethod === 'file' && (
                  <label className="flex flex-col items-center justify-center gap-2.5 py-10 rounded-2xl cursor-pointer transition-colors text-center" style={{ background: C.groupBg, border: `1.5px dashed ${docFile ? brandAccent : C.inputBorder}` }}>
                    <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: `${brandAccent}14` }}><Upload className="w-5 h-5" style={{ color: brandAccent }} /></span>
                    <span className="text-sm font-medium" style={{ color: C.text }}>{docFile ? docFile.name : 'Choose a file'}</span>
                    <span className="text-xs" style={{ color: C.faint }}>PDF, DOCX, DOC, TXT, PPTX, PPT (max 20 MB)</span>
                    <input type="file" accept=".pdf,.docx,.doc,.txt,.pptx,.ppt" className="hidden" onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
                  </label>
                )}
                {docSourceMethod === 'text' && (
                  <AiTextarea value={docText} onValueChange={setDocText} placeholder="Paste your documentation, product guide, or notes here..." rows={8} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={inputStyle} />
                )}
                {docSourceMethod === 'url' && (
                  <input type="url" value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="https://docs.example.com/guide" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                )}

                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Course Title <span style={{ color: C.faint }}>(optional)</span></label>
                  <input type="text" value={docBrief.title} onChange={e => setDocBrief(p => ({ ...p, title: e.target.value }))} placeholder="Leave blank to let AI propose one" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Audience <span style={{ color: C.faint }}>(optional)</span></label>
                    <input type="text" value={docBrief.audience} onChange={e => setDocBrief(p => ({ ...p, audience: e.target.value }))} placeholder="e.g. New customers, sales team" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Level</label>
                    <select value={docBrief.level} onChange={e => setDocBrief(p => ({ ...p, level: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                      {['Beginner', 'Intermediate', 'Advanced'].map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Course Goal <span style={{ color: C.faint }}>(what should learners be able to DO?)</span></label>
                  <AiTextarea value={docBrief.goal} onValueChange={value => setDocBrief(p => ({ ...p, goal: value }))} placeholder="e.g. Confidently write SQL queries to answer real business questions" rows={2} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Specific Focus <span style={{ color: C.faint }}>(optional)</span></label>
                  <AiTextarea value={docBrief.focus} onValueChange={value => setDocBrief(p => ({ ...p, focus: value }))} placeholder="Any sections, topics, or angles to emphasize or skip..." rows={2} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Depth</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: 'primer',        label: 'Quick primer' },
                      { key: 'balanced',      label: 'Balanced' },
                      { key: 'comprehensive', label: 'Comprehensive' },
                    ] as const).map(opt => {
                      const active = docBrief.depth === opt.key;
                      return (
                        <button key={opt.key} type="button" onClick={() => setDocBrief(p => ({ ...p, depth: opt.key }))} className="px-3 py-1.5 rounded-full text-xs font-medium transition-all" style={active ? { background: ctaBg, color: ctaFg, border: ctaBorder } : { background: C.pill, color: C.muted }}>
                          {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>How thorough the course should be (controls how many modules and lessons).</p>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Practice Style</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: 'hands_on',  label: 'Hands-on heavy' },
                      { key: 'balanced',  label: 'Balanced' },
                      { key: 'knowledge', label: 'Knowledge checks' },
                    ] as const).map(opt => {
                      const active = docBrief.practice === opt.key;
                      return (
                        <button key={opt.key} type="button" onClick={() => setDocBrief(p => ({ ...p, practice: opt.key }))} className="px-3 py-1.5 rounded-full text-xs font-medium transition-all" style={active ? { background: ctaBg, color: ctaFg, border: ctaBorder } : { background: C.pill, color: C.muted }}>
                          {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>Lean toward applied exercises (SQL, reviews) or quick knowledge checks.</p>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Tone</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: 'professional',  label: 'Professional' },
                      { key: 'conversational', label: 'Conversational' },
                      { key: 'academic',      label: 'Academic' },
                    ] as const).map(opt => {
                      const active = docBrief.tone === opt.key;
                      return (
                        <button key={opt.key} type="button" onClick={() => setDocBrief(p => ({ ...p, tone: opt.key }))} className="px-3 py-1.5 rounded-full text-xs font-medium transition-all" style={active ? { background: ctaBg, color: ctaFg, border: ctaBorder } : { background: C.pill, color: C.muted }}>
                          {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Lesson Images</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: 'source', label: 'From the document' },
                      { key: 'stock',  label: 'Stock photos' },
                    ] as const).map(opt => {
                      const active = docBrief.imageMode.includes(opt.key);
                      return (
                        <button key={opt.key} type="button" onClick={() => setDocBrief(p => ({ ...p, imageMode: active ? p.imageMode.filter(m => m !== opt.key) : [...p.imageMode, opt.key] }))} className="px-3 py-1.5 rounded-full text-xs font-medium transition-all" style={active ? { background: ctaBg, color: ctaFg, border: ctaBorder } : { background: C.pill, color: C.muted }}>
                          {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>Document pages are used for uploaded PDFs; stock photos cover everything else.</p>
                </div>

                {/* Videos */}
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Lesson Videos</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { val: true,  label: 'Include YouTube videos' },
                      { val: false, label: 'No videos' },
                    ] as const).map(opt => {
                      const active = docBrief.includeVideos === opt.val;
                      return (
                        <button key={String(opt.val)} type="button" onClick={() => setDocBrief(p => ({ ...p, includeVideos: opt.val }))} className="px-3 py-1.5 rounded-full text-xs font-medium transition-all" style={active ? { background: ctaBg, color: ctaFg, border: ctaBorder } : { background: C.pill, color: C.muted }}>
                          {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {docBrief.includeVideos && (
                    <div className="mt-2.5">
                      <input type="text" value={docBrief.preferredChannels} onChange={e => setDocBrief(p => ({ ...p, preferredChannels: e.target.value }))} placeholder="Channel name, @handle, or link, comma separated (optional)" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                      <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>e.g. freeCodeCamp, @AlexTheAnalyst, or a channel URL. Videos will be pulled from these channels when they have a relevant match.</p>
                    </div>
                  )}
                </div>

                <button type="button" onClick={handleGenerateDocOutline} disabled={!!aiLoadingLabel} className="flex items-center justify-center gap-2 w-full py-3.5 mt-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-4 h-4" /> Generate Outline
                </button>
              </div>
              </div>
            </motion.div>
          )}

          {/* Document -> Course Wizard -- Outline review step */}
          {docWizardStep === 'outline' && docOutline && (
            <motion.div key="doc-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-5xl mx-auto pb-12">
              <div className="rounded-[24px] p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4" style={wizardPanelStyle}>
                <button type="button" onClick={() => setDocWizardStep('input')} className="w-10 h-10 rounded-xl flex items-center justify-center transition-opacity hover:opacity-60 shrink-0" style={wizardSoftStyle} title="Back to source settings">
                  <ArrowLeft className="w-4 h-4" style={{ color: C.muted }} />
                </button>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: brandAccent }}>Outline ready · Step 2 of 2</p>
                  <h2 className="text-xl font-semibold tracking-tight" style={{ color: C.text }}>Review your document course</h2>
                  <p className="text-sm" style={{ color: C.muted }}>Edit module titles, lesson names, and activity types before generating.</p>
                </div>
                <button type="button" onClick={handleGenerateDocFullCourse} disabled={!!aiLoadingLabel} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-3.5 h-3.5" /> Generate Full Course
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {(docOutline.modules ?? []).map((mod: any, modIdx: number) => (
                  <div key={mod.id || modIdx} className="rounded-[20px] p-5" style={wizardPanelStyle}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className="text-xs font-bold mt-2 flex-shrink-0" style={{ color: C.faint }}>M{modIdx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <input value={mod.title} onChange={e => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i === modIdx ? { ...m, title: e.target.value } : m) }))} className="w-full text-sm font-semibold bg-transparent border-none outline-none py-1" style={{ color: C.text }} />
                        <input value={mod.description} onChange={e => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i === modIdx ? { ...m, description: e.target.value } : m) }))} className="w-full text-xs bg-transparent border-none outline-none pb-1" style={{ color: C.muted }} />
                      </div>
                      <button type="button" onClick={() => handleRegenerateDocModule(modIdx)} disabled={docModuleLoading !== null} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg flex-shrink-0 transition-opacity disabled:opacity-40" style={{ background: C.pill, color: C.muted }}>
                        {docModuleLoading === modIdx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Regenerate
                      </button>
                      <button type="button" onClick={() => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.filter((_: any, i: number) => i !== modIdx) }))} className="flex-shrink-0 transition-opacity hover:opacity-70" title="Delete module" style={{ color: C.faint }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5 mt-2 ml-5">
                      {(mod.lessons ?? []).map((lesson: any, lessonIdx: number) => {
                        const typeBg: Record<string, string> = { multiple_choice: '#475569', fill_blank: '#16a34a', arrange: '#d97706', sql_exercise: '#3b82f6', python_exercise: '#f59e0b', code: '#0ea5e9', code_review: '#0891b2', excel_review: '#15803d', dashboard_critique: '#0d9488', document_review: '#b45309', written_response: '#7c2d12' };
                        const typeLabel: Record<string, string> = { multiple_choice: 'MCQ', fill_blank: 'FILL', arrange: 'ORDER', sql_exercise: 'SQL', python_exercise: 'PYTHON', code: 'CODE', code_review: 'CODE REVIEW', excel_review: 'EXCEL', dashboard_critique: 'DASHBOARD', document_review: 'DOCUMENT', written_response: 'WRITTEN' };
                        const docLessonTypes = ['multiple_choice', 'fill_blank', 'arrange', 'sql_exercise', 'python_exercise', 'code', 'code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];
                        const col = typeBg[lesson.questionType] ?? '#475569';
                        return (
                          <div key={lesson.id || lessonIdx} className="flex items-center gap-2 group">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0" style={{ background: col, color: '#fff' }}>{typeLabel[lesson.questionType] ?? 'MCQ'}</span>
                            <input value={lesson.title} onChange={e => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.map((l: any, li: number) => li === lessonIdx ? { ...l, title: e.target.value } : l) }) }))} className="flex-1 text-xs bg-transparent border-none outline-none" style={{ color: C.text }} />
                            <select value={lesson.questionType} onChange={e => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.map((l: any, li: number) => li === lessonIdx ? { ...l, questionType: e.target.value } : l) }) }))} className="text-[10px] rounded px-1 py-0.5 flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }}>
                              {docLessonTypes.map(qt => <option key={qt} value={qt}>{typeLabel[qt] ?? qt}</option>)}
                            </select>
                            <button type="button" onClick={() => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.filter((_: any, li: number) => li !== lessonIdx) }) }))} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: C.faint }}>
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                      <button type="button" onClick={() => setDocOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: [...m.lessons, { id: Math.random().toString(36).slice(2, 9), title: 'New lesson', summary: '', questionType: 'multiple_choice' }] }) }))} className="flex items-center gap-1 text-xs mt-1 transition-opacity hover:opacity-60" style={{ color: C.faint }}>
                        <Plus className="w-3 h-3" /> Add lesson
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Python Course Wizard -- Brief step */}
          {pyWizardStep === 'brief' && (
            <motion.div key="py-brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-5">
                <button type="button" onClick={() => setPyWizardStep(null)} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Course types
                </button>
                <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: '#f59e0b' }}>Course Studio</span>
              </div>
              <div className="rounded-[28px] p-6 sm:p-9" style={wizardPanelStyle}>
              <div className="flex items-start gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: '#f59e0b18' }}>
                  <Code2 className="w-5 h-5" style={{ color: '#f59e0b' }} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: '#f59e0b' }}>Build with AI</p>
                  <h2 className="text-2xl font-semibold tracking-tight" style={{ color: C.text }}>Create a Python course</h2>
                  <p className="text-sm mt-1 max-w-xl" style={{ color: C.muted }}>Set the learning direction. You can review and refine every module before the course is created.</p>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Course Title</label>
                  <input type="text" value={pyBrief.title} onChange={e => setPyBrief(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Python for Financial Analysts" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Industry</label>
                    <select value={pyBrief.industry} onChange={e => setPyBrief(p => ({ ...p, industry: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                      {['Finance', 'Healthcare', 'Retail', 'Marketing', 'HR', 'EdTech', 'Logistics', 'Consulting'].map(ind => <option key={ind} value={ind}>{ind}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Skill Level</label>
                    <select value={pyBrief.level} onChange={e => setPyBrief(p => ({ ...p, level: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                      {['Beginner', 'Intermediate', 'Advanced'].map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Focus Area</label>
                  <select value={pyBrief.focus} onChange={e => setPyBrief(p => ({ ...p, focus: e.target.value }))} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                    {['Data Analysis', 'Data Visualization', 'Machine Learning', 'Statistics', 'Data Cleaning', 'Automation'].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Target Role</label>
                  <input type="text" value={pyBrief.role} onChange={e => setPyBrief(p => ({ ...p, role: e.target.value }))} placeholder="e.g. Data Analyst, Business Analyst" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={labelStyle}>Specific Focus <span style={{ color: C.faint }}>(optional)</span></label>
                  <AiTextarea value={pyBrief.promptText} onValueChange={value => setPyBrief(p => ({ ...p, promptText: value }))} placeholder="Any specific libraries, datasets, or skills to focus on..." rows={3} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={inputStyle} />
                </div>
                <button type="button" onClick={handleGeneratePythonOutline} disabled={!!aiLoadingLabel || !pyBrief.title.trim()} className="flex items-center justify-center gap-2 w-full py-3.5 mt-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-4 h-4" /> Generate Outline
                </button>
              </div>
              </div>
            </motion.div>
          )}

          {/* Python Course Wizard -- Outline review step */}
          {pyWizardStep === 'outline' && pyOutline && (
            <motion.div key="py-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-12">
              <div className="rounded-[24px] p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4" style={wizardPanelStyle}>
                <button type="button" onClick={() => setPyWizardStep('brief')} className="w-10 h-10 rounded-xl flex items-center justify-center transition-opacity hover:opacity-60 shrink-0" style={wizardSoftStyle} title="Back to course brief">
                  <ArrowLeft className="w-4 h-4" style={{ color: C.muted }} />
                </button>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: '#f59e0b' }}>Outline ready · Step 2 of 2</p>
                  <h2 className="text-xl font-semibold tracking-tight" style={{ color: C.text }}>Review your Python course</h2>
                  <p className="text-sm" style={{ color: C.muted }}>Edit module and lesson titles, then confirm the dataset plan.</p>
                </div>
                <button type="button" onClick={handleGeneratePythonFullCourse} disabled={!!aiLoadingLabel} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40" style={{ background: ctaBg, color: ctaFg, border: ctaBorder }}>
                  <Sparkles className="w-3.5 h-3.5" /> Generate Full Course
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Modules -- 2/3 width */}
                <div className="lg:col-span-2 flex flex-col gap-3">
                  {(pyOutline.modules ?? []).map((mod: any, modIdx: number) => (
                    <div key={mod.id || modIdx} className="rounded-[20px] overflow-hidden" style={wizardPanelStyle}>
                      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
                        <button type="button"
                          onClick={() => {
                            setPyModuleLoading(modIdx);
                            supabase.auth.getSession().then(({ data: { session } }) => {
                              fetch('/api/ai-course', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
                                body: JSON.stringify({ action: 'generate_python_course_outline', ...pyBrief, moduleIndex: modIdx, existingOutline: pyOutline }),
                              }).then(r => r.json()).then(data => {
                                if (data.module) setPyOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i === modIdx ? data.module : m) }));
                              }).finally(() => setPyModuleLoading(null));
                            });
                          }}
                          disabled={pyModuleLoading !== null}
                          className="p-1 rounded transition-opacity hover:opacity-60 disabled:opacity-30 flex-shrink-0" title="Regenerate this module" style={{ color: '#f59e0b' }}>
                          <RefreshCw className={`w-3.5 h-3.5 ${pyModuleLoading === modIdx ? 'animate-spin' : ''}`} />
                        </button>
                        <input value={mod.title} onChange={e => setPyOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, i: number) => i !== modIdx ? m : { ...m, title: e.target.value }) }))} className="flex-1 text-sm font-semibold bg-transparent border-none outline-none" style={{ color: C.text }} />
                      </div>
                      <div className="flex flex-col gap-1.5 p-3 ml-5">
                        {(mod.lessons ?? []).map((lesson: any, lessonIdx: number) => {
                          const typeColors: Record<string, string> = { python_exercise: '#f59e0b', multiple_choice: '#475569' };
                          const typeLabels: Record<string, string> = { python_exercise: 'PY', multiple_choice: 'MCQ' };
                          const col = typeColors[lesson.questionType] ?? '#475569';
                          return (
                            <div key={lesson.id || lessonIdx} className="flex items-center gap-2 group">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0" style={{ background: col, color: '#fff' }}>{typeLabels[lesson.questionType] ?? 'PY'}</span>
                              <input value={lesson.title} onChange={e => setPyOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.map((l: any, li: number) => li !== lessonIdx ? l : { ...l, title: e.target.value }) }) }))} className="flex-1 text-xs bg-transparent border-none outline-none" style={{ color: C.text }} />
                              <button type="button" onClick={() => setPyOutline((prev: any) => ({ ...prev, modules: prev.modules.map((m: any, mi: number) => mi !== modIdx ? m : { ...m, lessons: m.lessons.filter((_: any, li: number) => li !== lessonIdx) }) }))} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.faint }}>
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dataset plan -- 1/3 width */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-[20px] p-5" style={wizardPanelStyle}>
                    <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#f59e0b' }}>Dataset Plan</p>
                    <p className="text-xs mb-3" style={{ color: C.muted }}>{pyOutline.datasetPlan?.description}</p>
                    {(pyOutline.datasetPlan?.datasets ?? []).map((ds: any, i: number) => (
                      <div key={i} className="mb-3 last:mb-0 rounded-lg p-3" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                        <p className="text-xs font-mono font-bold mb-1" style={{ color: '#f59e0b' }}>{ds.variableName}</p>
                        <p className="text-xs mb-1.5" style={{ color: C.muted }}>{ds.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {(ds.columns ?? []).map((col: string) => (
                            <span key={col} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: C.pill, color: C.muted }}>{col}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="mt-3 rounded-lg p-3" style={{ background: '#f59e0b0d', border: '1px solid #f59e0b22' }}>
                      <p className="text-[11px] font-semibold mb-1" style={{ color: '#f59e0b' }}>After generating</p>
                      <p className="text-[11px]" style={{ color: C.muted }}>Prepare CSV files matching these schemas and upload them to each exercise in the course editor.</p>
                    </div>
                  </div>
                  <div className="rounded-[20px] p-5" style={wizardPanelStyle}>
                    <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.muted }}>Outcomes</p>
                    <ul className="text-xs space-y-1.5" style={{ color: C.text }}>
                      {(pyOutline.learningOutcomes ?? []).map((o: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5"><span style={{ color: '#f59e0b' }}>+</span>{o}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Normal landing page */}
          {!sqlWizardStep && !docWizardStep && !pyWizardStep && (
            <>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full mb-9">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-30" style={{ background: brandAccent }} />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: brandAccent }} />
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: brandAccent }}>Course Studio</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ color: C.text }}>How would you like to begin?</h1>
                <p className="text-sm sm:text-base mt-2 max-w-2xl" style={{ color: C.muted }}>Start with a blank experience, transform your source material, or let AI build a specialist course you can refine.</p>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {TEMPLATES.filter(t => userRole !== 'staff' || t.config.eventDetails?.isEvent).map((t, i) => {
                    const Icon = t.icon;
                    return (
                      <motion.button key={t.key} type="button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 +i * 0.07 }} onClick={() => handleSelectTemplate(t)} className="group relative flex items-start gap-4 p-5 sm:p-6 rounded-[22px] transition-all text-left hover:-translate-y-0.5" style={wizardPanelStyle}>
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${t.color}18` }}>
                          <Icon className="w-4.5 h-4.5" style={{ color: t.color, width: 18, height: 18 }} />
                        </div>
                        <div className="flex-1 min-w-0 pr-7">
                          <p className="text-base font-semibold leading-tight" style={{ color: C.text }}>{t.label}</p>
                          <p className="text-sm mt-1 leading-relaxed" style={{ color: C.muted }}>{t.description}</p>
                        </div>
                        <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: C.faint }} />
                      </motion.button>
                    );
                  })}
                  {/* SQL Course with AI */}
                  {userRole !== 'staff' && <motion.button key="sql-course-ai" type="button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 +TEMPLATES.length * 0.07 }} onClick={() => setSqlWizardStep('brief')} className="group relative flex items-start gap-4 p-5 sm:p-6 rounded-[22px] transition-all text-left hover:-translate-y-0.5" style={wizardPanelStyle}>
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#3b82f618' }}>
                      <Database className="w-4.5 h-4.5" style={{ color: '#3b82f6', width: 18, height: 18 }} />
                    </div>
                    <div className="flex-1 min-w-0 pr-7">
                      <p className="text-base font-semibold leading-tight" style={{ color: C.text }}>SQL Course with AI</p>
                      <p className="text-sm mt-1 leading-relaxed" style={{ color: C.muted }}>Generate applied exercises, a shared schema, and guided solutions.</p>
                    </div>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: C.faint }} />
                  </motion.button>}
                  {/* Python Course with AI */}
                  {userRole !== 'staff' && <motion.button key="py-course-ai" type="button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 +(TEMPLATES.length + 1) * 0.07 }} onClick={() => setPyWizardStep('brief')} className="group relative flex items-start gap-4 p-5 sm:p-6 rounded-[22px] transition-all text-left hover:-translate-y-0.5" style={wizardPanelStyle}>
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: '#f59e0b18' }}>
                      <Code2 className="w-4.5 h-4.5" style={{ color: '#f59e0b', width: 18, height: 18 }} />
                    </div>
                    <div className="flex-1 min-w-0 pr-7">
                      <p className="text-base font-semibold leading-tight" style={{ color: C.text }}>Python Course with AI</p>
                      <p className="text-sm mt-1 leading-relaxed" style={{ color: C.muted }}>Build a data course with datasets, Python practice, and knowledge checks.</p>
                    </div>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: C.faint }} />
                  </motion.button>}
                  {/* Course from a Document */}
                  {userRole !== 'staff' && <motion.button key="doc-course-ai" type="button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 +(TEMPLATES.length + 2) * 0.07 }} onClick={() => setDocWizardStep('input')} className="group relative flex items-start gap-4 p-5 sm:p-6 rounded-[22px] transition-all text-left hover:-translate-y-0.5" style={wizardPanelStyle}>
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${brandAccent}18` }}>
                      <FileText className="w-4.5 h-4.5" style={{ color: brandAccent, width: 18, height: 18 }} />
                    </div>
                    <div className="flex-1 min-w-0 pr-7">
                      <p className="text-base font-semibold leading-tight" style={{ color: C.text }}>Create from a Document</p>
                      <p className="text-sm mt-1 leading-relaxed" style={{ color: C.muted }}>Transform a PDF, deck, guide, web page, or pasted text into a course.</p>
                    </div>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform group-hover:translate-x-0.5" style={{ color: C.faint }} />
                  </motion.button>}
                </div>
              </motion.div>
            </>
          )}

        </div>
        <GeneratingOverlay visible={!!aiLoadingLabel} label={aiLoadingLabel || undefined} failed={aiFailed} />
      </main>
    );
  }

  // -- Editor --
  const accentColor = formConfig.customAccent ?? themeAccentColors[formConfig.theme];

  const defaultPoints: PointsSystem = {
    enabled: true,
    basePoints: 50,
    timeBonusEnabled: true,
    timeBonusSeconds: 10,
    timeBonusMultiplier: 1.5,
    streakEnabled: true,
    streakCount: 3,
    streakBonus: 0,
    hintPenalty: 20,
    solutionPenalty: 30,
    milestones: [],
  };
  const editorSections = ([
    { id: 'info', label: formConfig.isCourse ? 'Basic Info' : 'Form Info' },
    { id: 'cover', label: formConfig.isCourse ? 'Cover & Media' : 'Cover Image' },
    ...(!formConfig.isCourse && !formConfig.eventDetails?.isEvent ? [{ id: 'fields', label: 'Form Fields' }] : []),
    ...(formConfig.isCourse ? [{ id: 'curriculum', label: 'Lessons' }] : []),
    ...(formConfig.eventDetails?.isEvent ? [{ id: 'fields', label: 'Registration Fields' }, { id: 'event_details', label: 'Event Details' }, { id: 'visibility', label: 'Visibility' }] : []),
    ...(formConfig.isCourse ? [{ id: 'course_settings', label: 'Learning Rules' }] : []),
    { id: 'appearance', label: 'Appearance' },
    ...(formConfig.isCourse ? [{ id: 'points', label: 'Points & Rewards' }] : []),
    ...((formConfig.isCourse || formConfig.eventDetails?.isEvent) ? [{ id: 'cohorts', label: 'Access' }] : []),
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
  const studioPanelClass = 'rounded-2xl p-4 sm:p-5 space-y-5';
  const studioPanelStyle = { background: C.card, border: `1px solid ${C.cardBorder}` };

  return (
    <main className="min-h-screen flex flex-col" style={{ background: C.page, colorScheme: theme === 'dark' ? 'dark' : 'light' }}>
      {/* -- Editor header: Logo + Dashboard link + Save -- */}
      {!formConfig.isCourse && <header className="sticky top-0 z-30 backdrop-blur-md" style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}` }}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <img src={(theme === 'dark' ? logoDarkUrl || logoUrl : logoUrl) || undefined} alt="" className="h-6 w-auto" />
              </Link>
            <div className="w-px h-4" style={{ background: C.divider }} />
            <Link href="/dashboard" className="flex items-center gap-1.5 text-xs transition-colors hover:opacity-60" style={{ color: C.muted }}>
              <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
            </Link>
            {savedFormId && formConfig?.title && (
              <>
                <span className="text-xs" style={{ color: C.faint }}>/</span>
                <span className="text-xs truncate max-w-[180px]" style={{ color: C.muted }}>{formConfig.title}</span>
              </>
            )}
          </div>
          <button onClick={toggleTheme} type="button" className="p-2 rounded-lg transition-colors ff-hover" title="Toggle theme" style={{ color: C.faint }}>
            {theme === 'dark' ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
          </button>
          <div className="flex items-center gap-2">
            {sqlOutline && (
              <button
                type="button"
                onClick={() => { setFormConfig(null); setSqlWizardStep('outline'); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: '#3b82f618', color: '#3b82f6', border: '1px solid #3b82f630' }}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Edit Outline
              </button>
            )}
            {docOutline && (
              <button
                type="button"
                onClick={() => { setFormConfig(null); setDocWizardStep('outline'); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: `${brandAccent}18`, color: brandAccent, border: `1px solid ${brandAccent}30` }}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Edit Outline
              </button>
            )}
            {/* Draft status pill -- only shown when form is already saved as draft */}
            {savedFormId && formStatus === 'draft' && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: C.pill, color: C.muted }}>Draft</span>
            )}
            <button
              type="button"
              onClick={() => handleShare('draft')}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60 hover:opacity-80"
              style={{ background: C.pill, color: C.text }}
            >
              {savingAs === 'draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Draft
            </button>
            <button
              type="button"
              onClick={() => handleShare('published')}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60 hover:opacity-90"
              style={{ background: accentColor, color: C.ctaText }}
            >
              {savingAs === 'published' ? <Loader2 className="w-4 h-4 animate-spin" /> : copied ? <Check className="w-4 h-4" /> : null}
              {copied && savingAs !== 'published' ? 'Saved!' : savedFormId && formStatus === 'published' ? 'Save' : 'Publish'}
            </button>
          </div>
        </div>
      </header>}

      {formConfig.isCourse && (
        <div className="fixed bottom-4 left-4 right-4 z-[90] flex flex-wrap items-center justify-end gap-2 rounded-xl p-2 sm:left-auto sm:right-6 sm:bottom-6" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: theme === 'dark' ? '0 14px 38px rgba(0,0,0,0.48)' : '0 14px 38px rgba(15,23,42,0.16)' }}>
          {sqlOutline && <button type="button" onClick={() => { setFormConfig(null); setSqlWizardStep('outline'); }} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}><ArrowLeft className="h-3.5 w-3.5" /> Edit outline</button>}
          {docOutline && <button type="button" onClick={() => { setFormConfig(null); setDocWizardStep('outline'); }} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}><ArrowLeft className="h-3.5 w-3.5" /> Edit outline</button>}
          <button type="button" onClick={() => handleShare('draft')} disabled={isSaving} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.text }}>
            {savingAs === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft
          </button>
          <button type="button" onClick={() => handleShare('published')} disabled={isSaving} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60" style={{ background: accentColor, color: C.ctaText }}>
            {savingAs === 'published' ? <Loader2 className="h-4 w-4 animate-spin" /> : copied ? <Check className="h-4 w-4" /> : null}
            {copied && savingAs !== 'published' ? 'Saved!' : savedFormId && formStatus === 'published' ? 'Save' : 'Publish'}
          </button>
        </div>
      )}

      <div className="relative z-10 flex flex-col flex-1 overflow-hidden">
        {/* -- Content Area -- */}
        <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ background: C.page }}>
          {/* Published URL banner */}
          {savedFormId && formStatus === 'published' && (
            <div className="flex items-center gap-3 px-8 py-2.5 text-xs" style={{ background: `${accentColor}10`, borderBottom: `1px solid ${accentColor}20` }}>
              <span className="flex items-center gap-1.5 font-medium flex-shrink-0" style={{ color: accentColor }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: accentColor }} />
                Live
              </span>
              <code className="flex-1 truncate" style={{ color: C.muted }}>
                {typeof window !== 'undefined' ? window.location.origin : ''}/{customSlug || savedFormId}
              </code>
              <button type="button" onClick={() => handleShare()} className="flex items-center gap-1 px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80 flex-shrink-0" style={{ background: accentColor, color: '#fff' }}>
                {copied ? <Check className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                <span>{copied ? 'Copied!' : 'Copy link'}</span>
              </button>
            </div>
          )}
          <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: theme === 'dark' ? '1px solid transparent' : `1px solid ${C.cardBorder}`, boxShadow: 'none' }}>
          {formConfig.isCourse && (
            <div style={{ background: C.card, borderBottom: `1px solid ${C.cardBorder}` }}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
                <div className="mr-auto min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden="true"><span className="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-20" style={{ background: accentColor }} /><span className="relative h-1.5 w-1.5 rounded-full" style={{ background: accentColor }} /></span>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: accentColor }}>Course Studio</p>
                  </div>
                  <p className="mt-1 truncate text-base font-semibold leading-tight sm:text-lg" style={{ color: C.text }}>{formConfig.title || 'Untitled course'}</p>
                </div>
                <span className="text-[11px]" style={{ color: C.faint }}>{savedFormId ? (formStatus === 'published' ? 'Published course' : 'Draft course') : 'New course'}</span>
              </div>
              <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-3 sm:px-6" aria-label="Course studio modes" style={{ scrollbarWidth: 'none' }}>
                {courseStudioModes.map(mode => {
                  const active = mode.id === activeStudioMode.id;
                  return <button key={mode.id} type="button" onClick={() => goToSection(mode.sections[0], editorSectionIds)} className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors" style={{ background: active ? `${accentColor}14` : 'transparent', color: active ? accentColor : C.faint }}><mode.Icon className="h-3.5 w-3.5" /> {mode.label}</button>;
                })}
              </nav>
            </div>
          )}
          {(() => {
            const navSections = editorSections;
            const ids = formConfig.isCourse ? courseStudioModes.map(mode => mode.sections[0]) : editorSectionIds;
            const i = formConfig.isCourse ? courseStudioModes.findIndex(mode => mode.id === activeStudioMode.id) : ids.indexOf(activeSection);
            const currentLabel = formConfig.isCourse ? activeStudioMode.label : navSections[editorSectionIds.indexOf(activeSection)]?.label;
            return (
              <div className="flex items-center justify-between gap-4 px-6 sm:px-8 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold leading-tight truncate" style={{ color: C.text }}>{currentLabel}</h2>
                  <p className="text-[11px] mt-1 font-medium tracking-wide uppercase" style={{ color: C.faint }}>{formConfig.isCourse ? `${activeStudioMode.label} workspace` : `Step ${i + 1} of ${ids.length}`}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" disabled={i <= 0} onClick={() => goToSection(ids[i - 1], ids)} aria-label="Previous"
                    className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                    <ChevronLeft className="w-4 h-4"/>
                  </button>
                  <button type="button" disabled={i >= ids.length - 1} onClick={() => goToSection(ids[i + 1], ids)} aria-label="Next"
                    className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                    <ChevronRight className="w-4 h-4"/>
                  </button>
                </div>
              </div>
            );
          })()}
          <AnimatePresence mode="wait" custom={secDir}>
          <motion.div key={activeSection} custom={secDir}
            initial={{ opacity: 0, x: secDir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: secDir * -28 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-5 px-6 py-7 sm:px-8">

            {activeSection === 'info' && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course identity</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Give learners a clear promise before they begin.</p></div>}
              <div>
                <label className={labelCls} style={labelStyle}>{formConfig.isCourse ? 'Course title' : 'Form Title'}</label>
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
              </div>

              {/* Learning outcomes -- course only */}
              {formConfig.isCourse && (
                <div>
                  <label className={labelCls} style={labelStyle}>What students will learn</label>
                  <div className="space-y-1.5">
                    {(formConfig.learnOutcomes || []).map((outcome, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                        <div className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center" style={{ background: `${accentColor}22` }}>
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }}/>
                        </div>
                        <span className="flex-1 text-xs leading-relaxed" style={{ color: C.text }}>{outcome}</span>
                        <button
                          type="button"
                          onClick={() => updateConfig({ learnOutcomes: (formConfig.learnOutcomes || []).filter((_, idx) => idx !== i) })}
                          className="flex-shrink-0 transition-opacity hover:opacity-70"
                          style={{ color: C.faint }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={learnOutcomeInput}
                        onChange={e => setLearnOutcomeInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const v = learnOutcomeInput.trim();
                            if (v) { updateConfig({ learnOutcomes: [...(formConfig.learnOutcomes || []), v] }); setLearnOutcomeInput(''); }
                          }
                        }}
                        placeholder="Add a learning outcome..."
                        className={`${inputCls} flex-1`}
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const v = learnOutcomeInput.trim();
                          if (v) { updateConfig({ learnOutcomes: [...(formConfig.learnOutcomes || []), v] }); setLearnOutcomeInput(''); }
                        }}
                        className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
                        style={{ background: accentColor }}
                      >
                        <Plus className="w-4 h-4 text-white" />
                      </button>
                    </div>
                    {(formConfig.learnOutcomes || []).length === 0 && (
                      <p className="text-[10px] leading-relaxed pt-0.5" style={{ color: C.faint }}>Bullet points shown on the course overview page. Press Enter or click + to add.</p>
                    )}
                  </div>
                </div>

              )}
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
                      <p className="text-sm font-bold" style={{ color: C.text }}>AI Event Assistant</p>
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: C.faint }}>Generate the setup, registration fields, and confirmation copy from a short brief.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEventAssistantOpen(true)} disabled={!!aiLoadingLabel}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50 flex-shrink-0"
                    style={{ background: accentColor, color: C.ctaText }}>
                    <Sparkles className="w-3.5 h-3.5" /> Open Assistant
                  </button>
                </div>
                {/* FORMAT -- type + location */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Format</p>
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
                          style={{ background: active ? `${accentColor}14` : C.input }}>
                          {active && <Check className="w-4 h-4 absolute top-3 right-3" style={{ color: accentColor }} />}
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: active ? `${accentColor}1f` : C.pill, color: active ? accentColor : C.muted }}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: active ? accentColor : C.text }}>{label}</p>
                            <p className="text-[11px]" style={{ color: C.faint }}>{desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.faint }}>
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
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Schedule</p>
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
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Repeats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['once', 'daily', 'weekly'] as const).map(freq => {
                      const active = (formConfig.eventDetails!.recurrence ?? 'once') === freq;
                      const labels = { once: 'One-time', daily: 'Daily', weekly: 'Weekly' };
                      return (
                        <button key={freq} type="button"
                          onClick={() => updateConfig({ eventDetails: { ...formConfig.eventDetails!, recurrence: freq } })}
                          className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: active ? `${accentColor}14` : C.input, color: active ? accentColor : C.muted }}>
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
                            style={{ background: selected ? accentColor : C.input, color: selected ? C.ctaText : C.faint }}>
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
                      <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>
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

            {((formConfig.isCourse && activeStudioMode.id === 'settings') || (activeSection === 'cohorts' && formConfig.eventDetails?.isEvent)) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 2 } : undefined}>
                {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Learner access</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Choose who can access this course and optionally set a deadline.</p></div>}
                <div className="space-y-2">
                  {formConfig.isCourse && (
                    <button
                      type="button"
                      onClick={() => { setCourseAvailableToEveryone(true); setSelectedCohortIds([]); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                      style={{ background: courseAvailableToEveryone ? `${accentColor}12` : C.input, border: `1px solid ${courseAvailableToEveryone ? accentColor : C.inputBorder}` }}
                    >
                      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ background: courseAvailableToEveryone ? accentColor : 'transparent', border: `1px solid ${courseAvailableToEveryone ? accentColor : C.inputBorder}` }}>
                        {courseAvailableToEveryone && <Check className="w-2.5 h-2.5" style={{ color: '#fff' }} />}
                      </div>
                      <span className="text-sm font-medium" style={{ color: C.text }}>Everyone</span>
                    </button>
                  )}
                  {cohorts.length === 0 && (
                    <p className="text-xs py-2" style={{ color: C.faint }}>No cohorts yet. Create one in the dashboard.</p>
                  )}
                  {cohorts.map(c => {
                    const checked = selectedCohortIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                        style={{ background: checked ? `${accentColor}12` : C.input, border: `1px solid ${checked ? accentColor : C.inputBorder}` }}>
                        <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                          style={{ background: checked ? accentColor : 'transparent', border: `1.5px solid ${checked ? accentColor : C.faint}` }}>
                          {checked && <Check className="w-2.5 h-2.5" style={{ color: '#fff' }}/>}
                        </div>
                        <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleCohort(c.id)}/>
                        <span className="text-sm font-medium" style={{ color: C.text }}>{c.name}</span>
                      </label>
                    );
                  })}
                  <p className="text-[11px] pt-1" style={{ color: C.faint }}>
                    {courseAvailableToEveryone
                      ? 'Available to every signed-in student.'
                      : selectedCohortIds.length === 0
                      ? 'Nobody can access this yet. Choose Everyone or select at least one cohort.'
                      : `Visible to ${selectedCohortIds.length} cohort${selectedCohortIds.length > 1 ? 's' : ''}.`}
                  </p>
                  {selectedCohortIds.length > 0 && (
                    <div className="pt-2 border-t" style={{ borderColor: C.inputBorder }}>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Deadline (days from assignment)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={1} max={365} placeholder="--"
                          value={formConfig.deadline_days ?? ''}
                          onChange={e => updateConfig({ deadline_days: e.target.value ? Number(e.target.value) : null })}
                          className="w-20 bg-transparent px-2 py-1.5 text-sm outline-none rounded-lg text-center"
                          style={{ border: `1px solid ${C.inputBorder}`, color: C.text, background: C.input }}
                        />
                        <span className="text-xs" style={{ color: C.faint }}>days · leave blank for no deadline</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {((formConfig.isCourse && activeStudioMode.id === 'publish') || (!formConfig.isCourse && activeSection === 'share')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 0 } : undefined}>
              {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course link</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Create a short, recognizable URL for sharing.</p></div>}
              <div>
                <label className={labelCls} style={labelStyle}>Custom slug (optional)</label>
                <div className="flex min-h-12 items-center overflow-hidden rounded-xl" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                  <span className="flex self-stretch items-center px-3 text-xs whitespace-nowrap" style={{ color: C.faint, borderRight: `1px solid ${C.inputBorder}` }}>/</span>
                  <input type="text" value={customSlug} onChange={e => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder={formConfig.isCourse ? 'my-course' : 'my-form'} className="w-full bg-transparent px-3 py-3 text-sm font-medium outline-none" style={{ color: C.text }} />
                </div>
              </div>
              </div>
            )}

            {(activeSection === 'cover' || (formConfig.isCourse && activeStudioMode.id === 'design')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Cover &amp; media</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Choose the visual learners see before opening the course.</p></div>}
              {formConfig.coverImage ? (
                <div className="relative w-full h-28 rounded-xl overflow-hidden group" style={{ border: `1px solid ${C.cardBorder}` }}>
                  <img src={resolveCoverUrl(formConfig.coverImage)} alt="Cover" className="w-full h-full object-cover" onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button onClick={() => setShowCoverLibrary(true)} className="flex items-center gap-1.5 text-xs font-medium bg-white/90 px-3 py-1.5 rounded-lg hover:bg-white transition-colors" style={{ color: '#111' }}>
                      <ImageIcon className="w-3.5 h-3.5" /> Change
                    </button>
                    <button onClick={() => { deleteUploadedFile(formConfig.coverImage); updateConfig({ coverImage: '' }); }} className="flex items-center gap-1.5 text-red-400 text-xs font-medium bg-white/80 px-3 py-1.5 rounded-lg hover:bg-white transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCoverLibrary(true)} className="relative block w-full cursor-pointer">
                  <div className="w-full rounded-xl px-3 py-7 flex flex-col items-center justify-center gap-2 transition-colors hover:opacity-80" style={{ background: C.groupBg, border: `1.5px dashed ${C.inputBorder}` }}>
                    <ImageIcon className="w-5 h-5" style={{ color: C.faint }} />
                    <span className="text-xs" style={{ color: C.faint }}>Select or upload cover image</span>
                  </div>
                </button>
              )}
              {showCoverLibrary && (
                <ImageLibrary
                  uploadFolder="covers"
                  initialFolder="covers"
                  returnPublicId
                  onSelect={ref => { if (formConfig.coverImage && formConfig.coverImage !== ref) deleteUploadedFile(formConfig.coverImage); updateConfig({ coverImage: ref }); }}
                  onClose={() => setShowCoverLibrary(false)}
                />
              )}
              </div>
            )}

            {(activeSection === 'appearance' || (formConfig.isCourse && activeStudioMode.id === 'design')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? studioPanelStyle : undefined}>
              {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Appearance</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Set the course theme, typography, and accent color.</p></div>}
              <div>
                <label className={labelCls} style={labelStyle}>Mode</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([{ value: 'light', label: 'Light', description: 'Bright canvas', Icon: Sun }, { value: 'dark', label: 'Dark', description: 'Low-light canvas', Icon: Moon }, { value: 'auto', label: 'Automatic', description: 'Match learner device', Icon: LayoutDashboard }] as const).map(({ value, label, description, Icon }) => {
                    const active = formConfig.mode === value;
                    return <button key={value} type="button" onClick={() => updateConfig({ mode: value })} className="flex min-h-20 items-start gap-3 rounded-xl p-3 text-left transition-all" style={{ background: active ? `${accentColor}10` : C.groupBg, border: `1px solid ${active ? `${accentColor}55` : C.inputBorder}`, color: active ? accentColor : C.muted }}><span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: active ? `${accentColor}18` : C.pill }}><Icon className="h-4 w-4" /></span><span><span className="block text-xs font-bold" style={{ color: active ? accentColor : C.text }}>{label}</span><span className="mt-1 block text-[10px]" style={{ color: C.faint }}>{description}</span></span></button>;
                  })}
                </div>
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Font</label>
                <button
                  onClick={() => setFontPickerOpen(true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}`, color: C.text, fontFamily: getFontById(formConfig.font).cssFamily }}
                >
                  <span>{getFontById(formConfig.font).name}</span>
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }} />
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
                <div className="flex gap-3 flex-wrap pl-1 pt-1">
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
                            boxShadow: isSelected ? `0 0 0 2.5px ${C.page}, 0 0 0 4.5px ${color}` : undefined,
                          }}
                        />
                        <span className="text-[10px] transition-colors group-hover:opacity-60" style={{ color: C.faint }}>{label}</span>
                      </button>
                    );
                  })}

                  {/* Custom color picker */}
                  <div className="flex flex-col items-center gap-1.5 group">
                    <div
                      title="Custom color"
                      className={`relative grid h-7 w-7 cursor-pointer place-items-center rounded-full transition-transform group-hover:scale-110 ${formConfig.customAccent ? 'scale-110' : ''}`}
                      style={{
                        background: formConfig.customAccent ?? 'conic-gradient(from 90deg, #f43f5e, #f59e0b, #a3e635, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #f43f5e)',
                        boxShadow: formConfig.customAccent ? `0 0 0 2.5px ${C.page}, 0 0 0 4.5px ${formConfig.customAccent}` : undefined,
                      }}
                    >
                      {!formConfig.customAccent && <span className="pointer-events-none grid h-[18px] w-[18px] place-items-center rounded-full" style={{ background: C.card, color: C.faint }}><Plus className="h-2.5 w-2.5" /></span>}
                      <input
                        type="color"
                        aria-label="Choose a custom accent color"
                        value={formConfig.customAccent ?? accentColor}
                        onChange={e => updateConfig({ customAccent: e.target.value })}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
                      />
                    </div>
                    <span className="text-[10px] transition-colors group-hover:opacity-60" style={{ color: C.faint }}>Custom</span>
                  </div>
                </div>
              </div>
              </div>
            )}

            {/* Course settings section */}
            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 0 }}>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course rules</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Define assessment behavior, timing, attempts, and feedback.</p></div>
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
                    <div className="mt-2 flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {COURSE_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => updateConfig({ category: formConfig.category === cat ? null : cat })}
                          className="min-h-8 rounded-lg px-3 py-1 text-[11px] font-semibold transition-all"
                          style={{
                            background: formConfig.category === cat ? accentColor : 'transparent',
                            color: formConfig.category === cat ? '#fff' : C.muted,
                            boxShadow: formConfig.category === cat ? '0 1px 3px rgba(15,23,42,0.12)' : undefined,
                          }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: C.faint }}>
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
                    <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: C.faint }}>
                      Displayed as &quot;Offered by&quot; attribution on catalog cards and certificates.
                    </p>
                  </div>

                  {/* Completion badge */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Completion Badge</label>
                    <p className="text-[10px] mb-2 leading-relaxed" style={{ color: C.faint }}>
                      Students earn this badge when they pass the course assessment. It appears in their Badges section alongside their certificate.
                    </p>
                    <input ref={badgeInputRef} type="file" accept="image/*" className="hidden" onChange={handleBadgeImageUpload}/>
                    {formConfig.badgeImageUrl ? (
                      <div className="flex items-center gap-3">
                        <img src={formConfig.badgeImageUrl} alt="Badge" className="w-16 h-16 rounded-xl object-contain flex-shrink-0" style={{ border: `1px solid ${C.inputBorder}`, background: C.pill }}/>
                        <div className="flex flex-col gap-1.5">
                          <button type="button" onClick={() => badgeInputRef.current?.click()} disabled={uploadingBadge}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}>
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
                        style={{ border: `1.5px dashed ${C.inputBorder}`, color: C.faint, background: C.groupBg, width: '100%', justifyContent: 'center' }}>
                        {uploadingBadge ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                        {uploadingBadge ? 'Uploading...' : 'Upload badge image'}
                      </button>
                    )}
                  </div>

                  {/* Show answers setting */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <label className={labelCls} style={labelStyle}>Show correct answers</label>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {([
                        { value: 'per_question', label: 'Per question' },
                        { value: 'after_quiz', label: 'After course' },
                        { value: 'none', label: 'Never' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateConfig({ showAnswers: value })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.showAnswers ?? 'per_question') === value ? accentColor : 'transparent', color: (formConfig.showAnswers ?? 'per_question') === value ? '#fff' : C.muted }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: C.faint }}>
                      {(formConfig.showAnswers ?? 'per_question') === 'per_question' && 'Students see correct/incorrect after each question.'}
                      {formConfig.showAnswers === 'after_quiz' && 'Students see all answers after submitting.'}
                      {formConfig.showAnswers === 'none' && 'Students only see their final score.'}
                    </p>
                  </div>

                  {/* Lesson timing */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <label className={labelCls} style={labelStyle}>Lesson timing</label>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {([
                        { value: 'before', label: 'Before question' },
                        { value: 'after', label: 'After answer' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateConfig({ lessonTiming: value })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.lessonTiming ?? 'after') === value ? accentColor : 'transparent', color: (formConfig.lessonTiming ?? 'after') === value ? '#fff' : C.muted }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: C.faint }}>
                      {(formConfig.lessonTiming ?? 'after') === 'before'
                        ? 'Lesson opens automatically before each question. Students read first, then answer.'
                        : 'Lesson is offered after answering. "Why?" if wrong, "Review Lesson" if right.'}
                    </p>
                  </div>

                  {/* AI tutor */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <label className={labelCls} style={labelStyle}>AI tutor</label>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {([
                        { value: true, label: 'On' },
                        { value: false, label: 'Off' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={String(value)}
                          type="button"
                          onClick={() => updateConfig({ enableAiTutor: value })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: (formConfig.enableAiTutor ?? false) === value ? accentColor : 'transparent', color: (formConfig.enableAiTutor ?? false) === value ? '#fff' : C.muted }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: C.faint }}>
                      {formConfig.enableAiTutor
                        ? 'Lesson slides show an Ask AI button. The tutor answers from that lesson only and never gives away knowledge-check answers.'
                        : 'Students read lesson slides on their own. No AI help is offered.'}
                    </p>
                  </div>

                  {/* Pass mark */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Pass mark</label>
                      <span className="text-xs font-semibold" style={{ color: accentColor }}>{formConfig.passmark ?? 50}%</span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {[50, 60, 70, 80].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => updateConfig({ passmark: pct })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.passmark ?? 50) === pct ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                        >
                          {pct}%
                        </button>
                      ))}
                      <input
                        type="number"
                        min="1"
                        max="100"
                        placeholder="Custom"
                        value={![50, 60, 70, 80].includes(formConfig.passmark ?? 50) ? (formConfig.passmark ?? '') : ''}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v >= 1 && v <= 100) updateConfig({ passmark: v });
                        }}
                        onFocus={e => {
                          e.currentTarget.style.borderColor = accentColor;
                          e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}18`;
                        }}
                        onBlur={e => {
                          e.currentTarget.style.borderColor = C.inputBorder;
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        className="min-h-9 w-24 rounded-lg border px-3 py-1.5 text-xs font-semibold outline-none transition-all placeholder:font-medium"
                        style={{ background: theme === 'dark' ? C.input : '#ffffff', borderColor: C.inputBorder, color: C.text }}
                      />
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Time limit</label>
                      <span className="text-xs font-semibold" style={{ color: C.muted }}>
                        {formConfig.courseTimer ? `${formConfig.courseTimer} min` : 'None'}
                      </span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {[0, 5, 10, 15, 20, 30, 45, 60].map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => updateConfig({ courseTimer: t || undefined })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.courseTimer ?? 0) === t ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                        >
                          {t === 0 ? 'None' : `${t}m`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Max attempts */}
                  <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                    <div className="flex items-center justify-between">
                      <label className={`${labelCls} mb-0`} style={labelStyle}>Max attempts</label>
                      <span className="text-xs font-semibold" style={{ color: C.muted }}>
                        {formConfig.maxAttempts ? formConfig.maxAttempts : 'Unlimited'}
                      </span>
                    </div>
                    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                      {[0, 1, 2, 3, 5].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => updateConfig({ maxAttempts: n || undefined })}
                          className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                          style={(formConfig.maxAttempts ?? 0) === n ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                        >
                          {n === 0 ? '∞' : n}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px]" style={{ color: C.faint }}>Tracked per email address via submission records.</p>
                  </div>
              </div>
            )}

            {/* Curriculum / Fields section */}
            {(activeSection === 'curriculum' && formConfig.isCourse) && (
              <div className={studioPanelClass} style={studioPanelStyle}>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Course curriculum</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Shape the learning journey, lessons, and practice activities.</p></div>
                <div className="space-y-3">
                  <div className="p-3 rounded-xl space-y-3" style={{ background: C.card }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <label className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>AI Course Builder</label>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: C.faint }}>
                          Generate questions and learning outcomes from a topic, then refine each question with AI.
                        </p>
                      </div>
                      <div className="px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ background: `${accentColor}18`, color: accentColor }}>
                        AI
                      </div>
                    </div>

                    <input
                      type="text"
                      value={aiTopic}
                      onChange={e => setAiTopic(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="e.g. Intro to digital marketing for beginners"
                    />

                    <div className="grid grid-cols-2 gap-2">
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
                        <label className={labelCls} style={labelStyle}>Question count</label>
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

                    <div>
                      <label className={labelCls} style={labelStyle}>
                        Custom instructions <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span>
                      </label>
                      <AiTextarea
                        value={aiCustomPrompt}
                        onValueChange={value => setAiCustomPrompt(value.slice(0, 800))}
                        className={`${inputCls} min-h-[60px] resize-y`}
                        style={inputStyle}
                        placeholder="e.g. Focus on real-world scenarios, use beginner-friendly language, avoid theory-heavy questions."
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <button
                          type="button"
                          onClick={generateQuestions}
                          disabled={!!aiLoadingLabel}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: accentColor, color: C.ctaText }}
                        >
                          {aiLoadingLabel === 'Generating questions...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          Generate Questions
                        </button>
                      </div>
                      <div className="flex-1">
                        <button
                          type="button"
                          onClick={generateOutcomes}
                          disabled={!!aiLoadingLabel}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: C.pill, color: C.text, border: `1px solid ${C.inputBorder}` }}
                        >
                          {aiLoadingLabel === 'Generating learning outcomes...' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                          Generate Outcomes
                        </button>
                      </div>
                    </div>

                    {aiError && <p className="text-[11px]" style={{ color: '#ef4444' }}>{aiError}</p>}
                    {!aiError && aiSuccess && <p className="text-[11px]" style={{ color: '#10b981' }}>{aiSuccess}</p>}
                  </div>

                  {formConfig.questions?.map((q, qIdx) => {
                    const qType: QuestionType = q.type ?? 'multiple_choice';
                    const isExpanded = expandedQuestions.has(q.id);
                    const insertDivider = (
                      <div key={`insert-${q.id}`} className="group relative flex items-center justify-center gap-1.5 h-5 my-0.5">
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px transition-colors" style={{ background: C.divider }} />
                        <button
                          type="button"
                          onClick={() => setPickerCtx({ mode: 'insert', afterIndex: qIdx })}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: accentColor, color: C.ctaText, zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Add
                        </button>
                        <button
                          type="button"
                          onClick={() => insertSectionAt(qIdx)}
                          className="relative hidden group-hover:flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium transition-all hover:opacity-90"
                          style={{ background: C.pill, color: C.muted, border: `1px solid ${C.cardBorder}`, zIndex: 1 }}
                        >
                          <Plus className="w-2.5 h-2.5" /> Section
                        </button>
                      </div>
                    );

                    // -- Section divider card --
                    if (q.isSection) {
                      return (
                        <React.Fragment key={q.id}>
                        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${accentColor}40`, borderLeft: `3px solid ${accentColor}` }}>
                          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
                            <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>Section</span>
                            <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                              className="p-1 rounded transition-colors hover:bg-red-500/10">
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
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
                        </div>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    // -- LinkedIn share block card --
                    // Keep in sync with the identical card in components/FormEditor.tsx: create and
                    // edit are two separate editors.
                    if (q.isLinkedInShare) {
                      const patch = (changes: Partial<CourseQuestion>) =>
                        updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, ...changes } : qq) });
                      const required = q.linkedInShareRequired === true;

                      return (
                        <React.Fragment key={q.id}>
                        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid #0A66C240`, borderLeft: '3px solid #0A66C2' }}>
                          {/* Header */}
                          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${C.divider}` : 'none' }}>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left">
                              <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5" style={{ color: '#0A66C2' }}>
                                <LinkedInIcon className="w-3 h-3" /> {q.linkedInShareTitle || 'LinkedIn Share'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => patch({ lockUntilPrevious: !q.lockUntilPrevious })}
                              title={q.lockUntilPrevious ? 'Locked until the previous lesson is completed' : 'Lock until the previous lesson is completed'}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
                              style={q.lockUntilPrevious ? { background: accentColor, color: C.ctaText } : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                            >
                              {q.lockUntilPrevious ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />} Lock
                            </button>
                            <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                              className="p-1 rounded transition-colors hover:bg-red-500/10">
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: C.faint }}>
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
                              <label className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.faint }}>
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
                                <label className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.faint }}>
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
                                  ? { background: accentColor, color: C.ctaText }
                                  : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                              >
                                {required ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                                {required ? 'Required to continue' : 'Optional'}
                              </button>
                            </div>

                            <p className="text-[11px] leading-relaxed" style={{ color: C.faint }}>
                              Students paste the link to their own LinkedIn post. The link is checked, and a post
                              already submitted by someone else is rejected. This slide is not scored.
                            </p>
                          </div>}
                        </div>
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
                        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid #f59e0b40`, borderLeft: '3px solid #f59e0b' }}>
                          {/* Header */}
                          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: isExpanded ? `1px solid ${C.divider}` : 'none' }}>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="flex-1 text-left">
                              <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                                <Download className="w-3 h-3" /> {q.downloadsTitle || 'Downloads'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, lockUntilPrevious: !qq.lockUntilPrevious } : qq) })}
                              title={q.lockUntilPrevious ? 'Locked until the previous lesson is completed' : 'Lock until the previous lesson is completed'}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
                              style={q.lockUntilPrevious ? { background: accentColor, color: C.ctaText } : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                            >
                              {q.lockUntilPrevious ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />} Lock
                            </button>
                            <button type="button" onClick={() => updateConfig({ questions: formConfig.questions?.filter(qq => qq.id !== q.id) })}
                              className="p-1 rounded transition-colors hover:bg-red-500/10">
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                            <button type="button" onClick={() => toggleQuestion(q.id)} className="p-1 transition-colors" style={{ color: C.faint }}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                          {isExpanded && <div className="px-3.5 py-3 space-y-3">
                            {/* Title */}
                            <input
                              value={q.downloadsTitle || ''}
                              onChange={e => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsTitle: e.target.value } : qq) })}
                              placeholder="Section title e.g. Course Materials"
                              className={`${inputCls} font-semibold`}
                              style={inputStyle}
                            />

                            {/* Overall description */}
                            <RichTextEditor
                              value={q.downloadsDescription || ''}
                              onChange={html => updateConfig({ questions: formConfig.questions?.map(qq => qq.id === q.id ? { ...qq, downloadsDescription: html } : qq) })}
                              placeholder="Describe what students will find here..."
                              enableAiAssist
                            />

                            {/* Download items */}
                            {dlItems.length > 0 && (
                              <div className="space-y-2 pt-1">
                                {dlItems.map((item) => (
                                  <div key={item.id} className="rounded-lg p-3 space-y-2.5" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                                    {/* Type toggle + delete */}
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1">
                                        {(['file', 'link'] as const).map(t => (
                                          <button
                                            key={t}
                                            type="button"
                                            onClick={() => updateItems(dlItems.map(it => it.id === item.id ? { ...it, type: t } : it))}
                                            className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize transition-all"
                                            style={item.type === t ? { background: accentColor, color: C.ctaText } : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                                          >
                                            {t === 'file' ? <span className="flex items-center gap-1"><Upload className="w-2.5 h-2.5" />File</span> : <span className="flex items-center gap-1"><Link2 className="w-2.5 h-2.5" />Link</span>}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => updateItems(dlItems.filter(it => it.id !== item.id))}
                                        className="p-0.5 rounded transition-colors hover:bg-red-500/10"
                                      >
                                        <X className="w-3 h-3 text-red-400" />
                                      </button>
                                    </div>

                                    {/* Item title */}
                                    <input
                                      value={item.title}
                                      onChange={e => updateItems(dlItems.map(it => it.id === item.id ? { ...it, title: e.target.value } : it))}
                                      placeholder={item.type === 'file' ? 'File name or label...' : 'Link label...'}
                                      className={inputCls}
                                      style={inputStyle}
                                    />

                                    {/* Item description (rich text) */}
                                    <RichTextEditor
                                      value={item.description || ''}
                                      onChange={html => updateItems(dlItems.map(it => it.id === item.id ? { ...it, description: html } : it))}
                                      placeholder="Short description (optional)..."
                                      enableAiAssist
                                    />

                                    {/* File upload or URL */}
                                    {item.type === 'file' ? (
                                      item.fileUrl ? (
                                        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: '#f59e0b15', border: '1px solid #f59e0b30' }}>
                                          <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                                          <span className="text-xs flex-1 truncate" style={{ color: C.text }}>{item.fileName || 'Uploaded file'}{item.pdfPages ? ` · inline preview (${item.pdfPages}p)` : ''}</span>
                                          <button
                                            type="button"
                                            onClick={() => { deleteUploadedFile(item.fileUrl); updateItems(dlItems.map(it => it.id === item.id ? { ...it, fileUrl: '', fileName: '', pdfPages: undefined } : it)); }}
                                            className="text-red-400 text-[10px] font-medium hover:opacity-70 flex-shrink-0"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ) : (
                                        <label className="block cursor-pointer">
                                          <input
                                            type="file"
                                            className="hidden"
                                            onChange={async e => {
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
                                            }}
                                          />
                                          <div className="w-full h-10 flex items-center justify-center gap-1.5 rounded-lg text-xs transition-colors hover:opacity-60 cursor-pointer" style={{ border: `1.5px dashed ${C.inputBorder}`, color: C.faint }}>
                                            <Upload className="w-3.5 h-3.5" /> Click to upload file (max 20 MB)
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
                            )}

                            {/* Add buttons */}
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'file' }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all hover:opacity-80"
                                style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}
                              >
                                <Upload className="w-3 h-3" /> Add File
                              </button>
                              <button
                                type="button"
                                onClick={() => updateItems([...dlItems, { id: Math.random().toString(36).substring(7), title: '', type: 'link' }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all hover:opacity-80"
                                style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}
                              >
                                <Link2 className="w-3 h-3" /> Add Link
                              </button>
                            </div>
                          </div>}
                        </div>
                        {insertDivider}
                        </React.Fragment>
                      );
                    }

                    return (
                    <React.Fragment key={q.id}>
                    <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow }}>
                      {/* Header */}
                      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
                        <span className="text-xs font-medium flex items-center gap-1.5 min-w-0" style={{ color: C.faint }}>
                          {q.lessonOnly
                            ? (<span className="truncate">{q.lesson?.title || 'Untitled lesson'}</span>)
                            : (<>Q{qIdx + 1}{q.question ? <span className="truncate" style={{ color: C.muted }}> · {q.question}</span> : null}</>)
                          }
                        </span>
                        <div className="flex items-center gap-1.5">
                          {/* Type selector */}
                          <button
                            type="button"
                            onClick={() => setPickerCtx({ mode: 'change', qId: q.id })}
                            className="flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 transition-opacity hover:opacity-70 cursor-pointer"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}
                          >
                            {TYPE_LABELS[qType] ?? qType}
                            <ChevronDown className="w-3 h-3 ml-0.5 flex-shrink-0" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuestion(q.id, {
                              lessonOnly: !q.lessonOnly,
                              // auto-open lesson panel when enabling lesson-only mode
                              ...(!q.lessonOnly && !q.lesson ? { lesson: { title: '', body: '', imageUrl: '', videoUrl: '' } } : {}),
                            })}
                            title="Lesson only (no question)"
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
                            style={q.lessonOnly ? { background: accentColor, color: C.ctaText } : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                          >
                            <BookOpen className="w-3 h-3" /> Lesson only
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuestion(q.id, { lockUntilPrevious: !q.lockUntilPrevious })}
                            title={q.lockUntilPrevious ? 'Locked until the previous lesson is completed' : 'Lock until the previous lesson is completed'}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
                            style={q.lockUntilPrevious ? { background: accentColor, color: C.ctaText } : { background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
                          >
                            {q.lockUntilPrevious ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />} Lock
                          </button>
                          <button type="button" onClick={() => handleRemoveQuestion(q.id)} className="p-1 transition-colors hover:text-red-400" style={{ color: C.faint }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="p-3.5 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {!q.lessonOnly && ['multiple_choice', 'code'].includes(qType) && (<>
                          <button
                            type="button"
                            onClick={() => generateQuestionAsset(q, 'generate_distractors')}
                            disabled={!!aiLoadingLabel}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                          >
                            {busyQuestionId === q.id && aiLoadingLabel === 'Generating distractors...' ? 'Generating...' : 'AI Distractors'}
                          </button>
                          </>)}
                          <button
                            type="button"
                            onClick={() => setLessonPromptModal({ q })}
                            disabled={!!aiLoadingLabel}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                          >
                            {busyQuestionId === q.id && aiLoadingLabel === 'Generating lesson...' ? 'Generating…' : 'AI Lesson'}
                          </button>
                          {!q.lessonOnly && !(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (<>
                          <button
                            type="button"
                            onClick={() => generateQuestionAsset(q, 'generate_hint')}
                            disabled={!!aiLoadingLabel}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                          >
                            {busyQuestionId === q.id && aiLoadingLabel === 'Generating hint...' ? 'Generating...' : 'AI Hint'}
                          </button>
                          <button
                            type="button"
                            onClick={() => generateQuestionAsset(q, 'generate_explanation')}
                            disabled={!!aiLoadingLabel}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                          >
                            {busyQuestionId === q.id && aiLoadingLabel === 'Generating explanation...' ? 'Generating...' : 'AI Explanation'}
                          </button>
                          </>)}
                        </div>
                        {!q.lessonOnly && (<>

                        {/* Question text -- hidden for review types and exercise types that have their own task field */}
                        {!(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (
                        <div>
                          <label className={labelCls} style={labelStyle}>Question</label>
                          <input type="text" value={q.question} onChange={e => handleUpdateQuestion(q.id, { question: e.target.value })} className={inputCls} style={inputStyle}
                            placeholder={qType === 'fill_blank' ? 'e.g. The capital of France is ___' : 'Enter your question...'} />
                          {qType === 'fill_blank' && <p className="text-[10px] mt-1" style={{ color: C.faint }}>Tip: use ___ to mark where the blank is.</p>}
                        </div>
                        )}

                        {/* Code snippet section */}
                        {qType === 'code' && (
                          <div className="space-y-2">
                            <label className={labelCls} style={labelStyle}>Code Snippet</label>
                            <select
                              value={q.codeLanguage || 'javascript'}
                              onChange={e => handleUpdateQuestion(q.id, { codeLanguage: e.target.value })}
                              className={`${inputCls} py-1.5`}
                              style={inputStyle}
                            >
                              {['javascript', 'python', 'typescript', 'java', 'c', 'cpp', 'go', 'rust', 'sql'].map(lang => (
                                <option key={lang} value={lang}>{lang}</option>
                              ))}
                            </select>
                            <AiTextarea
                              value={q.codeSnippet || ''}
                              onValueChange={value => handleUpdateQuestion(q.id, { codeSnippet: value })}
                              className={`${inputCls} min-h-[120px] resize-y font-mono text-xs`}
                              style={inputStyle}
                              placeholder="Paste your code snippet here..."
                            />
                          </div>
                        )}

                        {/* Image options -- each option is an image */}
                        {qType === 'image' && (
                          <div className="space-y-2">
                            <label className={labelCls} style={labelStyle}>Image Options <span style={{ color: C.faint }}>(● = correct)</span></label>
                            <div className="grid grid-cols-2 gap-2">
                              {q.options.map((opt, optIdx) => {
                                const imgSrc = (q.optionImages || [])[optIdx] || '';
                                return (
                                  <div key={optIdx} className="relative rounded-lg overflow-hidden transition-colors" style={{ border: `2px solid ${q.correctAnswer === opt ? accentColor : C.inputBorder}` }}>
                                    {imgSrc ? (
                                      <div className="relative group">
                                        <img src={imgSrc} alt="" className="w-full h-20 object-cover" />
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <button
                                            onClick={() => {
                                              const newImages = [...(q.optionImages || q.options.map(() => ''))];
                                              newImages[optIdx] = '';
                                              handleUpdateQuestion(q.id, { optionImages: newImages });
                                            }}
                                            className="text-red-400 text-[10px] font-medium flex items-center gap-1"
                                          >
                                            <Trash2 className="w-3 h-3" /> Remove
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <label className="block cursor-pointer">
                                        <input type="file" accept="image/*" className="hidden" onChange={e => handleQuestionImageUpload(q.id, e, optIdx)} />
                                        <div className="w-full h-20 flex items-center justify-center gap-1 text-[10px] transition-colors hover:opacity-60" style={{ color: C.faint }}>
                                          <ImageIcon className="w-3 h-3" /> Upload
                                        </div>
                                      </label>
                                    )}
                                    <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderTop: `1px solid ${C.divider}` }}>
                                      <input type="radio" name={`correct-${q.id}`} checked={q.correctAnswer === opt}
                                        onChange={() => handleUpdateQuestion(q.id, { correctAnswer: opt })}
                                        className="w-3 h-3 flex-shrink-0" style={{ accentColor: accentColor }} />
                                      <span className="text-[10px]" style={{ color: C.faint }}>Option {optIdx + 1}</span>
                                      {q.options.length > 2 && (
                                        <button type="button" onClick={() => {
                                          deleteUploadedFile((q.optionImages || [])[optIdx]);
                                          const newOpts = q.options.filter((_, i) => i !== optIdx);
                                          const newImages = (q.optionImages || q.options.map(() => '')).filter((_, i) => i !== optIdx);
                                          const u: Partial<CourseQuestion> = { options: newOpts, optionImages: newImages };
                                          if (q.correctAnswer === opt) u.correctAnswer = newOpts[0] ?? '0';
                                          handleUpdateQuestion(q.id, u);
                                        }} className="ml-auto transition-colors hover:text-red-400" style={{ color: C.faint }}>
                                          <X className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <button type="button" onClick={() => {
                              const newIdx = String(q.options.length);
                              const newOpts = [...q.options, newIdx];
                              const newImages = [...(q.optionImages || q.options.map(() => '')), ''];
                              handleUpdateQuestion(q.id, { options: newOpts, optionImages: newImages });
                            }} className="text-xs transition-colors flex items-center gap-1 mt-1 hover:opacity-60" style={{ color: C.muted }}>
                              <Plus className="w-3 h-3" /> Add option
                            </button>
                          </div>
                        )}

                        {/* Multiple choice options (also used for code type) */}
                        {(qType === 'multiple_choice' || qType === 'code') && (
                          <div className="space-y-1.5">
                            <label className={labelCls} style={labelStyle}>Options <span style={{ color: C.faint }}>(● = correct)</span></label>
                            {q.options.map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-2">
                                <input type="radio" name={`correct-${q.id}`} checked={q.correctAnswer === opt}
                                  onChange={() => handleUpdateQuestion(q.id, { correctAnswer: opt })}
                                  className="w-3.5 h-3.5 flex-shrink-0" style={{ accentColor: accentColor }} />
                                <input type="text" value={opt}
                                  onChange={e => {
                                    const newOpts = [...q.options]; newOpts[optIdx] = e.target.value;
                                    const u: Partial<CourseQuestion> = { options: newOpts };
                                    if (q.correctAnswer === opt) u.correctAnswer = e.target.value;
                                    handleUpdateQuestion(q.id, u);
                                  }}
                                  className={`${inputCls} py-1.5 flex-1`} style={inputStyle} />
                                {q.options.length > 2 && (
                                  <button type="button" onClick={() => {
                                    const newOpts = q.options.filter((_, i) => i !== optIdx);
                                    const u: Partial<CourseQuestion> = { options: newOpts };
                                    if (q.correctAnswer === opt) u.correctAnswer = newOpts[0] ?? '';
                                    handleUpdateQuestion(q.id, u);
                                  }} className="transition-colors flex-shrink-0 hover:text-red-400" style={{ color: C.faint }}>
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => {
                              const newOpts = [...q.options, `Option ${q.options.length + 1}`];
                              handleUpdateQuestion(q.id, { options: newOpts });
                            }} className="text-xs transition-colors flex items-center gap-1 mt-1 hover:opacity-60" style={{ color: C.muted }}>
                              <Plus className="w-3 h-3" /> Add option
                            </button>
                          </div>
                        )}

                        {/* Fill in the blank -- correct answer */}
                        {qType === 'fill_blank' && (
                          <div>
                            <label className={labelCls} style={labelStyle}>Correct answer</label>
                            <input type="text" value={q.correctAnswer}
                              onChange={e => handleUpdateQuestion(q.id, { correctAnswer: e.target.value })}
                              className={inputCls} style={inputStyle} placeholder="e.g. Paris" />
                            <p className="text-[10px] mt-1" style={{ color: C.faint }}>Separate multiple accepted answers with | (e.g. Paris|paris|PARIS)</p>
                          </div>
                        )}

                        {/* Arrange -- ordered items */}
                        {qType === 'arrange' && (
                          <div className="space-y-1.5">
                            <label className={labelCls} style={labelStyle}>Items <span style={{ color: C.faint }}>(top = first in correct order)</span></label>
                            {q.options.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex items-center gap-2">
                                <span className="text-[10px] font-mono w-4 flex-shrink-0 text-right" style={{ color: C.faint }}>{itemIdx + 1}</span>
                                <input type="text" value={item}
                                  onChange={e => {
                                    const newOpts = [...q.options]; newOpts[itemIdx] = e.target.value;
                                    handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                  }}
                                  className={`${inputCls} py-1.5 flex-1`} style={inputStyle} />
                                {q.options.length > 2 && (
                                  <button type="button" onClick={() => {
                                    const newOpts = q.options.filter((_, i) => i !== itemIdx);
                                    handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                                  }} className="transition-colors flex-shrink-0 hover:text-red-400" style={{ color: C.faint }}>
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => {
                              const newOpts = [...q.options, `Item ${q.options.length + 1}`];
                              handleUpdateQuestion(q.id, { options: newOpts, correctAnswer: newOpts.join('|||') });
                            }} className="text-xs transition-colors flex items-center gap-1 mt-1 hover:opacity-60" style={{ color: C.muted }}>
                              <Plus className="w-3 h-3" /> Add item
                            </button>
                          </div>
                        )}

                        {/* AI Review config */}
                        {(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'] as const).includes(qType as any) && (
                          <div className="space-y-3 rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>
                              {qType === 'code_review' ? 'Code Review' : qType === 'excel_review' ? 'Excel Review' : qType === 'dashboard_critique' ? 'Dashboard Critique' : qType === 'written_response' ? 'Written Response' : 'Document Review'} Config
                            </p>

                            {/* Project prompt / brief */}
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

                            {/* Language (code_review only) */}
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

                            {/* Schema (code_review only) */}
                            {qType === 'code_review' && (
                              <div>
                                <label className={labelCls} style={labelStyle}>Expected output / schema <span style={{ color: C.faint }}>(optional)</span></label>
                                <AiTextarea
                                  value={q.schema || ''}
                                  onValueChange={value => handleUpdateQuestion(q.id, { schema: value })}
                                  className={`${inputCls} min-h-[60px] resize-y font-mono text-xs`}
                                  style={inputStyle}
                                  placeholder="Describe or paste the expected output..."
                                />
                              </div>
                            )}

                            {/* Context (excel_review / dashboard_critique / document_review / written_response) */}
                            {(qType === 'excel_review' || qType === 'dashboard_critique' || qType === 'document_review' || qType === 'written_response') && (
                              <div>
                                <label className={labelCls} style={labelStyle}>
                                  {qType === 'document_review' ? 'Report scope / context' : qType === 'written_response' ? 'Context for the AI reviewer' : 'Dataset / context'} <span style={{ color: C.faint }}>(optional)</span>
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
                                <label className={labelCls} style={labelStyle}>Model answer <span style={{ color: C.faint }}>(optional, never shown to students)</span></label>
                                <AiTextarea
                                  value={q.expectedAnswer || ''}
                                  onValueChange={value => handleUpdateQuestion(q.id, { expectedAnswer: value })}
                                  className={`${inputCls} min-h-[72px] resize-y`}
                                  style={inputStyle}
                                  placeholder="What a strong answer covers. The AI grades against this instead of guessing."
                                />
                              </div>
                              <div>
                                <label className={labelCls} style={labelStyle}>Maximum words <span style={{ color: C.faint }}>(0 for no limit)</span></label>
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

                            {/* Review mode (document_review only) */}
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


                            {/* Rubric */}
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
                                      style={{ background: C.pill, color: C.muted, opacity: extractingRubric && !busy ? 0.5 : 1, cursor: extractingRubric ? 'not-allowed' : 'pointer' }}>
                                      {busy ? <><Loader2 className="w-3 h-3 animate-spin"/> Extracting...</> : <><Upload className="w-3 h-3"/> Upload Reference Solution</>}
                                    </button>
                                  </>
                                ); })()}
                              </div>
                              <p className="text-xs mb-2" style={{ color: C.faint }}>Upload the completed reference file to auto-extract rubric criteria.</p>
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
                                      style={{ color: C.faint }}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => handleUpdateQuestion(q.id, { rubric: [...(q.rubric || []), ''] })}
                                  className="text-xs transition-colors flex items-center gap-1 mt-1 hover:opacity-60"
                                  style={{ color: C.muted }}
                                >
                                  <Plus className="w-3 h-3" /> Add criterion
                                </button>
                              </div>
                            </div>

                            {/* Min score */}
                            {/* Min score -- not shown for manual review mode */}
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
                          <div className="space-y-3 rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>SQL Exercise Config</p>

                            <div>
                              <label className={labelCls} style={labelStyle}>Student task</label>
                              <AiTextarea
                                value={q.question}
                                onValueChange={value => handleUpdateQuestion(q.id, { question: value })}
                                className={`${inputCls} min-h-[72px] resize-y`}
                                style={inputStyle}
                                placeholder="Ask the student to write a query..."
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <label className={labelCls} style={labelStyle}>Tables</label>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateQuestion(q.id, { sqlTables: [...(q.sqlTables ?? []), { id: Math.random().toString(36).slice(2, 9), tableName: 'table_name', fileName: '', fileUrl: '', csvUrl: '' }] })}
                                  className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                                  style={{ background: C.pill, color: C.muted }}
                                >
                                  <Plus className="w-3 h-3 inline mr-1" /> Add table
                                </button>
                              </div>
                              {(q.sqlTables ?? []).map((table, tableIdx) => (
                                <div key={table.id ?? tableIdx} className="grid gap-2 rounded-lg p-2" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                                  <div className="flex gap-2">
                                    <input
                                      value={table.tableName}
                                      onChange={e => {
                                        const tables = [...(q.sqlTables ?? [])];
                                        tables[tableIdx] = { ...table, tableName: e.target.value };
                                        handleUpdateQuestion(q.id, { sqlTables: tables });
                                      }}
                                      className={`${inputCls} flex-1 py-1.5`}
                                      style={inputStyle}
                                      placeholder="orders"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => { deleteUploadedFile(q.sqlTables?.[tableIdx]?.fileUrl); handleUpdateQuestion(q.id, { sqlTables: (q.sqlTables ?? []).filter((_, i) => i !== tableIdx) }); }}
                                      className="px-2 rounded-lg hover:text-red-400"
                                      style={{ color: C.faint }}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.inputBorder}` }}>
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
                                            style={{ background: active ? accentColor : C.pill, color: active ? C.ctaText : C.muted }}
                                          >
                                            {mode === 'upload' ? 'Upload' : 'Seed SQL'}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: C.pill, color: C.muted }}>
                                      <Upload className="w-3 h-3" /> Upload CSV/XLSX
                                      <input type="file" className="hidden" accept=".csv,.tsv,.xlsx" onChange={e => handleSqlDatasetUpload(q.id, table.id ?? String(tableIdx), e)} />
                                    </label>
                                    <span className="text-xs truncate" style={{ color: C.faint }}>{table.fileName || table.fileUrl || 'No file uploaded'}</span>
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
                              <label className={labelCls} style={labelStyle}>Solution SQL <span style={{ color: C.faint }}>(hidden from students)</span></label>
                              <AiTextarea value={q.sqlSolution ?? ''} onValueChange={value => handleUpdateQuestion(q.id, { sqlSolution: value, sqlExpectedResult: undefined })} className={`${inputCls} min-h-[96px] resize-y font-mono text-xs`} style={inputStyle} placeholder="SELECT ..." />
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <button type="button" onClick={() => computeSqlExpectedResult(q.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: C.ctaText }}>
                                  Compute expected result
                                </button>
                                <span className="text-xs" style={{ color: q.sqlExpectedResult ? '#10b981' : C.faint }}>
                                  {q.sqlExpectedResult ? `${q.sqlExpectedResult.rows.length} expected row(s) saved` : 'Expected result not computed'}
                                </span>
                              </div>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-2">
                              <label className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
                                <input type="checkbox" checked={!!q.sqlResultOrdered} onChange={e => handleUpdateQuestion(q.id, { sqlResultOrdered: e.target.checked })} />
                                Require row order
                              </label>
                              <input type="number" value={q.sqlNumericTolerance ?? 0} onChange={e => handleUpdateQuestion(q.id, { sqlNumericTolerance: Number(e.target.value) })} className={`${inputCls} py-1.5`} style={inputStyle} placeholder="Numeric tolerance" />
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Required SQL patterns <span style={{ color: C.faint }}>(optional)</span></label>
                              <AiTextarea
                                value={(q.sqlRequiredPatterns ?? []).join('\n')}
                                onValueChange={value => handleUpdateQuestion(q.id, { sqlRequiredPatterns: value.split('\n').map(s => s.trim()).filter(Boolean) })}
                                className={`${inputCls} min-h-[64px] resize-y font-mono text-xs`}
                                style={inputStyle}
                                placeholder={`LIMIT\nORDER BY\n/^SELECT\\s+\\*\\s+FROM\\s+employees\\s+LIMIT\\s+10\\s*;?$/i`}
                              />
                              <p className="mt-1 text-[11px]" style={{ color: C.faint }}>One per line. Plain words must appear as SQL keywords; /regex/i is also supported.</p>
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Hints</label>
                              <AiTextarea
                                value={(q.sqlHints ?? []).join('\n')}
                                onValueChange={value => handleUpdateQuestion(q.id, { sqlHints: value.split('\n').map(s => s.trim()).filter(Boolean) })}
                                className={`${inputCls} min-h-[70px] resize-y`}
                                style={inputStyle}
                                placeholder="One hint per line"
                              />
                            </div>
                          </div>
                        )}

                        {qType === 'python_exercise' && (
                          <div className="space-y-3 rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accentColor }}>Python Exercise Config</p>

                            <div>
                              <label className={labelCls} style={labelStyle}>Student task</label>
                              <RichTextEditor value={q.question} onChange={html => handleUpdateQuestion(q.id, { question: html })} placeholder="Describe what the student should write..." enableAiAssist />
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <label className={labelCls} style={labelStyle}>Datasets</label>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: [...(q.pythonDatasets ?? []), { id: Math.random().toString(36).slice(2, 9), variableName: 'df', fileName: '', fileUrl: '', csvUrl: '' }] })}
                                  className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                                  style={{ background: C.pill, color: C.muted }}
                                >
                                  <Plus className="w-3 h-3 inline mr-1" /> Add dataset
                                </button>
                              </div>
                              {(q.pythonDatasets ?? []).map((ds, dsIdx) => (
                                <div key={ds.id} className="grid gap-2 rounded-lg p-2" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
                                  <div className="flex gap-2">
                                    <input
                                      value={ds.variableName}
                                      onChange={e => {
                                        const datasets = [...(q.pythonDatasets ?? [])];
                                        datasets[dsIdx] = { ...ds, variableName: e.target.value };
                                        handleUpdateQuestion(q.id, { pythonDatasets: datasets });
                                      }}
                                      className={`${inputCls} flex-1 py-1.5 font-mono`}
                                      style={inputStyle}
                                      placeholder="df"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateQuestion(q.id, { pythonDatasets: (q.pythonDatasets ?? []).filter((_, i) => i !== dsIdx) })}
                                      className="px-2 rounded-lg hover:text-red-400"
                                      style={{ color: C.faint }}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: C.pill, color: C.muted }}>
                                      <Upload className="w-3 h-3" /> Upload CSV
                                      <input type="file" className="hidden" accept=".csv,.tsv" onChange={e => handlePythonDatasetUpload(q.id, ds.id, e)} />
                                    </label>
                                    <span className="text-xs truncate" style={{ color: C.faint }}>{ds.fileName || ds.fileUrl || 'No file uploaded'}</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Setup code <span style={{ color: C.faint }}>(optional, runs before student code)</span></label>
                              <AiTextarea
                                value={q.pythonSetupCode ?? ''}
                                onValueChange={value => handleUpdateQuestion(q.id, { pythonSetupCode: value, pythonExpectedOutput: '' })}
                                className={`${inputCls} min-h-[84px] resize-y font-mono text-xs`}
                                style={inputStyle}
                                placeholder="# import libraries or define helper data here"
                              />
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Starter code</label>
                              <AiTextarea
                                value={q.pythonStarterCode ?? ''}
                                onValueChange={value => handleUpdateQuestion(q.id, { pythonStarterCode: value })}
                                className={`${inputCls} min-h-[84px] resize-y font-mono text-xs`}
                                style={inputStyle}
                                placeholder="# Write your solution here"
                              />
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Solution <span style={{ color: C.faint }}>(hidden from students)</span></label>
                              <AiTextarea
                                value={q.pythonSolution ?? ''}
                                onValueChange={value => handleUpdateQuestion(q.id, { pythonSolution: value, pythonExpectedOutput: '' })}
                                className={`${inputCls} min-h-[96px] resize-y font-mono text-xs`}
                                style={inputStyle}
                                placeholder="# Correct solution"
                              />
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <button type="button" onClick={() => computePythonExpectedOutput(q.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: accentColor, color: C.ctaText }}>
                                  Compute expected output
                                </button>
                                <span className="text-xs" style={{ color: q.pythonExpectedOutput ? '#10b981' : C.faint }}>
                                  {q.pythonExpectedOutput ? 'Expected output saved' : 'Expected output not computed'}
                                </span>
                              </div>
                              {q.pythonExpectedOutput && (
                                <pre className="mt-2 rounded-lg p-2 text-[11px] font-mono overflow-auto max-h-24" style={{ background: C.pill, color: C.muted }}>
                                  {q.pythonExpectedOutput}
                                </pre>
                              )}
                            </div>

                            <div>
                              <label className={labelCls} style={labelStyle}>Hints</label>
                              <AiTextarea
                                value={(q.pythonHints ?? []).join('\n')}
                                onValueChange={value => handleUpdateQuestion(q.id, { pythonHints: value.split('\n').map((s: string) => s.trim()).filter(Boolean) })}
                                className={`${inputCls} min-h-[70px] resize-y`}
                                style={inputStyle}
                                placeholder="One hint per line"
                              />
                            </div>
                          </div>
                        )}

                        {/* Hint and explanation -- not shown for AI review types or exercise types */}
                        {!(['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response', 'sql_exercise', 'python_exercise'] as const).includes(qType as any) && (<>
                        <div>
                          <label className={labelCls} style={labelStyle}>Hint <span style={{ color: C.faint }}>(optional)</span></label>
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
                          <label className={labelCls} style={labelStyle}>Explanation <span style={{ color: C.faint }}>(shown after answering)</span></label>
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
                        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
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
                            style={{ color: C.muted }}
                          >
                            <span className="flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5" />
                              Lesson <span style={{ color: C.faint }}>(optional)</span>
                            </span>
                            {lessonOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          {lessonOpen && q.lesson && (
                            <div className="px-3 py-3 space-y-2" style={{ borderTop: `1px solid ${C.divider}` }}>
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
                              {q.lesson.imageUrl ? (
                                <div className="relative group rounded-lg overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
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
                                  <div className="w-full h-10 flex items-center justify-center gap-1.5 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: C.groupBg, color: C.muted }}>
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
                                  <span className="text-xs flex-1 truncate" style={{ color: C.text }}>
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
                                  <div className="w-full h-10 flex items-center justify-center gap-1.5 rounded-lg text-xs transition-colors hover:opacity-70" style={{ background: C.groupBg, color: C.muted }}>
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
                                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: C.groupBg, color: C.muted }}>
                                    <FileCode className="w-3.5 h-3.5"/> HTML
                                  </div>
                                </label>
                              </div>
                              {(() => {
                                const vurl = q.lesson.videoUrl || '';
                                const embedUrl = safeEmbedUrl(vurl);
                                return embedUrl ? (
                                  <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
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
                                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70" style={{ background: C.groupBg, color: C.muted }}>
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
                              {q.lesson.audioUrl && <LessonAudioPlayer src={q.lesson.audioUrl} isDark={theme === 'dark'} />}
                            </div>
                          )}
                          </>);
                          })()}
                        </div>
                      </div>
                    </div>
                    {insertDivider}
                    </React.Fragment>
                    );
                  })}
                  {(!formConfig.questions || formConfig.questions.length === 0) && <p className="text-xs text-center py-3" style={{ color: C.faint }}>No questions yet.</p>}

                  {/* Add question row */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPickerCtx({ mode: 'bottom' })}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all flex-1 hover:opacity-80"
                      style={{ background: accentColor, color: C.ctaText }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Content
                    </button>
                    <button type="button" onClick={handleAddSection} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all flex-shrink-0 hover:opacity-80" style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}>
                      <Plus className="w-3.5 h-3.5" /> Section
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'fields' && !formConfig.isCourse && (
              <div className="space-y-5">
                <div className="space-y-2">
                  {/* Field cards -- drag to reorder */}
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
                          <div style={{ background: C.card, border: `1.5px solid ${C.lime}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: `0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px ${C.lime}22`, cursor: 'grabbing', transform: 'rotate(1.5deg) scale(1.02)', transformOrigin: 'center' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.lime} strokeWidth="2.5"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>{field.label || 'Untitled field'}</span>
                            <span style={{ fontSize: 10, fontWeight: 500, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', background: C.pill, padding: '2px 7px', borderRadius: 5 }}>{field.type}</span>
                          </div>
                        );
                      })() : null}
                    </DragOverlay>
                  </DndContext>

                  {formConfig.fields.length === 0 && <p className="text-xs text-center py-3" style={{ color: C.faint }}>No fields yet.</p>}

                  {/* Add new field */}
                  <div className="pt-3 space-y-2.5 mt-2" style={{ borderTop: `1px solid ${C.divider}` }}>
                    <p className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: C.faint }}>Add Field</p>
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

                    {/* Conditional extras */}
                    {newFieldType === 'select' && (
                      <input type="text" placeholder="Options: Yes, No, Maybe" value={newFieldOptions} onChange={e => setNewFieldOptions(e.target.value)} className={inputCls} style={inputStyle} />
                    )}
                    {newFieldType === 'social' && (
                      <div>
                        <label className={labelCls} style={labelStyle}>Platforms to include</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {SOCIAL_PLATFORMS.map(p => (
                            <label key={p.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors" style={{ background: newSocialPlatforms.includes(p.id) ? `${accentColor}18` : C.input, border: `1px solid ${newSocialPlatforms.includes(p.id) ? accentColor : C.inputBorder}`, color: newSocialPlatforms.includes(p.id) ? accentColor : C.muted }}>
                              <input type="checkbox" checked={newSocialPlatforms.includes(p.id)} onChange={e => { if (e.target.checked) setNewSocialPlatforms(prev => [...prev, p.id]); else setNewSocialPlatforms(prev => prev.filter(id => id !== p.id)); }} className="hidden" />
                              <SocialIcon id={p.id} size={14} />
                              <span className="text-xs font-medium">{p.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Required toggle -- not shown for description blocks */}
                    {newFieldType !== 'description' && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs" style={{ color: C.muted }}>Mark as required?</span>
                        <Toggle checked={newFieldRequired} onChange={() => setNewFieldRequired(!newFieldRequired)} accentColor={accentColor} />
                      </div>
                    )}

                    <button type="button" onClick={handleAddField} disabled={newFieldType !== 'description' && !newFieldLabel.trim()} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80" style={{ background: accentColor, color: C.ctaText }}>
                      <Plus className="w-4 h-4" /> {newFieldType === 'description' ? 'Add Description Block' : 'Add Field'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeStudioMode.id === 'settings' && formConfig.isCourse && (
              <div className={studioPanelClass} style={{ ...studioPanelStyle, order: 1 }}>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Points &amp; rewards</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Recognize meaningful progress with XP, streaks, and milestones.</p></div>
              <div className="space-y-3">
                {/* Enable toggle */}
                <div className="flex items-center justify-between rounded-xl p-4" style={{ background: formConfig.pointsSystem?.enabled ? `${accentColor}0e` : C.groupBg, border: `1px solid ${formConfig.pointsSystem?.enabled ? `${accentColor}40` : C.inputBorder}` }}>
                  <div>
                    <p className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>Enable points system</p>
                    <p className="text-[10px] mt-0.5" style={{ color: C.faint }}>Gamify your course with XP, streaks & rewards</p>
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
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`} style={labelStyle}>Base points per question</label>
                        <span className="text-xs font-semibold" style={{ color: accentColor }}>{formConfig.pointsSystem?.basePoints ?? 50} pts</span>
                      </div>
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                        {[50, 100, 200, 500].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, basePoints: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.basePoints ?? 50) === n ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Time bonus */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`} style={labelStyle}>Time bonus</label>
                        <SwitchToggle
                          checked={formConfig.pointsSystem?.timeBonusEnabled ?? true}
                          onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusEnabled: v } })}
                          accentColor={accentColor}
                        />
                      </div>
                      {(formConfig.pointsSystem?.timeBonusEnabled ?? true) && (
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <label className={`${labelCls} mb-0 flex-1`} style={labelStyle}>Within (seconds)</label>
                            <input type="number" min="3" max="60"
                              value={formConfig.pointsSystem?.timeBonusSeconds ?? 10}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusSeconds: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`} style={inputStyle}
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className={`${labelCls} mb-0 flex-1`} style={labelStyle}>Multiplier</label>
                            <select
                              value={formConfig.pointsSystem?.timeBonusMultiplier ?? 1.5}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, timeBonusMultiplier: Number(e.target.value) } })}
                              className={`${inputCls} w-24 py-1.5`} style={inputStyle}
                            >
                              {[1.2, 1.5, 2.0, 3.0].map(m => <option key={m} value={m}>{m}x</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Streak bonus */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`} style={labelStyle}>Hot streak bonus</label>
                        <SwitchToggle
                          checked={formConfig.pointsSystem?.streakEnabled ?? true}
                          onChange={v => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakEnabled: v } })}
                          accentColor={accentColor}
                        />
                      </div>
                      {(formConfig.pointsSystem?.streakEnabled ?? true) && (
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <label className={`${labelCls} mb-0 flex-1`} style={labelStyle}>Trigger after N correct</label>
                            <input type="number" min="2" max="10"
                              value={formConfig.pointsSystem?.streakCount ?? 3}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakCount: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`} style={inputStyle}
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <label className={`${labelCls} mb-0 flex-1`} style={labelStyle}>Bonus points</label>
                            <input type="number" min="10" max="500"
                              value={formConfig.pointsSystem?.streakBonus ?? 50}
                              onChange={e => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, streakBonus: Number(e.target.value) } })}
                              className={`${inputCls} w-20 py-1.5`} style={inputStyle}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hint penalty */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`} style={labelStyle}>Hint cost (points)</label>
                        <span className="text-xs font-semibold text-rose-500">-{formConfig.pointsSystem?.hintPenalty ?? 20} pts</span>
                      </div>
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                        {[10, 20, 50, 100].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, hintPenalty: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.hintPenalty ?? 20) === n ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Solution penalty */}
                    <div className="space-y-3 border-t pt-5" style={{ borderColor: C.divider }}>
                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`} style={labelStyle}>View solution cost (XP)</label>
                        <span className="text-xs font-semibold text-rose-500">-{formConfig.pointsSystem?.solutionPenalty ?? 30} XP</span>
                      </div>
                      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl p-1" style={{ background: C.groupBg }}>
                        {[10, 20, 30, 50].map(n => (
                          <button key={n} type="button"
                            onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, solutionPenalty: n } })}
                            className="min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
                            style={(formConfig.pointsSystem?.solutionPenalty ?? 30) === n ? { background: accentColor, color: 'white' } : { background: 'transparent', color: C.muted }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>

                    {/* Milestones */}
                    <div className="space-y-2">
                      <label className={labelCls} style={labelStyle}>Reward milestones</label>
                      {(formConfig.pointsSystem?.milestones ?? []).map((m, i) => (
                        <div key={m.id} className="p-3 rounded-xl space-y-2" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold" style={{ color: accentColor }}>{m.points} pts</span>
                            <button type="button"
                              onClick={() => updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: (formConfig.pointsSystem?.milestones ?? []).filter((_, j) => j !== i) } })}
                              className="transition-colors hover:text-red-400" style={{ color: C.faint }}
                            ><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                          <input type="number" placeholder="Points threshold"
                            value={m.points}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], points: Number(e.target.value) };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`} style={inputStyle}
                          />
                          <input type="text" placeholder="Label (e.g. SQL Cheat Sheet)"
                            value={m.label}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], label: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`} style={inputStyle}
                          />
                          <input type="text" placeholder="Description (e.g. Downloadable cheat sheet)"
                            value={m.description}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], description: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`} style={inputStyle}
                          />
                          <input type="url" placeholder="Reward URL (optional)"
                            value={m.rewardUrl ?? ''}
                            onChange={e => {
                              const ms = [...(formConfig.pointsSystem?.milestones ?? [])];
                              ms[i] = { ...ms[i], rewardUrl: e.target.value };
                              updateConfig({ pointsSystem: { ...defaultPoints, ...formConfig.pointsSystem, milestones: ms } });
                            }}
                            className={`${inputCls} py-1.5`} style={inputStyle}
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
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors hover:opacity-70"
                        style={{ border: `1.5px dashed ${C.inputBorder}`, color: C.muted }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add milestone
                      </button>
                    </div>
                  </>
                )}
              </div>
              </div>
            )}

            {((formConfig.isCourse && activeStudioMode.id === 'publish') || (!formConfig.isCourse && activeSection === 'submission')) && (
              <div className={formConfig.isCourse ? studioPanelClass : 'space-y-5'} style={formConfig.isCourse ? { ...studioPanelStyle, order: 1 } : undefined}>
              {formConfig.isCourse && <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Completion experience</p><p className="mt-1 text-xs" style={{ color: C.faint }}>Choose what learners see and where they go after finishing.</p></div>}
              <div className="space-y-3">
                {/* Type selector */}
                <div>
                  <label className={labelCls} style={labelStyle}>What happens after submission</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { value: 'default', label: 'Thank you', description: 'Show the standard completion screen', Icon: Check },
                      { value: 'redirect', label: 'Redirect URL', description: 'Send learners to another page', Icon: Link2 },
                      { value: 'button', label: 'CTA Button', description: 'Offer one clear next action', Icon: Share2 },
                      { value: 'events', label: 'Show Events', description: 'Recommend related experiences', Icon: Globe },
                      { value: 'notice', label: 'Notice', description: 'Display a custom final message', Icon: FileText },
                    ] as const).map(({ value, label, description, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateConfig({ postSubmission: { ...formConfig.postSubmission, type: value } as any })}
                        className="flex min-h-20 items-start gap-3 rounded-xl p-3 text-left transition-all"
                        style={(formConfig.postSubmission?.type ?? 'default') === value ? { background: `${accentColor}10`, color: accentColor, border: `1px solid ${accentColor}55` } : { background: C.groupBg, border: `1px solid ${C.inputBorder}`, color: C.muted }}
                      >
                        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={{ background: (formConfig.postSubmission?.type ?? 'default') === value ? `${accentColor}18` : C.pill }}><Icon className="h-4 w-4" /></span>
                        <span><span className="block text-xs font-bold" style={{ color: (formConfig.postSubmission?.type ?? 'default') === value ? accentColor : C.text }}>{label}</span><span className="mt-1 block text-[10px] leading-snug" style={{ color: C.faint }}>{description}</span></span>
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
                    <p className="text-[10px] mt-1" style={{ color: C.faint }}>Users will be automatically redirected after submitting.</p>
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

                {/* Show Programs */}
                {(formConfig.postSubmission?.type === 'events') && (
                  <div className="space-y-2">
                    <label className={labelCls} style={labelStyle}>Select courses/events to show</label>
                    {availableForms.length === 0 ? (
                      <p className="text-[11px] py-2" style={{ color: C.faint }}>No other courses or events found.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                        {availableForms.map(f => {
                          const selected = (formConfig.postSubmission?.relatedEventIds || []).includes(f.id);
                          return (
                            <label key={f.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:opacity-80" style={{ background: selected ? `${accentColor}18` : C.input, border: `1px solid ${selected ? accentColor : C.inputBorder}` }}>
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
                              <span className="text-xs truncate flex-1" style={{ color: C.text }}>{(f as any).config?.title || f.title || f.slug}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0" style={{ background: (f as any)._type === 'course' ? '#3b82f620' : '#8b5cf620', color: (f as any)._type === 'course' ? '#3b82f6' : '#8b5cf6' }}>
                                {(f as any)._type === 'course' ? 'Course' : 'Event'}
                              </span>
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
              </div>
            )}

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
      <GeneratingOverlay visible={!!aiLoadingLabel} label={aiLoadingLabel || undefined} failed={aiFailed} />
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
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.text }}>Generate Course Description</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: C.faint }}>
                    Pick the tone, length, and any extra direction you want the AI to follow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDescriptionModalOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
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
                    style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={generateCourseDescription}
                    disabled={!!aiLoadingLabel}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: accentColor, color: C.ctaText }}
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
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.text }}>AI Event Assistant</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: C.faint }}>
                    Describe the event and AI will fill the setup, suggest registration fields, and draft a confirmation notice.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEventAssistantOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.faint }}
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
                    style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.text }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={generateEventSetup}
                    disabled={!!aiLoadingLabel}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: accentColor, color: C.ctaText }}
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

      {/* -- Toast notification -- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-xl w-[calc(100%-2rem)] max-h-[45vh] overflow-auto rounded-2xl px-4 py-3.5 flex items-start gap-3 shadow-xl"
            style={{
              background: C.card,
              border: `1px solid ${toast.type === 'error' ? 'rgba(239,68,68,0.25)' : toast.type === 'success' ? 'rgba(16,185,129,0.25)' : C.cardBorder}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}
          >
            <div className="w-2 self-stretch rounded-full flex-shrink-0 mt-0.5"
              style={{ background: toast.type === 'error' ? '#ef4444' : toast.type === 'success' ? '#10b981' : '#3b82f6' }}
            />
            <p className="text-sm leading-snug flex-1" style={{ color: C.text }}>{toast.message}</p>
            <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} className="flex-shrink-0 mt-0.5 hover:opacity-60 transition-opacity" style={{ color: C.faint }}>
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
              style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.text }}>Generate AI Lesson</p>
                  <p className="text-xs mt-0.5" style={{ color: C.faint }}>
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
                  <div className="rounded-lg px-3 py-2 text-xs" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}`, color: C.muted }}>
                    <span className="font-semibold" style={{ color: C.faint }}>Question: </span>{lessonPromptModal.q.question}
                  </div>
                )}
                <div>
                  <label className={labelCls} style={labelStyle}>
                    {lessonPromptModal.q.lessonOnly ? 'Topic / Instructions' : 'Custom Instructions'} <span style={{ color: C.faint, fontWeight: 400, textTransform: 'none' }}>{lessonPromptModal.q.lessonOnly ? '' : '(optional)'}</span>
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
              <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${C.cardBorder}` }}>
                <button type="button" onClick={() => setLessonPromptModal(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{ background: C.pill, border: `1px solid ${C.inputBorder}`, color: C.muted }}>
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
                  style={{ background: accentColor, color: C.ctaText }}
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
                  <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-xl" style={{ background: C.groupBg, border: `1px solid ${C.inputBorder}` }}>
                    <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                    <input
                      type="text"
                      value={bunnySearch}
                      onChange={e => setBunnySearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && openBunnyPicker(bunnyPickerQId!, bunnySearch, bunnyCollection)}
                      placeholder="Search videos..."
                      className="flex-1 bg-transparent text-sm outline-none"
                      style={{ color: C.text }}
                    />
                  </div>
                  <button
                    onClick={() => openBunnyPicker(bunnyPickerQId!, bunnySearch, bunnyCollection)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ background: '#FF6B35', color: 'white' }}
                  >Search</button>
                </div>
              </div>

              {/* Body: collections sidebar + video grid */}
              <div className="flex flex-1 overflow-hidden">
                {/* Collections sidebar */}
                {bunnyCollections.length > 0 && (
                  <div className="w-44 flex-shrink-0 overflow-y-auto py-2" style={{ borderRight: `1px solid ${C.cardBorder}` }}>
                    <button
                      onClick={() => { setBunnyCollection(''); openBunnyPicker(bunnyPickerQId!, bunnySearch, ''); }}
                      className="w-full text-left px-4 py-2 text-xs font-medium transition-colors"
                      style={{ background: bunnyCollection === '' ? `${C.green}18` : 'transparent', color: bunnyCollection === '' ? C.green : C.muted }}
                    >
                      All videos
                    </button>
                    {bunnyCollections.map(col => (
                      <button
                        key={col.guid}
                        onClick={() => { setBunnyCollection(col.guid); openBunnyPicker(bunnyPickerQId!, bunnySearch, col.guid); }}
                        className="w-full text-left px-4 py-2 text-xs transition-colors"
                        style={{ background: bunnyCollection === col.guid ? `${C.green}18` : 'transparent', color: bunnyCollection === col.guid ? C.green : C.muted }}
                      >
                        <span className="block font-medium truncate">{col.name}</span>
                        <span className="text-[10px]" style={{ color: C.faint }}>{col.videoCount} videos</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Video grid */}
                <div className="flex-1 overflow-y-auto p-4">
                  {bunnyLoading && (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/>
                    </div>
                  )}
                  {bunnyError && !bunnyLoading && (
                    <div className="text-center py-10 text-sm" style={{ color: '#ef4444' }}>{bunnyError}</div>
                  )}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length === 0 && (
                    <div className="text-center py-10 text-sm" style={{ color: C.faint }}>No videos found.</div>
                  )}
                  {!bunnyLoading && !bunnyError && bunnyVideos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {bunnyVideos.map(v => (
                        <button
                          key={v.guid}
                          onClick={() => selectBunnyVideo(v.embedUrl)}
                          className="text-left rounded-xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg group"
                          style={{ border: `1px solid ${C.cardBorder}`, background: C.groupBg }}
                        >
                          <div className="relative aspect-video bg-black overflow-hidden">
                            {v.thumbnail
                              ? <img src={v.thumbnail} alt={v.title}
                                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex'; }}
                                />
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
    </main>
  );
}
