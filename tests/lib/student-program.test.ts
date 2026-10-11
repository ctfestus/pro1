// The My Program timeline: how cohort content becomes weeks, statuses and pace for a student.
import { describe, expect, it } from 'vitest';
import { buildProgramTimeline, displayStatus, type ProgramItem, type ProgramPayload } from '@/lib/student-program';

const item = (over: Partial<ProgramItem>): ProgramItem => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  title: over.title ?? 'Item',
  type: over.type ?? 'course',
  href: '/x',
  baseStatus: over.baseStatus ?? 'not_started',
  progressPct: 0,
  dueDate: over.dueDate ?? null,
  ...over,
});

const payload = (items: ProgramItem[], cohort: Partial<ProgramPayload['cohort']> = {}): ProgramPayload => ({
  cohort: { id: 'c1', name: 'Cohort 7', startDate: '2026-09-01', endDate: '2026-11-23', ...cohort } as any,
  items,
  group: null,
});

describe('week placement', () => {
  it('counts weeks from the cohort start date, seven days each', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'a', dueDate: '2026-09-01' }), // day 0  -> week 1
      item({ id: 'b', dueDate: '2026-09-07' }), // day 6  -> week 1
      item({ id: 'c', dueDate: '2026-09-08' }), // day 7  -> week 2
      item({ id: 'd', dueDate: '2026-09-17' }), // day 16 -> week 3
    ]), '2026-09-02');
    expect(t.weeks).toHaveLength(12);
    expect(t.weeks[0].items.map(i => i.id)).toEqual(['a', 'b']);
    expect(t.weeks[1].items.map(i => i.id)).toEqual(['c']);
    expect(t.weeks[2].items.map(i => i.id)).toEqual(['d']);
    expect(t.weeks[2].startDate).toBe('2026-09-15');
  });

  it('runs work with no dates from Week 1 to the current week, counted once', () => {
    const t = buildProgramTimeline(payload([item({ id: 'a' })]), '2026-10-09');
    expect(t.anytime).toHaveLength(0);
    const placed = t.weeks[5].items.find(i => i.id === 'a')!;
    expect(placed.week).toBe(6);
    expect(placed.spanFrom).toBe(1);
    // Listed as ongoing in weeks 1-5, counted only in week 6.
    expect(t.weeks.slice(0, 5).every(w => w.ongoing.some(i => i.id === 'a'))).toBe(true);
    expect(t.weeks.slice(0, 5).every(w => w.required === 0)).toBe(true);
    expect(t.weeks[5].required).toBe(1);
  });

  it('stops spreading in the week the work was completed', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'a', baseStatus: 'done', completedAt: '2026-09-25T10:00:00.000Z' }),
    ]), '2026-10-09');
    const placed = t.weeks.flatMap(w => w.items).find(i => i.id === 'a')!;
    expect(placed.week).toBe(4);
    expect(t.weeks.slice(0, 3).every(w => w.ongoing.some(i => i.id === 'a'))).toBe(true);
    expect(t.weeks.slice(4).some(w => w.ongoing.some(i => i.id === 'a') || w.items.some(i => i.id === 'a'))).toBe(false);
  });

  it('starts spreading from the assigned week when there is one', () => {
    const t = buildProgramTimeline(payload([item({ id: 'a', assignedAt: '2026-09-17T10:00:00.000Z' })]), '2026-10-09');
    expect(t.weeks[1].ongoing).toHaveLength(0);
    expect(t.weeks.slice(2, 5).every(w => w.ongoing.some(i => i.id === 'a'))).toBe(true);
  });

  it('keeps Any time only when the cohort has no dates at all', () => {
    const t = buildProgramTimeline(payload([item({ id: 'a' })], { startDate: null, endDate: null }), '2026-10-09');
    expect(t.anytime.map(i => i.id)).toEqual(['a']);
    expect(t.weeks).toHaveLength(0);
  });

  it('pulls deadlines outside the program into the first or last week', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'early', dueDate: '2026-08-20' }),
      item({ id: 'late', dueDate: '2027-01-15' }),
    ]), '2026-09-02');
    expect(t.weeks[0].items.map(i => i.id)).toEqual(['early']);
    expect(t.weeks[11].items.map(i => i.id)).toEqual(['late']);
  });

  it('falls back to the earliest deadline when the cohort has no start date', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'a', dueDate: '2026-10-05' }),
      item({ id: 'b', dueDate: '2026-10-20' }),
    ], { startDate: null, endDate: null }), '2026-10-01');
    expect(t.weeks).toHaveLength(3);
    expect(t.weeks[0].startDate).toBe('2026-10-05');
    expect(t.weeks[2].items.map(i => i.id)).toEqual(['b']);
  });

  it('has no weeks when nothing is dated and the cohort has no start date', () => {
    const t = buildProgramTimeline(payload([item({})], { startDate: null, endDate: null }), '2026-10-01');
    expect(t.weeks).toHaveLength(0);
    expect(t.phase).toBe('undated');
    expect(t.anytime).toHaveLength(1);
  });
});

