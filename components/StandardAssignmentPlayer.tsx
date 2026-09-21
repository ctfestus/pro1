'use client';

// Plain, OPEN runtime for a Standard (scenario-based) assignment. Renders scenarios and
// their tasks as ordinary cards -- no manager/emails/chat, no gating: the student works
// through the tasks in any order and submits everything at once. AI-review tasks run inline
// and show feedback (informational); MCQ is auto-marked right/wrong into a preliminary score;
// written/upload tasks are collected for the instructor. The instructor sets the final grade.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from '@/components/ThemeProvider';
import { useC } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/sanitize';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { LessonDoc } from '@/lib/lesson-doc';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import {
  CheckCircle, CheckCircle2, Circle, Upload as UploadIcon, Loader2, X, FileText, AlertCircle, Check,
  Calendar, BookOpen, Layers, ListChecks, Download, ExternalLink, PenLine, Code2,
  FileSpreadsheet, LayoutDashboard,
} from 'lucide-react';
import {
  type ScenarioConfig, type AssignmentTask, type RawTaskAnswer, type TaskGradeMap,
  TASK_TYPE_LABEL, isAiTaskType, flattenTasks, parseSubmissionRecord, isAllowedUpload, hasRichText,
} from '@/lib/assignment-scenarios';

type AnswerState = {
  text?: string;
  fileUrl?: string;
  fileName?: string;
  selectedOption?: string;
  report?: any;
  imageUrl?: string;
  score?: number | null;
};

