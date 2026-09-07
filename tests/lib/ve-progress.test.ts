import { describe, expect, it } from 'vitest';
import { mergeVeProgress, reversibleDeliverableRequirementIds, shouldCompleteVeAttempt } from '@/lib/ve-progress';

const modules = [{
  lessons: [{
    requirements: [
      { id: 'task-1', type: 'task' },
      { id: 'legacy-deliverable', type: 'deliverable' },
      { id: 'quiz-1', type: 'mcq' },
    ],
  }],
}];

describe('VE progress merging', () => {
  it('finds current and legacy checkbox deliverables', () => {
    expect([...reversibleDeliverableRequirementIds(modules)]).toEqual(['task-1', 'legacy-deliverable']);
  });

  it('allows a deliverable to be unchecked before submission', () => {
    const merged = mergeVeProgress(
      { 'task-1': { completed: true, notes: 'kept' } },
      { 'task-1': { completed: false } },
      reversibleDeliverableRequirementIds(modules),
      false,
    );
    expect(merged['task-1']).toEqual({ completed: false, notes: 'kept' });
  });

  it('freezes a deliverable after submission', () => {
    const merged = mergeVeProgress(
      { 'task-1': { completed: true } },
      { 'task-1': { completed: false } },
      reversibleDeliverableRequirementIds(modules),
      true,
    );
    expect(merged['task-1'].completed).toBe(true);
  });

  it('keeps non-deliverable completion monotonic', () => {
    const merged = mergeVeProgress(
      { 'quiz-1': { completed: true, selectedAnswer: 'A' } },
      { 'quiz-1': { completed: false, selectedAnswer: 'B' } },
      reversibleDeliverableRequirementIds(modules),
      false,
    );
    expect(merged['quiz-1']).toEqual({ completed: true, selectedAnswer: 'A' });
  });

  it('accepts a completion request only for a valid standalone attempt', () => {
    expect(shouldCompleteVeAttempt({ completedAt: 'requested', requirementsComplete: true })).toBe(true);
    expect(shouldCompleteVeAttempt({ completedAt: 'requested', requirementsComplete: false })).toBe(false);
    expect(shouldCompleteVeAttempt({ assignmentId: 'assignment-1', completedAt: 'requested', requirementsComplete: true })).toBe(false);
    expect(shouldCompleteVeAttempt({ requirementsComplete: true })).toBe(false);
  });
});
