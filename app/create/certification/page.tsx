'use client';

// Dedicated, thin certification authoring editor. Intentionally simpler than the course editor:
// no outline/left pane, no course nav, no points UI -- just exam settings + a sortable question
// list. Reuses the shared CourseQuestion shape, QuestionTypePicker, the dashboard theme,
// and the dnd-kit sortable pattern. Persists to /api/certifications.

import { useState, useEffect, useCallback, useMemo, useRef, Suspense, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, ChevronDown, ChevronUp, Plus, ArrowLeft, Loader2, Check, ImagePlus, Upload, FileText, BookOpen, Route, Search, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { DARK_C, useC, type ThemeColors } from '@/lib/theme';
import { inputCls, labelCls } from '@/components/create/shared';
import { MenuSelect } from '@/components/MenuSelect';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { FIELD } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { QuestionTypePicker, TYPE_LABELS, type QuestionTypeOrDownloads } from '@/components/create/QuestionTypePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { ImageLibrary } from '@/components/ImageLibrary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { CourseQuestion, QuestionType, SkillArea, CertificationPrepItem, CertificationType, PlaygroundData, CertificationScenario } from '@/lib/course-schema';

const EXAM_TYPES: QuestionTypeOrDownloads[] = ['multiple_choice', 'fill_blank', 'arrange', 'image', 'image_choice', 'code', 'python_exercise'];

type EditorTab = 'overview' | 'settings' | 'blueprint' | 'resources' | 'questions' | 'practice' | 'publish';

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Exam setup' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'resources', label: 'Resources' },
  { id: 'questions', label: 'Questions' },
  { id: 'practice', label: 'Practice' },
  { id: 'publish', label: 'Publish' },
];

// Type names in sentence case ("Multiple choice"), whatever casing the shared labels use.
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

const newId = () => { try { return crypto.randomUUID(); } catch { return `q-${Math.random().toString(36).slice(2)}`; } };

function blankQuestion(type: QuestionType): CourseQuestion {
  const base: CourseQuestion = { id: newId(), type, question: '', options: [], correctAnswer: '' };
  switch (type) {
    case 'multiple_choice':
    case 'code':
      return { ...base, options: ['', '', '', ''], correctAnswer: '' };
    case 'image_choice':
      return { ...base, options: ['', '', '', ''], correctAnswer: '', imageUrl: '' };
    case 'image':
      return { ...base, options: ['', ''], optionImages: ['', ''], correctAnswer: '0' };
    case 'arrange':
      return { ...base, options: ['', '', ''], correctAnswer: '' };
    case 'python_exercise':
      return { ...base, pythonStarterCode: '', pythonSolution: '', pythonExpectedOutput: '', pythonHasExpectedOutput: true };
    case 'fill_blank':
    default:
      return base;
  }
}

interface CertState {
  title: string;
  description: string;
  certType: CertificationType; // 'career' | 'technology'; groups the certifications listing
  slug: string;               // public URL; blank keeps the current/auto-generated one
  coverImage: string;
  badgeImageUrl: string;      // awarded on pass; shown on the certificate, report, and badges
  passmark: number;
  timeLimit: number;          // minutes; 0 = untimed
  maxAttempts: number;        // 0 = unlimited
  retakeCooldownHours: number; // min wait after a fail before a retake; 0 = none
  examProtection: boolean;
  cohortIds: string[];
  availableToEveryone: boolean;
  skillAreas: SkillArea[];
  scenarios: CertificationScenario[];  // case studies (shared stimulus referenced by questions)
  studyGuideUrl: string;
  studyGuideName: string;
  studyGuidePublished: boolean;
  posterUrl: string;
  posterPublished: boolean;
  practiceTestUrl: string;
  prepItems: CertificationPrepItem[];  // published courses / learning paths to complete before the exam
  playgroundData: PlaygroundData;      // shared runnable-playground data reused across question playgrounds
  randomizeQuestions: boolean;         // exam integrity: shuffle question order per attempt
  shuffleOptions: boolean;             // exam integrity: shuffle answer options per attempt
  questionPoolSize: number;            // exam integrity: draw N questions per attempt (0 = all)
  questions: CourseQuestion[];
  practiceQuestions: CourseQuestion[]; // separate practice-only bank (reveals feedback; never the exam)
}

const DEFAULTS: CertState = {
  title: '', description: '', certType: 'technology', slug: '', coverImage: '', badgeImageUrl: '',
  passmark: 70, timeLimit: 30, maxAttempts: 1, retakeCooldownHours: 24, examProtection: true,
  cohortIds: [],
  availableToEveryone: false,
  skillAreas: [], scenarios: [], studyGuideUrl: '', studyGuideName: '', studyGuidePublished: false,
  posterUrl: '', posterPublished: false, practiceTestUrl: '', prepItems: [], playgroundData: {},
  randomizeQuestions: false, shuffleOptions: false, questionPoolSize: 0,
  questions: [], practiceQuestions: [],
};

