'use client';

// Dedicated, thin certification authoring editor. Intentionally simpler than the course editor:
// no outline/left pane, no course nav, no points UI -- just exam settings + a sortable question
// list. Reuses the shared CourseQuestion shape, QuestionTypePicker, the create-editor LOCAL theme,
// and the dnd-kit sortable pattern. Persists to /api/certifications.

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, ChevronDown, ChevronUp, Plus, ArrowLeft, Loader2, Check, ImagePlus, ShieldCheck, Upload, FileText, BookOpen, Route, Search, X, SlidersHorizontal, Layers3, Library, ListChecks, Sparkles, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { useC } from '@/components/create/theme';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { useC as useLibC } from '@/lib/theme';
import { Toggle, inputCls, labelCls } from '@/components/create/shared';
import { QuestionTypePicker, TYPE_LABELS, type QuestionTypeOrDownloads } from '@/components/create/QuestionTypePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { ImageLibrary } from '@/components/ImageLibrary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { CourseQuestion, QuestionType, SkillArea, CertificationPrepItem, CertificationType, PlaygroundData, CertificationScenario } from '@/lib/course-schema';

const EXAM_TYPES: QuestionTypeOrDownloads[] = ['multiple_choice', 'fill_blank', 'arrange', 'image', 'image_choice', 'code', 'python_exercise'];

type EditorTab = 'overview' | 'settings' | 'blueprint' | 'resources' | 'questions' | 'practice' | 'publish';

