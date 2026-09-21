'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowLeft, BarChart3, CheckCircle2, ChevronDown, Circle, CircleCheckBig, ClipboardList, Copy, Download, Edit2, ExternalLink, Eye, FileText, Loader2, Plus, RotateCcw, Search, Send, SlidersHorizontal, Trash2, Users, TrendingUp, Clock3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText } from '@/lib/sanitize';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ReviewReportView, REVIEW_TYPES } from '@/components/ReviewReportView';
import { parseReviewNotes, inferReviewType } from '@/lib/reviewRecord';
import { parseSubmissionRecord, parseTaskGrades, taskGradeStats, mcqTaskScore, MAX_TASK_FEEDBACK, passMarkOf, type McqGrade } from '@/lib/assignment-scenarios';
import { ScenarioGradingPanel, draftsToTaskGrades, taskScoreValue, taskScoreValid, type TaskGradeDraft } from '@/components/dashboard/ScenarioGradingPanel';
import { SolutionFilesList } from '@/components/SolutionFilesList';
import { requestSolutionCleanup, type AssignmentSolution } from '@/lib/assignment-solutions';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useTheme } from '@/components/ThemeProvider';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SYNC_ENABLED } from '@/lib/sync';
import { exportAssignment, exportAllAssignments, exportCSV, exportGroupCSV } from '@/lib/dashboard-export';
import { PushButton, PushAllButton, StudentAvatar } from '@/components/dashboard/primitives';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { excelReviewSaveErrorMessage } from '@/lib/excel-review-config';

