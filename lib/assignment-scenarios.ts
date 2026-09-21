// Shared contract for the reworked "standard" assignment: an assignment is built as
// SCENARIOS, and each scenario holds one or more TASKS. Each task is one option/type
// (written response, file upload, multiple choice, or an inline AI review). This is the
// virtual-experience authoring model, renamed to scenarios/tasks and rendered plainly:
// the student works through the tasks in any order (no gating), submits everything at
// once, and the instructor reviews and grades -- exactly like a normal assignment.
//
// Pure module (no React / component imports) so the authoring UI, the student player, and
// the instructor grading view can all agree on one shape without a module cycle.

import type { LessonDoc } from '@/lib/lesson-doc';

// -- Authoring model (stored in assignments.config.scenarios) ----------------------------
//
// Rich content (scenario intros, task instructions, the assignment overview) uses the VE
// interactive editor: it is stored as a canonical `doc` (LessonDoc: images, carousel, steps,
// callouts, tabs, accordions, tables, runnable code, ...) with a sanitized HTML `*Body`
// fallback for legacy/plain rendering. Render `doc` with LessonRenderer when present.

export type AssignmentTaskType =
  | 'text'        // written rich-text response
  | 'upload'      // plain file upload (no AI) -- instructor opens it
  | 'mcq'         // multiple choice, auto right/wrong -> preliminary score
  | 'code_review' // inline AI review of pasted/uploaded code
  | 'excel_review'
  | 'dashboard_critique'
  | 'document_review';

export interface AssignmentTask {
  id: string;
  type: AssignmentTaskType;
  title: string;
  doc?: LessonDoc;                   // interactive instructions (VE editor)
  description?: string;              // HTML fallback of `doc`
  // mcq
  options?: string[];
  correctAnswer?: string;            // the correct option's text (instructor-set)
  // AI-review settings (mirror the review players' props)
  rubric?: string[];
  schema?: string;                   // code_review (SQL schema)
  context?: string;                  // excel_review / document_review
  reviewSheetNames?: string[];       // excel_review
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
}

export interface AssignmentScenario {
  id: string;
  title: string;
  doc?: LessonDoc;                   // interactive intro/context (VE editor)
  description?: string;              // HTML fallback of `doc`
  tasks: AssignmentTask[];
}

export interface ScenarioConfig {
  scenarios: AssignmentScenario[];
  introDoc?: LessonDoc;              // assignment-level overview (VE editor)
  introBody?: string;               // HTML fallback of `introDoc`
}

export const AI_TASK_TYPES: AssignmentTaskType[] = [
  'code_review', 'excel_review', 'dashboard_critique', 'document_review',
];

export function isAiTaskType(t: AssignmentTaskType): boolean {
  return AI_TASK_TYPES.includes(t);
}

// True when an assignment's config carries the scenarios structure (a new-style assignment).
// Old standard assignments (brief + free submission) have no config.scenarios and fall back
// to the legacy submission panel.
export function isScenarioConfig(config: any): config is ScenarioConfig {
  return !!config && Array.isArray(config.scenarios) && config.scenarios.length > 0;
}

// A short, human label for each task type (builder chips + student headings).
export const TASK_TYPE_LABEL: Record<AssignmentTaskType, string> = {
  text:               'Written response',
  upload:             'File upload',
  mcq:                'Multiple choice',
  code_review:        'Code review (AI)',
  excel_review:       'Excel review (AI)',
  dashboard_critique: 'Dashboard critique (AI)',
  document_review:    'Document review (AI)',
};

// -- Submission record (stored as assignment_submissions.response_text JSON) -------------
//
// One record per submission, holding every task's answer. Detected by `format: 'scenarios'`
// so the instructor grading view can render each task; the pending score is the mean of the
// auto-scored tasks (MCQ 100/0 + AI overallScore), left for the instructor to confirm.

