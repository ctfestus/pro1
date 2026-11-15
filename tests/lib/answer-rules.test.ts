import { describe, it, expect } from 'vitest';

import { isAnswerRight } from '@/lib/answer-rules';
import { gradeQuestion } from '@/lib/grade-question';

// isAnswerRight is shared by the course player (instant feedback) and the server grader, so the
// learner is never told "Correct" for an answer the server then scores wrong, or the reverse.

describe('isAnswerRight', () => {
  it('has no answer: wrong', () => {
    expect(isAnswerRight({ type: 'multiple_choice', correctAnswer: 'A' }, null)).toBe(false);
    expect(isAnswerRight({ type: 'multiple_choice', correctAnswer: 'A' }, undefined)).toBe(false);
  });

  it('multiple choice, code and image: exact option text, type defaults to multiple choice', () => {
    expect(isAnswerRight({ type: 'multiple_choice', correctAnswer: 'Remove Duplicates' }, 'Remove Duplicates')).toBe(true);
    expect(isAnswerRight({ type: 'multiple_choice', correctAnswer: 'Remove Duplicates' }, 'remove duplicates')).toBe(false);
    expect(isAnswerRight({ correctAnswer: 'A' }, 'A')).toBe(true);
    expect(isAnswerRight({ type: 'code', correctAnswer: 'Revenue by region' }, 'Revenue by region')).toBe(true);
    expect(isAnswerRight({ type: 'image', correctAnswer: '2' }, '2')).toBe(true);
    expect(isAnswerRight({ type: 'image', correctAnswer: '2' }, '1')).toBe(false);
  });

  it('fill in the blank: any accepted alternative, ignoring case and outer spaces', () => {
    const q = { type: 'fill_blank', correctAnswer: 'TRIM|trim()' };
    expect(isAnswerRight(q, 'TRIM')).toBe(true);
    expect(isAnswerRight(q, '  trim ')).toBe(true);
    expect(isAnswerRight(q, 'trim()')).toBe(true);
    expect(isAnswerRight(q, 'CLEAN')).toBe(false);
  });

  it('fill in the blank with several blanks: each blank checked in order', () => {
    const q = { type: 'fill_blank', correctAnswer: 'SELECT|||FROM|from' };
    expect(isAnswerRight(q, 'select|||From')).toBe(true);
    expect(isAnswerRight(q, 'FROM|||SELECT')).toBe(false);
    expect(isAnswerRight(q, 'SELECT')).toBe(false);
  });

  it('ordering: the whole order must match exactly', () => {
    const q = { type: 'arrange', correctAnswer: 'Select the data|||Insert > PivotTable|||Format' };
    expect(isAnswerRight(q, 'Select the data|||Insert > PivotTable|||Format')).toBe(true);
    expect(isAnswerRight(q, 'Insert > PivotTable|||Select the data|||Format')).toBe(false);
  });

  it('multi-select: same options in any order, no extras', () => {
    const q = { type: 'multiple_choice', multiSelect: true, correctAnswer: 'Region|||Revenue' };
    expect(isAnswerRight(q, 'Revenue|||Region')).toBe(true);
    expect(isAnswerRight(q, 'Region')).toBe(false);
    expect(isAnswerRight(q, 'Region|||Revenue|||Order date')).toBe(false);
  });

  it('AI review: right once the review is completed', () => {
    expect(isAnswerRight({ type: 'written_response' }, 'completed')).toBe(true);
    expect(isAnswerRight({ type: 'excel_review' }, 'pending')).toBe(false);
  });

  it('agrees with the server grader for every chosen or typed answer', () => {
    const cases: [any, string][] = [
      [{ id: 'a', type: 'multiple_choice', correctAnswer: 'A' }, 'A'],
      [{ id: 'b', type: 'multiple_choice', correctAnswer: 'A' }, 'B'],
      [{ id: 'c', type: 'fill_blank', correctAnswer: 'TRIM|trim()' }, ' trim '],
      [{ id: 'd', type: 'fill_blank', correctAnswer: 'x|||y' }, 'x|||z'],
      [{ id: 'e', type: 'arrange', correctAnswer: '1|||2|||3' }, '1|||2|||3'],
      [{ id: 'f', type: 'arrange', correctAnswer: '1|||2|||3' }, '2|||1|||3'],
      [{ id: 'g', type: 'code_review' }, 'completed'],
      [{ id: 'h', type: 'multiple_choice', multiSelect: true, correctAnswer: 'A|||B' }, 'B|||A'],
    ];
    for (const [q, answer] of cases) {
      expect(isAnswerRight(q, answer)).toBe(gradeQuestion(q, { storedAnswers: { [q.id]: answer } }));
    }
  });
});