describe('work with no deadline', () => {
  // Cohort Sep 1 - Nov 23; today Oct 9 is Week 6.
  it('starts in the week it was assigned and moves forward while unfinished', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'open', baseStatus: 'in_progress', assignedAt: '2026-09-10T10:00:00.000Z' }),
    ]), '2026-10-09');
    const placed = t.weeks.flatMap(w => w.items).find(i => i.id === 'open')!;
    expect(placed.week).toBe(6);
    expect(placed.carriedFrom).toBe(2);
    expect(placed.status).toBe('progress'); // no deadline, so never overdue
    expect(t.anytime).toHaveLength(0);
  });

  it('settles in the week it was completed', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'done', baseStatus: 'done', assignedAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-25T10:00:00.000Z' }),
    ]), '2026-10-09');
    const placed = t.weeks.flatMap(w => w.items).find(i => i.id === 'done')!;
    expect(placed.week).toBe(4);
    expect(placed.carriedFrom).toBeNull();
  });

  it('stays in its assigned week when assigned this week or before the program starts', () => {
    const thisWeek = buildProgramTimeline(payload([item({ id: 'a', assignedAt: '2026-10-07T10:00:00.000Z' })]), '2026-10-09');
    expect(thisWeek.weeks[5].items[0].carriedFrom).toBeNull();
    const before = buildProgramTimeline(payload([item({ id: 'b', assignedAt: '2026-08-20T10:00:00.000Z' })]), '2026-08-25');
    expect(before.weeks[0].items.map(i => i.id)).toEqual(['b']);
  });

  it('is not counted as behind, since there is no deadline to miss', () => {
    const t = buildProgramTimeline(payload([item({ assignedAt: '2026-09-02T10:00:00.000Z' })]), '2026-10-09');
    expect(t.behind).toBe(0);
  });

  it('carries into the current week when the cohort has no end date', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'open', baseStatus: 'not_started', assignedAt: '2026-09-03T10:00:00.000Z' }),
    ], { endDate: null }), '2026-10-09');
    const placed = t.weeks.flatMap(w => w.items).find(i => i.id === 'open')!;
    expect(t.weeks).toHaveLength(6);
    expect(placed.week).toBe(6);
    expect(placed.carriedFrom).toBe(1);
  });

  it('carries a not-passed item forward until it is passed', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'retake', type: 'assignment', baseStatus: 'failed', assignedAt: '2026-09-10T10:00:00.000Z' }),
    ]), '2026-10-09');
    expect(t.weeks[5].items.map(i => i.id)).toEqual(['retake']);
  });

  it('does not let an old completion date set Week 1 when the cohort has no start date', () => {
    const t = buildProgramTimeline(payload([
      item({ baseStatus: 'done', completedAt: '2026-03-01T10:00:00.000Z', assignedAt: '2026-09-01T10:00:00.000Z' }),
      item({ dueDate: '2026-09-20' }),
    ], { startDate: null, endDate: null }), '2026-09-10');
    expect(t.weeks[0].startDate).toBe('2026-09-01');
  });

  it('keeps work with a deadline in its due week, even when it has an assigned date', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'due', baseStatus: 'not_started', dueDate: '2026-09-20', assignedAt: '2026-09-02T10:00:00.000Z' }),
    ]), '2026-10-09');
    const placed = t.weeks.flatMap(w => w.items).find(i => i.id === 'due')!;
    expect(placed.week).toBe(3);
    expect(placed.carriedFrom).toBeNull();
  });
});

