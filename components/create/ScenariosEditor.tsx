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
  Plus, Trash2, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown,
  PenLine, Upload, ListChecks, Code2, FileSpreadsheet, LayoutDashboard, FileText,
} from 'lucide-react';
import { FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import type { AssignmentScenario, AssignmentTask, AssignmentTaskType } from '@/lib/assignment-scenarios';
import { TASK_TYPE_LABEL } from '@/lib/assignment-scenarios';

const TASK_PALETTE: { type: AssignmentTaskType; icon: React.ReactNode; description: string; group: 'Learner responses' | 'AI reviews' }[] = [
  { type: 'text', icon: <PenLine style={{ width: 16, height: 16 }} />, description: 'A structured written answer', group: 'Learner responses' },
  { type: 'upload', icon: <Upload style={{ width: 16, height: 16 }} />, description: 'A file for you to review', group: 'Learner responses' },
  { type: 'mcq', icon: <ListChecks style={{ width: 16, height: 16 }} />, description: 'Marked automatically', group: 'Learner responses' },
  { type: 'code_review', icon: <Code2 style={{ width: 16, height: 16 }} />, description: 'SQL or code against a rubric', group: 'AI reviews' },
  { type: 'excel_review', icon: <FileSpreadsheet style={{ width: 16, height: 16 }} />, description: 'Spreadsheet logic and quality', group: 'AI reviews' },
  { type: 'dashboard_critique', icon: <LayoutDashboard style={{ width: 16, height: 16 }} />, description: 'A dashboard screenshot', group: 'AI reviews' },
  { type: 'document_review', icon: <FileText style={{ width: 16, height: 16 }} />, description: 'A document or report', group: 'AI reviews' },
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
  onChange: React.Dispatch<React.SetStateAction<AssignmentScenario[]>>;
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
  const updateTask = (
    scenarioId: string,
    taskId: string,
    updates: Partial<AssignmentTask> | ((task: AssignmentTask) => Partial<AssignmentTask>),
  ) => onChange(current => current.map(s => s.id === scenarioId
    ? {
        ...s,
        tasks: s.tasks.map(task => task.id === taskId
          ? { ...task, ...(typeof updates === 'function' ? updates(task) : updates) }
          : task),
      }
    : s));
  const removeTask = (scenarioId: string, taskId: string) =>
    onChange(scenarios.map(s => s.id === scenarioId ? { ...s, tasks: s.tasks.filter(t => t.id !== taskId) } : s));
  const moveTask = (scenarioId: string, idx: number, dir: -1 | 1) =>
    onChange(scenarios.map(s => s.id === scenarioId ? { ...s, tasks: moveItem(s.tasks, idx, idx + dir) } : s));

  const P = palette(C);
  const iconBtn = (onClick: () => void, disabled: boolean, children: React.ReactNode, title: string, danger = false) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80 disabled:opacity-30"
      style={danger ? { background: P.badSoft, color: P.bad } : { color: C.muted }}>
      {children}
    </button>
  );
  const iconChip = (icon: React.ReactNode) => (
    <span className="w-[34px] h-[34px] rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>{icon}</span>
  );

  return (
    <section className={embedded ? 'grid gap-3.5' : 'grid gap-3.5 p-5 rounded-2xl'} style={embedded ? undefined : { background: C.card }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold" style={{ color: C.text }}>Scenarios and tasks</h3>
        <button type="button" onClick={addScenario} className={btnSmClass} style={btnStyle('sec', C)}>
          <Plus className="w-3.5 h-3.5" /> Add scenario
        </button>
      </div>
      <p className="text-xs -mt-1.5" style={{ color: C.muted }}>
        Learners can work through them in any order and submit everything for review.
      </p>

      {scenarios.length === 0 && (
        <div className="px-4 py-8 rounded-xl text-center text-sm" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
          <strong className="block font-semibold mb-1" style={{ color: C.text }}>Build the first scenario</strong>
          Add context, then combine written, upload, quiz and AI review tasks.
        </div>
      )}

      {scenarios.map((scenario, sIdx) => {
        const open = openScenarios.has(scenario.id);
        return (
          <div key={scenario.id} className="rounded-[14px]" style={{ background: C.page }}>
            {/* Scenario header */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 px-3 py-2.5">
              <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{sIdx + 1}</span>
              <input
                value={scenario.title}
                onChange={e => updateScenario(scenario.id, { title: e.target.value })}
                placeholder="Scenario title, for example Investigate the churn spike"
                aria-label="Scenario title"
                className={`${FIELD} min-w-0 flex-1 basis-[180px]`}
                style={{ ...inputStyle(C), background: C.card }}
                maxLength={200}
              />
              <span className="text-xs flex-shrink-0" style={{ color: C.muted }}>{scenario.tasks.length} {scenario.tasks.length === 1 ? 'task' : 'tasks'}</span>
              {iconBtn(() => moveScenario(sIdx, -1), sIdx === 0, <ChevronUp className="w-4 h-4" />, 'Move up')}
              {iconBtn(() => moveScenario(sIdx, 1), sIdx === scenarios.length - 1, <ChevronDown className="w-4 h-4" />, 'Move down')}
              {iconBtn(() => removeScenario(scenario.id), false, <Trash2 className="w-4 h-4" />, 'Delete scenario', true)}
              {iconBtn(() => toggle(openScenarios, setOpenScenarios, scenario.id), false, open ? <ChevronsDownUp className="w-4 h-4" /> : <ChevronsUpDown className="w-4 h-4" />, open ? 'Collapse' : 'Expand')}
            </div>

            {open && (
              <div className="px-3 pb-3 grid gap-2.5">
                <div>
                  <span className="text-xs font-semibold mb-2 block" style={{ color: C.muted }}>Scenario intro (optional)</span>
                  {/* White behind the editor, so it does not sink into the grey block. */}
                  <div className="rounded-xl" style={{ background: C.card }}>
                    <LessonEditor
                      doc={scenario.doc}
                      bodyFallback={scenario.description}
                      onChange={({ doc, body }) => updateScenario(scenario.id, { doc, description: body })}
                      placeholder="Set the context for this scenario. Add images, steps, callouts, tables."
                      isDark={isDark}
                      accentColor={C.cta}
                    />
                  </div>
                </div>

                {/* Tasks */}
                {scenario.tasks.map((task, tIdx) => {
                  const tOpen = openTasks.has(task.id);
                  const taskMeta = TASK_PALETTE.find(item => item.type === task.type);
                  return (
                    <div key={task.id} className="rounded-xl overflow-hidden" style={{ background: C.card }}>
                      <div className="flex items-center gap-2.5 px-3 py-2.5">
                        {iconChip(taskMeta?.icon)}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold truncate" style={{ color: task.title ? C.text : C.faint }}>{task.title || 'Untitled task'}</span>
                          <span className="block text-xs" style={{ color: C.muted }}>{TASK_TYPE_LABEL[task.type]}</span>
                        </span>
                        {iconBtn(() => moveTask(scenario.id, tIdx, -1), tIdx === 0, <ChevronUp className="w-4 h-4" />, 'Move up')}
                        {iconBtn(() => moveTask(scenario.id, tIdx, 1), tIdx === scenario.tasks.length - 1, <ChevronDown className="w-4 h-4" />, 'Move down')}
                        {iconBtn(() => removeTask(scenario.id, task.id), false, <Trash2 className="w-4 h-4" />, 'Delete task', true)}
                        {iconBtn(() => toggle(openTasks, setOpenTasks, task.id), false, tOpen ? <ChevronsDownUp className="w-4 h-4" /> : <ChevronsUpDown className="w-4 h-4" />, tOpen ? 'Collapse' : 'Expand')}
                      </div>
                      {tOpen && (
                        <div className="px-3 pt-1 pb-3.5" style={{ borderTop: `1px solid ${C.divider}` }}>
                          <TaskFields task={task} onChange={u => updateTask(scenario.id, task.id, u)} C={C} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add task */}
                {addingFor === scenario.id ? (
                  <div className="rounded-[14px] p-3.5 grid gap-2.5" style={{ background: C.card }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="block text-sm font-semibold" style={{ color: C.text }}>Choose a task type</span>
                        <span className="block text-xs" style={{ color: C.muted }}>How learners respond or get feedback</span>
                      </div>
                      <button type="button" onClick={() => setAddingFor(null)} className={btnSmClass} style={btnStyle('ghost', C)}>Cancel</button>
                    </div>
                    {TASK_GROUPS.map(group => (
                      <div key={group}>
                        <p className="text-xs font-semibold mt-1 mb-2" style={{ color: C.muted }}>{group}</p>
                        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                          {TASK_PALETTE.filter(item => item.group === group).map(({ type, icon, description }) => (
                            <button key={type} type="button" onClick={() => addTask(scenario.id, type)}
                              className="flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-opacity hover:opacity-80" style={{ background: C.page }}>
                              {iconChip(icon)}
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold" style={{ color: C.text }}>{TASK_TYPE_LABEL[type]}</span>
                                <span className="block text-xs" style={{ color: C.muted }}>{description}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddingFor(scenario.id)}
                    className="flex items-center justify-center gap-1.5 h-10 w-full rounded-xl text-[13px] font-semibold"
                    style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
                    <Plus className="w-3.5 h-3.5" /> Add task
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
