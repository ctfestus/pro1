import { describe, it, expect } from 'vitest';

import {
  isScenarioConfig, isAiTaskType, flattenTasks, computePendingScore, parseSubmissionRecord,
  TASK_TYPE_LABEL, AI_TASK_TYPES,
  validateScenarioConfig, extractAnswerKeys, stripAnswerKeys, buildScenarioRecord, gradeMcq, isAllowedUpload,
  parseTaskGrades, taskGradeStats, mcqTaskScore, aiTaskScoreSuggestion, hasRichText, clampTaskScore,
  passMarkOf, DEFAULT_PASS_MARK,
  type ScenarioConfig, type AssignmentSubmissionRecord, type TaskAnswer,
} from '@/lib/assignment-scenarios';

const cfg = (scenarios: ScenarioConfig['scenarios']): ScenarioConfig => ({ scenarios });

describe('isScenarioConfig', () => {
  it('is true only for a config with at least one scenario', () => {
    expect(isScenarioConfig(cfg([{ id: 's1', title: 'A', tasks: [] }]))).toBe(true);
  });
  it('is false for null / non-object / missing or empty scenarios', () => {
    expect(isScenarioConfig(null)).toBe(false);
    expect(isScenarioConfig(undefined)).toBe(false);
    expect(isScenarioConfig({})).toBe(false);
    expect(isScenarioConfig({ scenarios: [] })).toBe(false);
    expect(isScenarioConfig({ ve_form_id: 'x' })).toBe(false); // a VE-linked assignment config
  });
});

describe('isAiTaskType / AI_TASK_TYPES', () => {
  it('flags exactly the four AI-review task types', () => {
    for (const t of AI_TASK_TYPES) expect(isAiTaskType(t)).toBe(true);
    expect(isAiTaskType('code_review')).toBe(true);
    expect(isAiTaskType('text')).toBe(false);
    expect(isAiTaskType('mcq')).toBe(false);
    expect(isAiTaskType('upload')).toBe(false);
  });
});

describe('TASK_TYPE_LABEL', () => {
  it('has a label for every task type', () => {
    for (const t of ['text', 'upload', 'mcq', 'code_review', 'excel_review', 'dashboard_critique', 'document_review'] as const) {
      expect(typeof TASK_TYPE_LABEL[t]).toBe('string');
      expect(TASK_TYPE_LABEL[t].length).toBeGreaterThan(0);
    }
  });
});

describe('flattenTasks', () => {
  it('returns every task in display order paired with its scenario', () => {
    const config = cfg([
      { id: 's1', title: 'One', tasks: [
        { id: 't1', type: 'text', title: 'a' },
        { id: 't2', type: 'mcq', title: 'b' },
      ] },
      { id: 's2', title: 'Two', tasks: [
        { id: 't3', type: 'upload', title: 'c' },
      ] },
    ]);
    const flat = flattenTasks(config);
    expect(flat.map(f => f.task.id)).toEqual(['t1', 't2', 't3']);
    expect(flat.map(f => f.scenario.id)).toEqual(['s1', 's1', 's2']);
  });
  it('handles empty scenarios and scenarios with no tasks', () => {
    expect(flattenTasks(cfg([]))).toEqual([]);
    expect(flattenTasks(cfg([{ id: 's1', title: 'x', tasks: [] }]))).toEqual([]);
  });
});

describe('computePendingScore', () => {
  const ans = (score: number | null | undefined): TaskAnswer =>
    ({ scenarioId: 's', scenarioTitle: '', taskId: 't', taskTitle: '', type: 'mcq', score });

  it('averages only the auto-scored tasks and rounds', () => {
    expect(computePendingScore([ans(100), ans(0)])).toBe(50);
    expect(computePendingScore([ans(90), ans(undefined), ans(80)])).toBe(85); // text/upload excluded
    expect(computePendingScore([ans(1), ans(2)])).toBe(2); // 1.5 rounds to 2
  });
  it('is null when nothing is auto-scored', () => {
    expect(computePendingScore([])).toBeNull();
    expect(computePendingScore([ans(undefined), ans(null)])).toBeNull();
  });
});

describe('parseSubmissionRecord', () => {
  it('parses a scenarios submission record', () => {
    const rec: AssignmentSubmissionRecord = {
      format: 'scenarios',
      submittedAt: '2026-07-24T00:00:00.000Z',
      answers: [{ scenarioId: 's', scenarioTitle: 'S', taskId: 't', taskTitle: 'T', type: 'text', text: '<p>hi</p>' }],
      pendingScore: null,
    };
    expect(parseSubmissionRecord(JSON.stringify(rec))).toEqual(rec);
  });
  it('returns null for anything that is not a scenarios record', () => {
    expect(parseSubmissionRecord(null)).toBeNull();
    expect(parseSubmissionRecord('')).toBeNull();
    expect(parseSubmissionRecord('<p>legacy html response</p>')).toBeNull();
    expect(parseSubmissionRecord('not json at all')).toBeNull();
    expect(parseSubmissionRecord(JSON.stringify([{ overallScore: 90 }]))).toBeNull(); // legacy array
    expect(parseSubmissionRecord(JSON.stringify({ type: 'code_review', report: { overallScore: 90 } }))).toBeNull(); // AI review envelope
    expect(parseSubmissionRecord(JSON.stringify({ format: 'scenarios' }))).toBeNull(); // missing answers[]
  });
});