interface Props {
  assignmentId: string;
  config: ScenarioConfig;
  userId: string;
  initialSubmission?: any;
  graded?: boolean;
  submitted?: boolean;
  canSubmit?: boolean;
  disabledReason?: string;
  previewMode?: boolean;
  // Per-task score + comment the instructor left (assignment_submissions.task_grades). Shown
  // beside the student's own answer for the task it belongs to.
  taskGrades?: TaskGradeMap;
  onSubmit?: (answers: RawTaskAnswer[]) => Promise<any>;
  onSaveDraft?: (answers: RawTaskAnswer[]) => Promise<any>;
  // Left-pane display metadata (assignment-level)
  title?: string;
  coverImage?: string;
  deadline?: string;
  courseTitle?: string;
  courseHref?: string;
  resources?: Array<{ id: string; name?: string; url: string; resource_type?: string }>;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function seedAnswers(submission: any): Record<string, AnswerState> {
  const record = parseSubmissionRecord(submission?.response_text);
  if (!record) return {};
  const out: Record<string, AnswerState> = {};
  for (const a of record.answers) {
    out[a.taskId] = {
      text: a.text, fileUrl: a.fileUrl, fileName: a.fileName,
      selectedOption: a.selectedOption, report: a.report, imageUrl: a.imageUrl, score: a.score,
    };
  }
  return out;
}

const RESOURCES_TAB = '__resources__';

export default function StandardAssignmentPlayer({
  assignmentId, config, userId, initialSubmission,
  graded = false, submitted = false, canSubmit = true, disabledReason, previewMode = false, taskGrades,
  onSubmit, onSaveDraft,
  title, coverImage, deadline, courseTitle, courseHref, resources = [],
}: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const reduceMotion = useReducedMotion();
  const C = useC();
  // Keep this assignment experience locally green in light mode without changing the
  // course/dashboard theme. Dark mode deliberately retains the existing theme tokens.
  const scenarioAccent = isDark ? C.green : '#00bf63';
  const scenarioAccentSoft = isDark ? C.lime : 'rgba(0,191,99,0.10)';
  const scenarioAccentText = isDark ? C.cta : '#008f4b';
  const scenarioAction = isDark ? C.cta : scenarioAccent;
  const [activeTab, setActiveTab] = useState<string>(() => config.scenarios[0]?.id ?? RESOURCES_TAB);
  // Dark mode uses borderless cards (separated by background contrast), matching the app theme.
  const cardBorder = isDark ? 'none' : `1px solid ${C.divider}`;
  // Mobile: stack the panes, drop the sticky pane, tighten padding, full-width footer buttons.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Render interactive content (LessonDoc) with the VE renderer, falling back to sanitized HTML.
  const renderRich = (doc: LessonDoc | undefined, html: string | undefined, style?: React.CSSProperties) => {
    if (doc) return <LessonRenderer doc={doc} isDark={isDark} accentColor={scenarioAccent} />;
    if (html && html.replace(/<[^>]*>/g, '').trim()) {
      return <div className="rich-content" style={style} dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
    }
    return null;
  };

  const flat = useMemo(() => flattenTasks(config), [config]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => seedAnswers(initialSubmission));
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const locked = graded; // graded = review + reveal MCQ answers; submitted stays editable until graded
  // Non-leaders (and student-mode viewers) get a fully read-only view: they can see the group
  // leader's saved draft/submission but cannot type, upload, or submit.
  const readOnly = graded || !canSubmit;
  const anyUploading = Object.values(uploading).some(Boolean);

  const patch = (taskId: string, updates: AnswerState) =>
    setAnswers(prev => ({ ...prev, [taskId]: { ...prev[taskId], ...updates } }));

  function isAnswered(task: AssignmentTask): boolean {
    const a = answers[task.id];
    if (!a) return false;
    if (task.type === 'text') return !!a.text && !!a.text.replace(/<[^>]*>/g, '').trim();
    if (task.type === 'upload') return !!a.fileUrl;
    if (task.type === 'mcq') return a.selectedOption != null;
    return !!a.report;
  }
  const answeredCount = flat.filter(({ task }) => isAnswered(task)).length;

  async function handleUpload(task: AssignmentTask, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAllowedUpload(file.name)) { setSubmitError('File type not allowed. Accepted: PDF, images, Word, Excel, PowerPoint, CSV, ZIP, Power BI (.pbix, .pbip).'); return; }
    if (file.size > MAX_FILE_SIZE) { setSubmitError('File exceeds the 10 MB size limit.'); return; }
    setSubmitError('');
    setUploading(prev => ({ ...prev, [task.id]: true }));
    try {
      const key = `${Date.now()}-${file.name}`;
      const path = `submissions/${assignmentId}/${userId}/${task.id}/${key}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      patch(task.id, { fileUrl: publicUrl, fileName: file.name });
    } catch {
      setSubmitError('Upload failed. Please try again.');
    } finally {
      setUploading(prev => ({ ...prev, [task.id]: false }));
    }
  }

  // Raw answers only -- scoring, MCQ correctness, and the stored record are all derived on the
  // server, which never trusts a client-provided score or answer key.
  function buildRawAnswers(): RawTaskAnswer[] {
    return flat.map(({ task }) => {
      const a = answers[task.id] ?? {};
      const base: RawTaskAnswer = { taskId: task.id };
      if (task.type === 'text') return { ...base, text: a.text };
      if (task.type === 'upload') return { ...base, fileUrl: a.fileUrl, fileName: a.fileName };
      if (task.type === 'mcq') return { ...base, selectedOption: a.selectedOption };
      return { ...base, report: a.report, imageUrl: a.imageUrl };
    });
  }

  async function handleSubmit() {
    if (!onSubmit || previewMode) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      const sub = await onSubmit(buildRawAnswers());
      if (sub !== undefined) setJustSubmitted(true);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Save progress without submitting; the student can close the tab and resume later (the
  // draft is reloaded and re-seeds every answer, including uploaded files and AI reports).
  async function handleSaveDraft() {
    if (!onSaveDraft || previewMode) return;
    setSubmitError('');
    setSavingDraft(true);
    try {
      await onSaveDraft(buildRawAnswers());
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2500);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to save draft. Please try again.');
    } finally {
      setSavingDraft(false);
    }
  }

  // -- per-task renderers ---

  function renderMcq(task: AssignmentTask) {
    const a = answers[task.id] ?? {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Correct answers are graded server-side and never sent to students, so the option
            list only reflects the student's own selection (no correct/wrong reveal here). */}
        {(task.options ?? []).filter(Boolean).map((opt, i) => {
          const selected = a.selectedOption === opt;
          const ring = selected ? scenarioAccent : (isDark ? 'transparent' : C.divider);
          return (
            <button key={i} type="button" disabled={readOnly}
              onClick={() => patch(task.id, { selectedOption: opt })}
              style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${ring}`, background: selected ? scenarioAccentSoft : C.input, color: C.text, fontSize: 14, cursor: readOnly ? 'default' : 'pointer' }}>
              {selected ? <CheckCircle2 style={{ width: 18, height: 18, color: ring, flexShrink: 0 }} /> : <Circle style={{ width: 18, height: 18, color: C.faint, flexShrink: 0 }} />}
              <span style={{ flex: 1 }}>{opt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderUpload(task: AssignmentTask) {
    const a = answers[task.id] ?? {};
    const busy = uploading[task.id];
    return (
      <div>
        {a.fileUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 12, background: scenarioAccentSoft, border: `1px solid ${isDark ? C.divider : 'rgba(0,191,99,.22)'}` }}>
            <span style={{ width: 32, height: 32, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 9, background: C.card, color: scenarioAccent }}><FileText style={{ width: 16, height: 16 }} /></span>
            <a href={a.fileUrl} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.text, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName || 'Uploaded file'}</a>
            {!readOnly && (
              <button type="button" onClick={() => patch(task.id, { fileUrl: undefined, fileName: undefined })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}><X style={{ width: 15, height: 15 }} /></button>
            )}
          </div>
        ) : readOnly ? (
          <p style={{ fontSize: 13, color: C.faint }}>No file uploaded.</p>
        ) : (
          <>
            <input ref={el => { fileRefs.current[task.id] = el; }} type="file" style={{ display: 'none' }} onChange={e => handleUpload(task, e)} />
            <button type="button" onClick={() => fileRefs.current[task.id]?.click()} disabled={busy}
              style={{ width: '100%', minHeight: 62, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 12, border: `1px dashed ${isDark ? C.divider : 'rgba(0,191,99,.35)'}`, background: C.input, color: scenarioAccentText, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? <Loader2 style={{ width: 17, height: 17 }} className="animate-spin" /> : <UploadIcon style={{ width: 17, height: 17 }} />}
              {busy ? 'Uploading...' : 'Choose a file to submit'}
            </button>
          </>
        )}
      </div>
    );
  }

  function renderText(task: AssignmentTask) {
    const a = answers[task.id] ?? {};
    if (readOnly) {
      return a.text
        ? <div className="rich-content" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(a.text) }} />
        : <p style={{ fontSize: 13, color: C.faint }}>No response.</p>;
    }
    // Distinct bordered field + input background so the response area reads as an editable
    // input in both light and dark mode (the editor has no border of its own in dark).
    return (
      <div style={{ border: cardBorder, borderRadius: 10, overflow: 'hidden' }}>
        <RichTextEditor value={a.text ?? ''} onChange={html => patch(task.id, { text: html })} placeholder="Write your response here..." bgOverride={C.input} />
      </div>
    );
  }

  function renderAi(task: AssignmentTask) {
    const a = answers[task.id] ?? {};
    const reqId = `${assignmentId}::${task.id}`;
    // Re-runnable while the assignment is still editable (draft OR submitted-not-graded),
    // consistent with the text/upload tasks; read-only once graded or for a non-leader viewer.
    const completed = readOnly;
    const common = { reqId, isDark, accentColor: scenarioAccent, completed, rubric: task.rubric, minScore: task.minScore } as const;
    if (task.type === 'code_review') {
      return <CodeReviewPlayer {...common} savedResult={a.report} schema={task.schema}
        onComplete={(result: any) => patch(task.id, { report: result, score: typeof result?.overallScore === 'number' ? result.overallScore : null })} />;
    }
    if (task.type === 'excel_review') {
      return <ExcelReviewPlayer {...common} savedResult={a.report} context={task.context} reviewSheetNames={task.reviewSheetNames}
        reviewTarget={{ source: 'assignment', contentId: assignmentId, itemId: task.id }}
        onComplete={(result: any) => patch(task.id, { report: result, score: typeof result?.overallScore === 'number' ? result.overallScore : null })} />;
    }
    if (task.type === 'document_review') {
      return <DocumentReviewPlayer {...common} savedResult={a.report} context={task.context} documentReviewMode={task.documentReviewMode ?? 'ai_only'}
        onComplete={(result: any) => patch(task.id, { report: result, score: typeof result?.overallScore === 'number' ? result.overallScore : null })} />;
    }
    // dashboard_critique
    return <DashboardCritiquePlayer {...common} savedResult={a.report} savedImageUrl={a.imageUrl}
      onComplete={(result: any, imageDataUrl: string) => patch(task.id, { report: result, imageUrl: imageDataUrl, score: typeof result?.audit?.overallScore === 'number' ? result.audit.overallScore : null })} />;
  }

  function renderTaskBody(task: AssignmentTask) {
    if (task.type === 'mcq') return renderMcq(task);
    if (task.type === 'upload') return renderUpload(task);
    if (task.type === 'text') return renderText(task);
    if (isAiTaskType(task.type)) return renderAi(task);
    return null;
  }

  // The instructor's mark for this task, once the submission has been graded. The comment is
  // rich text (sanitized on save, and again here before it is rendered).
  function renderTaskGrade(task: AssignmentTask) {
    const g = taskGrades?.[task.id];
    const hasComment = hasRichText(g?.feedback);
    if (!g || (g.score == null && !hasComment)) return null;
    return (
      <div style={{ marginTop: 14, borderRadius: 12, padding: '12px 14px', background: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hasComment ? 6 : 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#10b981' }}>Instructor feedback</span>
          {g.score != null && (
            <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: C.text }}>{g.score}/100</span>
          )}
        </div>
        {hasComment && (
          <div className="rich-content" style={{ fontSize: 13.5, lineHeight: 1.6, color: C.text }}
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(g.feedback as string) }}/>
        )}
      </div>
    );
  }

  const totalTasks = flat.length;
  const scenarioCount = config.scenarios.length;
  const activeScenario = config.scenarios.find(s => s.id === activeTab);
  const scoreVal = initialSubmission?.score;
  // Guard against reverting a finalized group row to draft (e.g. a leader who unchecked
  // themselves in Mark Participants sees submitted!==true but the row is already submitted).
  const alreadyFinal = initialSubmission?.status === 'submitted' || initialSubmission?.status === 'graded';
  const status = graded
    ? { label: scoreVal != null ? `Graded - ${scoreVal}%` : 'Graded', bg: 'rgba(16,185,129,0.12)', color: '#10b981' }
    : submitted
    ? { label: 'Submitted', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' }
    : initialSubmission?.status === 'draft'
    ? { label: 'In progress', bg: C.pill, color: C.muted }
    : { label: 'Not submitted', bg: C.pill, color: C.faint };
  // A scenario is "done" once every one of its tasks is answered (checks the timeline node).
  const scenarioDone = (s: ScenarioConfig['scenarios'][number]) => s.tasks.every(t => isAnswered(t));
  const timelineSteps = [
    ...(resources.length > 0 ? [{ key: RESOURCES_TAB, label: 'Resources', title: 'Resources', done: false, isResources: true, num: 0 }] : []),
    ...config.scenarios.map((s, i) => ({ key: s.id, label: `Scenario ${i + 1}`, title: s.title?.trim() || `Scenario ${i + 1}`, done: scenarioDone(s), isResources: false, num: i + 1 })),
  ];
  // Bottom nav: Save-and-continue + Next through the steps; Submit shows only on the final step
  // (the last scenario), so students can't submit before reaching the end.
  const unansweredCount = flat.length - answeredCount;
  const currentStepIndex = timelineSteps.findIndex(s => s.key === activeTab);
  const isLastStep = timelineSteps.length > 0 && currentStepIndex === timelineSteps.length - 1;
  const goNext = () => {
    const next = timelineSteps[currentStepIndex + 1];
    if (next) { setActiveTab(next.key); setConfirmIncomplete(false); }
  };
  const detailRow = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ color: C.faint, flexShrink: 0, display: 'flex', marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 11, color: C.faint, margin: '0 0 1px' }}>{label}</p>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  );
  const taskTypeIcon = (type: AssignmentTask['type']) => {
    if (type === 'text') return <PenLine style={{ width: 18, height: 18 }} />;
    if (type === 'upload') return <UploadIcon style={{ width: 18, height: 18 }} />;
    if (type === 'mcq') return <ListChecks style={{ width: 18, height: 18 }} />;
    if (type === 'code_review') return <Code2 style={{ width: 18, height: 18 }} />;
    if (type === 'excel_review') return <FileSpreadsheet style={{ width: 18, height: 18 }} />;
    if (type === 'dashboard_critique') return <LayoutDashboard style={{ width: 18, height: 18 }} />;
    return <FileText style={{ width: 18, height: 18 }} />;
  };
  const renderScenarioBody = (scenario: ScenarioConfig['scenarios'][number]) => (
    <>
      {(scenario.doc || scenario.description) && (
        <div style={{ marginBottom: 16 }}>{renderRich(scenario.doc, scenario.description, { color: C.muted })}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {scenario.tasks.map((task, tIdx) => {
          const done = isAnswered(task);
          return (
            // The header establishes task type and status without indenting the instructions or
            // response control, so every task keeps the full available content width.
            <div key={task.id} style={{ paddingTop: tIdx > 0 ? 14 : 0, paddingBottom: tIdx < scenario.tasks.length - 1 ? 14 : 0, borderBottom: tIdx < scenario.tasks.length - 1 ? `1px solid ${C.divider}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
                <span style={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 12, background: done ? scenarioAccentSoft : C.pill, color: done ? scenarioAccent : C.muted }}>
                  {taskTypeIcon(task.type)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', marginBottom: 3, fontSize: 10.5, fontWeight: 800, letterSpacing: '.075em', textTransform: 'uppercase', color: done ? scenarioAccentText : C.faint }}>{TASK_TYPE_LABEL[task.type]}</span>
                  <span style={{ display: 'block', fontSize: 15.5, lineHeight: 1.35, fontWeight: 750, color: C.text }}>{task.title || `Task ${tIdx + 1}`}</span>
                </span>
                <span aria-label={done ? 'Task completed' : 'Task not completed'} style={{ flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  {done
                    ? <motion.span initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }}><CheckCircle2 style={{ width: 20, height: 20, color: scenarioAccent }} /></motion.span>
                    : <Circle style={{ width: 20, height: 20, color: C.faint }} />}
                </span>
              </div>
              {(task.doc || task.description) && (
                <div style={{ marginBottom: 12, fontSize: 14, color: C.muted }}>{renderRich(task.doc, task.description)}</div>
              )}
              {renderTaskBody(task)}
              {renderTaskGrade(task)}
            </div>
          );
        })}
        {scenario.tasks.length === 0 && <p style={{ fontSize: 13, color: C.faint }}>No tasks in this scenario yet.</p>}
      </div>
    </>
  );

  return (
    // Google Sans throughout, matching the VE look. Two-column: left info pane + right tabbed
    // content (one scenario per tab + a Resources tab). The scoped style overrides
    // .rich-content, which otherwise pins Inter via --font-sans.
    <div className="sa-scenario-font" style={{ fontFamily: "'Google Sans Text', 'Inter', sans-serif" }}>
      <style>{`
        .sa-scenario-font .rich-content, .sa-scenario-font .lesson-content { font-family: 'Google Sans Text', 'Inter', sans-serif; overflow-wrap: break-word; }
        .sa-scenario-font .rich-content img, .sa-scenario-font .lesson-content img { max-width: 100%; height: auto; border-radius: 10px; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 20, alignItems: isMobile ? 'stretch' : 'flex-start', flexWrap: isMobile ? 'nowrap' : 'wrap', maxWidth: '100%' }}>

        {/* LEFT PANE -- one card: cover + status + detail. Sticky on desktop so it stays in view
            while the right pane scrolls; static + full-width when stacked on mobile. */}
        <aside style={{ flex: '1 1 240px', width: isMobile ? '100%' : undefined, maxWidth: isMobile ? '100%' : 320, minWidth: isMobile ? 0 : 220, position: isMobile ? 'static' : 'sticky', top: isMobile ? undefined : 16, alignSelf: 'flex-start' }}>
          <div style={{ borderRadius: 16, background: C.card, border: cardBorder }}>
            <div style={{ padding: isMobile ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {coverImage && (
                <img src={resolveCoverUrl(coverImage)} alt={title || 'Assignment'} style={{ width: '100%', display: 'block', objectFit: 'cover', borderRadius: 12, maxHeight: 200 }} onError={e => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              )}
              <span style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: status.bg, color: status.color }}>{status.label}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, margin: 0 }}>Detail</p>
                {deadline && detailRow(<Calendar style={{ width: 15, height: 15 }} />, 'Deadline', new Date(deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}
                {courseTitle && detailRow(<BookOpen style={{ width: 15, height: 15 }} />, 'Related course', courseHref ? <a href={courseHref} style={{ color: scenarioAccent, textDecoration: 'none' }}>{courseTitle}</a> : courseTitle)}
                {detailRow(<Layers style={{ width: 15, height: 15 }} />, 'Scenarios', scenarioCount)}
                {detailRow(<ListChecks style={{ width: 15, height: 15 }} />, 'Tasks', totalTasks)}
                {!readOnly && detailRow(<CheckCircle style={{ width: 15, height: 15 }} />, 'Answered', `${answeredCount} / ${totalTasks}`)}
              </div>
            </div>
          </div>
        </aside>

        {/* RIGHT PANE -- one card: title + overview + progress + tabs + active content, then submit */}
        <main style={{ flex: '3 1 420px', minWidth: 0, width: isMobile ? '100%' : undefined, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ borderRadius: 16, background: C.card, border: cardBorder, padding: isMobile ? 16 : 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {title && <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h2>}
          {(config.introDoc || config.introBody) && (
            <div>{renderRich(config.introDoc, config.introBody, { color: C.muted })}</div>
          )}

          {/* Studio-style scenario navigation: compact tabs above a connected workspace,
              mirroring the course editor while preserving progress and completion states. */}
          {timelineSteps.length > 0 && (
            <div role="tablist" aria-label="Assignment scenarios" style={{ width: '100%', overflowX: 'auto', scrollbarWidth: 'thin', paddingBottom: 14, borderBottom: `1px solid ${C.divider}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 'max-content' }}>
                {timelineSteps.map(step => {
                  const active = activeTab === step.key;
                  return (
                    <motion.button key={step.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(step.key)} title={step.title}
                      whileTap={reduceMotion ? undefined : { scale: .97 }}
                      animate={{ backgroundColor: active ? scenarioAccentSoft : 'rgba(0,0,0,0)', color: active ? scenarioAccentText : C.faint }}
                      transition={{ duration: reduceMotion ? 0 : .2 }}
                      style={{ position: 'relative', flexShrink: 0, minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: active ? 750 : 650 }}>
                      {step.isResources ? (
                        <Download style={{ width: 15, height: 15 }} />
                      ) : step.done ? (
                        <motion.span initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }}>
                          <CheckCircle2 style={{ width: 16, height: 16, color: scenarioAccent }} />
                        </motion.span>
                      ) : (
                        <span style={{ position: 'relative', width: 16, height: 16, display: 'grid', placeItems: 'center' }}>
                          {active && <motion.span aria-hidden="true" animate={reduceMotion ? undefined : { scale: [1, 1.45, 1], opacity: [.24, .06, .24] }} transition={{ duration: 1.8, repeat: Infinity }} style={{ position: 'absolute', inset: 2, borderRadius: '50%', background: scenarioAccent }} />}
                          <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: active ? scenarioAccent : C.faint }} />
                        </span>
                      )}
                      <span>{step.label}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === RESOURCES_TAB ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>Resources</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: C.faint }}>Assignment resources</p>
              </div>
              {resources.map(r => (
                <a key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'transparent', border: cardBorder, textDecoration: 'none' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.pill, flexShrink: 0 }}>
                    {r.resource_type === 'file' ? <FileText style={{ width: 16, height: 16, color: scenarioAccent }} /> : <ExternalLink style={{ width: 16, height: 16, color: scenarioAccent }} />}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.text }}>{r.name || r.url}</span>
                  <Download style={{ width: 15, height: 15, color: C.faint }} />
                </a>
              ))}
            </div>
          ) : activeScenario ? (
            <div>
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>{activeScenario.title || 'Scenario'}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: C.faint }}>Scenario {Math.max(1, config.scenarios.findIndex(s => s.id === activeScenario.id) + 1)} of {scenarioCount}</p>
              </div>
              {renderScenarioBody(activeScenario)}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: C.faint }}>No scenarios yet.</p>
          )}
          </div>

          {/* Submit */}
          {!locked && (
            <div style={{ marginTop: 6 }}>
              {submitError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#ef4444' }}>
                  <AlertCircle style={{ width: 15, height: 15 }} /> {submitError}
                </div>
              )}
              {previewMode ? (
                <p style={{ fontSize: 13, color: C.faint }}>Preview - submissions are disabled.</p>
              ) : !canSubmit ? (
                <p style={{ fontSize: 13, textAlign: 'center', padding: '10px 14px', borderRadius: 10, background: C.pill, color: C.muted }}>
                  {disabledReason || 'Your group leader will submit this for the group.'}
                </p>
              ) : (
                <>
                  {submitted && !justSubmitted && (
                    <p style={{ fontSize: 12, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: scenarioAccentSoft, color: scenarioAccentText }}>Submitted - you can still edit and resubmit until it is graded.</p>
                  )}
                  {justSubmitted ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)' }}>
                      <Check style={{ width: 18, height: 18, color: '#10b981' }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#10b981' }}>Submitted for review.</span>
                    </div>
                  ) : (
                    <>
                      {isLastStep && confirmIncomplete && unansweredCount > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}>
                          <AlertCircle style={{ width: 16, height: 16, color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 13, color: C.text }}>{unansweredCount} of {flat.length} {unansweredCount === 1 ? 'task is' : 'tasks are'} not answered. Go back and complete {unansweredCount === 1 ? 'it' : 'them'}, or submit anyway.</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row', justifyContent: isMobile ? 'stretch' : 'flex-end', alignItems: isMobile ? 'stretch' : 'center' }}>
                        {onSaveDraft && !submitted && !alreadyFinal && (
                          <button type="button" onClick={handleSaveDraft} disabled={savingDraft || submitting || anyUploading}
                            style={{ padding: '12px 18px', borderRadius: 12, border: cardBorder, background: C.pill, color: C.muted, fontSize: 14, fontWeight: 700, cursor: (savingDraft || submitting || anyUploading) ? 'not-allowed' : 'pointer', opacity: (savingDraft || submitting || anyUploading) ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            {savingDraft ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : null}
                            {savingDraft ? 'Saving...' : draftSaved ? 'Saved' : 'Save and continue'}
                          </button>
                        )}
                        {!isLastStep ? (
                          <button type="button" onClick={goNext}
                            style={{ padding: '12px 26px', borderRadius: 12, border: 'none', background: scenarioAction, color: C.ctaText, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            Next
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => { if (unansweredCount > 0 && !confirmIncomplete) { setConfirmIncomplete(true); return; } handleSubmit(); }}
                            disabled={submitting || anyUploading}
                            style={{ padding: '12px 26px', borderRadius: 12, border: 'none', background: scenarioAction, color: C.ctaText, fontSize: 15, fontWeight: 700, cursor: (submitting || anyUploading) ? 'not-allowed' : 'pointer', opacity: (submitting || anyUploading) ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            {submitting ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : null}
                            {submitting ? 'Submitting...' : (confirmIncomplete && unansweredCount > 0) ? 'Submit anyway' : submitted ? 'Resubmit for review' : 'Submit for review'}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
