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
import { reviewGate } from '@/lib/review-gate';
import { sanitizeRichText } from '@/lib/sanitize';
import { hasRichContent } from '@/lib/plain-text';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { LessonDoc } from '@/lib/lesson-doc';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import { ArrowSquareOut, BookOpen, CalendarDots, Check, CheckCircle, CircleNotch, Code, DownloadSimple, FileText, FileXls, ListChecks, Medal, PencilSimpleLine, SquaresFour, Stack, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';
import { DISPLAY_FONT } from '@/components/dashboard/subscriptions/ui';
import { DetailsLine, DetailsPanel, IconTile, assignmentStatus, formatDueShort, type DetailRow } from '@/components/student/assignment-details';
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
  /** The assignment's pass mark, shown in the details panel. */
  passMark?: number;
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
  title, coverImage, deadline, courseTitle, courseHref, resources = [], passMark,
}: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const reduceMotion = useReducedMotion();
  const C = useC();
  // One brand colour for actions and selection on every assignment type; green is kept for
  // meaning (a task or scenario that is done).
  const scenarioAccent = C.cta;
  const scenarioAccentSoft = `${C.cta}17`;
  const scenarioAccentText = C.cta;
  const doneGreen = '#16a34a';
  const [activeTab, setActiveTab] = useState<string>(() => config.scenarios[0]?.id ?? RESOURCES_TAB);
  // Below 900px: the details panel becomes one line above the brief, padding tightens, and the
  // footer buttons go full width.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Render interactive content (LessonDoc) with the VE renderer, falling back to sanitized HTML.
  const renderRich = (doc: LessonDoc | undefined, html: string | undefined, style?: React.CSSProperties) => {
    if (doc) return <LessonRenderer doc={doc} isDark={isDark} accentColor={scenarioAccent} />;
    if (html && hasRichContent(html)) {
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
    if (task.type === 'text') return hasRichContent(a.text);
    if (task.type === 'upload') return !!a.fileUrl;
    if (task.type === 'mcq') return a.selectedOption != null;
    return !!a.report;
  }
  const answeredCount = flat.filter(({ task }) => isAnswered(task)).length;

  async function handleUpload(task: AssignmentTask, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadFile(task, file);
  }

  // Shared by the file picker and dropping a file on the drop zone.
  async function uploadFile(task: AssignmentTask, file: File) {
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
          return (
            <button key={i} type="button" disabled={readOnly} role="radio" aria-checked={selected}
              onClick={() => patch(task.id, { selectedOption: opt })}
              style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px', borderRadius: 10, border: `1px solid ${selected ? scenarioAccent : C.divider}`, background: selected ? scenarioAccentSoft : C.card, color: C.text, fontSize: 14, cursor: readOnly ? 'default' : 'pointer' }}>
              <span aria-hidden style={{ width: 16, height: 16, flexShrink: 0, borderRadius: '50%', boxSizing: 'border-box', border: selected ? `5px solid ${scenarioAccent}` : `2px solid ${C.faint}` }} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10, background: C.card, border: `1px solid ${C.divider}` }}>
            <IconTile C={C} icon={<FileText weight="duotone" />} />
            <a href={a.fileUrl} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.text, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName || 'Uploaded file'}</a>
            {!readOnly && (
              <button type="button" onClick={() => patch(task.id, { fileUrl: undefined, fileName: undefined })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}><X weight="bold" style={{ width: 15, height: 15 }} /></button>
            )}
          </div>
        ) : readOnly ? (
          <p style={{ fontSize: 13, color: C.faint }}>No file uploaded.</p>
        ) : (
          <>
            <input ref={el => { fileRefs.current[task.id] = el; }} type="file" style={{ display: 'none' }} onChange={e => handleUpload(task, e)} />
            <button type="button" onClick={() => fileRefs.current[task.id]?.click()} disabled={busy}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file && !busy) void uploadFile(task, file); }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 16, borderRadius: 10, border: `1.5px dashed ${C.cta}59`, background: isDark ? C.card : `${C.cta}08`, color: C.muted, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? <CircleNotch weight="bold" style={{ width: 20, height: 20 }} className="animate-spin" /> : <UploadSimple weight="bold" style={{ width: 20, height: 20 }} />}
              <b style={{ color: C.text }}>{busy ? 'Uploading...' : 'Choose a file'}</b>
              {!busy && <span style={{ fontSize: 12.5, color: C.faint }}>or drop it here</span>}
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
      <div style={{ border: `1px solid ${C.divider}`, borderRadius: 10, overflow: 'hidden' }}>
        <RichTextEditor value={a.text ?? ''} onChange={html => patch(task.id, { text: html })} placeholder="Write your response here" bgOverride={C.card} images="upload" imageFolder="submission-images" />
      </div>
    );
  }

  function renderAi(task: AssignmentTask) {
    const a = answers[task.id] ?? {};
    const reqId = `${assignmentId}::${task.id}`;
    // Re-runnable while the assignment is still editable (draft OR submitted-not-graded),
    // consistent with the text/upload tasks; read-only once graded or for a non-leader viewer.
    const completed = readOnly;
    // The server grades each AI task on its saved settings, found through this target.
    const reviewTarget = { source: 'assignment', contentId: assignmentId, itemId: task.id } as const;
    const common = { reqId, isDark, accentColor: scenarioAccent, completed, rubric: task.rubric, minScore: task.minScore, reviewTarget } as const;
    if (task.type === 'code_review') {
      return <CodeReviewPlayer {...common} savedResult={a.report} schema={task.schema}
        onComplete={(result: any) => patch(task.id, { report: result, score: reviewGate(result, task.rubric?.length).score })} />;
    }
    if (task.type === 'excel_review') {
      return <ExcelReviewPlayer {...common} savedResult={a.report} context={task.context} reviewSheetNames={task.reviewSheetNames}
        onComplete={(result: any) => patch(task.id, { report: result, score: reviewGate(result, task.rubric?.length).score })} />;
    }
    if (task.type === 'document_review') {
      return <DocumentReviewPlayer {...common} savedResult={a.report} context={task.context} documentReviewMode={task.documentReviewMode ?? 'ai_only'}
        onComplete={(result: any) => patch(task.id, { report: result, score: reviewGate(result, task.rubric?.length).score })} />;
    }
    // dashboard_critique
    return <DashboardCritiquePlayer {...common} savedResult={a.report} savedImageUrl={a.imageUrl}
      onComplete={(result: any, imageDataUrl: string) => patch(task.id, { report: result, imageUrl: imageDataUrl, score: reviewGate(result.audit ?? { overallScore: 0 }, task.rubric?.length).score })} />;
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
  const status = assignmentStatus(graded ? 'graded' : submitted ? 'submitted' : initialSubmission?.status, scoreVal);
  // A scenario is "done" once every one of its tasks is answered (ticks its step).
  const scenarioDone = (s: ScenarioConfig['scenarios'][number]) => s.tasks.length > 0 && s.tasks.every(t => isAnswered(t));
  const timelineSteps = [
    ...(resources.length > 0 ? [{ key: RESOURCES_TAB, title: 'Resources', done: false, isResources: true, num: 0 }] : []),
    ...config.scenarios.map((s, i) => ({ key: s.id, title: s.title?.trim() || `Scenario ${i + 1}`, done: scenarioDone(s), isResources: false, num: i + 1 })),
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
  const detailRows: DetailRow[] = [
    ...(deadline ? [{ icon: <CalendarDots weight="duotone" />, label: 'Deadline', value: formatDueShort(deadline) }] : []),
    ...(passMark != null ? [{ icon: <Medal weight="duotone" />, label: 'Pass mark', value: `${passMark}%` }] : []),
    ...(courseTitle ? [{ icon: <BookOpen weight="duotone" />, label: 'Related course', value: courseHref ? <a href={courseHref} style={{ color: C.text, textDecoration: 'underline', textUnderlineOffset: 2 }}>{courseTitle}</a> : courseTitle }] : []),
    { icon: <Stack weight="duotone" />, label: 'Scenarios', value: scenarioCount },
    { icon: <ListChecks weight="duotone" />, label: 'Tasks', value: totalTasks },
    ...(!readOnly ? [{ icon: <CheckCircle weight="duotone" />, label: 'Answered', value: `${answeredCount} of ${totalTasks}` }] : []),
  ];
  const taskTypeIcon = (type: AssignmentTask['type']) => {
    if (type === 'text') return <PencilSimpleLine weight="duotone" />;
    if (type === 'upload') return <UploadSimple weight="bold" />;
    if (type === 'mcq') return <ListChecks weight="duotone" />;
    if (type === 'code_review') return <Code weight="bold" />;
    if (type === 'excel_review') return <FileXls weight="duotone" />;
    if (type === 'dashboard_critique') return <SquaresFour weight="duotone" />;
    return <FileText weight="duotone" />;
  };
  // Buttons: the brand colour for the main action, a white outlined one beside it, and grey with
  // readable text while disabled.
  const btnBase: React.CSSProperties = { padding: '11px 20px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
  const primaryBtn = (disabled: boolean): React.CSSProperties => ({ ...btnBase, background: disabled ? C.pill : C.cta, color: disabled ? C.muted : C.ctaText, cursor: disabled ? 'not-allowed' : 'pointer' });
  const ghostBtn = (disabled: boolean): React.CSSProperties => ({ ...btnBase, background: C.card, color: disabled ? C.faint : C.text, boxShadow: `inset 0 0 0 1px ${C.divider}`, cursor: disabled ? 'not-allowed' : 'pointer' });
  const renderScenarioBody = (scenario: ScenarioConfig['scenarios'][number]) => (
    <>
      {(scenario.doc || scenario.description) && (
        <div style={{ marginBottom: 4 }}>{renderRich(scenario.doc, scenario.description, { color: C.muted })}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {scenario.tasks.map((task, tIdx) => {
          const done = isAnswered(task);
          return (
            // Each task in its own outlined card: a tile, its type and title, and a tick once answered.
            <div key={task.id} style={{ border: `1px solid ${C.divider}`, borderRadius: 12, padding: isMobile ? 14 : 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 22px', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <IconTile C={C} icon={taskTypeIcon(task.type)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.faint }}>{TASK_TYPE_LABEL[task.type]}</span>
                  <span style={{ display: 'block', fontSize: 14.5, lineHeight: 1.35, fontWeight: 700, color: C.text }}>{task.title || `Task ${tIdx + 1}`}</span>
                </span>
                <span aria-label={done ? 'Task completed' : 'Task not completed'} style={{ display: 'grid', placeItems: 'center' }}>
                  {done
                    ? <motion.span initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }} style={{ display: 'grid' }}><CheckCircle weight="fill" style={{ width: 22, height: 22, color: doneGreen }} /></motion.span>
                    : <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${C.faint}66`, boxSizing: 'border-box' }} />}
                </span>
              </div>
              {(task.doc || task.description) && (
                <div style={{ margin: '-4px 0 10px', fontSize: 14, color: C.muted }}>{renderRich(task.doc, task.description)}</div>
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
    // Two columns: the details panel and the brief with its scenario steps. Below 900px the panel
    // folds into one line above the brief. The scoped style overrides .rich-content, which
    // otherwise pins Inter via --font-sans.
    <div className="sa-scenario-font" style={{ fontFamily: "'Google Sans Text', 'Inter', sans-serif" }}>
      <style>{`
        .sa-scenario-font .rich-content, .sa-scenario-font .lesson-content { font-family: 'Google Sans Text', 'Inter', sans-serif; overflow-wrap: break-word; }
        .sa-scenario-font .rich-content img, .sa-scenario-font .lesson-content img { max-width: 100%; height: auto; border-radius: 10px; }
      `}</style>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : '260px minmax(0,1fr)', gap: 18 }}>

        {!isMobile && (
          <DetailsPanel C={C} status={status} rows={detailRows}
            cover={coverImage ? (
              <img src={resolveCoverUrl(coverImage)} alt={title || 'Assignment'} style={{ width: '100%', display: 'block', objectFit: 'cover', borderRadius: 10, maxHeight: 160, marginBottom: 12 }} onError={e => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            ) : undefined} />
        )}

        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isMobile && <DetailsLine C={C} status={status} due={deadline} passMark={passMark} />}
          <div style={{ borderRadius: 12, background: C.card, padding: isMobile ? 16 : '22px 24px' }}>
          {title && <h1 style={{ fontSize: isMobile ? 21 : 24, fontWeight: 700, lineHeight: 1.25, color: C.text, margin: '0 0 10px', fontFamily: DISPLAY_FONT }}>{title}</h1>}
          {(config.introDoc || config.introBody) && (
            <div style={{ marginBottom: 14 }}>{renderRich(config.introDoc, config.introBody, { color: C.muted })}</div>
          )}

          {/* Named steps: a number (a tick once done) and the scenario's own title. */}
          {timelineSteps.length > 0 && (
            <div role="tablist" aria-label="Assignment scenarios" style={{ width: '100%', overflowX: 'auto', scrollbarWidth: 'thin', paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${C.divider}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 'max-content' }}>
                {timelineSteps.map(step => {
                  const active = activeTab === step.key;
                  return (
                    <motion.button key={step.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(step.key)} title={step.title}
                      whileTap={reduceMotion ? undefined : { scale: .97 }}
                      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 8px', border: 'none', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                        background: active ? scenarioAccentSoft : 'transparent', color: active ? scenarioAccentText : C.muted, boxShadow: active ? 'none' : `inset 0 0 0 1px ${C.divider}` }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                        background: step.done ? doneGreen : active ? scenarioAccent : C.pill, color: step.done || active ? '#ffffff' : C.muted }}>
                        {step.isResources ? <DownloadSimple weight="bold" style={{ width: 12, height: 12 }} /> : step.done ? <Check weight="bold" style={{ width: 12, height: 12 }} /> : step.num}
                      </span>
                      <span>{step.title}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === RESOURCES_TAB ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, color: C.text, margin: '0 0 6px', fontFamily: DISPLAY_FONT }}>Resources</h2>
              {resources.map(r => (
                <a key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: C.card, border: `1px solid ${C.divider}`, textDecoration: 'none' }}>
                  <IconTile C={C} icon={r.resource_type === 'file' ? <FileText weight="duotone" /> : <ArrowSquareOut weight="bold" />} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.text }}>{r.name || r.url}</span>
                  <DownloadSimple weight="bold" style={{ width: 15, height: 15, color: C.faint }} />
                </a>
              ))}
            </div>
          ) : activeScenario ? (
            <div>
              <p style={{ margin: 0, fontSize: 12.5, color: C.faint }}>Scenario {Math.max(1, config.scenarios.findIndex(s => s.id === activeScenario.id) + 1)} of {scenarioCount}</p>
              <h2 style={{ fontSize: 19, fontWeight: 700, color: C.text, margin: '2px 0 4px', fontFamily: DISPLAY_FONT }}>{activeScenario.title || 'Scenario'}</h2>
              {renderScenarioBody(activeScenario)}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: C.faint }}>No scenarios yet.</p>
          )}
          </div>

          {/* Submit */}
          {!locked && (
            <div>
              {submitError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#ef4444' }}>
                  <WarningCircle weight="duotone" style={{ width: 15, height: 15 }} /> {submitError}
                </div>
              )}
              {previewMode ? (
                <p style={{ fontSize: 13, color: C.faint }}>Preview - submissions are disabled.</p>
              ) : !canSubmit ? (
                <p style={{ fontSize: 13, textAlign: 'center', padding: '10px 14px', borderRadius: 10, background: C.card, color: C.muted }}>
                  {disabledReason || 'Your group leader will submit this for the group.'}
                </p>
              ) : (
                <>
                  {submitted && !justSubmitted && (
                    <p style={{ fontSize: 12.5, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: C.card, color: C.muted }}>Submitted - you can still edit and resubmit until it is graded.</p>
                  )}
                  {justSubmitted ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 12, background: C.card, boxShadow: 'inset 0 0 0 1px rgba(22,163,74,0.28)' }}>
                      <Check weight="bold" style={{ width: 18, height: 18, color: doneGreen }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: doneGreen }}>Submitted for review.</span>
                    </div>
                  ) : (
                    <>
                      {isLastStep && confirmIncomplete && unansweredCount > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}>
                          <WarningCircle weight="duotone" style={{ width: 16, height: 16, color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 13, color: C.text }}>{unansweredCount} of {flat.length} {unansweredCount === 1 ? 'task is' : 'tasks are'} not answered. Go back and complete {unansweredCount === 1 ? 'it' : 'them'}, or submit anyway.</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row', justifyContent: isMobile ? 'stretch' : 'flex-end', alignItems: isMobile ? 'stretch' : 'center' }}>
                        {onSaveDraft && !submitted && !alreadyFinal && (
                          <button type="button" onClick={handleSaveDraft} disabled={savingDraft || submitting || anyUploading}
                            style={ghostBtn(savingDraft || submitting || anyUploading)}>
                            {savingDraft ? <CircleNotch weight="bold" style={{ width: 16, height: 16 }} className="animate-spin" /> : null}
                            {savingDraft ? 'Saving...' : draftSaved ? 'Saved' : 'Save and continue'}
                          </button>
                        )}
                        {!isLastStep ? (
                          <button type="button" onClick={goNext} style={primaryBtn(false)}>
                            {activeScenario && currentStepIndex < timelineSteps.length - 1 && !timelineSteps[currentStepIndex + 1]?.isResources ? 'Next scenario' : 'Next'}
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => { if (unansweredCount > 0 && !confirmIncomplete) { setConfirmIncomplete(true); return; } handleSubmit(); }}
                            disabled={submitting || anyUploading}
                            style={primaryBtn(submitting || anyUploading)}>
                            {submitting ? <CircleNotch weight="bold" style={{ width: 16, height: 16 }} className="animate-spin" /> : null}
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