const EDITOR_TABS: { id: EditorTab; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'overview', label: 'Overview', icon: ShieldCheck },
  { id: 'settings', label: 'Exam setup', icon: SlidersHorizontal },
  { id: 'blueprint', label: 'Blueprint', icon: Layers3 },
  { id: 'resources', label: 'Resources', icon: Library },
  { id: 'questions', label: 'Questions', icon: ListChecks },
  { id: 'practice', label: 'Practice', icon: Sparkles },
  { id: 'publish', label: 'Publish', icon: Check },
];

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
  const baseC = useC();
  const libC = useLibC();
  // Accent mirrors the course/dashboard pages exactly (lib/theme): tenant primary brand color in
  // light, ocean (#3E93FF) in dark. Borderless cards, per the house style. Overridden here only --
  // the course create editor (which shares the create theme) is untouched.
  const C = useMemo(() => ({ ...baseC, cta: libC.cta, ctaText: '#ffffff', cardBorder: 'transparent' }), [baseC, libC]);
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name').then(({ data }) => setCohorts(data ?? []));
  }, []);

  useEffect(() => {
    if (!editId) return;
    supabase.from('certifications').select('*').eq('id', editId).single().then(({ data }) => {
      if (data) {
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
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: C.cta }} /></div>;
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: C.page, color: C.text }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <div className="flex flex-col gap-5 px-5 sm:px-7 pt-6 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.cta }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: C.cta, boxShadow: `0 0 0 5px ${C.cta}18` }} /> Certification Studio
                </div>
                <h1 className="mt-2 truncate text-xl sm:text-2xl font-bold">{state.title.trim() || (editId ? 'Edit certification' : 'New certification')}</h1>
              </div>
              <button onClick={() => router.push('/dashboard#certifications')} className="shrink-0 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-transform hover:-translate-y-0.5" style={{ background: C.pill, color: C.muted }}>
                <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Certifications</span>
              </button>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-1.5">
                {EDITOR_TABS.map(tab => {
                  const Icon = tab.icon;
                  const active = editorTab === tab.id;
                  const count = tab.id === 'questions' ? state.questions.length : tab.id === 'practice' ? state.practiceQuestions.length : null;
                  return (
                    <button key={tab.id} type="button" onClick={() => setEditorTab(tab.id)}
                      className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all"
                      style={{ background: active ? `${C.cta}14` : 'transparent', color: active ? C.cta : C.faint }}>
                      <Icon className="w-4 h-4" /> {tab.label}
                      {count !== null && <span className="min-w-5 rounded-full px-1.5 py-0.5 text-[10px] text-center" style={{ background: active ? `${C.cta}1f` : C.pill }}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {error && <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'rgba(244,63,94,0.1)', color: '#f43f5e' }}>{error}</div>}

        {/* Basics */}
        {editorTab === 'overview' && <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={{ background: C.card }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Certification identity</p>
            <h2 className="mt-1 text-lg font-bold">Set the promise learners will work toward</h2>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>Create a clear title, summary, category, and public address.</p>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Certification name</label>
            <input value={state.title} onChange={e => update({ title: e.target.value })} placeholder="Enter certification name"
              className="w-full rounded-xl px-4 py-3.5 text-lg font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text, outlineColor: C.cta }} />
          </div>
          <textarea value={state.description} onChange={e => update({ description: e.target.value })} placeholder="Short description shown before the exam starts"
            rows={2} className={inputCls} style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }} />
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Certification type</label>
            <div className="flex gap-2">
              {(['career', 'technology'] as const).map(tp => {
                const on = state.certType === tp;
                return (
                  <button key={tp} type="button" onClick={() => update({ certType: tp })}
                    className="px-4 py-1.5 rounded-full text-xs font-medium capitalize"
                    style={{ background: on ? C.cta : C.pill, color: on ? C.ctaText : C.muted }}>
                    {tp}
                  </button>
                );
              })}
            </div>
            <p className="text-xs mt-1.5" style={{ color: C.faint }}>Groups this certification on the certifications page.</p>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Public URL</label>
            <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
              <span className="text-sm" style={{ color: C.faint }}>/</span>
              <input value={state.slug} onChange={e => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })}
                placeholder="auto-generated" className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.text }} />
            </div>
            <p className="text-xs mt-1" style={{ color: C.faint }}>The link students open. Leave blank to keep the current one.</p>
          </div>
        </div>}

        {/* Settings */}
        {editorTab === 'settings' && <div className="rounded-2xl p-5 sm:p-7 space-y-6" style={{ background: C.card }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Exam setup</p>
            <h2 className="mt-1 text-lg font-bold">Define the exam rules</h2>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>Control scoring, time, attempts, security, access, and award visuals.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <NumField C={C} label="Pass mark (%)" value={state.passmark} min={0} max={100} onChange={v => update({ passmark: v })} />
            <NumField C={C} label="Time limit (minutes, 0 = none)" value={state.timeLimit} min={0} max={600} onChange={v => update({ timeLimit: v })} />
            <NumField C={C} label="Max attempts (0 = unlimited)" value={state.maxAttempts} min={0} max={20} onChange={v => update({ maxAttempts: v })} />
            <NumField C={C} label="Retake wait (hours, 0 = none)" value={state.retakeCooldownHours} min={0} max={720} onChange={v => update({ retakeCooldownHours: v })} />
            <div>
              <label className={labelCls} style={{ color: C.faint }}>Cover image</label>
              <ImagePickerField C={C} value={state.coverImage} onChange={url => update({ coverImage: url })} folder="certification-covers" placeholder="Select or upload cover image" />
            </div>
            <div>
              <label className={labelCls} style={{ color: C.faint }}>Certification badge</label>
              <ImagePickerField C={C} value={state.badgeImageUrl} onChange={url => update({ badgeImageUrl: url })} folder="certification-badges" placeholder="Select or upload badge" contain />
              <p className="text-xs mt-1.5" style={{ color: C.faint }}>Awarded on pass. Shown on the report and the student&apos;s badges.</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-sm font-medium">Exam protection</span>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>Block copy/paste/right-click, request fullscreen, log tab-switching.</p>
            </div>
            <Toggle checked={state.examProtection} onChange={() => update({ examProtection: !state.examProtection })} accentColor={C.cta} />
          </div>

          {/* Exam integrity: randomize order, shuffle options, question pooling */}
          <div className="pt-4 space-y-4" style={{ borderTop: `1px solid ${C.divider}` }}>
            <div>
              <span className="text-sm font-medium">Exam integrity</span>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>Vary the exam per attempt so answers can&apos;t be shared as easily.</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: C.text }}>Randomize question order</span>
              <Toggle checked={state.randomizeQuestions} onChange={() => update({ randomizeQuestions: !state.randomizeQuestions })} accentColor={C.cta} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: C.text }}>Shuffle answer options</span>
              <Toggle checked={state.shuffleOptions} onChange={() => update({ shuffleOptions: !state.shuffleOptions })} accentColor={C.cta} />
            </div>
            <NumField C={C} label={`Questions per attempt (0 = all${state.questions.length ? `; ${state.questions.length} in the bank` : ''})`}
              value={state.questionPoolSize} min={0} max={Math.max(0, state.questions.length)} onChange={v => update({ questionPoolSize: v })} />
          </div>

          <div>
            <label className={labelCls} style={{ color: C.faint }}>Who can take this</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => update({ cohortIds: [], availableToEveryone: true })}
                className="px-3 py-1.5 rounded-full text-xs font-medium"
                style={{ background: state.availableToEveryone ? C.cta : C.pill, color: state.availableToEveryone ? C.ctaText : C.muted }}>
                Everyone
              </button>
              {cohorts.map(c => {
                const on = state.cohortIds.includes(c.id);
                return (
                  <button key={c.id} onClick={() => update({ availableToEveryone: false, cohortIds: on ? state.cohortIds.filter(x => x !== c.id) : [...state.cohortIds, c.id] })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: on ? C.cta : C.pill, color: on ? C.ctaText : C.muted }}>
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs mt-2" style={{ color: C.faint }}>
              {state.availableToEveryone
                ? 'Available to everyone who is signed in.'
                : state.cohortIds.length === 0
                  ? 'Nobody can take this yet. Choose Everyone or select at least one cohort.'
                  : 'Only the selected cohorts can take this certification.'}
            </p>
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <PlanAccessPicker
                contentTable="certifications"
                contentId={editId}
                availableToEveryone={state.availableToEveryone}
              />
            </div>
          </div>
        </div>}

        {/* Skill areas */}
        {editorTab === 'blueprint' && <>
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={{ background: C.card }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Assessment blueprint</p>
            <h2 className="mt-1 text-lg font-bold">Skills and case studies</h2>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>Define the skills this certification assesses, then map each question to a skill below.</p>
          </div>
          {state.skillAreas.length > 0 && (
            <div className="space-y-2">
              {state.skillAreas.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input value={s.name} onChange={e => setSkill(s.id, e.target.value)} placeholder={`Skill area ${i + 1}`} className={inputCls} style={inputStyle} />
                  <button onClick={() => removeSkill(s.id)} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          <button onClick={addSkill} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add skill area</button>
        </div>

        {/* Case studies */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-4" style={{ background: C.card }}>
          <div>
            <h3 className="text-sm font-semibold">Case studies</h3>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>Define a shared scenario, then attach questions to it below. Each attached question shows the scenario alongside it, so several questions can build on one context.</p>
          </div>
          {state.scenarios.length > 0 && (
            <div className="space-y-3">
              {state.scenarios.map((s, i) => (
                <div key={s.id} className="rounded-lg p-3 space-y-2" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
                  <div className="flex items-center gap-2">
                    <input value={s.title} onChange={e => setScenario(s.id, { title: e.target.value })} placeholder={`Case study ${i + 1} title`} className={inputCls} style={inputStyle} />
                    <button onClick={() => removeScenario(s.id)} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <RichTextEditor value={s.content} onChange={html => setScenario(s.id, { content: html })}
                    placeholder="Scenario / context shown to the student. Use the toolbar for images, block quotes, tables, lists, and more."
                    onRequestImage={requestScenarioImage} />
                </div>
              ))}
            </div>
          )}
          <button onClick={addScenario} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add case study</button>
        </div>
        </>}

        {/* Learner resources */}
        {editorTab === 'resources' && <>
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={{ background: C.card }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Learner resources</p>
            <h2 className="mt-1 text-lg font-bold">Prepare learners for success</h2>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>Publish study materials, a visual poster, and optional practice links.</p>
          </div>
          <StudyGuideField C={C} url={state.studyGuideUrl} name={state.studyGuideName} published={state.studyGuidePublished}
            onChange={(url, name) => update({ studyGuideUrl: url, studyGuideName: name, ...(url ? {} : { studyGuidePublished: false }) })}
            onPublish={v => update({ studyGuidePublished: v })} />
          <PosterField C={C} url={state.posterUrl} published={state.posterPublished}
            onChange={url => update({ posterUrl: url, ...(url ? {} : { posterPublished: false }) })}
            onPublish={v => update({ posterPublished: v })} />
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Practice test link</label>
            <input value={state.practiceTestUrl} onChange={e => update({ practiceTestUrl: e.target.value })} placeholder="https://..." className={inputCls} style={inputStyle} />
            <p className="text-xs mt-1.5" style={{ color: C.faint }}>Learners can launch the practice test from the certification before the real exam.</p>
          </div>
        </div>

        {/* Courses to complete (shown on the overview's "Complete courses" step) */}
        <PrepItemsField C={C} value={state.prepItems} onChange={items => update({ prepItems: items })} />
        </>}

        {/* Shared playground data -- define tables/datasets once; question playgrounds reuse them */}
        {editorTab === 'blueprint' && <SharedPlaygroundField C={C} inputStyle={inputStyle} value={state.playgroundData} onChange={pd => update({ playgroundData: pd })} />}

        {/* Questions */}
        {editorTab === 'questions' && <div className="rounded-2xl p-5 sm:p-7" style={{ background: C.card }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Question bank</p>
              <h2 className="mt-1 text-lg font-bold">Graded exam questions <span style={{ color: C.faint }}>({state.questions.length})</span></h2>
              <p className="mt-1 text-sm" style={{ color: C.muted }}>Build and reorder the questions used in scored attempts.</p>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={state.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
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
          <button onClick={() => setPicking(true)} className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium"
            style={{ border: `1.5px dashed ${C.inputBorder}`, color: C.muted }}>
            <Plus className="w-4 h-4" /> Add question
          </button>
        </div>}

        {/* Practice questions -- a SEPARATE bank used only by practice mode (never the graded exam). */}
        {editorTab === 'practice' && <div className="rounded-2xl p-5 sm:p-7" style={{ background: C.card }}>
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Practice bank</p>
            <h2 className="mt-1 text-lg font-bold">Practice questions <span style={{ color: C.faint }}>({state.practiceQuestions.length})</span></h2>
            <p className="text-sm mt-1" style={{ color: C.muted }}>Students see the correct answers and explanations after practice. These questions never appear in the graded exam. Leave empty to hide Practice.</p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPracticeDragEnd}>
            <SortableContext items={state.practiceQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
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
          <button onClick={() => setPickingPractice(true)} className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium"
            style={{ border: `1.5px dashed ${C.inputBorder}`, color: C.muted }}>
            <Plus className="w-4 h-4" /> Add practice question
          </button>
        </div>}

        {editorTab === 'publish' && (
          <div className="rounded-2xl p-5 sm:p-7 space-y-6" style={{ background: C.card }}>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>Readiness</p>
              <h2 className="mt-1 text-lg font-bold">Review before publishing</h2>
              <p className="mt-1 text-sm" style={{ color: C.muted }}>A quick check of the essentials learners need for a complete certification experience.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Certification identity', detail: state.title.trim() ? state.title : 'Add a title', ready: !!state.title.trim(), tab: 'overview' as EditorTab },
                { label: 'Exam questions', detail: `${state.questions.length} graded question${state.questions.length === 1 ? '' : 's'}`, ready: state.questions.length > 0, tab: 'questions' as EditorTab },
                { label: 'Award badge', detail: state.badgeImageUrl ? 'Badge ready' : 'Optional badge not added', ready: !!state.badgeImageUrl, tab: 'settings' as EditorTab },
                { label: 'Learner preparation', detail: `${state.prepItems.length} prerequisite${state.prepItems.length === 1 ? '' : 's'} · ${state.practiceQuestions.length} practice question${state.practiceQuestions.length === 1 ? '' : 's'}`, ready: state.prepItems.length > 0 || state.practiceQuestions.length > 0, tab: state.practiceQuestions.length ? 'practice' as EditorTab : 'resources' as EditorTab },
              ].map(item => (
                <button key={item.label} type="button" onClick={() => setEditorTab(item.tab)} className="flex items-center gap-3 rounded-xl p-4 text-left transition-transform hover:-translate-y-0.5" style={{ background: C.input }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: item.ready ? `${C.cta}16` : C.pill, color: item.ready ? C.cta : C.faint }}>
                    {item.ready ? <Check className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{item.label}</span><span className="block truncate text-xs mt-0.5" style={{ color: C.muted }}>{item.detail}</span></span>
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button onClick={() => save('draft')} disabled={saving} className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.text }}>Save as draft</button>
              <button onClick={() => save('published')} disabled={saving} className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2" style={{ background: C.cta, color: C.ctaText }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Publish certification
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-5 right-4 sm:right-6 z-30 flex items-center gap-2 rounded-2xl p-2" style={{ background: C.card, boxShadow: '0 16px 50px rgba(15,23,42,0.20)' }}>
        <button onClick={() => save('draft')} disabled={saving} className="rounded-xl px-3.5 py-2.5 text-sm font-semibold" style={{ background: C.pill, color: C.text }}>Save draft</button>
        <button onClick={() => save('published')} disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2" style={{ background: C.cta, color: C.ctaText }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Publish
        </button>
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

function NumField({ C, label, value, min, max, onChange }: { C: any; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={labelCls} style={{ color: C.faint }}>{label}</label>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className={inputCls} style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }} />
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
            <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.92)', color: '#111' }}><ImagePlus className="w-3.5 h-3.5" /> Change</button>
            <button type="button" onClick={() => onChange('')} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.85)', color: '#dc2626' }}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
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
    <div className="space-y-4 pt-2">
      <div>
        <h3 className="text-sm font-semibold">Courses to prepare for the exam</h3>
        <p className="text-xs mt-0.5" style={{ color: C.faint }}>Attach the courses or learning paths that build the skills for this certification. They appear on the certification page under &quot;Complete courses&quot; as cards with a hover preview.</p>
      </div>

      {value.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}>
        <Plus className="w-3 h-3" /> Add courses or learning paths
      </button>

      {open && (
        <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${C.divider}` }}>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
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
                      {on && <Check className="w-3 h-3" style={{ color: C.ctaText }} />}
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
      <label className={labelCls} style={{ color: C.faint }}>Study guide (PDF)</label>
      {url ? (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="flex items-center gap-1.5 min-w-0" style={{ color: C.text }}>
            <FileText className="w-4 h-4 flex-shrink-0" style={{ color: C.cta }} /><span className="truncate" style={{ maxWidth: 220 }}>{name || 'Study guide.pdf'}</span>
          </span>
          <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: C.cta }}>Preview</a>
          <label className="text-xs cursor-pointer" style={{ color: C.muted }}>{busy ? 'Uploading...' : 'Replace'}<input type="file" accept="application/pdf,.pdf" className="hidden" onChange={upload} /></label>
          <button onClick={() => onChange('', '')} className="text-xs" style={{ color: C.faint }}>Remove</button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm w-fit" style={{ ...inputStyle, color: C.muted }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>Upload PDF</span>
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={upload} />
          </label>
          <div className="flex items-center gap-2">
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
              placeholder="or paste a link to a PDF (https://...)" className={inputCls} style={inputStyle} />
            <button onClick={addLink} disabled={!link.trim()} className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0" style={{ background: C.cta, color: C.ctaText, opacity: link.trim() ? 1 : 0.5 }}>Add</button>
          </div>
        </div>
      )}
      {url && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs" style={{ color: C.faint }}>Published (learners can view or download it)</span>
          <Toggle checked={published} onChange={() => onPublish(!published)} accentColor={C.cta} />
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
      <label className={labelCls} style={{ color: C.faint }}>Certification poster</label>
      <div className="flex items-center gap-3">
        <div style={{ width: 92, height: 120, borderRadius: 8, background: C.input, border: `1px solid ${C.inputBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.faint }} />
            : url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-xs w-fit" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.muted }}>
            <Upload className="w-3.5 h-3.5" /> {url ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={upload} />
          </label>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium block" style={{ color: C.cta }}>Preview</a>}
          {url && <button onClick={() => onChange('')} className="text-xs block" style={{ color: C.faint }}>Remove</button>}
        </div>
      </div>
      {url && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs" style={{ color: C.faint }}>Published (visible to learners)</span>
          <Toggle checked={published} onChange={() => onPublish(!published)} accentColor={C.cta} />
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

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl overflow-hidden" >
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: expanded ? '12px 12px 0 0' : 12 }}>
        <button className="cursor-grab active:cursor-grabbing" style={{ color: C.faint }} {...attributes} {...listeners}><GripVertical className="w-3.5 h-3.5" /></button>
        <button onClick={onToggle} className="flex-1 text-left min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: C.text }}>
            {(q.question?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()) || <span className="italic" style={{ color: C.faint }}>Question {index + 1}</span>}
          </span>
          <span className="text-[10px]" style={{ color: C.faint }}>{TYPE_LABELS[type]}</span>
        </button>
        <button onClick={onRemove} className="p-1 hover:text-red-400" style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
        <button onClick={onToggle} className="p-1" style={{ color: C.faint }}>{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</button>
      </div>

      {expanded && (
        <div className="px-3 pt-3 pb-4 space-y-3" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
          <div>
            <label className={labelCls} style={{ color: C.faint }}>Question</label>
            <RichTextEditor value={q.question} onChange={html => onUpdate({ question: html })}
              placeholder="Ask the question. Use the toolbar for bold, lists, code, links, and images."
              onImageUpload={(file) => uploadToCloudinary(file, 'certification-prompts')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: C.faint }}>Section</label>
              <select value={q.section ?? 'technical'} onChange={e => onUpdate({ section: e.target.value as 'technical' | 'practical' })} className={inputCls} style={inputStyle}>
                <option value="technical">Technical</option>
                <option value="practical">Practical / Case study</option>
              </select>
            </div>
            {skillAreas.length > 0 && (
              <div>
                <label className={labelCls} style={{ color: C.faint }}>Skill area</label>
                <select value={q.skillAreaId ?? ''} onChange={e => onUpdate({ skillAreaId: e.target.value || undefined })} className={inputCls} style={inputStyle}>
                  <option value="">No skill area</option>
                  {skillAreas.map(s => <option key={s.id} value={s.id}>{s.name.trim() || 'Untitled skill'}</option>)}
                </select>
              </div>
            )}
            {scenarios.length > 0 && (
              <div>
                <label className={labelCls} style={{ color: C.faint }}>Case study</label>
                <select value={q.scenarioId ?? ''} onChange={e => onUpdate({ scenarioId: e.target.value || undefined })} className={inputCls} style={inputStyle}>
                  <option value="">No case study</option>
                  {scenarios.map((s, i) => <option key={s.id} value={s.id}>{s.title.trim() || `Case study ${i + 1}`}</option>)}
                </select>
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
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-xs flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.muted, maxWidth: 160 }}>
              {uploadingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="truncate">{tbl.fileName || 'CSV'}</span>
              <input type="file" accept=".csv,.tsv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCsv(i, f); }} />
            </label>
            <button onClick={() => onChange(tables.filter((_, k) => k !== i))} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...tables, { id: newId(), tableName: `table_${tables.length + 1}`, fileName: '', fileUrl: '', csvUrl: '' }])}
        className="mt-2 text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add table</button>
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
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-xs flex-shrink-0" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.muted, maxWidth: 160 }}>
              {uploadingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="truncate">{ds.fileName || 'CSV'}</span>
              <input type="file" accept=".csv,.tsv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadDataset(i, f); }} />
            </label>
            <button onClick={() => onChange(datasets.filter((_, k) => k !== i))} style={{ color: C.faint }}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...datasets, { id: newId(), variableName: `df${datasets.length || ''}`, fileName: '', fileUrl: '', csvUrl: '' }])}
        className="mt-2 text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add dataset</button>
    </div>
  );
}

// Certification-wide shared playground data: tables/datasets defined ONCE and reused by every
// question's runnable playground, so the same CSV is not re-uploaded on each question.
function SharedPlaygroundField({ C, inputStyle, value, onChange }: {
  C: any; inputStyle: any; value: PlaygroundData; onChange: (pd: PlaygroundData) => void;
}) {
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 13 };
  const [lang, setLang] = useState<'sql' | 'python'>(
    (value.pythonDatasets?.length || value.setupPython?.trim()) && !(value.sqlTables?.length || value.setupSql?.trim()) ? 'python' : 'sql',
  );
  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
      <div>
        <h3 className="text-sm font-semibold">Shared playground data</h3>
        <p className="text-xs mt-0.5" style={{ color: C.faint }}>Define tables or datasets once here. Every question&apos;s runnable playground can reuse them, so you don&apos;t re-add the same data on each question.</p>
      </div>
      <div className="flex gap-2">
        {(['sql', 'python'] as const).map(l => (
          <button key={l} type="button" onClick={() => setLang(l)} className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: lang === l ? C.cta : C.pill, color: lang === l ? C.ctaText : C.muted }}>
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
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 13 };
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
        <Toggle checked={enabled} onChange={() => onUpdate({ playground: enabled ? undefined : { language: 'sql', starterCode: '' } })} accentColor={C.cta} />
      </div>
      {enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            {(['sql', 'python'] as const).map(l => (
              <button key={l} onClick={() => update({ language: l })} className="px-3 py-1.5 rounded-full text-xs font-medium"
                style={{ background: lang === l ? C.cta : C.pill, color: lang === l ? C.ctaText : C.muted }}>
                {l === 'sql' ? 'SQL' : 'Python'}
              </button>
            ))}
          </div>

          {hasSharedData && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg" style={{ background: C.input }}>
              <div>
                <span className="text-xs font-medium" style={{ color: C.text }}>Use shared certification data</span>
                <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>Loads the certification&apos;s shared tables/datasets here too, alongside any added below.</p>
              </div>
              <Toggle checked={useShared} onChange={() => update({ useSharedData: !useShared })} accentColor={C.cta} />
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
  const mono = { ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 13 };
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
            <Toggle checked={multi} onChange={() => onUpdate({ multiSelect: !multi, correctAnswer: '' })} accentColor={C.cta} />
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
        <button onClick={() => onUpdate({ options: [...options, ''] })} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add option</button>
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
            <div key={i} className="rounded-lg p-2.5 space-y-2" style={{ border: `1px solid ${q.correctAnswer === String(i) ? C.cta : C.inputBorder}` }}>
              <label className="flex items-center justify-center h-24 rounded cursor-pointer overflow-hidden" style={{ background: C.input }}>
                {images[i] ? <img src={images[i]} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImg(i, f); }} />
              </label>
              <input value={opt} onChange={e => { const next = [...options]; next[i] = e.target.value; onUpdate({ options: next }); }} placeholder="Label" className={inputCls} style={inputStyle} />
              <label className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                <input type="radio" checked={q.correctAnswer === String(i)} onChange={() => onUpdate({ correctAnswer: String(i) })} style={{ accentColor: C.cta }} /> Correct
              </label>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => onUpdate({ options: [...options, ''], optionImages: [...images, ''] })} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add option</button>
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
        <button onClick={() => sync([...options, ''])} className="text-xs font-medium flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-3 h-3" /> Add item</button>
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