export interface TaskAnswer {
  scenarioId: string;
  scenarioTitle: string;
  taskId: string;
  taskTitle: string;
  type: AssignmentTaskType;
  // written
  text?: string;
  // upload
  fileUrl?: string;
  fileName?: string;
  // mcq
  selectedOption?: string;
  correctOption?: string;
  isCorrect?: boolean;
  // AI review
  report?: any;
  imageUrl?: string;          // dashboard_critique screenshot
  // auto score for this task (null/undefined when unscored, e.g. text/upload)
  score?: number | null;
}

export interface AssignmentSubmissionRecord {
  format: 'scenarios';
  submittedAt: string;
  answers: TaskAnswer[];
  pendingScore: number | null;
}

// Parse response_text into a scenarios submission record, or null if it is not one
// (legacy rich-text / single AI-review responses return null and are handled elsewhere).
export function parseSubmissionRecord(notes?: string | null): AssignmentSubmissionRecord | null {
  if (!notes) return null;
  let p: any;
  try { p = JSON.parse(notes); } catch { return null; }
  if (p && typeof p === 'object' && p.format === 'scenarios' && Array.isArray(p.answers)) {
    return p as AssignmentSubmissionRecord;
  }
  return null;
}

// Preliminary score = mean of the auto-scored tasks (MCQ + AI). Null when nothing is
// auto-scored (a purely written/upload assignment is graded entirely by the instructor).
export function computePendingScore(answers: TaskAnswer[]): number | null {
  const scored = answers.filter(a => typeof a.score === 'number');
  if (!scored.length) return null;
  const total = scored.reduce((sum, a) => sum + (a.score as number), 0);
  return Math.round(total / scored.length);
}

// Every task the student must engage with, flattened in display order. Used to compute
// "answered N of M" progress and to build the submission record deterministically.
export function flattenTasks(config: ScenarioConfig): Array<{ scenario: AssignmentScenario; task: AssignmentTask }> {
  return (config.scenarios ?? []).flatMap(scenario =>
    (scenario.tasks ?? []).map(task => ({ scenario, task })));
}

// -- Authoring validation ----------------------------------------------------------------
// Shared by the create UI (block publish, show messages) and any server write path.
// Returns a list of human-readable errors; empty means valid.
export function validateScenarioConfig(config: ScenarioConfig | null | undefined): string[] {
  const errors: string[] = [];
  const scenarios = config?.scenarios ?? [];
  if (scenarios.length === 0) { errors.push('Add at least one scenario.'); return errors; }
  let totalTasks = 0;
  scenarios.forEach((s, si) => {
    const label = `Scenario ${si + 1}`;
    if (!s.title?.trim()) errors.push(`${label} needs a title.`);
    if (!s.tasks || s.tasks.length === 0) { errors.push(`${label} has no tasks.`); return; }
    s.tasks.forEach((t, ti) => {
      totalTasks++;
      const tlabel = `${label}, task ${ti + 1}`;
      if (!t.title?.trim()) errors.push(`${tlabel} needs a title.`);
      if (t.type === 'mcq') {
        const opts = (t.options ?? []).map(o => o.trim()).filter(Boolean);
        if (opts.length < 2) errors.push(`${tlabel} needs at least two options.`);
        if (new Set(opts).size !== opts.length) errors.push(`${tlabel} has duplicate options.`);
        if (!t.correctAnswer || !opts.includes(t.correctAnswer.trim())) errors.push(`${tlabel} needs a correct answer selected.`);
      }
      if ((t.type === 'code_review' || t.type === 'excel_review' || t.type === 'document_review') && t.minScore != null) {
        if (!(t.minScore >= 1 && t.minScore <= 100)) errors.push(`${tlabel} pass score must be between 1 and 100.`);
      }
    });
  });
  if (totalTasks === 0) errors.push('Add at least one task.');
  return errors;
}