describe('submission round-trip', () => {
  it('build -> stringify -> parse preserves answers and score maths hold', () => {
    const answers: TaskAnswer[] = [
      { scenarioId: 's1', scenarioTitle: 'One', taskId: 't1', taskTitle: 'Write', type: 'text', text: '<p>ans</p>' },
      { scenarioId: 's1', scenarioTitle: 'One', taskId: 't2', taskTitle: 'Pick', type: 'mcq', selectedOption: 'B', correctOption: 'B', isCorrect: true, score: 100 },
      { scenarioId: 's2', scenarioTitle: 'Two', taskId: 't3', taskTitle: 'Excel', type: 'excel_review', report: { overallScore: 70 }, score: 70 },
    ];
    const pendingScore = computePendingScore(answers); // mean(100, 70) = 85
    const rec: AssignmentSubmissionRecord = { format: 'scenarios', submittedAt: '2026-07-24T00:00:00.000Z', answers, pendingScore };
    const round = parseSubmissionRecord(JSON.stringify(rec));
    expect(round).not.toBeNull();
    expect(round!.pendingScore).toBe(85);
    expect(round!.answers).toHaveLength(3);
    expect(round!.answers[1]).toMatchObject({ selectedOption: 'B', isCorrect: true, score: 100 });
    expect(round!.answers[2].report).toEqual({ overallScore: 70 });
  });
});