describe('statuses', () => {
  it('turns unfinished work overdue only after its due date has passed', () => {
    const due = item({ dueDate: '2026-10-12' });
    expect(displayStatus(due, '2026-10-12')).toBe('todo');
    expect(displayStatus(due, '2026-10-13')).toBe('overdue');
    expect(displayStatus({ ...due, baseStatus: 'in_progress' }, '2026-10-13')).toBe('overdue');
    expect(displayStatus({ ...due, baseStatus: 'done' }, '2026-10-13')).toBe('done');
  });

  it('marks live sessions attended, missed or upcoming', () => {
    const session = item({ type: 'event', dueDate: '2026-10-10', baseStatus: 'not_attended' });
    expect(displayStatus(session, '2026-10-09')).toBe('upcoming');
    expect(displayStatus(session, '2026-10-11')).toBe('missed');
    expect(displayStatus({ ...session, baseStatus: 'attended' }, '2026-10-11')).toBe('attended');
  });

  it('does not call a repeating session missed while it is still running', () => {
    const weekly = item({ type: 'event', dueDate: '2026-09-01', baseStatus: 'not_attended', recurring: true });
    expect(displayStatus(weekly, '2026-10-09')).toBe('upcoming');
    expect(displayStatus({ ...weekly, lastDate: '2026-11-20' }, '2026-10-09')).toBe('upcoming');
    expect(displayStatus({ ...weekly, lastDate: '2026-10-01' }, '2026-10-09')).toBe('missed');
  });

  it('resolves an exact deadline to the viewer local date', () => {
    const t = buildProgramTimeline(payload([item({ id: 'a', dueDate: '2026-09-10T12:00:00.000Z' })]), '2026-09-02');
    expect(t.weeks[1].items[0].dueDate).toBe('2026-09-10');
  });
});

describe('locked items', () => {
  it('never classifies or counts locked work as overdue', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'locked', baseStatus: 'not_started', dueDate: '2026-10-01', locked: true }),
      item({ id: 'locked-started', baseStatus: 'in_progress', dueDate: '2026-10-01', locked: true }),
    ]), '2026-10-09');
    const statuses = t.weeks.flatMap(w => w.items).map(i => i.status);
    expect(statuses.sort()).toEqual(['progress', 'todo']);
    expect(t.statusCounts.overdue).toBe(0);
    expect(t.behind).toBe(0);
    expect(t.weeks[4].hasOverdue).toBe(false);
  });

  it('keeps locked items in the program but never offers them as next', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'locked', baseStatus: 'not_started', dueDate: '2026-10-01', locked: true }),
      item({ id: 'open', type: 'assignment', baseStatus: 'not_started', dueDate: '2026-10-20' }),
    ]), '2026-10-09');
    expect(t.required).toBe(2);
    expect(t.upNext?.id).toBe('open');
  });
});