// -- Answer keys (server-only) -----------------------------------------------------------
// MCQ correct answers must never reach the student browser; they are stored in
// assignment_answer_keys and stripped from the config saved on the assignment row.
export function extractAnswerKeys(scenarios: AssignmentScenario[]): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const s of scenarios ?? []) {
    for (const t of s.tasks ?? []) {
      if (t.type === 'mcq' && t.correctAnswer != null) keys[t.id] = t.correctAnswer;
    }
  }
  return keys;
}
export function stripAnswerKeys(scenarios: AssignmentScenario[]): AssignmentScenario[] {
  return (scenarios ?? []).map(s => ({
    ...s,
    tasks: (s.tasks ?? []).map(t => {
      if (t.type !== 'mcq') return t;
      const copy: AssignmentTask = { ...t };
      delete copy.correctAnswer;
      return copy;
    }),
  }));
}

// -- Server-side submission record --------------------------------------------------------
// The raw answers a student submits. NO score, correctness, or answer keys are trusted from
// the client -- those are derived server-side (MCQ) or instructor-set (final grade).
export interface RawTaskAnswer {
  taskId: string;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  selectedOption?: string;
  report?: any;
  imageUrl?: string;
}

// Build the stored record from raw answers. Student-readable, so it deliberately omits
// correctOption/isCorrect (revealing those would leak the key + allow resubmit-gaming) and
// stores no auto score. AI reports are kept as advisory (instructor verifies).
export function buildScenarioRecord(
  config: ScenarioConfig,
  raw: RawTaskAnswer[],
  sanitizeText: (html: string) => string = (s) => s,
  submittedAt = new Date().toISOString(),
): AssignmentSubmissionRecord {
  const byId = new Map<string, RawTaskAnswer>((raw ?? []).map(r => [r.taskId, r]));
  const answers: TaskAnswer[] = flattenTasks(config).map(({ scenario, task }) => {
    const r: RawTaskAnswer = byId.get(task.id) ?? { taskId: task.id };
    const base: TaskAnswer = { scenarioId: scenario.id, scenarioTitle: scenario.title, taskId: task.id, taskTitle: task.title, type: task.type };
    if (task.type === 'text') return { ...base, text: r.text ? sanitizeText(r.text) : '' };
    if (task.type === 'upload') return { ...base, fileUrl: r.fileUrl, fileName: r.fileName };
    if (task.type === 'mcq') return { ...base, selectedOption: r.selectedOption };
    return { ...base, report: r.report, imageUrl: r.imageUrl };
  });
  return { format: 'scenarios', submittedAt, answers, pendingScore: null };
}

// -- Upload allowlist (shared by the player and the server endpoint) ---------------------
// Matches the standard assignment uploader. Client `accept` is UX only; the server enforces.
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.csv', '.tsv', '.txt', '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx',
  '.zip', '.pbix', '.pbip',
]);
export function uploadExtOf(name: string): string {
  const clean = (name || '').split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot).toLowerCase() : '';
}
export function isAllowedUpload(name: string): boolean {
  return ALLOWED_UPLOAD_EXTENSIONS.has(uploadExtOf(name));
}

// -- Instructor-side MCQ grading (uses the server-only keys) ------------------------------
export interface McqGrade { taskId: string; selected?: string; correctOption?: string; isCorrect: boolean; answered: boolean; }

export function gradeMcq(record: AssignmentSubmissionRecord, keys: Record<string, string>): { grades: Record<string, McqGrade>; subtotal: number | null } {
  const grades: Record<string, McqGrade> = {};
  const scores: number[] = [];
  for (const a of record.answers ?? []) {
    if (a.type !== 'mcq') continue;
    const correctOption = keys[a.taskId];
    const answered = a.selectedOption != null && a.selectedOption !== '';
    const isCorrect = answered && correctOption != null && a.selectedOption === correctOption;
    grades[a.taskId] = { taskId: a.taskId, selected: a.selectedOption, correctOption, isCorrect, answered };
    if (answered) scores.push(isCorrect ? 100 : 0);
  }
  const subtotal = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
  return { grades, subtotal };
}