function CertificationEditor() {
  const theme = useC();
  // The dashboard theme with the shared blue for buttons and selection controls, like the other editors.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');

  const [state, setState] = useState<CertState>(DEFAULTS);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [expandedPractice, setExpandedPractice] = useState<string | null>(null);
  const [pickingPractice, setPickingPractice] = useState(false);
  // Shared image library for case-study rich text (Cloudinary + Pexels), opened via RichTextEditor's
  // onRequestImage. One modal serves all scenario editors; the resolver returns the picked URL.
  const [scenarioImgOpen, setScenarioImgOpen] = useState(false);
  const scenarioImgResolver = useRef<((url: string | null) => void) | null>(null);
  const requestScenarioImage = useCallback(() => new Promise<string | null>(resolve => {
    scenarioImgResolver.current = resolve;
    setScenarioImgOpen(true);
  }), []);
  const resolveScenarioImage = useCallback((url: string | null) => {
    scenarioImgResolver.current?.(url);
    scenarioImgResolver.current = null;
    setScenarioImgOpen(false);
  }, []);
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorTab, setEditorTab] = useState<EditorTab>('overview');
  const [savedStatus, setSavedStatus] = useState<'draft' | 'published'>('draft');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name').then(({ data }) => setCohorts(data ?? []));
  }, []);

  useEffect(() => {
    if (!editId) return;
    supabase.from('certifications').select('*').eq('id', editId).single().then(({ data }) => {
      if (data) {
        setSavedStatus(data.status === 'published' ? 'published' : 'draft');
        setState({
          title: data.title ?? '', description: data.description ?? '', certType: data.cert_type === 'career' ? 'career' : 'technology',
          slug: data.slug ?? '', coverImage: data.cover_image ?? '',
          badgeImageUrl: data.badge_image_url ?? '',
          passmark: data.passmark ?? 70, timeLimit: data.time_limit ?? 0, maxAttempts: data.max_attempts ?? 1,
          retakeCooldownHours: data.retake_cooldown_hours ?? 24,
          examProtection: data.exam_protection !== false, cohortIds: data.cohort_ids ?? [], availableToEveryone: data.available_to_everyone === true,
          skillAreas: Array.isArray(data.skill_areas) ? data.skill_areas : [],
          scenarios: Array.isArray(data.scenarios) ? data.scenarios : [],
          studyGuideUrl: data.study_guide_url ?? '', studyGuideName: data.study_guide_name ?? '',
          studyGuidePublished: data.study_guide_published === true,
          posterUrl: data.poster_url ?? '', posterPublished: data.poster_published === true,
          practiceTestUrl: data.practice_test_url ?? '',
          prepItems: Array.isArray(data.prep_items)
            ? data.prep_items.filter((p: any) => p?.id && (p?.type === 'course' || p?.type === 'path'))
            : [],
          playgroundData: (data.playground_data && typeof data.playground_data === 'object' && !Array.isArray(data.playground_data)) ? data.playground_data : {},
          randomizeQuestions: data.randomize_questions === true, shuffleOptions: data.shuffle_options === true,
          questionPoolSize: Number(data.question_pool_size) > 0 ? Number(data.question_pool_size) : 0,
          questions: Array.isArray(data.questions) ? data.questions : [],
          practiceQuestions: Array.isArray(data.practice_questions) ? data.practice_questions : [],
        });
      }
      setLoading(false);
    });
  }, [editId]);

  const update = useCallback((patch: Partial<CertState>) => setState(prev => ({ ...prev, ...patch })), []);
  const updateQuestion = useCallback((id: string, patch: Partial<CourseQuestion>) => {
    setState(prev => ({ ...prev, questions: prev.questions.map(q => q.id === id ? { ...q, ...patch } : q) }));
  }, []);
  const inputStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };

  // Skill areas: add / rename / remove. Removing a skill also clears it from any question mapped to it.
  const addSkill = () => setState(prev => ({ ...prev, skillAreas: [...prev.skillAreas, { id: newId(), name: '' }] }));
  const setSkill = (id: string, name: string) => setState(prev => ({ ...prev, skillAreas: prev.skillAreas.map(s => s.id === id ? { ...s, name } : s) }));
  const removeSkill = (id: string) => setState(prev => ({
    ...prev,
    skillAreas: prev.skillAreas.filter(s => s.id !== id),
    questions: prev.questions.map(q => q.skillAreaId === id ? { ...q, skillAreaId: undefined } : q),
  }));

  // Case studies: add / edit / remove. Removing a scenario also detaches it from any question (exam or practice).
  const addScenario = () => setState(prev => ({ ...prev, scenarios: [...prev.scenarios, { id: newId(), title: '', content: '' }] }));
  const setScenario = (id: string, patch: Partial<CertificationScenario>) => setState(prev => ({ ...prev, scenarios: prev.scenarios.map(s => s.id === id ? { ...s, ...patch } : s) }));
  const removeScenario = (id: string) => setState(prev => ({
    ...prev,
    scenarios: prev.scenarios.filter(s => s.id !== id),
    questions: prev.questions.map(q => q.scenarioId === id ? { ...q, scenarioId: undefined } : q),
    practiceQuestions: prev.practiceQuestions.map(q => q.scenarioId === id ? { ...q, scenarioId: undefined } : q),
  }));

  const addQuestion = (type: QuestionTypeOrDownloads) => {
    const q = blankQuestion(type as QuestionType);
    setState(prev => ({ ...prev, questions: [...prev.questions, q] }));
    setExpanded(q.id);
    setPicking(false);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setState(prev => {
      const from = prev.questions.findIndex(q => q.id === active.id);
      const to = prev.questions.findIndex(q => q.id === over.id);
      return from < 0 || to < 0 ? prev : { ...prev, questions: arrayMove(prev.questions, from, to) };
    });
  };

  // Practice-only bank: same authoring as the exam questions, but a separate list.
  const updatePracticeQuestion = useCallback((id: string, patch: Partial<CourseQuestion>) => {
    setState(prev => ({ ...prev, practiceQuestions: prev.practiceQuestions.map(q => q.id === id ? { ...q, ...patch } : q) }));
  }, []);
  const addPracticeQuestion = (type: QuestionTypeOrDownloads) => {
    const q = blankQuestion(type as QuestionType);
    setState(prev => ({ ...prev, practiceQuestions: [...prev.practiceQuestions, q] }));
    setExpandedPractice(q.id);
    setPickingPractice(false);
  };
  const onPracticeDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setState(prev => {
      const from = prev.practiceQuestions.findIndex(q => q.id === active.id);
      const to = prev.practiceQuestions.findIndex(q => q.id === over.id);
      return from < 0 || to < 0 ? prev : { ...prev, practiceQuestions: arrayMove(prev.practiceQuestions, from, to) };
    });
  };

  const save = async (status: 'draft' | 'published') => {
    setError('');
    if (!state.title.trim()) { setError('Add a title.'); return; }
    if (!state.questions.length) { setError('Add at least one question.'); return; }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body = {
        id: editId || undefined,
        title: state.title,
        description: state.description,
        slug: state.slug.trim() || undefined,
        cohort_ids: state.cohortIds,
        available_to_everyone: state.availableToEveryone,
        status,
        config: {
          certType: state.certType,
          coverImage: state.coverImage,
          badgeImageUrl: state.badgeImageUrl || null,
          questions: state.questions,
          passmark: state.passmark,
          timeLimit: state.timeLimit || null,
          maxAttempts: state.maxAttempts,
          retakeCooldownHours: state.retakeCooldownHours,
          examProtection: state.examProtection,
          skillAreas: state.skillAreas,
          scenarios: state.scenarios,
          studyGuideUrl: state.studyGuideUrl,
          studyGuideName: state.studyGuideName,
          studyGuidePublished: state.studyGuidePublished,
          posterUrl: state.posterUrl,
          posterPublished: state.posterPublished,
          practiceTestUrl: state.practiceTestUrl,
          prepItems: state.prepItems,
          playgroundData: state.playgroundData,
          randomizeQuestions: state.randomizeQuestions,
          shuffleOptions: state.shuffleOptions,
          questionPoolSize: state.questionPoolSize,
          practiceQuestions: state.practiceQuestions,
        },
      };
      const res = await fetch('/api/certifications', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to save.');
      router.push('/dashboard#certifications');
    } catch (err: any) {
      setError(err?.message || 'Failed to save.');
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: C.muted }} /></div>;
  }

  const P = palette(C);
  const onSoft = { ...inputStyle, background: C.card };
  const chip = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { color: C.muted, background: C.pill });
  const questionCount = (id: string) => state.questions.filter(q => q.skillAreaId === id).length;
  const readiness = [
    { label: 'Certification', detail: state.title.trim() || 'Add a name', ready: !!state.title.trim(), tab: 'overview' as EditorTab },
    { label: 'Exam questions', detail: `${state.questions.length} graded question${state.questions.length === 1 ? '' : 's'}`, ready: state.questions.length > 0, tab: 'questions' as EditorTab },
    { label: 'Badge', detail: state.badgeImageUrl ? 'Added' : 'Optional, not added', ready: !!state.badgeImageUrl, tab: 'settings' as EditorTab },
    { label: 'Preparation', detail: `${state.prepItems.length} course${state.prepItems.length === 1 ? '' : 's'}, ${state.practiceQuestions.length} practice question${state.practiceQuestions.length === 1 ? '' : 's'}`, ready: state.prepItems.length > 0 || state.practiceQuestions.length > 0, tab: state.practiceQuestions.length ? 'practice' as EditorTab : 'resources' as EditorTab },
  ];

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <button type="button" onClick={() => router.push('/dashboard#certifications')} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4" /> All certifications
        </button>
        {/* Buttons stay at the top right; a long name wraps instead of pushing them down. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 md:flex-1">
            <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{state.title.trim() || (editId ? 'Edit certification' : 'New certification')}</h1>
            <div className="mt-2">{savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:flex-shrink-0">
            <button type="button" onClick={() => save('draft')} disabled={saving} className={btnClass} style={btnStyle('sec', C)}>
              <Check className="w-4 h-4" /> Save draft
            </button>
            <button type="button" onClick={() => save('published')} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {savedStatus === 'published' ? 'Publish changes' : 'Publish'}
            </button>
          </div>
        </div>
        <div role="tablist" aria-label="Certification steps" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {EDITOR_TABS.map(tab => {
            const active = editorTab === tab.id;
            const count = tab.id === 'questions' ? state.questions.length : tab.id === 'practice' ? state.practiceQuestions.length : null;
            return (
              <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => setEditorTab(tab.id)}
                className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                style={active ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                {tab.label}{count !== null && <span className="ml-1 text-xs" style={{ opacity: 0.7 }}>{count}</span>}
              </button>
            );
          })}
        </div>
        {error && (
          <div role="alert" className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            <XCircle className="w-4 h-4 flex-shrink-0" /><span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
          </div>
        )}

        <Card C={C} className="mt-4">
        {editorTab === 'overview' && (
          <Sect C={C} title="About the certification" first>
            <div>
              <label className={labelCls} style={{ color: C.muted }}>Name</label>
              <input value={state.title} onChange={e => update({ title: e.target.value })} placeholder="Enter the certification name" className={FIELD} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: C.muted }}>Short description</label>
              <textarea value={state.description} onChange={e => update({ description: e.target.value })} placeholder="Shown before the exam starts" rows={3} className={FIELD} style={inputStyle} />
            </div>
            <div>
              <span className={labelCls} style={{ color: C.muted }}>Type</span>
              <div className="flex flex-wrap gap-2">
                {(['career', 'technology'] as const).map(tp => (
                  <button key={tp} type="button" aria-pressed={state.certType === tp} onClick={() => update({ certType: tp })}
                    className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(state.certType === tp)}>
                    {tp === 'career' ? 'Career' : 'Technology'}
                  </button>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: C.muted }}>Groups it on the certifications page.</p>
            </div>
            <div>
              <label className={labelCls} style={{ color: C.muted }}>Public link</label>
              <div className="field-shell flex items-center gap-2 px-3 py-3 rounded-[10px]" style={inputStyle}>
                <span className="text-sm" style={{ color: C.faint }}>/</span>
                <input value={state.slug} onChange={e => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })}
                  placeholder="auto-generated" className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.text }} />
              </div>
              <p className="text-xs mt-2" style={{ color: C.muted }}>The link learners open. Leave blank to keep the current one.</p>
            </div>
          </Sect>
        )}

        {editorTab === 'settings' && (<>
          <Sect C={C} title="Scoring and time" first>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField C={C} label="Pass mark (%)" value={state.passmark} min={0} max={100} onChange={v => update({ passmark: v })} />
              <NumField C={C} label="Time limit (minutes, 0 for none)" value={state.timeLimit} min={0} max={600} onChange={v => update({ timeLimit: v })} />
              <NumField C={C} label="Attempts (0 for unlimited)" value={state.maxAttempts} min={0} max={20} onChange={v => update({ maxAttempts: v })} />
              <NumField C={C} label="Wait before a retake (hours, 0 for none)" value={state.retakeCooldownHours} min={0} max={720} onChange={v => update({ retakeCooldownHours: v })} />
            </div>
          </Sect>
          <Sect C={C} title="Images">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={labelCls} style={{ color: C.muted }}>Cover image</span>
                <ImagePickerField C={C} value={state.coverImage} onChange={url => update({ coverImage: url })} folder="certification-covers" placeholder="Select or upload a cover" />
              </div>
              <div>
                <span className={labelCls} style={{ color: C.muted }}>Badge</span>
                <ImagePickerField C={C} value={state.badgeImageUrl} onChange={url => update({ badgeImageUrl: url })} folder="certification-badges" placeholder="Select or upload a badge" contain />
                <p className="text-xs mt-2" style={{ color: C.muted }}>Awarded on pass; shown on the report and in badges.</p>
              </div>
            </div>
          </Sect>
          <Sect C={C} title="Exam integrity">
            <SwitchRow C={C} title="Exam protection" sub="Blocks copy and paste and right-click, asks for full screen and logs tab switches." on={state.examProtection} onChange={v => update({ examProtection: v })} />
            <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <SwitchRow C={C} title="Randomise question order" sub="Each attempt gets the questions in a new order." on={state.randomizeQuestions} onChange={v => update({ randomizeQuestions: v })} />
            </div>
            <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <SwitchRow C={C} title="Shuffle answer options" sub="So answers cannot be shared as easily." on={state.shuffleOptions} onChange={v => update({ shuffleOptions: v })} />
            </div>
            <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <NumField C={C} label={`Questions per attempt (0 for all${state.questions.length ? `; ${state.questions.length} in the bank` : ''})`}
                value={state.questionPoolSize} min={0} max={Math.max(0, state.questions.length)} onChange={v => update({ questionPoolSize: v })} />
            </div>
          </Sect>
          <Sect C={C} title="Who can take it" aside={state.availableToEveryone ? 'Everyone' : `${state.cohortIds.length} cohort${state.cohortIds.length === 1 ? '' : 's'}`}>
            <SwitchRow C={C} title="Available to everyone" sub="Anyone with an account can take it. Cohort choices are set aside while this is on." on={state.availableToEveryone}
              onChange={v => update({ availableToEveryone: v, ...(v ? { cohortIds: [] } : {}) })} />
            {cohorts.length === 0 ? (
              <p className="text-sm" style={{ color: C.muted }}>No bootcamp cohorts yet.</p>
            ) : (
              <div style={state.availableToEveryone ? { opacity: 0.45, pointerEvents: 'none' } : undefined} aria-hidden={state.availableToEveryone}>
                {cohorts.map((c, i) => {
                  const on = state.cohortIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" role="checkbox" aria-checked={on}
                      onClick={() => update({ availableToEveryone: false, cohortIds: on ? state.cohortIds.filter(x => x !== c.id) : [...state.cohortIds, c.id] })}
                      className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: C.text, borderTop: i ? `1px solid ${C.divider}` : undefined }}>
                      <Tick on={on} C={C} />{c.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <PlanAccessPicker contentTable="certifications" contentId={editId} availableToEveryone={state.availableToEveryone}
                onPublicAccessClosed={() => update({ availableToEveryone: false })} />
            </div>
          </Sect>
        </>)}

        {editorTab === 'blueprint' && (<>
          <Sect C={C} title="Skill areas" first>
            <p className="text-xs -mt-2" style={{ color: C.muted }}>The skills the exam assesses. Each question is linked to one.</p>
            {state.skillAreas.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: C.page }}>
                <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{i + 1}</span>
                <input value={s.name} onChange={e => setSkill(s.id, e.target.value)} placeholder={`Skill area ${i + 1}`} aria-label={`Skill area ${i + 1}`} className={`${FIELD} flex-1`} style={onSoft} />
                <span className="text-xs flex-shrink-0 hidden sm:block" style={{ color: C.muted }}>{questionCount(s.id)} question{questionCount(s.id) === 1 ? '' : 's'}</span>
                <button type="button" onClick={() => removeSkill(s.id)} aria-label="Remove skill area" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <div><button type="button" onClick={addSkill} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add skill area</button></div>
          </Sect>
          <Sect C={C} title="Case studies">
            <p className="text-xs -mt-2" style={{ color: C.muted }}>A shared scenario that several questions build on. Learners see it beside each attached question.</p>
            {state.scenarios.length === 0 && <p className="rounded-xl px-4 py-5 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>No case studies yet</p>}
            {state.scenarios.map((s, i) => (
              <div key={s.id} className="rounded-xl p-3 space-y-2" style={{ background: C.page }}>
                <div className="flex items-center gap-2">
                  <input value={s.title} onChange={e => setScenario(s.id, { title: e.target.value })} placeholder={`Case study ${i + 1} title`} aria-label="Case study title" className={FIELD} style={onSoft} />
                  <button type="button" onClick={() => removeScenario(s.id)} aria-label="Remove case study" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4" /></button>
                </div>
                <RichTextEditor value={s.content} onChange={html => setScenario(s.id, { content: html })} bgOverride={C.card}
                  placeholder="The scenario shown to the learner. Use the toolbar for images, quotes, tables and lists."
                  onRequestImage={requestScenarioImage} />
              </div>
            ))}
            <div><button type="button" onClick={addScenario} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add case study</button></div>
          </Sect>
          <Sect C={C} title="Shared practice data">
            <SharedPlaygroundField C={C} inputStyle={inputStyle} value={state.playgroundData} onChange={pd => update({ playgroundData: pd })} />
          </Sect>
        </>)}

        {editorTab === 'resources' && (<>
          <Sect C={C} title="Study guide" first>
            <StudyGuideField C={C} url={state.studyGuideUrl} name={state.studyGuideName} published={state.studyGuidePublished}
              onChange={(url, name) => update({ studyGuideUrl: url, studyGuideName: name, ...(url ? {} : { studyGuidePublished: false }) })}
              onPublish={v => update({ studyGuidePublished: v })} />
          </Sect>
          <Sect C={C} title="Poster">
            <PosterField C={C} url={state.posterUrl} published={state.posterPublished}
              onChange={url => update({ posterUrl: url, ...(url ? {} : { posterPublished: false }) })}
              onPublish={v => update({ posterPublished: v })} />
          </Sect>
          <Sect C={C} title="Practice test">
            <div>
              <label className={labelCls} style={{ color: C.muted }}>Link</label>
              <input value={state.practiceTestUrl} onChange={e => update({ practiceTestUrl: e.target.value })} placeholder="https://" className={FIELD} style={inputStyle} />
              <p className="text-xs mt-2" style={{ color: C.muted }}>Learners can open it from the certification before the exam.</p>
            </div>
          </Sect>
          <Sect C={C} title="Courses to prepare">
            <PrepItemsField C={C} value={state.prepItems} onChange={items => update({ prepItems: items })} />
          </Sect>
        </>)}

        {editorTab === 'questions' && (
          <Sect C={C} title="Exam questions" aside={`${state.questions.length} question${state.questions.length === 1 ? '' : 's'}`} first>
            <p className="text-xs -mt-2" style={{ color: C.muted }}>Questions in the scored exam. Drag to reorder.</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={state.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {state.questions.map((q, i) => (
                    <QuestionCard key={q.id} q={q} index={i} C={C} skillAreas={state.skillAreas} scenarios={state.scenarios}
                      hasSharedData={hasPlaygroundData(state.playgroundData)}
                      expanded={expanded === q.id}
                      onToggle={() => setExpanded(expanded === q.id ? null : q.id)}
                      onUpdate={patch => updateQuestion(q.id, patch)}
                      onRemove={() => setState(prev => ({ ...prev, questions: prev.questions.filter(x => x.id !== q.id) }))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div><button type="button" onClick={() => setPicking(true)} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add question</button></div>
          </Sect>
        )}

        {/* Practice questions: a separate bank used only by practice mode, never the graded exam. */}
        {editorTab === 'practice' && (
          <Sect C={C} title="Practice questions" aside={`${state.practiceQuestions.length} question${state.practiceQuestions.length === 1 ? '' : 's'}`} first>
            <p className="text-xs -mt-2" style={{ color: C.muted }}>Learners see the right answers and explanations after practising. These never appear in the exam; leave it empty to hide Practice.</p>
            {state.practiceQuestions.length === 0 && <p className="rounded-xl px-4 py-5 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>No practice questions yet</p>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPracticeDragEnd}>
              <SortableContext items={state.practiceQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {state.practiceQuestions.map((q, i) => (
                    <QuestionCard key={q.id} q={q} index={i} C={C} skillAreas={state.skillAreas} scenarios={state.scenarios}
                      hasSharedData={hasPlaygroundData(state.playgroundData)}
                      expanded={expandedPractice === q.id}
                      onToggle={() => setExpandedPractice(expandedPractice === q.id ? null : q.id)}
                      onUpdate={patch => updatePracticeQuestion(q.id, patch)}
                      onRemove={() => setState(prev => ({ ...prev, practiceQuestions: prev.practiceQuestions.filter(x => x.id !== q.id) }))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div><button type="button" onClick={() => setPickingPractice(true)} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add practice question</button></div>
          </Sect>
        )}

        {editorTab === 'publish' && (<>
          <Sect C={C} title="Status" first>
            <div>
              {savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
              <p className="text-sm mt-1.5" style={{ color: C.muted }}>{savedStatus === 'published' ? 'Learners it is given to can take the exam.' : 'Learners cannot see it yet.'}</p>
            </div>
          </Sect>
          <Sect C={C} title="Ready to publish">
            <div>
              {readiness.map((item, i) => (
                <div key={item.label} className="flex items-center gap-3 py-2.5 px-0.5" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={item.ready ? { background: P.good, color: '#fff' } : { boxShadow: `inset 0 0 0 2px ${C.faint}` }}>
                    {item.ready && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold" style={{ color: C.text }}>{item.label}</span>
                    <span className="block truncate text-xs" style={{ color: C.muted }}>{item.detail}</span>
                  </span>
                  {!item.ready && <button type="button" onClick={() => setEditorTab(item.tab)} className={btnSmClass} style={btnStyle('sec', C)}>Add</button>}
                </div>
              ))}
            </div>
          </Sect>
        </>)}
        </Card>
      </div>

      {picking && (
        <QuestionTypePicker allowedTypes={EXAM_TYPES} includeDownloads={false}
          onSelect={(type) => addQuestion(type)} onClose={() => setPicking(false)} />
      )}
      {pickingPractice && (
        <QuestionTypePicker allowedTypes={EXAM_TYPES} includeDownloads={false}
          onSelect={(type) => addPracticeQuestion(type)} onClose={() => setPickingPractice(false)} />
      )}
      {scenarioImgOpen && (
        <ImageLibrary uploadFolder="certification-scenarios" initialFolder="certification-scenarios"
          onSelect={(url) => resolveScenarioImage(url)} onClose={() => resolveScenarioImage(null)} />
      )}
    </div>
  );
}

// One flat section of a step card: a sentence-case heading, an optional count, then the fields.
function Sect({ title, aside, first, children, C }: { title: string; aside?: string; first?: boolean; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="p-5 grid gap-4" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex-1" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({ C, title, sub, on, onChange }: { C: ThemeColors; title: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>{sub}</p>
      </div>
      <Switch on={on} onChange={onChange} label={title} C={C} />
    </div>
  );
}

function NumField({ C, label, value, min, max, onChange }: { C: any; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={labelCls} style={{ color: C.muted }}>{label}</label>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className={FIELD} style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }} />
    </div>
  );
}

// Cover / badge picker: surfaces the shared Cloudinary image gallery (pick an existing image or
// upload a new one) and shows a preview of what's attached. `contain` fits badges without cropping.
function ImagePickerField({ C, value, onChange, folder, placeholder, contain }: {
  C: any; value: string; onChange: (url: string) => void; folder: string; placeholder: string; contain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {value ? (
        <div className="relative w-full h-28 rounded-xl overflow-hidden group" style={{ border: `1px solid ${C.inputBorder}`, background: C.input }}>
          <img src={value} alt="" className="w-full h-full" style={{ objectFit: contain ? 'contain' : 'cover' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.92)', color: '#111' }}><ImagePlus className="w-3.5 h-3.5" /> Change</button>
            <button type="button" onClick={() => onChange('')} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.85)', color: '#dc2626' }}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="block w-full">
          <div className="w-full rounded-xl px-3 py-6 flex flex-col items-center justify-center gap-2 transition-colors hover:opacity-80" style={{ background: C.input, border: `1.5px dashed ${C.inputBorder}` }}>
            <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />
            <span className="text-xs" style={{ color: C.faint }}>{placeholder}</span>
          </div>
        </button>
      )}
      {open && (
        <ImageLibrary uploadFolder={folder} initialFolder={folder} onSelect={v => onChange(v)} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// Courses / learning paths a learner completes before the exam. These render on the certification
// overview's "Complete courses" step as landing-page-style cards with hover previews. Instructors
// pick from PUBLISHED courses and learning paths (the same public views the landing page reads);
// only ids + type are stored, so details resolve fresh at render time and unpublished items drop out.
type PrepOption = { id: string; title: string; coverImage: string; type: 'course' | 'path' };

function PrepItemsField({ C, value, onChange }: {
  C: any; value: CertificationPrepItem[]; onChange: (items: CertificationPrepItem[]) => void;
}) {
  const [options, setOptions] = useState<PrepOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('published_courses').select('id,title,cover_image').limit(200),
      supabase.from('published_learning_paths').select('id,title,cover_image').limit(200),
    ]).then(([c, lp]) => {
      const courses: PrepOption[] = (c.data ?? []).map((r: any) => ({ id: r.id, title: r.title, coverImage: r.cover_image ?? '', type: 'course' as const }));
      const paths: PrepOption[] = (lp.data ?? []).map((r: any) => ({ id: r.id, title: r.title, coverImage: r.cover_image ?? '', type: 'path' as const }));
      setOptions([...courses, ...paths]);
      setLoading(false);
    });
  }, []);

  const byId = useMemo(() => {
    const m: Record<string, PrepOption> = {};
    options.forEach(o => { m[o.id] = o; });
    return m;
  }, [options]);

  const isSelected = (o: PrepOption) => value.some(v => v.id === o.id && v.type === o.type);
  const toggle = (o: PrepOption) => onChange(
    isSelected(o) ? value.filter(v => !(v.id === o.id && v.type === o.type)) : [...value, { id: o.id, type: o.type }],
  );
  const remove = (p: CertificationPrepItem) => onChange(value.filter(v => !(v.id === p.id && v.type === p.type)));

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter(o => o.title.toLowerCase().includes(q)) : options;

  const Thumb = ({ o, size }: { o?: PrepOption; size: number }) => (
    <div className="rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ width: size, height: size, background: C.pill }}>
      {o?.coverImage
        ? <img src={resolveCoverUrl(o.coverImage)} alt="" className="w-full h-full object-cover" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
        : (o?.type === 'path' ? <Route className="w-4 h-4" style={{ color: C.faint }} /> : <BookOpen className="w-4 h-4" style={{ color: C.faint }} />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs -mt-2" style={{ color: C.muted }}>Attach the courses or learning paths that build the skills for this certification. They appear on the certification page under &quot;Complete courses&quot; as cards with a hover preview.</p>
      </div>

      {value.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {value.map(p => {
            const o = byId[p.id];
            return (
              <div key={`${p.type}:${p.id}`} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: C.pill }}>
                <Thumb o={o ?? (p as any)} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: C.text }}>{o?.title ?? (loading ? 'Loading...' : 'No longer published')}</p>
                  <p className="text-xs" style={{ color: C.faint }}>{p.type === 'path' ? 'Learning path' : 'Course'}</p>
                </div>
                <button type="button" onClick={() => remove(p)} style={{ color: C.faint }} aria-label="Remove"><X className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      )}

      <div><button type="button" onClick={() => setOpen(o => !o)} className={btnSmClass} style={btnStyle('sec', C)}>
        <Plus className="w-3.5 h-3.5" /> Add courses or learning paths
      </button></div>

      {open && (
        <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${C.divider}` }}>
          <div className="flex items-center gap-2 px-3 py-3 rounded-lg" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search courses and paths" className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.text }} />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {loading ? <p className="text-xs p-2" style={{ color: C.faint }}>Loading...</p>
              : filtered.length === 0 ? <p className="text-xs p-2" style={{ color: C.faint }}>No published courses or paths found.</p>
              : filtered.map(o => {
                const on = isSelected(o);
                return (
                  <button type="button" key={`${o.type}:${o.id}`} onClick={() => toggle(o)} className="w-full flex items-center gap-3 p-2 rounded-md text-left" style={{ background: on ? C.pill : 'transparent' }}>
                    <Thumb o={o} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate" style={{ color: C.text }}>{o.title}</p>
                      <p className="text-xs" style={{ color: C.faint }}>{o.type === 'path' ? 'Learning path' : 'Course'}</p>
                    </div>
                    <span className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: on ? C.cta : 'transparent', border: on ? 'none' : `1.5px solid ${C.inputBorder}` }}>
                      {on && <Check className="w-3 h-3" style={{ color: '#fff' }} />}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// Derive a readable name from a pasted URL (the filename, or a generic fallback).
function nameFromUrl(u: string): string {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() ?? '');
    return last && /\.[a-z0-9]{2,4}$/i.test(last) ? last : 'Study guide';
  } catch { return 'Study guide'; }
}

// Study guide: upload a PDF (via the shared /api/upload Cloudinary path) OR paste a link to an
// externally hosted PDF. Preview + publish to learners.
function StudyGuideField({ C, url, name, published, onChange, onPublish }: {
  C: any; url: string; name: string; published: boolean; onChange: (url: string, name: string) => void; onPublish: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const inputStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadToCloudinary(file, 'certification-guides');
      // Cloudinary serves PDFs as an `image` resource; the f_auto,q_auto transform the upload route
      // adds rasterizes it to a single page. Strip it so the full multi-page PDF is delivered.
      onChange(uploaded.replace('/upload/f_auto,q_auto/', '/upload/'), file.name);
    }
    catch { window.alert('Upload failed. Try again.'); }
    finally { setBusy(false); }
  };
  const addLink = () => { const u = link.trim(); if (u) { onChange(u, nameFromUrl(u)); setLink(''); } };
  return (
    <div>
      {url ? (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="flex items-center gap-2 min-w-0" style={{ color: C.text }}>
            <FileText className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} /><span className="truncate" style={{ maxWidth: 220 }}>{name || 'Study guide.pdf'}</span>
          </span>
          <a href={url} target="_blank" rel="noreferrer" className={btnSmClass} style={btnStyle('sec', C)}>Preview</a>
          <label className={`${btnSmClass} cursor-pointer`} style={btnStyle('sec', C)}>{busy ? 'Uploading...' : 'Replace'}<input type="file" accept="application/pdf,.pdf" className="hidden" onChange={upload} /></label>
          <button type="button" onClick={() => onChange('', '')} className={btnSmClass} style={btnStyle('sec', C)}>Remove</button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className={`${btnClass} cursor-pointer w-fit`} style={btnStyle('sec', C)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>Upload PDF</span>
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={upload} />
          </label>
          <div className="flex items-center gap-2">
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
              placeholder="or paste a link to a PDF (https://...)" className={FIELD} style={inputStyle} />
            <button type="button" onClick={addLink} disabled={!link.trim()} className={`${btnClass} flex-shrink-0`} style={btnStyle('sec', C)}>Add</button>
          </div>
        </div>
      )}
      {url && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm" style={{ color: C.text }}>Published (learners can view or download it)</span>
          <Switch on={published} onChange={onPublish} label="Publish the study guide" C={C} />
        </div>
      )}
    </div>
  );
}

// Certification poster: upload an image, preview, and publish to learners.
function PosterField({ C, url, published, onChange, onPublish }: {
  C: any; url: string; published: boolean; onChange: (url: string) => void; onPublish: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { onChange(await uploadToCloudinary(file, 'certification-posters')); }
    catch { window.alert('Upload failed. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex items-center gap-3">
        <div style={{ width: 92, height: 120, borderRadius: 8, background: C.input, border: `1px solid ${C.inputBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.faint }} />
            : url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />}
        </div>
        <div className="space-y-2">
          <label className={`${btnSmClass} cursor-pointer w-fit`} style={btnStyle('sec', C)}>
            <Upload className="w-3.5 h-3.5" /> {url ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={upload} />
          </label>
          {url && <a href={url} target="_blank" rel="noreferrer" className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>Preview</a>}
          {url && <button type="button" onClick={() => onChange('')} className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>Remove</button>}
        </div>
      </div>
      {url && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm" style={{ color: C.text }}>Published (visible to learners)</span>
          <Switch on={published} onChange={onPublish} label="Publish the poster" C={C} />
        </div>
      )}
    </div>
  );
}

// ---- One sortable question card with per-type fields ----
function QuestionCard({ q, index, C, skillAreas, scenarios, hasSharedData, expanded, onToggle, onUpdate, onRemove }: {
  q: CourseQuestion; index: number; C: any; skillAreas: SkillArea[]; scenarios: CertificationScenario[]; hasSharedData: boolean; expanded: boolean; onToggle: () => void; onUpdate: (patch: Partial<CourseQuestion>) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const type = (q.type ?? 'multiple_choice') as QuestionType;
  const inputStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };
  const P = palette(C);

  return (
    <div ref={setNodeRef} style={{ ...style, background: C.page }} className="rounded-xl">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" aria-label="Drag to reorder" className="cursor-grab active:cursor-grabbing" style={{ color: C.faint }} {...attributes} {...listeners}><GripVertical className="w-3.5 h-3.5" /></button>
        <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{index + 1}</span>
        <button type="button" onClick={onToggle} className="flex-1 text-left min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: C.text }}>
            {(q.question?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()) || <span className="italic" style={{ color: C.faint }}>Question {index + 1}</span>}
          </span>
          <span className="text-[11px]" style={{ color: C.muted }}>{sentence(TYPE_LABELS[type])}</span>
        </button>
        <button type="button" onClick={onRemove} aria-label="Delete question" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4" /></button>
        <button type="button" onClick={onToggle} aria-label={expanded ? 'Collapse question' : 'Expand question'} className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: C.card, color: C.muted }}>{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
      </div>

      {expanded && (
        <div className="mx-2 mb-2 rounded-xl px-3 pt-3 pb-4 space-y-3" style={{ background: C.card }}>
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Question</label>
            <RichTextEditor value={q.question} onChange={html => onUpdate({ question: html })}
              placeholder="Ask the question. Use the toolbar for bold, lists, code, links, and images."
              onImageUpload={(file) => uploadToCloudinary(file, 'certification-prompts')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} style={{ color: C.muted }}>Section</label>
              <MenuSelect field label="Section" C={C} value={q.section ?? 'technical'} onChange={v => onUpdate({ section: v })}
                options={[{ value: 'technical', label: 'Technical' }, { value: 'practical', label: 'Practical or case study' }]} />
            </div>
            {skillAreas.length > 0 && (
              <div>
                <label className={labelCls} style={{ color: C.muted }}>Skill area</label>
                <MenuSelect field label="Skill area" C={C} value={q.skillAreaId ?? ''} onChange={v => onUpdate({ skillAreaId: v || undefined })}
                  options={[{ value: '', label: 'No skill area' }, ...skillAreas.map(s => ({ value: s.id, label: s.name.trim() || 'Untitled skill' }))]} />
              </div>
            )}
            {scenarios.length > 0 && (
              <div>
                <label className={labelCls} style={{ color: C.muted }}>Case study</label>
                <MenuSelect field label="Case study" C={C} value={q.scenarioId ?? ''} onChange={v => onUpdate({ scenarioId: v || undefined })}
                  options={[{ value: '', label: 'No case study' }, ...scenarios.map((s, i) => ({ value: s.id, label: s.title.trim() || `Case study ${i + 1}` }))]} />
              </div>
            )}
          </div>
          <TypeFields q={q} type={type} C={C} inputStyle={inputStyle} onUpdate={onUpdate} />
          <PlaygroundEditor q={q} C={C} inputStyle={inputStyle} hasSharedData={hasSharedData} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

// True when the certification has any shared playground data defined.
function hasPlaygroundData(pd: PlaygroundData): boolean {
  return !!(pd.sqlTables?.length || pd.pythonDatasets?.length || pd.setupSql?.trim() || pd.setupPython?.trim());
}

// Editable list of SQL tables (a CSV per table). Reused by the per-question playground and the
// certification-wide shared-data editor, so the upload flow lives in exactly one place.
function SqlTablesEditor({ C, inputStyle, tables, onChange }: {
  C: any; inputStyle: any; tables: NonNullable<PlaygroundData['sqlTables']>; onChange: (tables: NonNullable<PlaygroundData['sqlTables']>) => void;
}) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const setTable = (i: number, patch: any) => onChange(tables.map((tb, k) => (k === i ? { ...tb, ...patch } : tb)));
  const uploadCsv = async (i: number, file: File) => {
    setUploadingIdx(i);
    try {
      const { url } = await uploadToGithub(file, 'sql-datasets');
      setTable(i, { fileName: file.name, fileUrl: url, csvUrl: url, seedSql: undefined });
    } catch { window.alert('Upload failed. Try again.'); }
    finally { setUploadingIdx(null); }
  };
  return (
    <div>
      <label className={labelCls} style={{ color: C.faint }}>Tables (upload a CSV per table)</label>
      <div className="space-y-2">
        {tables.map((tbl, i) => (
          <div key={tbl.id ?? i} className="flex items-center gap-2">
            <input value={tbl.tableName} onChange={e => setTable(i, { tableName: e.target.value })} placeholder="table_name" className={inputCls} style={inputStyle} />
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-xs flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.muted, maxWidth: 160 }}>
              {uploadingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="truncate">{tbl.fileName || 'CSV'}</span>
              <input type="file" accept=".csv,.tsv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCsv(i, f); }} />
            </label>
            <button onClick={() => onChange(tables.filter((_, k) => k !== i))} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...tables, { id: newId(), tableName: `table_${tables.length + 1}`, fileName: '', fileUrl: '', csvUrl: '' }])}
        className={`mt-2 ${btnSmClass}`} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add table</button>
    </div>
  );
}

// Editable list of Python datasets (a CSV per pandas DataFrame). Reused per-question and cert-wide.
function PythonDatasetsEditor({ C, inputStyle, datasets, onChange }: {
  C: any; inputStyle: any; datasets: NonNullable<PlaygroundData['pythonDatasets']>; onChange: (datasets: NonNullable<PlaygroundData['pythonDatasets']>) => void;
}) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const setDataset = (i: number, patch: any) => onChange(datasets.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const uploadDataset = async (i: number, file: File) => {
    setUploadingIdx(i);
    try {
      const { url } = await uploadToGithub(file, 'python-datasets');
      setDataset(i, { fileName: file.name, fileUrl: url, csvUrl: url });
    } catch { window.alert('Upload failed. Try again.'); }
    finally { setUploadingIdx(null); }
  };
  return (
    <div>
      <label className={labelCls} style={{ color: C.faint }}>Datasets (CSV loaded into a pandas DataFrame)</label>
      <div className="space-y-2">
        {datasets.map((ds, i) => (
          <div key={ds.id ?? i} className="flex items-center gap-2">
            <input value={ds.variableName} onChange={e => setDataset(i, { variableName: e.target.value })} placeholder="df" className={inputCls} style={inputStyle} />
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-xs flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.muted, maxWidth: 160 }}>
              {uploadingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="truncate">{ds.fileName || 'CSV'}</span>
              <input type="file" accept=".csv,.tsv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadDataset(i, f); }} />
            </label>
            <button onClick={() => onChange(datasets.filter((_, k) => k !== i))} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...datasets, { id: newId(), variableName: `df${datasets.length || ''}`, fileName: '', fileUrl: '', csvUrl: '' }])}
        className={`mt-2 ${btnSmClass}`} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add dataset</button>
    </div>
  );
}

// Certification-wide shared playground data: tables/datasets defined ONCE and reused by every
// question's runnable playground, so the same CSV is not re-uploaded on each question.
function SharedPlaygroundField({ C, inputStyle, value, onChange }: {
  C: any; inputStyle: any; value: PlaygroundData; onChange: (pd: PlaygroundData) => void;
}) {
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 14 };
  const [lang, setLang] = useState<'sql' | 'python'>(
    (value.pythonDatasets?.length || value.setupPython?.trim()) && !(value.sqlTables?.length || value.setupSql?.trim()) ? 'python' : 'sql',
  );
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs -mt-2" style={{ color: C.muted }}>Define tables or datasets once here. Every question&apos;s runnable playground can reuse them, so you don&apos;t re-add the same data on each question.</p>
      </div>
      <div className="flex gap-2">
        {(['sql', 'python'] as const).map(l => (
          <button key={l} type="button" onClick={() => setLang(l)} className="px-3 py-2 rounded-full text-xs font-medium"
            style={lang === l ? { background: C.cta, color: '#fff' } : { background: C.pill, color: C.muted }}>
            {l === 'sql' ? 'SQL tables' : 'Python datasets'}
          </button>
        ))}
      </div>
      {lang === 'sql' ? (
        <>
          <SqlTablesEditor C={C} inputStyle={inputStyle} tables={value.sqlTables ?? []} onChange={t => onChange({ ...value, sqlTables: t })} />
          <Field C={C} label="Setup SQL (optional). Extra CREATE/INSERT shared by every question">
            <textarea value={value.setupSql ?? ''} onChange={e => onChange({ ...value, setupSql: e.target.value })} rows={3} className={inputCls} style={mono}
              placeholder={'CREATE TABLE t(...);\nINSERT INTO t VALUES (...);'} />
          </Field>
        </>
      ) : (
        <>
          <PythonDatasetsEditor C={C} inputStyle={inputStyle} datasets={value.pythonDatasets ?? []} onChange={d => onChange({ ...value, pythonDatasets: d })} />
          <Field C={C} label="Setup Python (optional). Runs before student code, shared by every question">
            <textarea value={value.setupPython ?? ''} onChange={e => onChange({ ...value, setupPython: e.target.value })} rows={3} className={inputCls} style={mono}
              placeholder={'# import pandas as pd'} />
          </Field>
        </>
      )}
    </div>
  );
}

// Optional non-graded runnable playground attached to a question (SQL/Python scratchpad).
function PlaygroundEditor({ q, C, inputStyle, hasSharedData, onUpdate }: { q: CourseQuestion; C: any; inputStyle: any; hasSharedData: boolean; onUpdate: (patch: Partial<CourseQuestion>) => void }) {
  const pg = q.playground;
  const enabled = !!pg;
  const lang = pg?.language ?? 'sql';
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 14 };
  const tables = pg?.sqlTables ?? [];
  const datasets = pg?.pythonDatasets ?? [];
  const useShared = pg?.useSharedData !== false; // default on when shared data exists
  const update = (patch: Partial<NonNullable<CourseQuestion['playground']>>) =>
    onUpdate({ playground: { ...(q.playground ?? { language: 'sql' }), ...patch } });
  return (
    <div className="pt-3 mt-1" style={{ borderTop: `1px solid ${C.divider}` }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium" style={{ color: C.text }}>Runnable playground</span>
          <p className="text-xs mt-0.5" style={{ color: C.faint }}>Optional non-graded SQL/Python scratchpad students run to work out the answer.</p>
        </div>
        <Switch on={enabled} onChange={() => onUpdate({ playground: enabled ? undefined : { language: 'sql', starterCode: '' } })} label="Runnable playground" C={C} />
      </div>
      {enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            {(['sql', 'python'] as const).map(l => (
              <button key={l} onClick={() => update({ language: l })} className="px-3 py-2 rounded-full text-xs font-medium"
                style={lang === l ? { background: C.cta, color: '#fff' } : { background: C.pill, color: C.muted }}>
                {l === 'sql' ? 'SQL' : 'Python'}
              </button>
            ))}
          </div>

          {hasSharedData && (
            <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg" style={{ background: C.input }}>
              <div>
                <span className="text-xs font-medium" style={{ color: C.text }}>Use shared certification data</span>
                <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>Loads the certification&apos;s shared tables/datasets here too, alongside any added below.</p>
              </div>
              <Switch on={useShared} onChange={() => update({ useSharedData: !useShared })} label="Use shared certification data" C={C} />
            </div>
          )}

          {lang === 'sql' && (
            <SqlTablesEditor C={C} inputStyle={inputStyle} tables={tables} onChange={t => update({ sqlTables: t })} />
          )}

          {lang === 'python' && (
            <PythonDatasetsEditor C={C} inputStyle={inputStyle} datasets={datasets} onChange={d => update({ pythonDatasets: d })} />
          )}

          <Field C={C} label={lang === 'sql' ? 'Setup SQL (optional). Extra CREATE/INSERT if not using a CSV' : 'Setup Python (optional). Runs before the student code'}>
            <textarea
              value={lang === 'sql' ? (pg?.setupSql ?? '') : (pg?.setupPython ?? '')}
              onChange={e => update(lang === 'sql' ? { setupSql: e.target.value } : { setupPython: e.target.value })}
              rows={3} className={inputCls} style={mono}
              placeholder={lang === 'sql' ? 'CREATE TABLE t(...);\nINSERT INTO t VALUES (...);' : '# import pandas as pd'} />
          </Field>
          <Field C={C} label="Starter code (optional)">
            <textarea value={pg?.starterCode ?? ''} onChange={e => update({ starterCode: e.target.value })}
              rows={3} className={inputCls} style={mono}
              placeholder={lang === 'sql' ? 'SELECT * FROM gasoline;' : 'print("explore here")'} />
          </Field>
        </div>
      )}
    </div>
  );
}

function TypeFields({ q, type, C, inputStyle, onUpdate }: { q: CourseQuestion; type: QuestionType; C: any; inputStyle: any; onUpdate: (patch: Partial<CourseQuestion>) => void }) {
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 14 };
  const [imgUploading, setImgUploading] = useState(false);

  // Multiple choice / code / image_choice: text options with a "correct" radio (correctAnswer = option
  // text). `code` shows a code snippet above the options; `image_choice` shows one prompt image.
  if (type === 'multiple_choice' || type === 'code' || type === 'image_choice') {
    const options = q.options ?? [];
    // Multiple-answer mode: correctAnswer holds the correct option texts '|||'-joined (in option order).
    const multi = !!q.multiSelect;
    const correctList = String(q.correctAnswer ?? '').split('|||').filter(Boolean);
    const isCorrect = (opt: string) => multi ? correctList.includes(opt) : (q.correctAnswer === opt && opt !== '');
    const correctFromSet = (set: Set<string>, opts: string[]) => opts.filter(o => o && set.has(o)).join('|||');
    const toggleCorrect = (opt: string) => {
      if (!opt) return;
      if (!multi) { onUpdate({ correctAnswer: opt }); return; }
      const set = new Set(correctList);
      set.has(opt) ? set.delete(opt) : set.add(opt);
      onUpdate({ correctAnswer: correctFromSet(set, options) });
    };
    const setOption = (i: number, text: string) => {
      const prev = options[i];
      const next = [...options];
      next[i] = text;
      if (multi) {
        const set = new Set(correctList);
        if (set.has(prev)) { set.delete(prev); if (text) set.add(text); }
        onUpdate({ options: next, correctAnswer: correctFromSet(set, next) });
      } else {
        const wasCorrect = prev === q.correctAnswer && q.correctAnswer !== '';
        onUpdate({ options: next, ...(wasCorrect ? { correctAnswer: text } : {}) });
      }
    };
    const removeOption = (i: number) => {
      const opt = options[i];
      const next = options.filter((_, x) => x !== i);
      if (multi) {
        const set = new Set(correctList); set.delete(opt);
        onUpdate({ options: next, correctAnswer: correctFromSet(set, next) });
      } else {
        onUpdate({ options: next, ...(opt === q.correctAnswer ? { correctAnswer: '' } : {}) });
      }
    };
    const uploadPrompt = async (file: File) => {
      setImgUploading(true);
      try { onUpdate({ imageUrl: await uploadToCloudinary(file, 'certification-prompts') }); }
      catch { const r = new FileReader(); r.onload = ev => onUpdate({ imageUrl: ev.target?.result as string }); r.readAsDataURL(file); }
      finally { setImgUploading(false); }
    };
    return (
      <>
        {type === 'code' && (
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Code snippet (shown above the options)</label>
            <textarea value={q.codeSnippet ?? ''} onChange={e => onUpdate({ codeSnippet: e.target.value })} rows={4} className={inputCls} style={mono} placeholder="def example():\n    ..." />
          </div>
        )}
        {type === 'image_choice' && (
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Image (shown above the question)</label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div style={{ width: 110, height: 76, borderRadius: 8, background: C.input, border: `1px solid ${C.inputBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {imgUploading ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.faint }} />
                  : q.imageUrl ? <img src={q.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />}
              </div>
              <span className="text-xs" style={{ color: C.muted }}>{q.imageUrl ? 'Change image' : 'Upload image'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadPrompt(f); }} />
            </label>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label className={labelCls} style={{ color: C.faint, marginBottom: 0 }}>{multi ? 'Options (select all correct)' : 'Options (select the correct one)'}</label>
          <label className="flex items-center gap-2 text-xs flex-shrink-0" style={{ color: C.muted }}>
            Multiple answers
            <Switch on={multi} onChange={() => onUpdate({ multiSelect: !multi, correctAnswer: '' })} label="Multiple answers" C={C} />
          </label>
        </div>
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type={multi ? 'checkbox' : 'radio'} checked={isCorrect(opt)} onChange={() => toggleCorrect(opt)} style={{ accentColor: C.cta }} />
              <input value={opt} onChange={e => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} className={inputCls} style={inputStyle} />
              {options.length > 2 && (
                <button onClick={() => removeOption(i)} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => onUpdate({ options: [...options, ''] })} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add option</button>
      </>
    );
  }

  // Image options: per-option image + label, correct chosen by index.
  if (type === 'image') {
    const options = q.options ?? [];
    const images = q.optionImages ?? [];
    const uploadImg = async (i: number, file: File) => {
      const apply = (src: string) => { const next = [...(q.optionImages ?? options.map(() => ''))]; next[i] = src; onUpdate({ optionImages: next }); };
      try { apply(await uploadToCloudinary(file, 'certification-options')); }
      catch { const r = new FileReader(); r.onload = ev => apply(ev.target?.result as string); r.readAsDataURL(file); }
    };
    return (
      <>
        <label className={labelCls} style={{ color: C.faint }}>Image options (select the correct one)</label>
        <div className="grid grid-cols-2 gap-3">
          {options.map((opt, i) => (
            <div key={i} className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${q.correctAnswer === String(i) ? C.cta : C.inputBorder}` }}>
              <label className="flex items-center justify-center h-24 rounded cursor-pointer overflow-hidden" style={{ background: C.input }}>
                {images[i] ? <img src={images[i]} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImg(i, f); }} />
              </label>
              <input value={opt} onChange={e => { const next = [...options]; next[i] = e.target.value; onUpdate({ options: next }); }} placeholder="Label" className={inputCls} style={inputStyle} />
              <label className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
                <input type="radio" checked={q.correctAnswer === String(i)} onChange={() => onUpdate({ correctAnswer: String(i) })} style={{ accentColor: C.cta }} /> Correct
              </label>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => onUpdate({ options: [...options, ''], optionImages: [...images, ''] })} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add option</button>
          {options.length > 2 && <button onClick={() => onUpdate({ options: options.slice(0, -1), optionImages: images.slice(0, -1) })} className="text-xs" style={{ color: C.faint }}>Remove last</button>}
        </div>
      </>
    );
  }

  // Fill in the blank (code completion): students type directly into each ___ in the snippet.
  if (type === 'fill_blank') {
    const blankCount = (q.codeSnippet ?? '').split(/_{3,}/).length - 1;
    const blanks = (q.correctAnswer ?? '').split('|||');
    const setBlankAns = (i: number, v: string) => {
      const next = Array.from({ length: blankCount }, (_, k) => (k === i ? v : (blanks[k] ?? '')));
      onUpdate({ correctAnswer: next.join('|||') });
    };
    return (
      <>
        <div>
          <label className={labelCls} style={{ color: C.faint }}>Code / context: put ___ where students type</label>
          <textarea value={q.codeSnippet ?? ''} onChange={e => onUpdate({ codeSnippet: e.target.value })} rows={4} className={inputCls} style={mono} placeholder={'SELECT ___(SQFT, ___)\nFROM gasoline'} />
        </div>
        {blankCount >= 2 ? (
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Accepted answers per blank (alternatives with | )</label>
            <div className="space-y-2">
              {Array.from({ length: blankCount }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs flex-shrink-0" style={{ color: C.faint, width: 52 }}>Blank {i + 1}</span>
                  <input value={blanks[i] ?? ''} onChange={e => setBlankAns(i, e.target.value)} placeholder="corr|correlation" className={inputCls} style={inputStyle} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Accepted answers (separate alternatives with | )</label>
            <input value={q.correctAnswer} onChange={e => onUpdate({ correctAnswer: e.target.value })} className={inputCls} style={inputStyle} placeholder="COUNT(*)|count(*)" />
          </div>
        )}
      </>
    );
  }

  // Arrange: options entered in correct order; correctAnswer is that order joined.
  if (type === 'arrange') {
    const options = q.options ?? [];
    const sync = (next: string[]) => onUpdate({ options: next, correctAnswer: next.join('|||') });
    return (
      <>
        <label className={labelCls} style={{ color: C.faint }}>Items in the CORRECT order</label>
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs w-5" style={{ color: C.faint }}>{i + 1}.</span>
              <input value={opt} onChange={e => { const next = [...options]; next[i] = e.target.value; sync(next); }} placeholder={`Step ${i + 1}`} className={inputCls} style={inputStyle} />
              {options.length > 2 && <button onClick={() => sync(options.filter((_, x) => x !== i))} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
        <button onClick={() => sync([...options, ''])} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add item</button>
      </>
    );
  }

  // Python exercise (also used for "code debug": seed a buggy starter).
  if (type === 'python_exercise') {
    return (
      <>
        <Field C={C} label="Starter code (e.g. buggy code to debug)"><textarea value={q.pythonStarterCode ?? ''} onChange={e => onUpdate({ pythonStarterCode: e.target.value })} rows={4} className={inputCls} style={mono} placeholder="# starter / buggy code" /></Field>
        <Field C={C} label="Setup code (optional, runs before, hidden)"><textarea value={q.pythonSetupCode ?? ''} onChange={e => onUpdate({ pythonSetupCode: e.target.value })} rows={2} className={inputCls} style={mono} /></Field>
        <Field C={C} label="Reference solution (hidden from students)"><textarea value={q.pythonSolution ?? ''} onChange={e => onUpdate({ pythonSolution: e.target.value })} rows={3} className={inputCls} style={mono} /></Field>
        <Field C={C} label="Expected output (the printed result that marks a pass)"><textarea value={q.pythonExpectedOutput ?? ''} onChange={e => onUpdate({ pythonExpectedOutput: e.target.value, pythonHasExpectedOutput: !!e.target.value.trim() })} rows={2} className={inputCls} style={mono} /></Field>
      </>
    );
  }

  return null;
}

function Field({ C, label, children }: { C: any; label: string; children: React.ReactNode }) {
  return <div><label className={labelCls} style={{ color: C.faint }}>{label}</label>{children}</div>;
}

export default function CertificationCreatePage() {
  return (
    <Suspense fallback={null}>
      <CertificationEditor />
    </Suspense>
  );
}