describe('catch-up period after classes', () => {
  // 12 weeks of classes (Sep 1 to Nov 23), then a month of catch-up to Dec 23.
  const withCatchUp = (items: ProgramItem[]) => payload(items, { endDate: '2026-12-23', classesEndDate: '2026-11-23' });

  it('draws the journey and measures pace over classes only', () => {
    const t = buildProgramTimeline(withCatchUp([item({ dueDate: '2026-09-05' })]), '2026-10-09');
    expect(t.weeks).toHaveLength(12);
    expect(t.phase).toBe('during');
    expect(t.currentWeek).toBe(6);
    expect(t.timePct).toBe(46);
    expect(t.daysLeft).toBe(45);
    expect(t.catchUpEndDate).toBe('2026-12-23');
  });

  it('switches to the catch-up phase after classes, counting days to the cohort end', () => {
    const t = buildProgramTimeline(withCatchUp([item({ baseStatus: 'not_started', dueDate: '2026-11-20' })]), '2026-12-01');
    expect(t.phase).toBe('catch_up');
    expect(t.timePct).toBe(100);
    expect(t.daysLeft).toBe(22);
    expect(t.behind).toBe(1);
  });

  it('puts deadlines set inside the catch-up period into the last week of classes', () => {
    const t = buildProgramTimeline(withCatchUp([item({ id: 'capstone', dueDate: '2026-12-15' })]), '2026-10-09');
    expect(t.weeks[11].items.map(i => i.id)).toEqual(['capstone']);
  });

  it('ends after the cohort end date, not after classes', () => {
    expect(buildProgramTimeline(withCatchUp([]), '2026-12-23').phase).toBe('catch_up');
    expect(buildProgramTimeline(withCatchUp([]), '2026-12-24').phase).toBe('after');
  });

  it('ignores a classes end date outside the cohort rather than breaking the journey', () => {
    const t = buildProgramTimeline(payload([], { endDate: '2026-11-23', classesEndDate: '2027-02-01' }), '2026-10-09');
    expect(t.weeks).toHaveLength(12);
    expect(t.catchUpEndDate).toBeNull();
    expect(t.classesEndDate).toBeNull();
  });

  it('ignores a classes end date before the start instead of making it all catch-up', () => {
    const t = buildProgramTimeline(payload([], { startDate: '2026-10-01', endDate: '2026-12-23', classesEndDate: '2026-09-20' }), '2026-10-02');
    expect(t.phase).toBe('during');
    expect(t.catchUpEndDate).toBeNull();
    expect(t.weeks.length).toBeGreaterThan(1);
  });
});

describe('cohorts without an end date', () => {
  it('keeps counting real weeks past the last dated item', () => {
    const t = buildProgramTimeline(payload([item({ dueDate: '2026-09-10' })], { endDate: null }), '2026-10-09');
    expect(t.weeks).toHaveLength(2);
    expect(t.currentWeek).toBe(6);
    expect(t.hasEndDate).toBe(false);
  });
});

describe('progress and pace', () => {
  it('counts submitted work as complete and leaves live sessions out', () => {
    const t = buildProgramTimeline(payload([
      item({ baseStatus: 'done', dueDate: '2026-09-05' }),
      item({ type: 'assignment', baseStatus: 'awaiting_grade', dueDate: '2026-09-05' }),
      item({ baseStatus: 'not_started', dueDate: '2026-10-30' }),
      item({ type: 'event', baseStatus: 'attended', dueDate: '2026-09-03' }),
    ]), '2026-10-09');
    expect(t.required).toBe(3);
    expect(t.completed).toBe(2);
    expect(t.pct).toBe(67);
  });

  it('counts past-due unfinished work as behind and offers overdue work first', () => {
    const t = buildProgramTimeline(payload([
      item({ id: 'progress', baseStatus: 'in_progress', dueDate: '2026-10-12' }),
      item({ id: 'overdue', baseStatus: 'not_started', dueDate: '2026-10-05' }),
      item({ id: 'done', baseStatus: 'done', dueDate: '2026-10-01' }),
    ]), '2026-10-09');
    expect(t.behind).toBe(1);
    expect(t.upNext?.id).toBe('overdue');
    expect(t.weeks[t.currentWeek! - 1].week).toBe(6);
  });

  it('reports the current week, time passed and days left during the program', () => {
    const t = buildProgramTimeline(payload([item({ dueDate: '2026-09-05' })]), '2026-10-09');
    expect(t.phase).toBe('during');
    expect(t.currentWeek).toBe(6);
    expect(t.daysLeft).toBe(45);
    expect(t.timePct).toBe(46);
  });

  it('knows when the program has not started or has ended', () => {
    const before = buildProgramTimeline(payload([item({ dueDate: '2026-09-05' })]), '2026-08-25');
    expect(before.phase).toBe('before');
    expect(before.currentWeek).toBeNull();
    expect(before.daysUntilStart).toBe(7);

    const after = buildProgramTimeline(payload([item({ dueDate: '2026-09-05' })]), '2026-12-10');
    expect(after.phase).toBe('after');
    expect(after.timePct).toBe(100);
    expect(after.daysLeft).toBe(0);
  });
});
