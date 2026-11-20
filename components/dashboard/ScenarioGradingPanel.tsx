'use client';

// Instructor grading surface for a scenario-based (standard) assignment submission: one card per
// scenario, and inside it every task with the student's answer AND its own score + comment. The
// submission-level score/feedback still exist (the official grade), but the marking happens here,
// task by task. Read-only when `readOnly` is set (used for a look without regrading rights).

import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, Download, MessageSquare } from 'lucide-react';
import { hasRichContent } from '@/lib/plain-text';
import { sanitizeRichText } from '@/lib/sanitize';
import { ReviewReportView } from '@/components/ReviewReportView';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { DISPLAY_FONT, Pill, palette } from '@/components/dashboard/subscriptions/ui';
import {
  TASK_TYPE_LABEL, isAiTaskType, aiTaskScoreSuggestion, clampTaskScore, hasRichText,
  type AssignmentSubmissionRecord, type TaskAnswer, type McqGrade, type TaskGradeMap,
} from '@/lib/assignment-scenarios';

// The score is held as a string while the instructor types (an empty field means "not scored");
// the comment is rich-text HTML from the editor, sanitized on save.
export interface TaskGradeDraft { score: string; feedback: string }

interface Props {
  record: AssignmentSubmissionRecord;
  mcq: Record<string, McqGrade>;
  drafts: Record<string, TaskGradeDraft>;
  onChange: (taskId: string, patch: Partial<TaskGradeDraft>) => void;
  C: typeof LIGHT_C;
  isDark: boolean;
}

interface ScenarioGroup { id: string; title: string; answers: TaskAnswer[] }

function groupByScenario(record: AssignmentSubmissionRecord): ScenarioGroup[] {
  const order: string[] = [];
  const byId: Record<string, ScenarioGroup> = {};
  for (const a of record.answers ?? []) {
    if (!byId[a.scenarioId]) { byId[a.scenarioId] = { id: a.scenarioId, title: a.scenarioTitle, answers: [] }; order.push(a.scenarioId); }
    byId[a.scenarioId].answers.push(a);
  }
  return order.map(id => byId[id]);
}

const scoreOf = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const isValid = (n: number | null) => n == null || (n >= 0 && n <= 100);

// The student's submitted work for one task, rendered read-only.
function AnswerBody({ a, mcq, C, isDark }: { a: TaskAnswer; mcq: Record<string, McqGrade>; C: typeof LIGHT_C; isDark: boolean }) {
  const empty = (text: string) => <p className="text-sm" style={{ color: C.muted }}>{text}</p>;

  if (a.type === 'text') {
    return a.text && hasRichContent(a.text)
      ? <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(a.text) }}/>
      : empty('No response.');
  }
  if (a.type === 'upload') {
    return a.fileUrl
      ? <a href={a.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold hover:opacity-70" style={{ color: C.text }}>
          <Download className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }}/>
          <span className="truncate">{a.fileName || 'Download file'}</span>
        </a>
      : empty('No file uploaded.');
  }
  if (a.type === 'mcq') {
    if (a.selectedOption == null || a.selectedOption === '') return empty('Not answered.');
    const g = mcq[a.taskId];
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" style={{ color: C.text }}>
        <span><span style={{ color: C.muted }}>Chose </span><span style={{ fontWeight: 600 }}>{a.selectedOption}</span></span>
        {g && (g.isCorrect
          ? <Pill tone="good" dot C={C}>Correct</Pill>
          : <>
              <Pill tone="bad" C={C}>Incorrect</Pill>
              {g.correctOption && <span style={{ color: C.muted }}>Correct answer: <span style={{ color: C.text, fontWeight: 600 }}>{g.correctOption}</span></span>}
            </>)}
      </div>
    );
  }
  if (isAiTaskType(a.type)) {
    return a.report
      ? <div className="space-y-2">
          <p className="text-xs" style={{ color: C.muted }}>AI feedback the student generated. Not independently verified, so confirm it against the submitted work before scoring.</p>
          <ReviewReportView rec={{ type: a.type, report: a.report, imageUrl: a.imageUrl }} isDark={isDark}/>
        </div>
      : empty('AI review not run.');
  }
  return null;
}