describe('validateScenarioConfig', () => {
  const goodMcq = { id: 'm', type: 'mcq' as const, title: 'Q', options: ['A', 'B'], correctAnswer: 'B' };
  it('passes a well-formed config', () => {
    expect(validateScenarioConfig(cfg([{ id: 's1', title: 'One', tasks: [goodMcq] }]))).toEqual([]);
  });
  it('flags no scenarios', () => {
    expect(validateScenarioConfig(cfg([]))).toContain('Add at least one scenario.');
    expect(validateScenarioConfig(null)).toContain('Add at least one scenario.');
  });
  it('flags untitled scenario / task and empty scenario', () => {
    expect(validateScenarioConfig(cfg([{ id: 's1', title: '', tasks: [goodMcq] }]))).toEqual(expect.arrayContaining(['Scenario 1 needs a title.']));
    expect(validateScenarioConfig(cfg([{ id: 's1', title: 'One', tasks: [] }]))).toEqual(expect.arrayContaining(['Scenario 1 has no tasks.']));
    expect(validateScenarioConfig(cfg([{ id: 's1', title: 'One', tasks: [{ id: 't', type: 'text', title: '' }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 needs a title.']));
  });
  it('flags bad MCQ: too few / duplicate options and no/invalid correct answer', () => {
    expect(validateScenarioConfig(cfg([{ id: 's', title: 'S', tasks: [{ id: 'm', type: 'mcq', title: 'Q', options: ['A'], correctAnswer: 'A' }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 needs at least two options.']));
    expect(validateScenarioConfig(cfg([{ id: 's', title: 'S', tasks: [{ id: 'm', type: 'mcq', title: 'Q', options: ['A', 'A'], correctAnswer: 'A' }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 has duplicate options.']));
    expect(validateScenarioConfig(cfg([{ id: 's', title: 'S', tasks: [{ id: 'm', type: 'mcq', title: 'Q', options: ['A', 'B'] }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 needs a correct answer selected.']));
    expect(validateScenarioConfig(cfg([{ id: 's', title: 'S', tasks: [{ id: 'm', type: 'mcq', title: 'Q', options: ['A', 'B'], correctAnswer: 'Z' }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 needs a correct answer selected.']));
  });
  it('flags an out-of-range AI pass score', () => {
    expect(validateScenarioConfig(cfg([{ id: 's', title: 'S', tasks: [{ id: 'e', type: 'excel_review', title: 'X', minScore: 250 }] }]))).toEqual(expect.arrayContaining(['Scenario 1, task 1 pass score must be between 1 and 100.']));
  });
});

describe('answer key strip / extract', () => {
  const scenarios = [{ id: 's', title: 'S', tasks: [
    { id: 'm1', type: 'mcq' as const, title: 'Q1', options: ['A', 'B'], correctAnswer: 'B' },
    { id: 't1', type: 'text' as const, title: 'Write' },
  ] }];
  it('extracts only mcq keys', () => {
    expect(extractAnswerKeys(scenarios)).toEqual({ m1: 'B' });
  });
  it('strips correctAnswer from mcq tasks and leaves others intact', () => {
    const stripped = stripAnswerKeys(scenarios);
    expect((stripped[0].tasks[0] as any).correctAnswer).toBeUndefined();
    expect(stripped[0].tasks[0].options).toEqual(['A', 'B']); // options remain
    expect(stripped[0].tasks[1]).toEqual(scenarios[0].tasks[1]);
  });
});

describe('buildScenarioRecord (server)', () => {
  it('stores only raw answers -- no correctOption/isCorrect/score, pendingScore null', () => {
    const config = cfg([{ id: 's', title: 'S', tasks: [
      { id: 'm', type: 'mcq', title: 'Q', options: ['A', 'B'], correctAnswer: 'B' },
      { id: 't', type: 'text', title: 'W' },
    ] }]);
    const raw = [
      { taskId: 'm', selectedOption: 'A' },
      { taskId: 't', text: '<b>hi</b>' },
    ];
    const rec = buildScenarioRecord(config, raw, (s) => `SANITIZED:${s}`, 'fixed');
    expect(rec.pendingScore).toBeNull();
    const mcq = rec.answers.find(a => a.taskId === 'm')!;
    expect(mcq.selectedOption).toBe('A');
    expect(mcq.correctOption).toBeUndefined();
    expect(mcq.isCorrect).toBeUndefined();
    expect(mcq.score).toBeUndefined();
    expect(rec.answers.find(a => a.taskId === 't')!.text).toBe('SANITIZED:<b>hi</b>');
    expect(rec.submittedAt).toBe('fixed');
  });
});

describe('gradeMcq (instructor, uses server-only keys)', () => {
  it('computes correctness + subtotal from the key', () => {
    const record: AssignmentSubmissionRecord = {
      format: 'scenarios', submittedAt: 'x', pendingScore: null,
      answers: [
        { scenarioId: 's', scenarioTitle: '', taskId: 'm1', taskTitle: '', type: 'mcq', selectedOption: 'B' },
        { scenarioId: 's', scenarioTitle: '', taskId: 'm2', taskTitle: '', type: 'mcq', selectedOption: 'A' },
        { scenarioId: 's', scenarioTitle: '', taskId: 't', taskTitle: '', type: 'text', text: 'hi' },
      ],
    };
    const { grades, subtotal } = gradeMcq(record, { m1: 'B', m2: 'C' });
    expect(grades.m1.isCorrect).toBe(true);
    expect(grades.m2.isCorrect).toBe(false);
    expect(grades.m2.correctOption).toBe('C');
    expect(subtotal).toBe(50); // one right, one wrong
    expect(grades.t).toBeUndefined(); // non-mcq ignored
  });
  it('subtotal is null when no MCQ answered', () => {
    const record: AssignmentSubmissionRecord = { format: 'scenarios', submittedAt: 'x', pendingScore: null, answers: [{ scenarioId: 's', scenarioTitle: '', taskId: 'm', taskTitle: '', type: 'mcq' }] };
    expect(gradeMcq(record, { m: 'A' }).subtotal).toBeNull();
  });
});

describe('isAllowedUpload', () => {
  it('allows the assignment file types and rejects dangerous ones', () => {
    for (const ok of ['a.pdf', 'b.xlsx', 'c.csv', 'd.png', 'e.docx', 'f.pbip', 'g.PDF']) expect(isAllowedUpload(ok)).toBe(true);
    for (const bad of ['x.exe', 'x.svg', 'x.html', 'x.js', 'x.sh', 'noext']) expect(isAllowedUpload(bad)).toBe(false);
    expect(isAllowedUpload('report.pdf?token=abc')).toBe(true); // query string tolerated
  });
});

// -- per-task grading -------------------------------------------------------------------

const ans = (over: Partial<TaskAnswer> & { taskId: string }): TaskAnswer =>
  ({ scenarioId: 's', scenarioTitle: 'S', taskTitle: 'T', type: 'text', ...over });

describe('hasRichText', () => {
  it('treats empty markup as empty and media as content', () => {
    expect(hasRichText('')).toBe(false);
    expect(hasRichText(undefined)).toBe(false);
    expect(hasRichText('<p></p>')).toBe(false);
    expect(hasRichText('<p>&nbsp;</p>')).toBe(false);
    expect(hasRichText('<p>Good work</p>')).toBe(true);
    expect(hasRichText('<p><img src="x.png"></p>')).toBe(true);
  });
});

describe('clampTaskScore', () => {
  it('clamps to 0-100 at 2dp', () => {
    expect(clampTaskScore(-5)).toBe(0);
    expect(clampTaskScore(140)).toBe(100);
    expect(clampTaskScore(87.456)).toBe(87.46);
  });
});

describe('parseTaskGrades', () => {
  it('reads a jsonb object or a JSON string, dropping empty entries', () => {
    const raw = { a: { score: 80, feedback: '<p>Nice</p>' }, b: { score: null, feedback: '<p></p>' }, c: { feedback: '<p>See note</p>' } };
    const parsed = parseTaskGrades(raw);
    expect(parsed.a).toEqual({ score: 80, feedback: '<p>Nice</p>' });
    expect(parsed.b).toBeUndefined();          // neither score nor comment
    expect(parsed.c).toEqual({ score: null, feedback: '<p>See note</p>' });
    expect(parseTaskGrades(JSON.stringify(raw)).a.score).toBe(80);
  });
  it('is tolerant of junk', () => {
    expect(parseTaskGrades(null)).toEqual({});
    expect(parseTaskGrades('not json')).toEqual({});
    expect(parseTaskGrades([1, 2])).toEqual({});
    expect(parseTaskGrades({ a: 5, b: { score: 'x' } })).toEqual({});
    expect(parseTaskGrades({ a: { score: 250 } }).a.score).toBe(100); // clamped
  });
});

describe('taskGradeStats', () => {
  it('averages only the scored tasks that exist in the submission', () => {
    const answers = [ans({ taskId: 'a' }), ans({ taskId: 'b' }), ans({ taskId: 'c' })];
    const stats = taskGradeStats(answers, {
      a: { score: 90, feedback: '<p>x</p>' },
      b: { score: 60 },
      gone: { score: 0 },              // stale task id from an edited assignment
    });
    expect(stats).toEqual({ total: 3, scored: 2, commented: 1, average: 75 });
  });
  it('average is null when nothing is scored', () => {
    expect(taskGradeStats([ans({ taskId: 'a' })], { a: { score: null, feedback: '<p>note</p>' } }).average).toBeNull();
  });
});

describe('mcqTaskScore / aiTaskScoreSuggestion', () => {
  it('prefills MCQ from the server-side marking only', () => {
    const mcq = ans({ taskId: 'm', type: 'mcq' });
    expect(mcqTaskScore(mcq, { taskId: 'm', isCorrect: true, answered: true })).toBe(100);
    expect(mcqTaskScore(mcq, { taskId: 'm', isCorrect: false, answered: true })).toBe(0);
    expect(mcqTaskScore(mcq, { taskId: 'm', isCorrect: false, answered: false })).toBe(0);
    expect(mcqTaskScore(mcq, undefined)).toBeNull();
    expect(mcqTaskScore(ans({ taskId: 't' }), { taskId: 't', isCorrect: true, answered: true })).toBeNull();
  });
  it('suggests the AI overall score from either report shape', () => {
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'excel_review', report: { overallScore: 72 } }))).toBe(72);
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'dashboard_critique', report: { audit: { overallScore: 64 } } }))).toBe(64);
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'code_review' }))).toBeNull();
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'code_review', report: { summary: 'x' } }))).toBeNull();
  });
  it('suggests rubric completion rather than model quality when a rubric was graded', () => {
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'code_review', report: { overallScore: 99, rubricScore: 20 } }))).toBe(20);
    expect(aiTaskScoreSuggestion(ans({ taskId: 'a', type: 'dashboard_critique', report: { audit: { overallScore: 58, rubricScore: 100 } } }))).toBe(100);
  });
});

describe('passMarkOf', () => {
  it('defaults to 85 when passingScore is absent, null, or the config is missing', () => {
    expect(passMarkOf(undefined)).toBe(DEFAULT_PASS_MARK);
    expect(passMarkOf(null)).toBe(DEFAULT_PASS_MARK);
    expect(passMarkOf({})).toBe(85);
    expect(passMarkOf({ passingScore: null })).toBe(85);
  });

  it('uses a valid in-range number', () => {
    expect(passMarkOf({ passingScore: 70 })).toBe(70);
    expect(passMarkOf({ passingScore: 90 })).toBe(90);
    expect(passMarkOf({ passingScore: 1 })).toBe(1);
    expect(passMarkOf({ passingScore: 100 })).toBe(100);
  });

  it('falls back to 85 for out-of-range, wrong-type, or non-finite values', () => {
    expect(passMarkOf({ passingScore: 0 })).toBe(85);
    expect(passMarkOf({ passingScore: 101 })).toBe(85);
    expect(passMarkOf({ passingScore: -5 })).toBe(85);
    expect(passMarkOf({ passingScore: 'invalid' })).toBe(85);
    expect(passMarkOf({ passingScore: '70' })).toBe(85);
    expect(passMarkOf({ passingScore: NaN })).toBe(85);
  });
});