export function AssignmentsManageSection({ C }: { C: typeof LIGHT_C }) {
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
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
  const [statusFilter, setStatusFilter]     = useState<string>('all');
  const [cohortFilter, setCohortFilter]     = useState<string>('all');
  const [responseSearch, setResponseSearch] = useState('');
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
    setExpandedGroups(new Set()); setVeProgressMap({}); setStatusFilter('all'); setCohortFilter('all'); setResponseSearch(''); setCohorts([]); setSolutions([]);
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

  function toggleExpandedGroup(groupId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
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
    if (error) { setDuplicatingId(null); window.alert(excelReviewSaveErrorMessage(error, 'Could not duplicate this assignment. Please try again.')); return; }

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
    if (copyIssues.length) {
      window.alert(`The copy was created as a draft, but these did not carry over: ${copyIssues.join(', ')}. Open the copy and re-add them before publishing.`);
    }
  }

  async function deleteAssignment(id: string) {
    if (!window.confirm('Delete this assignment? All submissions will also be removed.')) return;
    setDeletingId(id);
    // Note the solution files first: deleting the assignment cascades their rows away, and after
    // that nothing knows which objects it used. They are only removed from the bucket if no other
    // assignment references them (a duplicate shares the same file), which the server re-checks.
    const { data: sols } = await supabase.from('assignment_solutions')
      .select('storage_path').eq('assignment_id', id).eq('kind', 'file');
    const solutionPaths = (sols ?? []).map((s: any) => s.storage_path).filter(Boolean);

    const { error } = await supabase.from('assignments').delete().eq('id', id);
    setDeletingId(null);
    if (error) { window.alert(error.message); return; }

    if (solutionPaths.length > 0) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) requestSolutionCleanup(solutionPaths, session.access_token);
    }
    setAssignments(prev => prev.filter(a => a.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  if (loading) return (
    <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: C.card }}/>)}</div>
  );

  // -- Grading view ---
  if (viewingSub) {
    // Scenario-based standard submissions are graded task by task (score + comment per task);
    // everything else keeps the single overall score + feedback.
    const scenarioRec = parseSubmissionRecord(viewingSub.response_text);
    const stats = scenarioRec ? taskGradeStats(scenarioRec.answers, draftGrades) : null;
    const scorePct = score.trim() === '' ? null : parseFloat(score);
    const scoreIsPass = scorePct != null && Number.isFinite(scorePct) && scorePct >= passMark;
    return (
      <div>
        <button onClick={() => { setViewingSub(null); setVeAttemptProgress(null); }} className="flex items-center gap-2 mb-6 text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <ArrowLeft className="w-4 h-4"/> Back to responses
        </button>

        {gradeSuccess && (
          <div className="flex items-center gap-3 rounded-2xl px-5 py-4 mb-5" style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#10b981' }}/>
            <p className="text-sm font-semibold" style={{ color: '#10b981' }}>Grade saved successfully.</p>
          </div>
        )}

        {/* Student card */}
        <div className="rounded-2xl p-5 mb-4" style={{ ...cardStyle(C) }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <StudentAvatar name={viewingSub.student?.full_name} email={viewingSub.student?.email} size={40} C={C}/>
              <div>
                <p className="font-semibold text-sm" style={{ color: C.text }}>{viewingSub.student?.full_name || viewingSub.student?.email || 'Student'}</p>
                <p className="text-xs mt-0.5" style={{ color: C.faint }}>{viewingSub.student?.email}{viewingSub.updated_at ? ` · ${new Date(viewingSub.updated_at).toLocaleDateString()}` : ''}</p>
              </div>
            </div>
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: viewingSub.status === 'graded' ? 'rgba(22,163,74,0.12)' : viewingSub.status === 'submitted' ? 'rgba(37,99,235,0.12)' : C.pill, color: viewingSub.status === 'graded' ? '#16a34a' : viewingSub.status === 'submitted' ? '#2563eb' : C.faint }}>
              {viewingSub.status.charAt(0).toUpperCase() + viewingSub.status.slice(1)}
            </span>
          </div>

          {/* Scenario submissions: grading progress here, the task-by-task marking below. */}
          {stats && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Grading progress</p>
                <p className="text-xs font-semibold" style={{ color: C.text }}>{stats.scored} of {stats.total} tasks scored</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: C.pill }}>
                <div style={{ width: `${stats.total ? Math.round((stats.scored / stats.total) * 100) : 0}%`, height: '100%', background: C.green, transition: 'width 0.2s ease' }}/>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {stats.average != null && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(22,163,74,0.12)', color: '#16a34a' }}>Task average {stats.average}%</span>
                )}
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: C.pill, color: C.muted }}>{stats.commented} comment{stats.commented === 1 ? '' : 's'}</span>
                {scenarioMcq?.subtotal != null && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: C.pill, color: C.muted }}>Multiple choice auto-marked {scenarioMcq.subtotal}%</span>
                )}
              </div>
            </div>
          )}

          {!scenarioRec && (viewingSub.response_text ? (() => {
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
                        <div className="rounded-xl px-4 py-3" style={{ background: C.input }}>
                          <a href={fileUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
                            style={{ color: C.green }}>
                            <Download className="w-3 h-3" /> Download submitted report
                            {rec.report?.fileName && <span className="font-normal ml-1 opacity-60">({rec.report.fileName})</span>}
                          </a>
                        </div>
                      )}
                      {isManual
                        ? <div className="rounded-xl px-4 py-3" style={{ background: C.input }}><span className="text-sm" style={{ color: C.faint }}>Submitted for instructor review.</span></div>
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
              <div className="rounded-xl p-4 mb-3" style={{ background: C.input }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Response</p>
                <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(viewingSub.response_text) }}/>
              </div>
            );
          })() : (
            <p className="text-sm mb-3" style={{ color: C.faint }}>No written response.</p>
          ))}

          {veAttemptProgress && (() => {
            const cards: React.ReactNode[] = [];
            for (const [reqId, entry] of Object.entries(veAttemptProgress)) {
              const rec = parseReviewNotes((entry as any)?.notes);
              if (!rec) continue;
              // Only render entries that look like AI reviews (typed, inferable, or a legacy lean with a score).
              const type = rec.type ?? inferReviewType(rec.report);
              if (!type && typeof rec.report?.overallScore !== 'number') continue;
              cards.push(
                <div key={reqId} className="mb-3">
                  <ReviewReportView rec={rec} isDark={isDark} />
                </div>
              );
            }
            return cards.length > 0 ? <>{cards}</> : null;
          })()}

          {subFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Attachments</p>
              {subFiles.map((f: any) => (
                <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2.5 text-sm px-3.5 py-2.5 rounded-xl transition-opacity hover:opacity-75"
                  style={{ background: C.page, color: C.green, border: `1px solid ${C.divider}`, textDecoration: 'none' }}>
                  {f.file_name ? <FileText className="w-4 h-4 flex-shrink-0"/> : <ExternalLink className="w-4 h-4 flex-shrink-0"/>}
                  <span className="truncate font-medium">{f.file_name || f.file_url}</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Task-by-task marking (scenario assignments) */}
        {scenarioRec && (
          <div className="mb-4">
            <ScenarioGradingPanel
              record={scenarioRec}
              mcq={scenarioMcq?.grades ?? {}}
              drafts={taskDrafts}
              onChange={(taskId, patch) => setTaskDrafts(prev => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { score: '', feedback: '' }), ...patch } }))}
              C={C}
              isDark={isDark}
            />
          </div>
        )}

        {/* Grade panel */}
        <div className="rounded-2xl p-5" style={{ ...cardStyle(C) }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold" style={{ color: C.text }}>{scenarioRec ? 'Final grade' : 'Grade Submission'}</h3>
            <span className="text-xs" style={{ color: C.faint }}>Passmark: {passMark}%</span>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: C.faint }}>Score <span style={{ color: C.faint, fontWeight: 400 }}>(out of 100)</span></label>
            <div className="flex items-center flex-wrap gap-2">
              <input type="number" min={0} max={100} value={score} onChange={e => { setScore(e.target.value); setScoreTouched(true); }} placeholder="e.g. 90"
                style={{ width: 160, padding: '10px 14px', borderRadius: 12, border: `1px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 15, fontWeight: 600, outline: 'none', boxSizing: 'border-box' as const }}/>
              {score && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: scoreIsPass ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: scoreIsPass ? '#10b981' : '#ef4444' }}>
                  {scoreIsPass ? 'Pass' : 'Fail'}
                </span>
              )}
              {scenarioRec && taskAverage != null && (
                scoreTouched ? (
                  <button onClick={() => { setScoreTouched(false); setScore(String(taskAverage)); }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-75 transition-opacity"
                    style={{ background: C.pill, color: C.muted, border: 'none', cursor: 'pointer' }}>
                    <RotateCcw className="w-3 h-3"/> Use task average ({taskAverage}%)
                  </button>
                ) : (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(22,163,74,0.12)', color: '#16a34a' }}>Following the task average</span>
                )
              )}
            </div>
            {scenarioRec && (
              <p className="text-xs mt-2" style={{ color: C.faint }}>
                {taskAverage != null
                  ? `Average of the ${stats?.scored ?? 0} scored task${(stats?.scored ?? 0) === 1 ? '' : 's'}: ${taskAverage}%. Type a different number to set the final grade yourself.`
                  : 'Score the tasks above and the final grade fills in from their average, or set it here yourself.'}
              </p>
            )}
          </div>

          <div className={scenarioRec ? '' : 'mb-5'}>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: C.faint }}>{scenarioRec ? 'Overall feedback to student' : 'Feedback to student'}</label>
            <RichTextEditor value={feedback} onChange={setFeedback}
              placeholder={scenarioRec ? 'Sum up the whole submission. Task comments are saved with each task above.' : 'Write feedback for the student'}
              bgOverride={C.input} fontFamily="var(--font-mono)" enableAiAssist/>
          </div>

          {!scenarioRec && (
            <>
              {gradeError && <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{gradeError}</p>}
              <button onClick={saveGrade} disabled={grading || gradeSuccess}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: gradeSuccess ? '#10b981' : C.cta, color: C.ctaText, border: 'none', cursor: (grading || gradeSuccess) ? 'not-allowed' : 'pointer', opacity: grading ? 0.6 : 1 }}>
                {grading ? 'Saving...' : gradeSuccess ? 'Grade saved' : viewingSub.status === 'graded' ? 'Update Grade' : 'Save Grade'}
              </button>
            </>
          )}
        </div>

        {/* Action bar -- stays in view while marking a long submission, so the task scores, the
            final grade, and Save are always one glance apart. */}
        {scenarioRec && stats && (
          <div style={{ position: 'sticky', bottom: 12, zIndex: 20, marginTop: 16 }}>
            <div className="flex items-center gap-4 flex-wrap px-4 py-3 rounded-2xl"
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? '0 10px 30px rgba(0,0,0,0.45)' : '0 10px 30px rgba(15,23,42,0.12)' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Final grade</p>
                <p className="text-sm font-bold" style={{ color: scorePct == null || !Number.isFinite(scorePct) ? C.faint : scoreIsPass ? '#16a34a' : '#ef4444' }}>
                  {scorePct == null || !Number.isFinite(scorePct) ? 'Not set' : `${scorePct}% ${scoreIsPass ? 'Pass' : 'Fail'}`}
                </p>
              </div>
              <span className="text-xs font-semibold" style={{ color: C.faint }}>{stats.scored} of {stats.total} tasks scored</span>
              {gradeError && <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>{gradeError}</span>}
              {!gradeError && gradeWarning && <span className="text-xs font-semibold" style={{ color: '#d97706' }}>{gradeWarning}</span>}
              <button onClick={saveGrade} disabled={grading || gradeSuccess}
                className="ml-auto px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: gradeSuccess ? '#10b981' : C.cta, color: C.ctaText, border: 'none', cursor: (grading || gradeSuccess) ? 'not-allowed' : 'pointer', opacity: grading ? 0.6 : 1 }}>
                {grading ? 'Saving...' : gradeSuccess ? 'Grade saved' : viewingSub.status === 'graded' ? 'Update grade' : 'Save grade'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -- Assignment detail with tabs ---
  if (selected) {
    const isGroupAssignment = (selected.group_ids?.length ?? 0) > 0;
    // Resolve the status shown in the report. A submission wins (graded/submitted/draft); otherwise
    // fall back to the VE attempt so in-progress work isn't reported as Not Started.
    const statusCfg = (status: string, pct?: number) =>
        status === 'graded'           ? { label: 'Graded',      bg: 'rgba(22,163,74,0.12)', color: '#16a34a' }
      : status === 'submitted'        ? { label: 'Submitted',   bg: 'rgba(37,99,235,0.12)', color: '#2563eb' }
      : status === 'done_unsubmitted' ? { label: 'Done, not submitted', bg: 'rgba(217,119,6,0.12)', color: '#d97706' }
      : status === 'in_progress'      ? { label: pct != null ? `In Progress ${pct}%` : 'In Progress', bg: 'rgba(217,119,6,0.12)', color: '#d97706' }
      : status === 'draft'            ? { label: 'Draft',       bg: C.pill, color: C.muted }
      :                                 { label: 'Not Started', bg: C.pill, color: C.faint };
    const subMap: Record<string, any> = Object.fromEntries(submissions.map((s: any) => [s.student_id, s]));
    const rows = assignedStudents.map((st: any) => {
      const sub = subMap[st.id] ?? null;
      const ve = veProgressMap[st.id];
      const status = sub?.status ?? (ve ? (ve.completedAt ? 'done_unsubmitted' : 'in_progress') : 'not_started');
      return { ...st, sub, _status: status, _pct: ve?.pct };
    });
    const groupSubByGroup = Object.fromEntries(submissions.filter((s: any) => s.group_id).map((s: any) => [s.group_id, s]));
    const groupMap = new Map<string, { id: string; name: string; members: any[] }>();
    if (isGroupAssignment) {
      for (const st of assignedStudents as any[]) {
        if (!st.group_id) continue;
        if (!groupMap.has(st.group_id)) {
          groupMap.set(st.group_id, { id: st.group_id, name: st.group_name || 'Group', members: [] });
        }
        groupMap.get(st.group_id)!.members.push(st);
      }
    }
    const groupRows = Array.from(groupMap.values()).map(group => {
      const sub = groupSubByGroup[group.id] ?? null;
      const participantIds = new Set(Array.isArray(sub?.participants) ? sub.participants : []);
      const participants = sub ? group.members.filter(member => participantIds.has(member.id)) : [];
      const nonParticipants = sub ? group.members.filter(member => !participantIds.has(member.id)) : [];
      const leader = group.members.find(member => member.is_leader) ?? group.members[0] ?? null;
      const memberVe = group.members.map((m: any) => veProgressMap[m.id]).filter(Boolean);
      const anyCompleted = memberVe.some((v: any) => v.completedAt);
      const status = sub?.status ?? (memberVe.length ? (anyCompleted ? 'done_unsubmitted' : 'in_progress') : 'not_started');
      const pct = memberVe.length ? Math.max(...memberVe.map((v: any) => v.pct)) : undefined;
      return { ...group, sub, participants, nonParticipants, leader, _status: status, _pct: pct };
    });
    const responseRows = isGroupAssignment ? groupRows : rows;
    // Status filter (Submitted, Graded, etc.). Only offer statuses actually present in this list.
    const STATUS_LABELS: Record<string, string> = { submitted: 'Submitted', graded: 'Graded', done_unsubmitted: 'Done, not submitted', in_progress: 'In Progress', draft: 'Draft', not_started: 'Not Started' };
    const STATUS_ICONS: Record<string, typeof Circle> = { all: SlidersHorizontal, submitted: Send, graded: CheckCircle2, done_unsubmitted: CircleCheckBig, in_progress: Clock3, draft: FileText, not_started: Circle };
    const STATUS_ORDER = ['submitted', 'graded', 'done_unsubmitted', 'in_progress', 'draft', 'not_started'];
    const presentStatuses = STATUS_ORDER.filter(s => responseRows.some((r: any) => r._status === s));
    // Cohort filter only applies to the individual (cohort-based) view, and only when the
    // assignment spans more than one cohort. Group view is grouped by group, not cohort.
    const showCohortFilter = !isGroupAssignment && cohorts.length > 1;
    const normalizedSearch = responseSearch.trim().toLowerCase();
    const visibleRows = responseRows.filter((r: any) => {
      const searchable = isGroupAssignment
        ? [r.name, r.leader?.full_name, r.leader?.email, ...(r.members ?? []).flatMap((m: any) => [m.full_name, m.email])]
        : [r.full_name, r.email, r.group_name];
      return (statusFilter === 'all' || r._status === statusFilter) &&
        (cohortFilter === 'all' || r.cohort_id === cohortFilter) &&
        (!normalizedSearch || searchable.some(value => String(value ?? '').toLowerCase().includes(normalizedSearch)));
    });
    const responded = isGroupAssignment
      ? groupRows.filter((row: any) => row.sub != null).length
      : submissions.length;
    const gradedSubs = isGroupAssignment
      ? groupRows.filter((row: any) => row.sub?.status === 'graded')
      : submissions.filter(s => s.status === 'graded');
    const graded    = gradedSubs.length;
    const passed    = isGroupAssignment
      ? gradedSubs.filter((r: any) => (r.sub?.score ?? 0) >= passMark).length
      : submissions.filter(s => s.status === 'graded' && s.score >= passMark).length;
    const passRate  = graded > 0 ? Math.round((passed / graded) * 100) : 0;
    const assignedTotal = isGroupAssignment ? groupRows.length : assignedStudents.length;
    const awaitingGrade = responseRows.filter((row: any) => row._status === 'submitted').length;
    const gradedScores = gradedSubs
      .map((row: any) => isGroupAssignment ? row.sub?.score : row.score)
      .filter((value: any): value is number => typeof value === 'number');
    const averageScore = gradedScores.length
      ? Math.round(gradedScores.reduce((sum: number, value: number) => sum + value, 0) / gradedScores.length)
      : null;
    const responseRate = assignedTotal > 0 ? Math.round((responded / assignedTotal) * 100) : 0;
    const reportAccent = isDark ? C.cta : '#00bf63';
    const reportAccentSoft = isDark ? C.lime : 'rgba(0,191,99,.10)';

    return (
      <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 20, overflow: 'hidden' }}>
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setSelected(null)} className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 hover:opacity-70 transition-opacity" style={{ background: C.pill, border: 'none', cursor: 'pointer', color: C.muted }}>
              <ArrowLeft className="w-4 h-4"/>
            </button>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-0.5" style={{ color: reportAccent }}>Assignment report</p>
                <h2 className="text-lg font-bold truncate" style={{ color: C.text }}>{selected.title}</h2>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: selected.status === 'published' ? 'rgba(16,185,129,0.1)' : C.pill, color: selected.status === 'published' ? '#10b981' : C.faint }}>
                {selected.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="hidden sm:inline-flex items-center px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: reportAccentSoft, color: reportAccent }}>
              Pass mark {passMark}%
            </span>
            <Link href={`/create/assignment?edit=${selected.id}&preview=1`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold hover:opacity-80"
              style={{ background: reportAccentSoft, color: reportAccent, textDecoration: 'none' }}>
              <Eye className="w-3.5 h-3.5"/> Preview
            </Link>
            <Link href={`/create/assignment?edit=${selected.id}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold hover:opacity-80"
              style={{ background: C.pill, color: C.muted, textDecoration: 'none' }}>
              <Edit2 className="w-3.5 h-3.5"/> Edit
            </Link>
          </div>
        </div>

        {/* Responses report */}
        <div className="px-5 py-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-5 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {[
                { label: isGroupAssignment ? 'Groups' : 'Assigned', value: assignedTotal, icon: Users, color: C.muted, bg: C.pill },
                { label: 'Response rate', value: `${responseRate}%`, icon: FileText, color: '#2563eb', bg: 'rgba(37,99,235,0.10)' },
                { label: 'Needs grading', value: awaitingGrade, icon: Clock3, color: '#d97706', bg: 'rgba(217,119,6,0.11)' },
                { label: 'Graded', value: graded, icon: CheckCircle2, color: reportAccent, bg: reportAccentSoft },
                { label: 'Average score', value: averageScore == null ? '--' : `${averageScore}%`, icon: BarChart3, color: C.muted, bg: C.pill },
                { label: 'Pass rate', value: `${passRate}%`, icon: TrendingUp, color: reportAccent, bg: reportAccentSoft },
              ].map((s, index) => (
                <div key={s.label} className="px-4 py-2 first:pl-0" style={{ borderRight: index < 5 ? `1px solid ${C.divider}` : 'none' }}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: s.bg }}>
                      <s.icon className="w-4 h-4" style={{ color: s.color }}/>
                    </div>
                  </div>
                  <p className="text-xl font-bold" style={{ color: C.text }}>{s.value}</p>
                  <p className="text-[11px] font-semibold mt-1" style={{ color: C.faint }}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Filter + export */}
            {responseRows.length > 0 && (
              <div className="pb-4 mb-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-2">
                    <label className="relative flex-1 min-w-0 md:max-w-sm">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.faint }}/>
                      <input value={responseSearch} onChange={e => setResponseSearch(e.target.value)}
                        placeholder={isGroupAssignment ? 'Search groups or members...' : 'Search students or email...'}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs outline-none"
                        style={{ background: C.input, color: C.text, border: `1px solid ${C.divider}` }}/>
                    </label>
                  {showCohortFilter && (
                    <select value={cohortFilter} onChange={e => setCohortFilter(e.target.value)}
                      className="px-3.5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                      style={{ background: C.input, color: C.muted, border: `1px solid ${C.divider}` }}>
                      <option value="all">All cohorts</option>
                      {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  </div>
                  <button onClick={() => isGroupAssignment ? exportGroupCSV(visibleRows, selected.title, passMark) : exportCSV(visibleRows, selected.title, passMark)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold hover:opacity-80 transition-opacity"
                    style={{ background: reportAccentSoft, color: reportAccent, border: 'none' }}>
                    <Download className="w-3.5 h-3.5"/> Export CSV
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-0.5" role="group" aria-label="Filter responses by status">
                  {[{ value: 'all', label: 'All' }, ...presentStatuses.map(value => ({ value, label: STATUS_LABELS[value] }))].map(option => {
                    const active = statusFilter === option.value;
                    const StatusIcon = STATUS_ICONS[option.value] ?? Circle;
                    return <button key={option.value} type="button" aria-pressed={active} onClick={() => setStatusFilter(option.value)}
                      className="flex flex-shrink-0 items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-bold transition-colors"
                      style={{ border: 'none', background: active ? reportAccentSoft : 'transparent', color: active ? reportAccent : C.faint, cursor: 'pointer' }}>
                      <StatusIcon className="w-3.5 h-3.5"/>{option.label}
                    </button>;
                  })}
                </div>
              </div>
            )}

            {loadingSubs ? (
              <div className="space-y-2">{[0,1,2,3].map(i => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: C.card }}/>)}</div>
            ) : responseRows.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm font-medium mb-1" style={{ color: C.text }}>{isGroupAssignment ? 'No groups assigned' : 'No students assigned'}</p>
                <p className="text-xs" style={{ color: C.faint }}>{(selected.group_ids?.length ?? 0) > 0 ? 'No group members found for this assignment.' : 'Assign a cohort to this assignment first.'}</p>
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm font-medium mb-1" style={{ color: C.text }}>No {isGroupAssignment ? 'groups' : 'students'} match the current filter</p>
                <p className="text-xs" style={{ color: C.faint }}><button onClick={() => { setStatusFilter('all'); setCohortFilter('all'); setResponseSearch(''); }} className="font-semibold hover:opacity-70" style={{ color: reportAccent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear filters</button></p>
              </div>
            ) : isGroupAssignment ? (
              <div className="overflow-x-auto">
                <div className="grid px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ background: C.pill, color: C.faint, gridTemplateColumns: '1.35fr 1fr 90px 120px 110px 70px 80px 80px', minWidth: 960 }}>
                  <span>Group</span>
                  <span>Leader</span>
                  <span className="text-center">Members</span>
                  <span className="text-center">Participants</span>
                  <span>Status</span>
                  <span className="text-center">Score</span>
                  <span className="text-center">Result</span>
                  <span></span>
                </div>
                {visibleRows.map((row: any, i: number) => {
                  const sub = row.sub;
                  const sc = sub?.score ?? null;
                  const isPassed = sc != null && sc >= passMark;
                  const isExpanded = expandedGroups.has(row.id);
                  const statusInfo = statusCfg(row._status, row._pct);
                  return (
                    <div key={row.id} style={{ background: i % 2 === 0 ? C.card : C.page, borderTop: `1px solid ${C.divider}` }}>
                      <div className="grid px-5 py-3.5 items-center" style={{ gridTemplateColumns: '1.35fr 1fr 90px 120px 110px 70px 80px 80px', minWidth: 960 }}>
                        <button onClick={() => toggleExpandedGroup(row.id)} className="flex items-center gap-2 min-w-0 text-left hover:opacity-80"
                          style={{ color: C.text, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                          <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{row.name}</p>
                            <p className="text-xs truncate" style={{ color: C.faint }}>{sub ? `Submitted by ${sub.submitted_by_student?.full_name || sub.student?.full_name || 'group leader'}` : 'Awaiting submission'}</p>
                          </div>
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{row.leader?.full_name || row.leader?.email || '--'}</p>
                          <p className="text-xs truncate" style={{ color: C.faint }}>{row.leader?.email || ''}</p>
                        </div>
                        <span className="text-sm font-bold text-center" style={{ color: C.text }}>{row.members.length}</span>
                        <span className="text-sm font-bold text-center" style={{ color: sub ? C.text : C.faint }}>{sub ? `${row.participants.length}/${row.members.length}` : '--'}</span>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-center w-fit" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                          {statusInfo.label}
                        </span>
                        <span className="text-sm font-bold text-center" style={{ color: sc != null ? (isPassed ? '#10b981' : '#ef4444') : C.faint }}>
                          {sc != null ? sc : '--'}
                        </span>
                        <span className="text-xs font-bold text-center px-2 py-1 rounded-full mx-auto"
                          style={sc != null ? { background: isPassed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: isPassed ? '#10b981' : '#ef4444' } : { color: C.faint }}>
                          {sc != null ? (isPassed ? 'Passed' : 'Failed') : '--'}
                        </span>
                        <div className="flex justify-end">
                          {sub ? (
                            <button onClick={() => openSubmission(sub)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                              style={{ background: reportAccent, color: C.ctaText, border: 'none', cursor: 'pointer' }}>
                              {sub.status === 'graded' ? 'Regrade' : 'Grade'}
                            </button>
                          ) : (
                            <span className="text-xs" style={{ color: C.faint }}>--</span>
                          )}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-5 pb-4">
                          <div className="rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: C.faint }}>Group Members</p>
                              <div className="space-y-2">
                                {row.members.map((member: any) => {
                                  const participated = !!sub && row.participants.some((p: any) => p.id === member.id);
                                  return (
                                    <div key={member.id} className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <StudentAvatar name={member.full_name} email={member.email} size={28} C={C}/>
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{member.full_name || member.email}</p>
                                          <p className="text-xs truncate" style={{ color: C.faint }}>{member.email}</p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {member.is_leader && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(217,119,6,0.12)', color: '#d97706' }}>Leader</span>}
                                        {sub && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: participated ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)', color: participated ? '#10b981' : '#ef4444' }}>{participated ? 'Participant' : 'Not marked'}</span>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: C.faint }}>Submission</p>
                              {sub ? (
                                <div className="space-y-1.5 text-sm" style={{ color: C.text }}>
                                  <p><span className="font-semibold">Submitted by:</span> {sub.submitted_by_student?.full_name || sub.student?.full_name || 'Group leader'}</p>
                                  <p><span className="font-semibold">Submitted:</span> {sub.updated_at ? new Date(sub.updated_at).toLocaleString() : '--'}</p>
                                  <p style={{ color: C.faint }}>Only the marked participants receive this grade.</p>
                                </div>
                              ) : (
                                <p className="text-sm" style={{ color: C.faint }}>No submission yet.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* Table head */}
                <div className="grid px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ background: C.pill, color: C.faint, gridTemplateColumns: '1fr 110px 70px 80px 80px', minWidth: 680 }}>
                  <span>Student</span>
                  <span>Status</span>
                  <span className="text-center">Score</span>
                  <span className="text-center">Result</span>
                  <span></span>
                </div>
                {visibleRows.map((row: any, i: number) => {
                  const sub     = row.sub;
                  const sc      = sub?.score ?? null;
                  const isPassed = sc != null && sc >= passMark;
                  const statusInfo = statusCfg(row._status, row._pct);
                  return (
                    <div key={row.id} className="grid px-5 py-3.5 items-center" style={{ gridTemplateColumns: '1fr 110px 70px 80px 80px', minWidth: 680, background: i % 2 === 0 ? C.card : C.page, borderTop: `1px solid ${C.divider}` }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <StudentAvatar name={row.full_name} email={row.email} size={34} C={C}/>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{row.full_name || row.email}</p>
                          <p className="text-xs truncate" style={{ color: C.faint }}>{row.email}</p>
                          {isGroupAssignment && row.group_name && (
                            <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: C.muted }}>Group: {row.group_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-center" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                          {statusInfo.label}
                        </span>
                        {isGroupAssignment && sub?.submitted_by_student?.full_name && (
                          <span className="text-xs" style={{ color: C.faint }}>by {(sub.submitted_by_student as any).full_name}</span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-center" style={{ color: sc != null ? (isPassed ? '#10b981' : '#ef4444') : C.faint }}>
                        {sc != null ? sc : '--'}
                      </span>
                      <span className="text-xs font-bold text-center px-2 py-1 rounded-full mx-auto"
                        style={sc != null ? { background: isPassed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: isPassed ? '#10b981' : '#ef4444' } : { color: C.faint }}>
                        {sc != null ? (isPassed ? 'Passed' : 'Failed') : '--'}
                      </span>
                      <div className="flex justify-end">
                        {sub ? (
                          <button onClick={() => openSubmission(sub)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                            style={{ background: reportAccent, color: C.ctaText, border: 'none', cursor: 'pointer' }}>
                            {sub.status === 'graded' ? 'Regrade' : 'Grade'}
                          </button>
                        ) : (
                          <span className="text-xs" style={{ color: C.faint }}>--</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>
    );
  }

  // -- Assignment list ---
  if (!assignments.length) return (
    <div className="text-center py-24 rounded-3xl" style={{ ...cardStyle(C) }}>
      <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: C.lime }}>
        <ClipboardList className="w-7 h-7" style={{ color: C.green }}/>
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: C.text }}>No Assignments yet</h2>
      <p className="text-sm mb-5" style={{ color: C.faint }}>Create your first assignment to get started.</p>
      <Link href="/create/assignment" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-80" style={{ background: C.cta, color: C.ctaText }}>
        <Plus className="w-4 h-4"/> New Assignment
      </Link>
    </div>
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: C.green, boxShadow: `0 0 0 5px ${C.green}14` }}/>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: C.green }}>Assignment workspace</p>
          </div>
          <h2 className="text-xl font-bold tracking-tight" style={{ color: C.text }}>Assignments</h2>
          <p className="text-xs mt-1" style={{ color: C.faint }}>{assignments.length} learning experiences ready to manage and grade.</p>
        </div>
        <div className="flex items-center gap-2">
          {assignments.length > 0 && (
            <button onClick={() => exportAllAssignments(assignments, 'assignments_bulk')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: C.pill, color: C.muted }}>
              <Download className="w-3.5 h-3.5" /> Export All
            </button>
          )}
          {SYNC_ENABLED && assignments.length > 0 && (
            <PushAllButton
              items={assignments.map(a => ({ type: 'assignment', id: a.id }))}
              C={C}
            />
          )}
          <ImportButton
            types={['assignment']}
            C={C}
            onImported={r => { window.location.href = `/create/assignment?edit=${r.id}`; }}
            onBulkDone={() => window.location.reload()}
          />
          <Link href="/create/assignment" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-80" style={{ background: C.cta, color: C.ctaText }}>
            <Plus className="w-4 h-4"/> New
          </Link>
        </div>
      </div>
      <div className="space-y-3">
        {assignments.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className="flex items-center gap-4 p-4 rounded-2xl cursor-pointer group transition-all"
            style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? 'none' : '0 10px 28px rgba(15,23,42,0.045)' }}>
            {/* Cover / letter */}
            <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl font-black"
              style={{ background: C.thumbBg, color: C.green }}>
              {a.cover_image
                ? <img src={resolveCoverUrl(a.cover_image)} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>
                : <span style={{ opacity: 0.5 }}>{a.title?.[0]?.toUpperCase()}</span>}
            </div>
            {/* Info */}
            <button onClick={() => openAssignment(a)} className="flex-1 min-w-0 text-left" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{a.title}</p>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: a.status === 'published' ? 'rgba(16,185,129,0.1)' : C.pill, color: a.status === 'published' ? '#10b981' : C.faint }}>
                  {a.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: C.faint }}>
                <span>{(a.type || 'standard').replaceAll('_', ' ')}</span>
                <span aria-hidden="true">/</span>
                <span>{new Date(a.created_at).toLocaleDateString()}</span>
                {a.deadline_date && <><span aria-hidden="true">/</span><span>Due {new Date(a.deadline_date).toLocaleDateString()}</span></>}
              </div>
            </button>
            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href={`/create/assignment?edit=${a.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-80"
                style={{ background: C.pill, color: C.muted, textDecoration: 'none' }}>
                <Edit2 className="w-3 h-3"/> Edit
              </Link>
              <button onClick={e => { e.stopPropagation(); duplicateAssignment(a); }} disabled={duplicatingId === a.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-80"
                style={{ background: C.pill, color: C.muted, cursor: duplicatingId === a.id ? 'not-allowed' : 'pointer', opacity: duplicatingId === a.id ? 0.5 : 1 }}>
                {duplicatingId === a.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <Copy className="w-3 h-3"/>}
              </button>
              <button onClick={e => { e.stopPropagation(); exportAssignment(a); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-80"
                style={{ background: C.pill, color: C.muted }}>
                <Download className="w-3 h-3"/>
              </button>
              {SYNC_ENABLED && <PushButton type="assignment" id={a.id} C={C} />}
              <button onClick={e => { e.stopPropagation(); deleteAssignment(a.id); }} disabled={deletingId === a.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}`, cursor: deletingId === a.id ? 'not-allowed' : 'pointer', opacity: deletingId === a.id ? 0.5 : 1 }}>
                <Trash2 className="w-3 h-3"/>
              </button>
            </div>
            <ChevronDown className="w-4 h-4 flex-shrink-0 -rotate-90 group-hover:translate-x-0.5 transition-transform" style={{ color: C.faint }}/>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
