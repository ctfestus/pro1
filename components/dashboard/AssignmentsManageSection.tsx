'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, XCircle, ArrowLeft, CheckCircle2, Copy, Download, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/sanitize';
import { ReviewReportView, REVIEW_TYPES } from '@/components/ReviewReportView';
import { parseReviewNotes, inferReviewType } from '@/lib/reviewRecord';
import { parseSubmissionRecord, parseTaskGrades, taskGradeStats, mcqTaskScore, MAX_TASK_FEEDBACK, passMarkOf, type McqGrade } from '@/lib/assignment-scenarios';
import { ScenarioGradingPanel, draftsToTaskGrades, taskScoreValue, taskScoreValid, type TaskGradeDraft } from '@/components/dashboard/ScenarioGradingPanel';
import { requestSolutionCleanup, type AssignmentSolution } from '@/lib/assignment-solutions';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useTheme } from '@/components/ThemeProvider';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { excelReviewSaveErrorMessage } from '@/lib/excel-review-config';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { Bar, Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, shortDate } from '@/components/dashboard/subscriptions/ui';
import { SolutionFilesList } from '@/components/SolutionFilesList';
import { AssignmentReport } from '@/components/dashboard/assignments/AssignmentReport';
import { AssignmentsList } from '@/components/dashboard/assignments/AssignmentsList';
import { SectionSkeleton } from '@/components/dashboard/content/SectionSkeleton';

