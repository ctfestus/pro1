'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { motion } from 'motion/react';
import {
  Sparkles, Loader2, Check, Plus, Trash2, X, ChevronDown, ChevronUp,
  Upload, Link2, FileText, Database, ArrowLeft, Code2, RefreshCw,
} from 'lucide-react';
import type { FormConfig } from '@/lib/course-schema';
import { useC } from '@/components/create/theme';
import { TEMPLATES } from '@/components/create/shared';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { AiTextarea } from '@/components/AiTextarea';
import { lessonHtmlToDoc } from '@/components/lesson/extensions';
import { supabase } from '@/lib/supabase';
import { formatSQLPreflightIssue, preflightSQLExercises } from '@/lib/sql-exercise-preflight';
import { formatPythonPreflightIssue, preflightPythonExercises } from '@/lib/python-exercise-preflight';
import { useRouter } from 'next/navigation';

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

// --- Types: the content contract is canonical in lib/course-schema (imported above) ---

// --- Main Page ---
export default function Page() {
  const C = useC();
  const { theme } = useTheme();
  const { accentColor: brandAccent } = useTenant();
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
    <div role="status" className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-xl w-[calc(100%-2rem)] max-h-[45vh] overflow-auto rounded-2xl px-4 py-3.5 flex items-start gap-3 shadow-xl"
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

  // -- Field management --

  // -- Course management --

  // -- Shared view --
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
        {toastView}
        <div className={`relative z-10 flex-1 flex flex-col items-center ${(sqlWizardStep || docWizardStep || pyWizardStep) ? 'justify-start pt-8 sm:pt-12 pb-24' : 'justify-center py-16 sm:py-20'} px-4 sm:px-6 ${(sqlWizardStep === 'outline' || docWizardStep === 'outline' || pyWizardStep === 'outline') ? 'max-w-6xl' : 'max-w-4xl'} mx-auto w-full`}>

          {/* SQL Course Wizard -- Brief step */}
          {sqlWizardStep === 'brief' && (
            <motion.div key="sql-brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-5">
                <button type="button" onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Back to dashboard
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
                <button type="button" onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Back to dashboard
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
                <button type="button" onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-60" style={{ color: C.muted }}>
                  <ArrowLeft className="w-4 h-4" /> Back to dashboard
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
        </div>
        <GeneratingOverlay visible={!!aiLoadingLabel} label={aiLoadingLabel || undefined} failed={aiFailed} />
      </main>
    );
  }

  // -- A start point was chosen or generated: it is being saved as a draft (see createDraft) --
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: C.page, color: C.text }}>
      {toastView}
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} />
      <p className="text-sm" style={{ color: C.muted }}>Creating your draft</p>
    </main>
  );
}