// Score + comment for a single task.
function TaskGradeFields({ a, draft, onChange, C }: { a: TaskAnswer; draft: TaskGradeDraft; onChange: (patch: Partial<TaskGradeDraft>) => void; C: typeof LIGHT_C }) {
  // The rich-text editor mounts only once a comment is wanted, so a long submission does not
  // spin up one editor per task up front.
  const [showComment, setShowComment] = useState(hasRichText(draft.feedback));
  const value = scoreOf(draft.score);
  const valid = isValid(value);
  const suggestion = aiTaskScoreSuggestion(a);

  const P = palette(C);
  const chip = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick}
      className="h-8 px-3 rounded-[10px] text-xs font-semibold hover:opacity-75 transition-opacity"
      style={{ background: C.pill, color: C.muted, border: 'none', cursor: 'pointer' }}>
      {label}
    </button>
  );

  return (
    <div className="mt-3">
      <div className="flex items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={100} value={draft.score} onChange={e => onChange({ score: e.target.value })}
            placeholder="--" aria-label={`Score for ${a.taskTitle || 'this task'}`}
            className="field-focus [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ width: 72, height: 40, borderRadius: 10, border: `1px solid ${valid ? C.inputBorder : P.bad}`, background: C.input, color: C.text, fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}/>
          <span className="text-xs" style={{ color: C.muted }}>/ 100</span>
        </div>
        {suggestion != null && chip(`Use AI score (${suggestion})`, () => onChange({ score: String(suggestion) }))}
        {draft.score !== '' && chip('Clear', () => onChange({ score: '' }))}
        {!showComment && (
          <button type="button" onClick={() => setShowComment(true)}
            className="inline-flex items-center gap-2 text-xs font-semibold ml-auto underline underline-offset-2 hover:opacity-75"
            style={{ background: 'none', color: C.text, border: 'none', cursor: 'pointer' }}>
            <MessageSquare className="w-3.5 h-3.5"/> Add comment
          </button>
        )}
      </div>
      {!valid && (
        <p className="flex items-center gap-2 text-xs mt-2" style={{ color: P.bad }}>
          <AlertCircle className="w-3.5 h-3.5"/> Score must be between 0 and 100.
        </p>
      )}
      {showComment && (
        <div className="mt-3">
          <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Comment on this task</p>
          <div style={{ borderRadius: 10, border: `1px solid ${C.inputBorder}`, overflow: 'hidden' }}>
            <RichTextEditor value={draft.feedback} onChange={html => onChange({ feedback: html })}
              placeholder="What was strong, what to fix. The student sees this beside this task."
              bgOverride={C.input} enableAiAssist/>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScenarioGradingPanel({ record, mcq, drafts, onChange, C, isDark }: Props) {
  const P = palette(C);
  const groups = groupByScenario(record);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const drafted = group.answers.map(a => drafts[a.taskId] ?? { score: '', feedback: '' });
        const scores = drafted.map(d => scoreOf(d.score)).filter((n): n is number => n != null);
        const avg = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
        const isCollapsed = collapsed.has(group.id);
        return (
          <div key={group.id} className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
            {/* Scenario header */}
            <button type="button" onClick={() => toggle(group.id)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: C.muted, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}/>
              <div className="min-w-0 flex-1">
                <p className="text-xs" style={{ color: C.muted }}>Scenario {gi + 1}</p>
                <p className="text-base font-semibold truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{group.title || 'Scenario'}</p>
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: C.muted }}>
                {scores.length} of {group.answers.length} scored{avg != null ? `, average ${avg}%` : ''}
              </span>
            </button>

            {!isCollapsed && (
              <div>
                {group.answers.map((a, ti) => {
                  const draft = drafts[a.taskId] ?? { score: '', feedback: '' };
                  const value = scoreOf(draft.score);
                  return (
                    <div key={a.taskId} className="px-5 py-4" style={{ borderTop: `1px solid ${C.divider}` }}>
                      {/* Task header */}
                      <div className="flex items-start gap-3 mb-3">
                        <span className="flex items-center justify-center flex-shrink-0 text-xs font-bold rounded-lg" style={{ width: 24, height: 24, background: value != null ? P.good : C.pill, color: value != null ? '#FFFFFF' : C.muted }}>
                          {value != null ? <Check className="w-3 h-3" strokeWidth={3}/> : ti + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold" style={{ color: C.text }}>{a.taskTitle || `Task ${ti + 1}`}</p>
                          <p className="text-xs" style={{ color: C.muted }}>{TASK_TYPE_LABEL[a.type]}</p>
                        </div>
                      </div>

                      {/* Student answer */}
                      <div className="rounded-xl px-4 py-3" style={{ background: C.page }}>
                        <AnswerBody a={a} mcq={mcq} C={C} isDark={isDark}/>
                      </div>

                      {/* Grading */}
                      <TaskGradeFields a={a} draft={draft} onChange={patch => onChange(a.taskId, patch)} C={C}/>
                    </div>
                  );
                })}
                {group.answers.length === 0 && (
                  <p className="px-5 py-5 text-sm" style={{ color: C.muted, borderTop: `1px solid ${C.divider}` }}>No tasks in this scenario.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Score parsing/validation, shared with the section that owns the drafts and saves them.
export const taskScoreValue = scoreOf;
export const taskScoreValid = isValid;

// Drafts (string scores as typed, rich-text comments) -> the stored per-task grade map. Tasks with
// neither a score nor a comment are dropped, so "graded" stays meaningful; an out-of-range/garbage
// score is stored as unscored (saveGrade blocks on it before this is ever written).
// `sanitize` is passed on the save path only -- the live stats recompute on every keystroke and
// do not need to run the sanitizer.
export function draftsToTaskGrades(
  drafts: Record<string, TaskGradeDraft>,
  sanitize?: (html: string) => string,
): TaskGradeMap {
  const out: TaskGradeMap = {};
  for (const [taskId, d] of Object.entries(drafts)) {
    const raw = scoreOf(d.score);
    const score = raw != null && isValid(raw) ? clampTaskScore(raw) : null;
    if (score == null && !hasRichText(d.feedback)) continue;
    const clean = hasRichText(d.feedback) ? (sanitize ? sanitize(d.feedback) : d.feedback) : '';
    // Sanitizing can empty a comment out (markup only); then there is nothing left to store.
    const feedback = hasRichText(clean) ? clean : '';
    if (score == null && !feedback) continue;
    out[taskId] = feedback ? { score, feedback } : { score };
  }
  return out;
}