export function AssignmentsManageSection({ C: themeC }: { C: typeof LIGHT_C }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...themeC, cta: DARK_C.cta }), [themeC]);
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [assignments, setAssignments]       = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [deletingId, setDeletingId]         = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId]   = useState<string | null>(null);
  const [selected, setSelected]             = useState<any>(null);
  const [submissions, setSubmissions]       = useState<any[]>([]);
  const [assignedStudents, setAssignedStudents] = useState<any[]>([]);
  const [loadingSubs, setLoadingSubs]       = useState(false);
  const [viewingSub, setViewingSub]         = useState<any>(null);
  const [subFiles, setSubFiles]             = useState<any[]>([]);
  const [solutions, setSolutions]           = useState<AssignmentSolution[]>([]);
  const [score, setScore]                   = useState('');
  const [feedback, setFeedback]             = useState('');
  const [scenarioMcq, setScenarioMcq]       = useState<{ grades: Record<string, McqGrade>; subtotal: number | null } | null>(null);
  // Per-task grading: one score + comment per task, kept as typed strings while editing.
  const [taskDrafts, setTaskDrafts]         = useState<Record<string, TaskGradeDraft>>({});
  // The final grade follows the task average until the instructor edits it by hand.
  const [scoreTouched, setScoreTouched]     = useState(false);
  const [grading, setGrading]               = useState(false);
  const [gradeError, setGradeError]         = useState('');
  const [gradeWarning, setGradeWarning]     = useState('');
  const [gradeSuccess, setGradeSuccess]     = useState(false);
  const [veAttemptProgress, setVeAttemptProgress] = useState<Record<string, any> | null>(null);
  const [veProgressMap, setVeProgressMap]   = useState<Record<string, { pct: number; completedAt: string | null }>>({});
  const [deleting, setDeleting]             = useState<any>(null);
  const [notice, setNotice]                 = useState<{ ok: boolean; text: string } | null>(null);
  const notify = (ok: boolean, text: string) => setNotice({ ok, text });
  const [cohorts, setCohorts]               = useState<{ id: string; name: string }[]>([]);
  const openToken = useRef(0);
  // Separate guard for openSubmission, so its slower fetches (files, MCQ marking, VE progress)
  // cannot land after a different submission has been opened and grade it against the wrong one.
  const subToken = useRef(0);

  useEffect(() => {
    supabase.from('assignments').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) console.error('[assignments fetch]', error); setAssignments(data ?? []); setLoading(false); });
  }, []);

  // Task grades as they will be stored, plus the average they suggest for the final grade.
  const draftGrades = useMemo(() => draftsToTaskGrades(taskDrafts), [taskDrafts]);
  const taskAverage = useMemo(() => {
    const scores = Object.values(draftGrades).map(g => g.score).filter((n): n is number => n != null);
    return scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
  }, [draftGrades]);
  // The selected assignment's configured passing grade (default 85), used for every pass/fail readout.
  const passMark = passMarkOf(selected?.config);

  // Keep the final grade in step with the task scores while the instructor has not overridden it.
  useEffect(() => {
    if (scoreTouched || taskAverage == null) return;
    setScore(String(taskAverage));
  }, [taskAverage, scoreTouched]);

  async function openAssignment(a: any) {
    // Guard against out-of-order responses when assignments are clicked in quick succession:
    // only the latest call's fetched data is applied.
    const token = ++openToken.current;
    setSelected(a); setViewingSub(null); setSubFiles([]); setLoadingSubs(true);
    setVeProgressMap({}); setCohorts([]); setSolutions([]); setNotice(null);
    const groupIds: string[] = Array.isArray(a.group_ids) && a.group_ids.length > 0 ? a.group_ids : [];
    // Solution files (released to students only after grading) -- shown to the grader so they can
    // check the model answer while marking. Non-blocking: failure just leaves the list empty.
    supabase.from('assignment_solutions').select('id, name, kind, url').eq('assignment_id', a.id).order('created_at')
      .then(({ data }) => { if (openToken.current === token) setSolutions((data ?? []) as AssignmentSolution[]); });
    const [{ data: subs }, { data: cohortStudents }, { data: groupMemberRows }, { data: cohortRows }] = await Promise.all([
      supabase.from('assignment_submissions').select('*, student:students!student_id(id, full_name, email), submitted_by_student:students!submitted_by(full_name)').eq('assignment_id', a.id).order('updated_at', { ascending: false }),
      a.cohort_ids?.length ? supabase.from('students').select('id, full_name, email, cohort_id').in('cohort_id', a.cohort_ids) : Promise.resolve({ data: [] }),
      groupIds.length ? supabase.from('group_members').select('group_id, is_leader, groups(id, name), students(id, full_name, email)').in('group_id', groupIds) : Promise.resolve({ data: [] }),
      a.cohort_ids?.length ? supabase.from('cohorts').select('id, name').in('id', a.cohort_ids) : Promise.resolve({ data: [] }),
    ]);

    // For VE assignments, the submission row is only written when the student hits "Complete".
    // Pull the underlying VE attempts so students who are mid-experience (or finished the work
    // without submitting) show as In Progress instead of Not Started.
    const veFormId = a.type === 'virtual_experience' ? a.config?.ve_form_id : null;
    if (veFormId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch(`/api/ve-attempt?veId=${veFormId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const map: Record<string, { pct: number; completedAt: string | null }> = {};
          for (const att of json.attempts ?? []) map[att.studentId] = { pct: att.progressPct ?? 0, completedAt: att.completedAt ?? null };
          if (openToken.current !== token) return;
          setVeProgressMap(map);
        }
      }
    }
    const groupStudents = (groupMemberRows ?? []).map((r: any) => ({ ...(r.students ?? {}), group_id: r.group_id, group_name: (r.groups as any)?.name ?? null, is_leader: !!r.is_leader })).filter((s: any) => s?.id);
    const seen = new Set<string>();
    const sourceStudents = groupIds.length > 0 ? [...groupStudents, ...(cohortStudents ?? [])] : [...(cohortStudents ?? []), ...groupStudents];
    const allStudents = sourceStudents.filter((s: any) => {
      if (!s?.id || seen.has(s.id)) return false;
      seen.add(s.id); return true;
    });
    if (openToken.current !== token) return;
    setSubmissions(subs ?? []); setAssignedStudents(allStudents); setCohorts(cohortRows ?? []); setLoadingSubs(false);
  }

  async function openSubmission(sub: any) {
    // Guard against out-of-order fetches when submissions are clicked in quick succession: only the
    // latest call's data is applied, so one submission's grades can never bleed into another's.
    const token = ++subToken.current;
    setViewingSub(sub); setSubFiles([]); setScore(sub.score != null ? String(sub.score) : '');
    setFeedback(sub.feedback ?? ''); setGradeError(''); setGradeWarning(''); setGradeSuccess(false);
    setVeAttemptProgress(null);
    // Clear per-task grading state up front. Until this call's fetches resolve, a stale draft from a
    // previously open submission must not linger (it also feeds the auto-computed final grade), so
    // hold scoreTouched=true meanwhile to keep the average effect from acting on empty/old drafts.
    setScenarioMcq(null); setTaskDrafts({}); setScoreTouched(true);
    const veFormId = selected?.config?.ve_form_id;
    const isVe = selected?.type === 'virtual_experience' && veFormId && sub.student_id;

    const [{ data: files }, session] = await Promise.all([
      supabase.from('assignment_submission_files').select('*').eq('submission_id', sub.id).order('uploaded_at'),
      isVe ? supabase.auth.getSession() : Promise.resolve({ data: { session: null } }),
    ]);
    if (subToken.current !== token) return;
    if (files) setSubFiles(files);

    // Scenario submissions: MCQ is graded server-side (the answer keys never reach the browser
    // and the endpoint works for any authorized grader, not just the assignment owner).
    const record = selected?.type === 'standard' ? parseSubmissionRecord(sub.response_text) : null;
    if (record) {
      const { data: { session: gs } } = await supabase.auth.getSession();
      const gr = await fetch(`/api/assignments/mcq-grade?submissionId=${sub.id}`, {
        headers: gs ? { Authorization: `Bearer ${gs.access_token}` } : {},
      });
      const graded: { grades: Record<string, McqGrade>; subtotal: number | null } = gr.ok ? await gr.json() : { grades: {}, subtotal: null };
      if (subToken.current !== token) return;
      setScenarioMcq(graded);
      // Seed one draft per task. On a first pass MCQ prefills from the server-side marking
      // (authoritative) so only the human-judged tasks need typing. Once grades have been saved
      // they are the truth: a task the instructor deliberately left unscored stays unscored.
      const saved = parseTaskGrades(sub.task_grades);
      const isRegrade = Object.keys(saved).length > 0;
      const drafts: Record<string, TaskGradeDraft> = {};
      for (const a of record.answers) {
        const g = saved[a.taskId];
        const prefill = g?.score != null ? g.score : isRegrade ? null : mcqTaskScore(a, graded.grades?.[a.taskId]);
        drafts[a.taskId] = { score: prefill != null ? String(prefill) : '', feedback: g?.feedback ?? '' };
      }
      setTaskDrafts(drafts);
      // An existing grade is treated as deliberate, so the task average does not overwrite it.
      setScoreTouched(sub.score != null);
    }

    if (isVe && session?.data?.session?.access_token) {
      const res = await fetch(`/api/ve-attempt?veId=${veFormId}&studentId=${sub.student_id}`, {
        headers: { Authorization: `Bearer ${session.data.session.access_token}` },
      });
      if (subToken.current !== token) return;
      if (res.ok) {
        const json = await res.json();
        if (json.progress) setVeAttemptProgress(json.progress);
      }
    }
  }

  async function saveGrade() {
    if (!viewingSub) return;
    const isScenario = !!parseSubmissionRecord(viewingSub.response_text);
    // Block on a task score that is not a number in 0-100, else it would silently save as unscored.
    if (isScenario && Object.values(taskDrafts).some(d => {
      const n = taskScoreValue(d.score);
      return (d.score.trim() !== '' && n == null) || !taskScoreValid(n);
    })) {
      setGradeError('Each task score must be a number between 0 and 100.');
      return;
    }
    const finalScore = score.trim() === '' ? null : parseFloat(score);
    if (finalScore != null && (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100)) {
      setGradeError('The final grade must be a number between 0 and 100.');
      return;
    }
    const taskGrades = isScenario ? draftsToTaskGrades(taskDrafts, sanitizeRichText) : null;
    if (taskGrades && Object.values(taskGrades).some(g => (g.feedback?.length ?? 0) > MAX_TASK_FEEDBACK)) {
      setGradeError('One task comment is too long. Shorten it and save again.');
      return;
    }
    setGrading(true); setGradeError(''); setGradeWarning(''); setGradeSuccess(false);
    try {
      const sanitizedFeedback = sanitizeRichText(feedback).trim() || null;
      const payload: any = { score: finalScore, feedback: sanitizedFeedback, status: 'graded', graded_by: (await supabase.auth.getUser()).data.user?.id, graded_at: new Date().toISOString() };
      if (isScenario) payload.task_grades = Object.keys(taskGrades ?? {}).length ? taskGrades : null;
      let { error } = await supabase.from('assignment_submissions')
        .update(payload)
        .eq('id', viewingSub.id);
      // A tenant that has not applied migration 143 yet has no task_grades column. Save the
      // grade itself rather than blocking grading, and say what was left out.
      if (error && isScenario && (error.code === 'PGRST204' || error.code === '42703')) {
        delete payload.task_grades;
        ({ error } = await supabase.from('assignment_submissions').update(payload).eq('id', viewingSub.id));
        if (!error) setGradeWarning('Saved the final grade only. This database is missing migration 143 (task_grades), so the per-task scores and comments were not stored.');
      }
      if (error) throw error;
      const updated = { ...viewingSub, score: finalScore, feedback: sanitizedFeedback, status: 'graded', ...(isScenario ? { task_grades: payload.task_grades } : {}) };
      setViewingSub(updated);
      setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
      setGradeSuccess(true);
      setTimeout(() => setGradeSuccess(false), 3000);

      // Fire-and-forget grade notification email
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch('/api/assignments/grade-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ submissionId: viewingSub.id, assignmentTitle: selected?.title ?? '' }),
        }).catch(() => {});
      });
    } catch (err: any) {
      setGradeError(err?.message || 'Failed to save grade.');
    } finally {
      setGrading(false);
    }
  }

  async function duplicateAssignment(a: any) {
    setDuplicatingId(a.id);
    const { id, created_at, updated_at, ...rest } = a;
    const { data, error } = await supabase
      .from('assignments')
      .insert({ ...rest, title: `Copy of ${a.title}`, status: 'draft', cohort_ids: [], group_ids: [], deadline_date: null })
      .select('*')
      .single();
    if (error) { setDuplicatingId(null); notify(false, excelReviewSaveErrorMessage(error, 'Could not duplicate this assignment. Please try again.')); return; }

    // The copy is a series of non-atomic inserts; collect anything that fails to copy so the
    // instructor is told rather than being shown a false "duplicated" success.
    const copyIssues: string[] = [];

    // Copy resources
    const { data: resources, error: rSelErr } = await supabase
      .from('assignment_resources')
      .select('name, url, resource_type')
      .eq('assignment_id', a.id);
    if (rSelErr) copyIssues.push('resources');
    else if (resources?.length) {
      const { error: rErr } = await supabase.from('assignment_resources').insert(
        resources.map(r => ({ ...r, assignment_id: data.id }))
      );
      if (rErr) copyIssues.push('resources');
    }

    // Copy solution files. The rows point at the same private storage objects (immutable, and a
    // deleted row never deletes the object), so the copy releases the same model answer.
    const { data: sols, error: sSelErr } = await supabase
      .from('assignment_solutions')
      .select('name, kind, storage_path, url')
      .eq('assignment_id', a.id);
    if (sSelErr) copyIssues.push('solution files');
    else if (sols?.length) {
      const { error: sErr } = await supabase.from('assignment_solutions').insert(
        sols.map(s => ({ ...s, assignment_id: data.id }))
      );
      if (sErr) copyIssues.push('solution files');
    }

    // Copy MCQ answer keys (stored in a separate server-only table), else the copy's MCQs lose
    // their correct answers and can't be republished.
    const { data: keyRow, error: kSelErr } = await supabase.from('assignment_answer_keys').select('keys').eq('assignment_id', a.id).maybeSingle();
    if (kSelErr) copyIssues.push('MCQ answer keys');
    else if (keyRow) {
      const { error: kErr } = await supabase.from('assignment_answer_keys').upsert({ assignment_id: data.id, keys: keyRow.keys }, { onConflict: 'assignment_id' });
      if (kErr) copyIssues.push('MCQ answer keys');
    }

    setDuplicatingId(null);
    setAssignments(prev => [data, ...prev]);
    notify(!copyIssues.length, copyIssues.length
      ? `The copy was created as a draft, but these did not carry over: ${copyIssues.join(', ')}. Open the copy and re-add them before publishing.`
      : `${a.title} copied as a draft`);
  }

  async function deleteAssignment(id: string) {
    setDeletingId(id);
    // Note the solution files first: deleting the assignment cascades their rows away, and after
    // that nothing knows which objects it used. They are only removed from the bucket if no other
    // assignment references them (a duplicate shares the same file), which the server re-checks.
    const { data: sols } = await supabase.from('assignment_solutions')
      .select('storage_path').eq('assignment_id', id).eq('kind', 'file');
    const solutionPaths = (sols ?? []).map((s: any) => s.storage_path).filter(Boolean);

    const { error } = await supabase.from('assignments').delete().eq('id', id);
    setDeletingId(null);
    if (error) { notify(false, error.message); return; }

    if (solutionPaths.length > 0) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) requestSolutionCleanup(solutionPaths, session.access_token);
    }
    setAssignments(prev => prev.filter(a => a.id !== id));
    if (selected?.id === id) setSelected(null);
    notify(true, 'Assignment deleted');
  }

  const banner = notice && (
    <div role={notice.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 mb-5 text-sm flex items-center gap-3"
      style={notice.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      {notice.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
      <span className="flex-1">{notice.text}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4"/></button>
    </div>
  );

  if (loading) return <SectionSkeleton C={C} shape="rows" />;

  // -- Grading view ---
  if (viewingSub) {
    // Scenario-based standard submissions are graded task by task (score + comment per task);
    // everything else keeps the single overall score + feedback.
    const scenarioRec = parseSubmissionRecord(viewingSub.response_text);
    const stats = scenarioRec ? taskGradeStats(scenarioRec.answers, draftGrades) : null;
    const scorePct = score.trim() === '' ? null : parseFloat(score);
    const scoreSet = scorePct != null && Number.isFinite(scorePct);
    const scoreIsPass = scoreSet && scorePct >= passMark;
    const P = palette(C);
    const learner = viewingSub.student?.full_name || viewingSub.student?.email || 'Learner';
    const statusPill = viewingSub.status === 'graded' ? <Pill tone="good" dot C={C}>Graded</Pill>
      : viewingSub.status === 'submitted' ? <Pill tone="warn" dot C={C}>To grade</Pill>
      : <Pill tone="mute" C={C}>{viewingSub.status === 'draft' ? 'Draft' : String(viewingSub.status).replaceAll('_', ' ')}</Pill>;
    const section = (title: string, children: React.ReactNode, aside?: React.ReactNode) => (
      <Card C={C} className="overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <h3 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
          {aside}
        </div>
        <div className="px-5 py-4">{children}</div>
      </Card>
    );
    const veCards = (() => {
      if (!veAttemptProgress) return null;
      const cards: React.ReactNode[] = [];
      for (const [reqId, entry] of Object.entries(veAttemptProgress)) {
        const rec = parseReviewNotes((entry as any)?.notes);
        if (!rec) continue;
        // Only render entries that look like AI reviews (typed, inferable, or a legacy lean with a score).
        const type = rec.type ?? inferReviewType(rec.report);
        if (!type && typeof rec.report?.overallScore !== 'number') continue;
        cards.push(<div key={reqId}><ReviewReportView rec={rec} isDark={isDark} /></div>);
      }
      return cards.length ? cards : null;
    })();

    return (
      <div className="space-y-5 pb-12">
        <button type="button" onClick={() => { setViewingSub(null); setVeAttemptProgress(null); }} className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4"/>
          {selected?.title ?? 'Back to responses'}
        </button>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{learner}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: C.muted }}>
            {statusPill}
            {viewingSub.student?.email && viewingSub.student.email !== learner && <span>{viewingSub.student.email}</span>}
            {viewingSub.updated_at && <span>Handed in <b className="font-semibold" style={{ color: C.text }}>{shortDate(viewingSub.updated_at)}</b></span>}
          </div>
        </div>

        {gradeSuccess && (
          <div role="status" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0"/>
            Grade saved. The learner gets an email about it.
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          {/* The hand-in */}
          <div className="grid gap-4 min-w-0">
            {scenarioRec ? (
              <ScenarioGradingPanel
                record={scenarioRec}
                mcq={scenarioMcq?.grades ?? {}}
                drafts={taskDrafts}
                onChange={(taskId, patch) => setTaskDrafts(prev => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { score: '', feedback: '' }), ...patch } }))}
                C={C}
                isDark={isDark}
              />
            ) : section('Response', <>
            {viewingSub.response_text ? (() => {
            const subAssignType = selected?.type ?? 'standard';
            if (REVIEW_TYPES.includes(subAssignType)) {
              const rec = parseReviewNotes(viewingSub.response_text);
              if (rec) {
                const type = rec.type ?? subAssignType;
                if (type === 'document_review') {
                  const isManual = rec.documentReviewMode === 'manual' || !!rec.report?.manualReview;
                  const fileUrl = rec.report?.fileUrl;
                  return (
                    <div className="mb-3 space-y-3">
                      {fileUrl && (
                        <div className="rounded-xl px-4 py-3" style={{ background: C.page }}>
                          <a href={fileUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-70"
                            style={{ color: C.text }}>
                            <Download className="w-3 h-3" /> Download submitted report
                            {rec.report?.fileName && <span className="font-normal ml-1 opacity-60">({rec.report.fileName})</span>}
                          </a>
                        </div>
                      )}
                      {isManual
                        ? <p className="text-sm" style={{ color: C.muted }}>Handed in for you to review.</p>
                        : <ReviewReportView rec={{ ...rec, type: 'document_review' }} isDark={isDark} />}
                    </div>
                  );
                }
                return (
                  <div className="mb-3">
                    <ReviewReportView rec={{ ...rec, type }} isDark={isDark} />
                  </div>
                );
              }
            }

            return (
              <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(viewingSub.response_text) }}/>
            );
            })() : (
              <p className="text-sm" style={{ color: C.muted }}>No written response.</p>
            )}

            </>)}
            {veCards && section('AI reviews', <div className="grid gap-3">{veCards}</div>, <span className="text-xs" style={{ color: C.muted }}>From the virtual experience</span>)}
            {subFiles.length > 0 && section('Attachments', (
              <div className="grid gap-2">
                {subFiles.map((f: any) => (
                  <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 text-sm font-semibold px-4 py-3 rounded-xl transition-opacity hover:opacity-75"
                    style={{ background: C.page, color: C.text, textDecoration: 'none' }}>
                    {f.file_name ? <FileText className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }}/> : <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }}/>}
                    <span className="truncate flex-1">{f.file_name || f.file_url}</span>
                    <span className="text-xs font-normal" style={{ color: C.muted }}>Open</span>
                  </a>
                ))}
              </div>
            ), <span className="text-xs" style={{ color: C.muted }}>{subFiles.length} file{subFiles.length === 1 ? '' : 's'}</span>)}
          </div>

          {/* The grade: stays in view while a long hand-in scrolls. */}
          <div className="grid gap-4 lg:sticky lg:top-4">
            <Card C={C} className="overflow-hidden">
              <div className="flex items-baseline justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
                <h3 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{scenarioRec ? 'Final grade' : 'Grade'}</h3>
                <span className="text-xs" style={{ color: C.muted }}>Pass mark <b className="font-semibold" style={{ color: C.text }}>{passMark}%</b></span>
              </div>
              <div className="px-5 py-4 grid gap-4">
                {stats && (
                  <div className="grid gap-2">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="font-semibold" style={{ color: C.text }}>{stats.scored} of {stats.total} tasks scored</span>
                      <span style={{ color: C.muted }}>{stats.commented} comment{stats.commented === 1 ? '' : 's'}</span>
                    </div>
                    <Bar parts={[{ pct: stats.total ? (stats.scored / stats.total) * 100 : 0, color: P.good }]} C={C} />
                    {scenarioMcq?.subtotal != null && <p className="text-xs" style={{ color: C.muted }}>Multiple choice marked automatically: {scenarioMcq.subtotal}%</p>}
                  </div>
                )}
                <div>
                  <label htmlFor="final-score" className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{scenarioRec ? 'Final score' : 'Score'}</label>
                  <div className="flex items-center gap-3">
                    <input id="final-score" type="number" min={0} max={100} value={score} onChange={e => { setScore(e.target.value); setScoreTouched(true); }} placeholder="--"
                      className="field-focus [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      style={{ width: 96, height: 52, borderRadius: 12, border: `1px solid ${C.inputBorder}`, background: C.input, color: C.text, fontSize: 22, fontWeight: 600, textAlign: 'center', outline: 'none', boxSizing: 'border-box', fontFamily: DISPLAY_FONT }}/>
                    <span className="text-sm" style={{ color: C.muted }}>/ 100</span>
                    {scoreSet && <Pill tone={scoreIsPass ? 'good' : 'bad'} C={C}>{scoreIsPass ? 'Pass' : 'Fail'}</Pill>}
                  </div>
                  {scenarioRec && (
                    <div className="mt-2 grid gap-2">
                      <p className="text-xs" style={{ color: C.muted }}>
                        {taskAverage == null
                          ? 'Score the tasks and this fills in from their average, or set it yourself.'
                          : scoreTouched
                            ? `The task average is ${taskAverage}%. You have set your own score.`
                            : `Follows the task average (${taskAverage}%). Type a number to set it yourself.`}
                      </p>
                      {taskAverage != null && scoreTouched && (
                        <button type="button" onClick={() => { setScoreTouched(false); setScore(String(taskAverage)); }} className={`${btnSmClass} justify-self-start`} style={btnStyle('ghost', C)}>
                          <RotateCcw className="w-3.5 h-3.5"/> Use task average ({taskAverage}%)
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>{scenarioRec ? 'Overall feedback' : 'Feedback to the learner'}</p>
                  <RichTextEditor value={feedback} onChange={setFeedback}
                    placeholder={scenarioRec ? 'Sum up the whole hand-in. Task comments are saved with each task.' : 'Write feedback for the learner'}
                    bgOverride={C.input} enableAiAssist/>
                </div>
                {gradeError && <p role="alert" className="text-xs" style={{ color: P.bad }}>{gradeError}</p>}
                {!gradeError && gradeWarning && <p className="text-xs" style={{ color: P.warn }}>{gradeWarning}</p>}
                <button type="button" onClick={saveGrade} disabled={grading || gradeSuccess} className={`${btnClass} w-full`} style={btnStyle('pri', C)}>
                  {grading ? 'Saving...' : gradeSuccess ? 'Grade saved' : viewingSub.status === 'graded' ? 'Update grade' : 'Save grade'}
                </button>
                <p className="text-xs" style={{ color: C.muted }}>The learner gets an email when the grade is saved.</p>
              </div>
            </Card>
            {solutions.length > 0 && section('Model answer', (
              <div className="grid gap-3">
                <SolutionFilesList solutions={solutions} C={C}/>
                <p className="text-xs" style={{ color: C.muted }}>Only you see these while grading. Learners get them once they are graded.</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // -- Assignment report ---
  if (selected) {
    return (
      <>
        {banner}
        <AssignmentReport key={selected.id} assignment={selected} submissions={submissions} assignedStudents={assignedStudents} loading={loadingSubs}
          veProgressMap={veProgressMap} cohorts={cohorts} passMark={passMark} onBack={() => setSelected(null)} onGrade={openSubmission} C={C} />
      </>
    );
  }

  // -- Assignment list ---
  return (
    <>
      {banner}
      <AssignmentsList assignments={assignments} onOpen={openAssignment} onDuplicate={duplicateAssignment} onDelete={setDeleting}
        duplicatingId={duplicatingId} notify={notify} C={C} />
      {deleting && (
        <ConfirmModal
          title="Delete assignment?"
          eyebrow={deleting.title}
          body="All of its submissions are deleted with it. This cannot be undone."
          action="Delete assignment"
          danger
          busy={deletingId === deleting.id}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteAssignment(deleting.id); setDeleting(null); }}
          C={C}
        />
      )}
    </>
  );
}
