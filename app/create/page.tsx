'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Loader2, Check, Plus, Trash2, X, ChevronDown, ChevronUp,
  Upload, Link2, FileText,
} from 'lucide-react';
import type { FormConfig } from '@/lib/course-schema';
import { BriefPanel, Chips, Field, OutlineHeader, OutlineModules, Sect, SidePanel, newLessonId, useStarterC } from '@/components/create/generator-ui';
import { MenuSelect } from '@/components/MenuSelect';
import { FIELD } from '@/components/dashboard/subscriptions/Modal';
import { btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { TEMPLATES } from '@/components/create/shared';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { AiTextarea } from '@/components/AiTextarea';
import { loadLessonHtmlToDoc } from '@/components/lesson/loadLessonHtmlToDoc';
import { supabase } from '@/lib/supabase';
import { formatSQLPreflightIssue, preflightSQLExercises } from '@/lib/sql-exercise-preflight';
import { formatPythonPreflightIssue, preflightPythonExercises } from '@/lib/python-exercise-preflight';
import { useRouter } from 'next/navigation';

// Convert AI-generated question lessons (HTML body) into canonical interactive docs
// so full course generation produces doc-canonical lessons, matching the per-lesson
// generate_lesson flow. Body is kept as the lossy fallback. Runs client-side.
async function attachQuestionLessonDocs(questions: any[]): Promise<any[]> {
  const lessonHtmlToDoc = await loadLessonHtmlToDoc();
  return (questions || []).map((q: any) => {
    if (!q?.lesson?.body || q.lesson.doc) return q;
    try { return { ...q, lesson: { ...q.lesson, doc: lessonHtmlToDoc(q.lesson.body) } }; }
    catch { return q; } // keep body-only if the HTML cannot be parsed
  });
}

// --- Types: the content contract is canonical in lib/course-schema (imported above) ---

// Brief choices and outline lesson types for the AI course generators.
const INDUSTRIES = ['Finance', 'Healthcare', 'Retail', 'Marketing', 'HR', 'EdTech', 'Logistics', 'Consulting'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const PY_FOCUS_AREAS = ['Data Analysis', 'Data Visualization', 'Machine Learning', 'Statistics', 'Data Cleaning', 'Automation'];
const SQL_TYPES = [
  { value: 'sql', label: 'SQL exercise' }, { value: 'mcq', label: 'Multiple choice' },
  { value: 'debug', label: 'Fix the query' }, { value: 'completion', label: 'Complete the query' },
];
const PY_TYPES = [{ value: 'python_exercise', label: 'Python exercise' }, { value: 'multiple_choice', label: 'Multiple choice' }];
const DOC_TYPES = [
  { value: 'multiple_choice', label: 'Multiple choice' }, { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'arrange', label: 'Put in order' }, { value: 'sql_exercise', label: 'SQL exercise' },
  { value: 'python_exercise', label: 'Python exercise' }, { value: 'code', label: 'Code snippet' },
  { value: 'code_review', label: 'AI code review' }, { value: 'excel_review', label: 'AI Excel review' },
  { value: 'dashboard_critique', label: 'AI dashboard critique' }, { value: 'document_review', label: 'AI document review' },
  { value: 'written_response', label: 'AI written response' },
];
const DOC_DEPTHS = [{ key: 'primer', label: 'Quick primer' }, { key: 'balanced', label: 'Balanced' }, { key: 'comprehensive', label: 'Comprehensive' }] as const;
const DOC_PRACTICE = [{ key: 'hands_on', label: 'Hands-on heavy' }, { key: 'balanced', label: 'Balanced' }, { key: 'knowledge', label: 'Knowledge checks' }] as const;
const DOC_TONES = [{ key: 'professional', label: 'Professional' }, { key: 'conversational', label: 'Conversational' }, { key: 'academic', label: 'Academic' }] as const;
const DOC_IMAGES = [{ key: 'source', label: 'From the document' }, { key: 'stock', label: 'Stock photos' }] as const;
const DOC_VIDEOS = [{ key: true, label: 'Include YouTube videos' }, { key: false, label: 'No videos' }] as const;

// --- Main Page ---
export default function Page() {
  const C = useStarterC();
  const P = palette(C);
  const router = useRouter();
  const inputStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };
  const fieldCls = FIELD;
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(true); // stays true until useEffect resolves
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info'; persistent?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error', options?: { persistent?: boolean }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, persistent: options?.persistent });
    toastTimer.current = options?.persistent ? null : setTimeout(() => setToast(null), 5000);
  };

  // Add-field state
  const [aiLoadingLabel, setAiLoadingLabel] = useState('');
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
  const [docMoreOpen, setDocMoreOpen] = useState(false);
  // Bunny video picker

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
    const editId = params.get('edit');

    if (editId) {
      // Courses and events are edited in one place: the dashboard editor.
      router.replace(`/dashboard/${editId}?tab=settings`);
      return;
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
      } else {
        // No start point chosen: the Create menu on the dashboard is where courses start.
        const match = type ? TEMPLATES.find(t => t.key === type) : undefined;
        if (!match) { router.replace('/dashboard'); return; }
        setFormConfig({ ...match.config });
      }
      setIsLoadingEdit(false);
    }
  }, [router, userRole]);

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

  // A speaker typed into the Speakers form but not yet added: Save adds it (components/SpeakersEditor).

  // -- A chosen or generated start point is saved as a draft at once and opened in the dashboard
  // editor, the one place courses and events are edited. --
  const draftStartedRef = useRef(false);
  useEffect(() => {
    if (!formConfig || draftStartedRef.current) return;
    if (!user) return; // the page waits for sign-in; this runs again once the user loads
    draftStartedRef.current = true;
    (async () => {
      const failed = (message: string) => {
        showToast(message);
        draftStartedRef.current = false;
        setFormConfig(null);
      };
      try {
        let config = await prepareSqlExpectedResultsForSave(formConfig, false);
        if (config) config = await preparePythonExpectedOutputsForSave(config, false);
        if (!config) return failed('Could not prepare the course. Please try again.');
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            title: config.title,
            description: config.description,
            config,
            cohort_ids: [],
            ...(config.isCourse ? { available_to_everyone: false } : {}),
            deadline_days: config.deadline_days ?? null,
            status: 'draft',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.id) return failed(data.error ?? 'Could not create the draft. Please try again.');
        router.replace(`/dashboard/${data.id}?tab=settings`);
      } catch {
        failed('Could not create the draft. Please check your connection and try again.');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formConfig, user]);

  // Messages from the start page, the generators and the draft step.
  const toastView = toast && (
    <div role="status" className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-xl w-[calc(100%-2rem)] max-h-[45vh] overflow-auto rounded-2xl px-4 py-4 flex items-start gap-3 shadow-xl"
      style={{ background: C.card, border: `1px solid ${toast.type === 'error' ? 'rgba(217,48,37,0.25)' : toast.type === 'success' ? 'rgba(16,185,129,0.25)' : C.cardBorder}`, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
      <div className="w-2 self-stretch rounded-full flex-shrink-0 mt-0.5"
        style={{ background: toast.type === 'error' ? '#D93025' : toast.type === 'success' ? '#10b981' : '#3b82f6' }} />
      <p className="text-sm leading-snug flex-1" style={{ color: C.text }}>{toast.message}</p>
      <button type="button" aria-label="Close" onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} className="flex-shrink-0 mt-0.5 hover:opacity-60 transition-opacity" style={{ color: C.faint }}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

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

  // Regenerate one module of a SQL or Python outline, keeping the rest.
  const regenerateOutlineModule = async (action: string, brief: object, outline: any, setOutline: (fn: (prev: any) => any) => void, setLoading: (i: number | null) => void, modIdx: number) => {
    if (!outline) return;
    setLoading(modIdx);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action, ...brief, moduleIndex: modIdx, existingOutline: outline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate module.');
      setOutline((prev: any) => ({
        ...prev,
        modules: prev.modules.map((m: any, i: number) => i === modIdx ? data.module ?? m : m),
      }));
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate module.', 'error');
    } finally {
      setLoading(null);
    }
  };
  const handleRegenerateSqlModule = (modIdx: number) => regenerateOutlineModule('generate_sql_course_outline', sqlBrief, sqlOutline, setSqlOutline, setSqlModuleLoading, modIdx);
  const handleRegeneratePyModule = (modIdx: number) => regenerateOutlineModule('generate_python_course_outline', pyBrief, pyOutline, setPyOutline, setPyModuleLoading, modIdx);

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
        questions: await attachQuestionLessonDocs(data.questions || []),
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
        questions: await attachQuestionLessonDocs(data.questions || []),
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
        questions: await attachQuestionLessonDocs(data.questions || []),
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

  // -- Field management --

  // -- Course management --

  // -- Shared view --
  // What "More options" on the document brief is set to, shown while it is closed.
  const docOptionsSummary = [
    { primer: 'Quick primer', balanced: 'Balanced depth', comprehensive: 'Comprehensive' }[docBrief.depth],
    { hands_on: 'hands-on practice', balanced: 'balanced practice', knowledge: 'knowledge checks' }[docBrief.practice],
    `${docBrief.tone} tone`,
    docBrief.imageMode.length === 2 ? 'document and stock images' : docBrief.imageMode[0] === 'source' ? 'images from the document' : docBrief.imageMode[0] === 'stock' ? 'stock images' : 'no images',
    docBrief.includeVideos ? 'YouTube videos' : 'no videos',
  ].join(', ');

  // -- Loading edit --
  if (isLoadingEdit) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }} />
      </main>
    );
  }

  // -- Landing --
  if (!formConfig) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: C.page, color: C.text }}>
        {toastView}
        <div className={`relative z-10 flex-1 flex flex-col items-center ${(sqlWizardStep || docWizardStep || pyWizardStep) ? 'justify-start pt-6 sm:pt-8 pb-24' : 'justify-center py-16 sm:py-20'} px-4 sm:px-6 ${(sqlWizardStep === 'outline' || docWizardStep === 'outline' || pyWizardStep === 'outline') ? 'max-w-6xl' : 'max-w-4xl'} mx-auto w-full`}>

          {/* SQL course: brief */}
          {sqlWizardStep === 'brief' && (
            <motion.div key="sql-brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full">
              <BriefPanel title="Create a SQL course" description="Describe the course. You review the outline before anything is generated." onBack={() => router.push('/dashboard')}
                onGenerate={handleGenerateSqlOutline} disabled={!!aiLoadingLabel || !sqlBrief.title.trim()}>
                <Sect title="Course brief" first>
                <Field label="Course title">
                  <input type="text" value={sqlBrief.title} onChange={e => setSqlBrief(p => ({ ...p, title: e.target.value }))} placeholder="For example SQL for Financial Analysts" className={fieldCls} style={inputStyle} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Industry">
                    <MenuSelect field label="Industry" C={C} value={sqlBrief.industry} onChange={v => setSqlBrief(p => ({ ...p, industry: v }))} options={INDUSTRIES.map(v => ({ value: v, label: v }))} />
                  </Field>
                  <Field label="Skill level">
                    <MenuSelect field label="Skill level" C={C} value={sqlBrief.level} onChange={v => setSqlBrief(p => ({ ...p, level: v }))} options={LEVELS.map(v => ({ value: v, label: v }))} />
                  </Field>
                </div>
                <Field label="Target role">
                  <input type="text" value={sqlBrief.role} onChange={e => setSqlBrief(p => ({ ...p, role: e.target.value }))} placeholder="For example Data Analyst, Business Intelligence Developer" className={fieldCls} style={inputStyle} />
                </Field>
                <Field label="Specific focus" optional>
                  <AiTextarea value={sqlBrief.promptText} onValueChange={value => setSqlBrief(p => ({ ...p, promptText: value }))} placeholder="Any topics, datasets or skills to focus on" rows={3} className={`${fieldCls} resize-none`} style={inputStyle} />
                </Field>
                </Sect>
              </BriefPanel>
            </motion.div>
          )}

          {/* SQL course: outline review */}
          {sqlWizardStep === 'outline' && sqlOutline && (
            <motion.div key="sql-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-12">
              <OutlineHeader title="Review your SQL course" description="Rename modules and lessons, change lesson types or regenerate a module, then generate the course."
                onBack={() => setSqlWizardStep('brief')} onGenerate={handleGenerateSqlFullCourse} disabled={!!aiLoadingLabel} />
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
                <div className="min-w-0">
                  <OutlineModules modules={sqlOutline.modules ?? []} onChange={modules => setSqlOutline((prev: any) => ({ ...prev, modules }))} typeOptions={SQL_TYPES}
                    newLesson={() => ({ id: newLessonId(), title: 'New lesson', skillFocus: '', questionType: 'sql', questionSummary: '' })}
                    onRegenerate={handleRegenerateSqlModule} regenerating={sqlModuleLoading} />
                </div>
                <SidePanel title="Shared dataset" description={sqlOutline.sharedDataset?.description}>
                  <div className="flex flex-col">
                    {(sqlOutline.sharedDataset?.tables ?? []).map((table: any, tableIdx: number) => {
                      const setTable = (patch: any) => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.map((t: any, i: number) => i === tableIdx ? { ...t, ...patch } : t) } }));
                      const open = sqlExpandedTables.has(tableIdx);
                      return (
                        <div key={tableIdx} className="py-2.5" style={tableIdx ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <input value={table.tableName} onChange={e => setTable({ tableName: e.target.value })} aria-label="Table name" className="text-[13px] font-mono font-semibold bg-transparent border-none outline-none w-full" style={{ color: C.text }} />
                              <input value={table.description} onChange={e => setTable({ description: e.target.value })} aria-label="Table description" className="text-xs bg-transparent border-none outline-none w-full mt-0.5" style={{ color: C.muted }} />
                            </div>
                            <button type="button" onClick={() => setSqlExpandedTables(prev => { const next = new Set(prev); if (next.has(tableIdx)) next.delete(tableIdx); else next.add(tableIdx); return next; })}
                              title={open ? 'Hide setup SQL' : 'Edit setup SQL'} aria-label={open ? 'Hide setup SQL' : 'Edit setup SQL'} className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0" style={{ color: C.muted }}>
                              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: prev.sharedDataset.tables.filter((_: any, i: number) => i !== tableIdx) } }))}
                              title="Remove table" aria-label="Remove table" className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0" style={{ background: P.badSoft, color: P.bad }}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          {open && (
                            <AiTextarea value={table.seedSql} onValueChange={value => setTable({ seedSql: value })} rows={8} className="w-full mt-2 rounded-[10px] text-xs font-mono px-3 py-2 resize-none outline-none" style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }} />
                          )}
                        </div>
                      );
                    })}
                    <button type="button" onClick={() => setSqlOutline((prev: any) => ({ ...prev, sharedDataset: { ...prev.sharedDataset, tables: [...(prev.sharedDataset?.tables ?? []), { tableName: 'new_table', description: '', seedSql: 'CREATE TABLE new_table (\n  id INTEGER\n);\n' }] } }))}
                      className={`${btnSmClass} mt-2 self-start`} style={btnStyle('sec', C)}>
                      <Plus className="w-3.5 h-3.5" /> Add table
                    </button>
                  </div>
                </SidePanel>
              </div>
            </motion.div>
          )}

          {/* Document course: source and brief */}
          {docWizardStep === 'input' && (
            <motion.div key="doc-input" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full">
              <BriefPanel title="Create from a document" description="Turn a file, page or pasted text into a course with lessons and practice." onBack={() => router.push('/dashboard')}
                onGenerate={handleGenerateDocOutline} disabled={!!aiLoadingLabel}>
                <Sect title="Source" first>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl" style={{ background: C.page }}>
                  {([
                    { key: 'file', label: 'Upload', icon: Upload },
                    { key: 'text', label: 'Paste text', icon: FileText },
                    { key: 'url',  label: 'Web URL', icon: Link2 },
                  ] as const).map(opt => {
                    const Icon = opt.icon;
                    const active = docSourceMethod === opt.key;
                    return (
                      <button key={opt.key} type="button" onClick={() => setDocSourceMethod(opt.key)} aria-pressed={active} className="flex items-center justify-center gap-2 h-9 rounded-[9px] text-[13px] font-semibold transition-colors" style={active ? { background: P.sel, color: P.onSel } : { background: 'transparent', color: C.muted }}>
                        <Icon className="w-3.5 h-3.5" /> {opt.label}
                      </button>
                    );
                  })}
                </div>

                {docSourceMethod === 'file' && (
                  <label className="flex flex-col items-center justify-center gap-1 py-8 rounded-2xl cursor-pointer text-center" style={{ border: `2px dashed ${docFile ? P.sel : C.divider}` }}>
                    <Upload className="w-5 h-5 mb-2" style={{ color: docFile ? P.sel : C.faint }} />
                    <span className="text-sm font-semibold" style={{ color: C.text }}>{docFile ? docFile.name : 'Choose a file'}</span>
                    <span className="text-xs" style={{ color: C.faint }}>PDF, DOCX, DOC, TXT, PPTX, PPT (max 20 MB)</span>
                    <input type="file" accept=".pdf,.docx,.doc,.txt,.pptx,.ppt" className="hidden" onChange={e => setDocFile(e.target.files?.[0] ?? null)} />
                  </label>
                )}
                {docSourceMethod === 'text' && (
                  <AiTextarea value={docText} onValueChange={setDocText} placeholder="Paste your documentation, product guide or notes here" rows={8} className={`${fieldCls} resize-none`} style={inputStyle} />
                )}
                {docSourceMethod === 'url' && (
                  <input type="url" value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="https://docs.example.com/guide" className={fieldCls} style={inputStyle} />
                )}

                </Sect>
                <Sect title="About the course">
                <Field label="Course title" optional>
                  <input type="text" value={docBrief.title} onChange={e => setDocBrief(p => ({ ...p, title: e.target.value }))} placeholder="Leave blank and AI proposes one" className={fieldCls} style={inputStyle} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Audience" optional>
                    <input type="text" value={docBrief.audience} onChange={e => setDocBrief(p => ({ ...p, audience: e.target.value }))} placeholder="For example new customers, sales team" className={fieldCls} style={inputStyle} />
                  </Field>
                  <Field label="Level">
                    <MenuSelect field label="Level" C={C} value={docBrief.level} onChange={v => setDocBrief(p => ({ ...p, level: v }))} options={LEVELS.map(v => ({ value: v, label: v }))} />
                  </Field>
                </div>
                <Field label="What should learners be able to do?">
                  <AiTextarea value={docBrief.goal} onValueChange={value => setDocBrief(p => ({ ...p, goal: value }))} placeholder="For example confidently write SQL queries to answer real business questions" rows={2} className={`${fieldCls} resize-none`} style={inputStyle} />
                </Field>

                </Sect>
                <div className="p-5" style={{ borderTop: `1px solid ${C.divider}` }}>
                  <button type="button" onClick={() => setDocMoreOpen(o => !o)} aria-expanded={docMoreOpen} className="w-full flex items-center gap-3 text-left">
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-semibold" style={{ color: C.text }}>More options</span>
                      {!docMoreOpen && <span className="block text-xs mt-1" style={{ color: C.muted }}>{docOptionsSummary}</span>}
                    </span>
                    <span className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0" style={{ color: C.muted }}>
                      <ChevronDown className={`w-4 h-4 transition-transform ${docMoreOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {docMoreOpen && (
                    <div className="flex flex-col gap-4 mt-4">
                      <Field label="Specific focus" optional>
                        <AiTextarea value={docBrief.focus} onValueChange={value => setDocBrief(p => ({ ...p, focus: value }))} placeholder="Any sections, topics or angles to stress or skip" rows={2} className={`${fieldCls} resize-none`} style={inputStyle} />
                      </Field>
                      <Field label="Depth" hint="How thorough the course is: sets how many modules and lessons.">
                        <Chips options={DOC_DEPTHS} isOn={k => docBrief.depth === k} onPick={k => setDocBrief(p => ({ ...p, depth: k }))} />
                      </Field>
                      <Field label="Practice style" hint="Lean toward applied exercises (SQL, reviews) or quick knowledge checks.">
                        <Chips options={DOC_PRACTICE} isOn={k => docBrief.practice === k} onPick={k => setDocBrief(p => ({ ...p, practice: k }))} />
                      </Field>
                      <Field label="Tone">
                        <Chips options={DOC_TONES} isOn={k => docBrief.tone === k} onPick={k => setDocBrief(p => ({ ...p, tone: k }))} />
                      </Field>
                      <Field label="Lesson images" hint="Document pages are used for uploaded PDFs; stock photos cover everything else.">
                        <Chips options={DOC_IMAGES} isOn={k => docBrief.imageMode.includes(k)} onPick={k => setDocBrief(p => ({ ...p, imageMode: p.imageMode.includes(k) ? p.imageMode.filter(m => m !== k) : [...p.imageMode, k] }))} />
                      </Field>
                      <Field label="Lesson videos">
                        <Chips options={DOC_VIDEOS} isOn={k => docBrief.includeVideos === k} onPick={k => setDocBrief(p => ({ ...p, includeVideos: k }))} />
                        {docBrief.includeVideos && (
                          <div className="mt-3">
                            <input type="text" value={docBrief.preferredChannels} onChange={e => setDocBrief(p => ({ ...p, preferredChannels: e.target.value }))} placeholder="Channel name, @handle or link, comma separated (optional)" aria-label="Preferred YouTube channels" className={fieldCls} style={inputStyle} />
                            <p className="text-[11px] mt-2" style={{ color: C.faint }}>For example freeCodeCamp, @AlexTheAnalyst or a channel URL. Videos come from these channels when they have a relevant match.</p>
                          </div>
                        )}
                      </Field>
                    </div>
                  )}
                </div>

              </BriefPanel>
            </motion.div>
          )}

          {/* Document course: outline review */}
          {docWizardStep === 'outline' && docOutline && (
            <motion.div key="doc-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-12">
              <OutlineHeader title="Review your document course" description="Rename modules and lessons, change lesson types or regenerate a module, then generate the course."
                onBack={() => setDocWizardStep('input')} onGenerate={handleGenerateDocFullCourse} disabled={!!aiLoadingLabel} />
              <OutlineModules modules={docOutline.modules ?? []} onChange={modules => setDocOutline((prev: any) => ({ ...prev, modules }))} typeOptions={DOC_TYPES}
                newLesson={() => ({ id: newLessonId(), title: 'New lesson', summary: '', questionType: 'multiple_choice' })}
                onRegenerate={handleRegenerateDocModule} regenerating={docModuleLoading} />
            </motion.div>
          )}

          {/* Python course: brief */}
          {pyWizardStep === 'brief' && (
            <motion.div key="py-brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full">
              <BriefPanel title="Create a Python course" description="Describe the course. You review the outline before anything is generated." onBack={() => router.push('/dashboard')}
                onGenerate={handleGeneratePythonOutline} disabled={!!aiLoadingLabel || !pyBrief.title.trim()}>
                <Sect title="Course brief" first>
                <Field label="Course title">
                  <input type="text" value={pyBrief.title} onChange={e => setPyBrief(p => ({ ...p, title: e.target.value }))} placeholder="For example Python for Financial Analysts" className={fieldCls} style={inputStyle} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Industry">
                    <MenuSelect field label="Industry" C={C} value={pyBrief.industry} onChange={v => setPyBrief(p => ({ ...p, industry: v }))} options={INDUSTRIES.map(v => ({ value: v, label: v }))} />
                  </Field>
                  <Field label="Skill level">
                    <MenuSelect field label="Skill level" C={C} value={pyBrief.level} onChange={v => setPyBrief(p => ({ ...p, level: v }))} options={LEVELS.map(v => ({ value: v, label: v }))} />
                  </Field>
                </div>
                <Field label="Focus area">
                  <MenuSelect field label="Focus area" C={C} value={pyBrief.focus} onChange={v => setPyBrief(p => ({ ...p, focus: v }))} options={PY_FOCUS_AREAS.map(v => ({ value: v, label: v }))} />
                </Field>
                <Field label="Target role">
                  <input type="text" value={pyBrief.role} onChange={e => setPyBrief(p => ({ ...p, role: e.target.value }))} placeholder="For example Data Analyst, Business Analyst" className={fieldCls} style={inputStyle} />
                </Field>
                <Field label="Specific focus" optional>
                  <AiTextarea value={pyBrief.promptText} onValueChange={value => setPyBrief(p => ({ ...p, promptText: value }))} placeholder="Any libraries, datasets or skills to focus on" rows={3} className={`${fieldCls} resize-none`} style={inputStyle} />
                </Field>
                </Sect>
              </BriefPanel>
            </motion.div>
          )}

          {/* Python course: outline review */}
          {pyWizardStep === 'outline' && pyOutline && (
            <motion.div key="py-outline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-12">
              <OutlineHeader title="Review your Python course" description="Rename modules and lessons, change lesson types or regenerate a module, then generate the course."
                onBack={() => setPyWizardStep('brief')} onGenerate={handleGeneratePythonFullCourse} disabled={!!aiLoadingLabel} />
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
                <div className="min-w-0">
                  <OutlineModules modules={pyOutline.modules ?? []} onChange={modules => setPyOutline((prev: any) => ({ ...prev, modules }))} typeOptions={PY_TYPES}
                    newLesson={() => ({ id: newLessonId(), title: 'New lesson', skillFocus: '', questionType: 'python_exercise', questionSummary: '' })}
                    onRegenerate={handleRegeneratePyModule} regenerating={pyModuleLoading} />
                </div>
                <div className="flex flex-col gap-3">
                  <SidePanel title="Dataset plan" description={pyOutline.datasetPlan?.description}>
                    <div className="flex flex-col gap-2">
                      {(pyOutline.datasetPlan?.datasets ?? []).map((ds: any, i: number) => (
                        <div key={i} className="rounded-xl p-3" style={{ background: C.page }}>
                          <p className="text-xs font-mono font-semibold" style={{ color: C.text }}>{ds.variableName}</p>
                          <p className="text-xs mt-0.5 mb-2" style={{ color: C.muted }}>{ds.description}</p>
                          <div className="flex flex-wrap gap-1">
                            {(ds.columns ?? []).map((col: string) => (
                              <span key={col} className="text-[11px] px-2 py-0.5 rounded-md font-mono" style={{ background: C.card, color: C.muted }}>{col}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="text-xs" style={{ color: C.muted }}>
                        <span className="font-semibold" style={{ color: C.text }}>After generating: </span>prepare CSV files matching these schemas and upload them to each exercise in the course editor.
                      </p>
                    </div>
                  </SidePanel>
                  {(pyOutline.learningOutcomes ?? []).length > 0 && (
                    <SidePanel title="Outcomes">
                      <ul className="text-xs space-y-2" style={{ color: C.text }}>
                        {(pyOutline.learningOutcomes ?? []).map((o: string, i: number) => (
                          <li key={i} className="flex items-start gap-2"><Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: P.good }} />{o}</li>
                        ))}
                      </ul>
                    </SidePanel>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>
        <GeneratingOverlay visible={!!aiLoadingLabel} label={aiLoadingLabel || undefined} failed={aiFailed} />
      </main>
    );
  }

  // -- A start point was chosen or generated: it is being saved as a draft (see createDraft) --
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: C.page, color: C.text }}>
      {toastView}
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }} />
      <p className="text-sm" style={{ color: C.muted }}>Creating your draft</p>
    </main>
  );
}