// -- Per-task grading (instructor-set) ----------------------------------------------------
// A scenario assignment is graded task by task: the instructor scores each task out of 100 and
// leaves a comment on it. Stored on assignment_submissions.task_grades (migration 143) as
// { "<taskId>": { score, feedback } }; grader-only (the DB trigger blocks student writes). The
// final grade on the submission is the mean of the scored tasks unless the instructor overrides
// it, and the student sees each task's score + comment beside their own answer.

export interface TaskGrade {
  score: number | null;   // 0-100, null = not scored
  feedback?: string;      // rich-text comment for this task (sanitized HTML)
}
export type TaskGradeMap = Record<string, TaskGrade>;

// Cap on a single task comment, counted in HTML characters (markup included).
export const MAX_TASK_FEEDBACK = 8000;

// The submission passing grade (0-100). Instructors set it per assignment via config.passingScore;
// it falls back to DEFAULT_PASS_MARK when unset. This is the ONE authoritative rule for "did the
// submission pass" -- used by resubmit, solution release, grade notifications, the RLS release policy
// (which reads config->>'passingScore' with the same default), and pass/fail display. NOTE: this is
// distinct from a task's minScore, which is the per-AI-review threshold inside the review players.
export const DEFAULT_PASS_MARK = 85;
export function passMarkOf(config: any): number {
  const v = config?.passingScore;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 100 ? v : DEFAULT_PASS_MARK;
}

// Whether a rich-text value carries anything: text, or a media/table node that strips to nothing.
export function hasRichText(html?: string | null): boolean {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return text.length > 0 || /<(img|iframe|table|video|hr)\b/i.test(html);
}

// Clamp to the 0-100 range the score input allows, at 2dp (score is numeric(5,2)).
export function clampTaskScore(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

// Tolerant read of the stored column (jsonb object, or a JSON string on older rows). Entries with
// neither a score nor a comment are dropped so "has this task been graded" stays meaningful.
export function parseTaskGrades(raw: any): TaskGradeMap {
  if (!raw) return {};
  let p: any = raw;
  if (typeof raw === 'string') { try { p = JSON.parse(raw); } catch { return {}; } }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const out: TaskGradeMap = {};
  for (const [taskId, v] of Object.entries<any>(p)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const score = typeof v.score === 'number' && Number.isFinite(v.score) ? clampTaskScore(v.score) : null;
    const feedback = typeof v.feedback === 'string' ? v.feedback : '';
    if (score == null && !hasRichText(feedback)) continue;
    out[taskId] = hasRichText(feedback) ? { score, feedback } : { score };
  }
  return out;
}

// Grading progress + the suggested final grade: the mean of the scored tasks, counting only tasks
// that are actually in this submission (a stale taskId from an edited assignment is ignored).
export function taskGradeStats(answers: TaskAnswer[], grades: TaskGradeMap): {
  total: number; scored: number; commented: number; average: number | null;
} {
  const list = answers ?? [];
  const scores: number[] = [];
  let commented = 0;
  for (const a of list) {
    const g = grades[a.taskId];
    if (!g) continue;
    if (typeof g.score === 'number') scores.push(g.score);
    if (hasRichText(g.feedback)) commented++;
  }
  return {
    total: list.length,
    scored: scores.length,
    commented,
    average: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
  };
}

// MCQ is graded server-side from the answer key, so its per-task score is authoritative and
// prefills the input (an unanswered MCQ scores 0).
export function mcqTaskScore(answer: TaskAnswer, grade?: McqGrade): number | null {
  if (answer.type !== 'mcq' || !grade) return null;
  if (!grade.answered) return 0;
  return grade.isCorrect ? 100 : 0;
}

// An AI report's overall score is advisory only, so it is offered as a suggestion the instructor
// applies deliberately rather than prefilled.
export function aiTaskScoreSuggestion(answer: TaskAnswer): number | null {
  const r: any = answer.report;
  if (!r) return null;
  const n = typeof r.overallScore === 'number' ? r.overallScore
    : typeof r?.audit?.overallScore === 'number' ? r.audit.overallScore
    : null;
  return n == null || !Number.isFinite(n) ? null : clampTaskScore(n);
}
