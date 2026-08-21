'use client';

// The scenarios/tasks builder for a Standard assignment. An assignment is a list of
// SCENARIOS (each a titled section with a rich intro); inside a scenario you add TASKS,
// each of a chosen type (written response, upload, MCQ, or an inline AI review). Plain,
// open, ungated at runtime -- this component only authors the structure.

import { useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { LIGHT_C } from '@/lib/theme';
import { TaskFields } from '@/components/create/TaskFields';
import {
  Plus, Trash2, ChevronDown, ChevronUp, ArrowUp, ArrowDown,
  PenLine, Upload, ListChecks, Code2, FileSpreadsheet, LayoutDashboard, FileText,
} from 'lucide-react';
import type { AssignmentScenario, AssignmentTask, AssignmentTaskType } from '@/lib/assignment-scenarios';
import { TASK_TYPE_LABEL } from '@/lib/assignment-scenarios';

const TASK_PALETTE: { type: AssignmentTaskType; icon: React.ReactNode; description: string; group: 'Learner responses' | 'AI reviews' }[] = [
  { type: 'text', icon: <PenLine style={{ width: 18, height: 18 }} />, description: 'Collect a structured written response.', group: 'Learner responses' },
  { type: 'upload', icon: <Upload style={{ width: 18, height: 18 }} />, description: 'Let learners submit a file for review.', group: 'Learner responses' },
  { type: 'mcq', icon: <ListChecks style={{ width: 18, height: 18 }} />, description: 'Create an automatically marked question.', group: 'Learner responses' },
  { type: 'code_review', icon: <Code2 style={{ width: 18, height: 18 }} />, description: 'Review SQL or code against a rubric.', group: 'AI reviews' },
  { type: 'excel_review', icon: <FileSpreadsheet style={{ width: 18, height: 18 }} />, description: 'Assess spreadsheet logic and quality.', group: 'AI reviews' },
  { type: 'dashboard_critique', icon: <LayoutDashboard style={{ width: 18, height: 18 }} />, description: 'Critique a dashboard screenshot.', group: 'AI reviews' },
  { type: 'document_review', icon: <FileText style={{ width: 18, height: 18 }} />, description: 'Evaluate a document or report.', group: 'AI reviews' },
];

const TASK_GROUPS = ['Learner responses', 'AI reviews'] as const;

function newTask(type: AssignmentTaskType): AssignmentTask {
  const base: AssignmentTask = { id: crypto.randomUUID(), type, title: '' };
  if (type === 'mcq') base.options = ['', ''];
  if (type === 'code_review' || type === 'excel_review' || type === 'document_review') base.minScore = 70;
  return base;
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ScenariosEditor({ scenarios, onChange, C, embedded = false }: {
  scenarios: AssignmentScenario[];
  onChange: (scenarios: AssignmentScenario[]) => void;
  C: typeof LIGHT_C;
  embedded?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [openScenarios, setOpenScenarios] = useState<Set<string>>(() => new Set(scenarios.map(s => s.id)));
  const [openTasks, setOpenTasks] = useState<Set<string>>(new Set());
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const updateScenario = (id: string, updates: Partial<AssignmentScenario>) =>
    onChange(scenarios.map(s => s.id === id ? { ...s, ...updates } : s));

  const addScenario = () => {
    const s: AssignmentScenario = { id: crypto.randomUUID(), title: '', description: '', tasks: [] };
    onChange([...scenarios, s]);
    setOpenScenarios(prev => new Set(prev).add(s.id));
  };
  const removeScenario = (id: string) => onChange(scenarios.filter(s => s.id !== id));
  const moveScenario = (idx: number, dir: -1 | 1) => onChange(moveItem(scenarios, idx, idx + dir));

  const addTask = (scenarioId: string, type: AssignmentTaskType) => {
    const task = newTask(type);
    onChange(scenarios.map(s => s.id === scenarioId ? { ...s, tasks: [...s.tasks, task] } : s));
    setOpenTasks(prev => new Set(prev).add(task.id));
    setAddingFor(null);
  };
  const updateTask = (scenarioId: string, taskId: string, updates: Partial<AssignmentTask>) =>
    onChange(scenarios.map(s => s.id === scenarioId
      ? { ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t) }
      : s));
  const removeTask = (scenarioId: string, taskId: string) =>
    onChange(scenarios.map(s => s.id === scenarioId ? { ...s, tasks: s.tasks.filter(t => t.id !== taskId) } : s));
  const moveTask = (scenarioId: string, idx: number, dir: -1 | 1) =>
    onChange(scenarios.map(s => s.id === scenarioId ? { ...s, tasks: moveItem(s.tasks, idx, idx + dir) } : s));

  const iconBtn = (onClick: () => void, disabled: boolean, children: React.ReactNode, title: string) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, border: 'none', background: C.pill, color: C.faint, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );

  return (
    <section style={embedded
      ? { background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, margin: 0 }
      : { background: C.card, borderRadius: 20, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? 'none' : '0 14px 38px rgba(15,23,42,0.05)', padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>Scenarios & Tasks</h2>
        <button type="button" onClick={addScenario}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: C.cta, color: C.ctaText, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus style={{ width: 14, height: 14 }} /> Add scenario
        </button>
      </div>
      <p style={{ fontSize: 12, color: C.faint, marginTop: 0, marginBottom: 18 }}>
        Add scenarios, and inside each one add tasks of any kind. Students can work through them in any order and submit everything for your review.
      </p>

      {scenarios.length === 0 && (
        <div style={{ textAlign: 'center', padding: '34px 18px', borderRadius: 16, background: C.page, color: C.faint, fontSize: 13 }}>
          <div style={{ width: 38, height: 38, margin: '0 auto 10px', borderRadius: 12, display: 'grid', placeItems: 'center', background: `${C.cta}12`, color: C.cta }}><Plus style={{ width: 18, height: 18 }}/></div>
          <strong style={{ display: 'block', color: C.text, fontSize: 13, marginBottom: 4 }}>Build the first scenario</strong>
          Add context, then combine written, upload, quiz, and AI review tasks.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {scenarios.map((scenario, sIdx) => {
          const open = openScenarios.has(scenario.id);
          return (
            <div key={scenario.id} style={{ borderRadius: 16, border: `1px solid ${C.divider}`, background: C.page, overflow: 'hidden' }}>
              {/* Scenario header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12 }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: `${C.cta}14`, color: C.cta, fontSize: 12, fontWeight: 800 }}>{sIdx + 1}</span>
                <input
                  value={scenario.title}
                  onChange={e => updateScenario(scenario.id, { title: e.target.value })}
                  placeholder="Scenario title (e.g. Investigate the churn spike)"
                  style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.card, color: C.text, fontSize: 14, fontWeight: 650, outline: 'none' }}
                  maxLength={200}
                />
                {iconBtn(() => moveScenario(sIdx, -1), sIdx === 0, <ArrowUp style={{ width: 14, height: 14 }} />, 'Move up')}
                {iconBtn(() => moveScenario(sIdx, 1), sIdx === scenarios.length - 1, <ArrowDown style={{ width: 14, height: 14 }} />, 'Move down')}
                {iconBtn(() => removeScenario(scenario.id), false, <Trash2 style={{ width: 14, height: 14 }} />, 'Delete scenario')}
                {iconBtn(() => toggle(openScenarios, setOpenScenarios, scenario.id), false, open ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />, open ? 'Collapse' : 'Expand')}
              </div>

              {open && (
                <div style={{ padding: '0 12px 14px' }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 5 }}>Scenario intro <span style={{ fontWeight: 400, color: C.faint }}>(optional)</span></label>
                    <LessonEditor
                      doc={scenario.doc}
                      bodyFallback={scenario.description}
                      onChange={({ doc, body }) => updateScenario(scenario.id, { doc, description: body })}
                      placeholder="Set the context for this scenario. Add images, steps, callouts, tables..."
                      isDark={isDark}
                      accentColor={C.cta}
                    />
                  </div>

                  {/* Tasks */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {scenario.tasks.map((task, tIdx) => {
                      const tOpen = openTasks.has(task.id);
                      const taskMeta = TASK_PALETTE.find(item => item.type === task.type);
                      return (
                        <div key={task.id} style={{ borderRadius: 13, border: `1px solid ${C.divider}`, background: C.card, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10 }}>
                            <span style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 10, background: `${C.cta}12`, color: C.cta }}>
                              {taskMeta?.icon}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 10, fontWeight: 800, color: C.cta, letterSpacing: '.06em', textTransform: 'uppercase' }}>{TASK_TYPE_LABEL[task.type]}</span>
                              <span style={{ display: 'block', marginTop: 2, fontSize: 13, fontWeight: 650, color: task.title ? C.text : C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title || 'Untitled task'}</span>
                            </span>
                            {iconBtn(() => moveTask(scenario.id, tIdx, -1), tIdx === 0, <ArrowUp style={{ width: 13, height: 13 }} />, 'Move up')}
                            {iconBtn(() => moveTask(scenario.id, tIdx, 1), tIdx === scenario.tasks.length - 1, <ArrowDown style={{ width: 13, height: 13 }} />, 'Move down')}
                            {iconBtn(() => removeTask(scenario.id, task.id), false, <Trash2 style={{ width: 13, height: 13 }} />, 'Delete task')}
                            {iconBtn(() => toggle(openTasks, setOpenTasks, task.id), false, tOpen ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />, tOpen ? 'Collapse' : 'Expand')}
                          </div>
                          {tOpen && (
                            <div style={{ padding: '4px 12px 14px', borderTop: `1px solid ${C.divider}` }}>
                              <TaskFields task={task} onChange={u => updateTask(scenario.id, task.id, u)} C={C} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add task */}
                  {addingFor === scenario.id ? (
                    <div style={{ marginTop: 10, padding: 16, borderRadius: 16, border: `1px solid ${C.cardBorder}`, background: C.card }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 750, color: C.text }}>Choose a task type</span>
                          <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: C.faint }}>Select how learners will respond or receive feedback.</span>
                        </div>
                        <button type="button" onClick={() => setAddingFor(null)} style={{ fontSize: 12, color: C.faint, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                      </div>
                      {TASK_GROUPS.map(group => (
                        <div key={group} style={{ marginTop: 14 }}>
                          <p style={{ margin: '0 0 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.faint }}>{group}</p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                            {TASK_PALETTE.filter(item => item.group === group).map(({ type, icon, description }) => (
                              <button key={type} type="button" onClick={() => addTask(scenario.id, type)}
                                style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 72, padding: '11px 12px', textAlign: 'left', borderRadius: 12, border: `1px solid ${C.divider}`, background: C.page, color: C.text, cursor: 'pointer', transition: 'border-color .15s ease, background .15s ease, transform .15s ease' }}>
                                <span style={{ width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 11, background: `${C.cta}12`, color: C.cta }}>{icon}</span>
                                <span style={{ minWidth: 0 }}>
                                  <strong style={{ display: 'block', fontSize: 12.5, lineHeight: 1.25 }}>{TASK_TYPE_LABEL[type]}</strong>
                                  <span style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.35, color: C.faint }}>{description}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingFor(scenario.id)}
                      style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: `1px dashed ${C.cardBorder}`, background: C.card, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                      <Plus style={{ width: 14, height: 14 }} /> Add task
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
