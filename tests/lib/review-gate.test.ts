import { describe, expect, it } from 'vitest';
import { collectRubricGrades, reviewGate, reviewPassed, rubricPassRate, UNGRADED_COMMENT } from '@/lib/review-gate';

const grade = (passed: boolean) => ({ passed });

describe('rubricPassRate', () => {
  it('returns null only when there is no rubric at all', () => {
    expect(rubricPassRate(undefined, 0)).toBeNull();
    expect(rubricPassRate([], 0)).toBeNull();
    expect(rubricPassRate([], 4)).toBe(0);
  });

  it('counts ungraded criteria as not met rather than shrinking the denominator', () => {
    // Two of four criteria graded, both passed. Scoring over the graded ones would read 100.
    expect(rubricPassRate([grade(true), grade(true)], 4)).toBe(50);
  });

  it('uses the grade count when it exceeds the criteria count', () => {
    expect(rubricPassRate([grade(true), grade(false)], 1)).toBe(50);
  });

  it('scores a fully met rubric at 100 and a fully missed one at 0', () => {
    expect(rubricPassRate([grade(true), grade(true)], 2)).toBe(100);
    expect(rubricPassRate([grade(false), grade(false)], 2)).toBe(0);
  });
});

describe('reviewGate', () => {
  it('gates on the quality score when no rubric was set', () => {
    expect(reviewGate({ overallScore: 98 })).toEqual({ score: 98, fromRubric: false });
  });

  it('prefers the score the route computed over any recount', () => {
    // An instructor who adds a criterion after the attempt must not retroactively re-grade it.
    const result = { overallScore: 98, rubricScore: 40, rubricGrades: [grade(true), grade(true)] };
    expect(reviewGate(result, 5)).toEqual({ score: 40, fromRubric: true });
  });

  it('treats a zero rubric score as a rubric gate, not a missing one', () => {
    expect(reviewGate({ overallScore: 98, rubricScore: 0, rubricGrades: [] }, 3))
      .toEqual({ score: 0, fromRubric: true });
  });

  it('recomputes for a saved report that predates rubricScore', () => {
    const result = { overallScore: 98, rubricGrades: [grade(true), grade(false)] };
    expect(reviewGate(result, 2)).toEqual({ score: 50, fromRubric: true });
  });

  it('does not let a rubric with no grades fall back to the quality score', () => {
    // The bypass this gate exists to close: the model returns no grades, the quality score is high.
    expect(reviewGate({ overallScore: 98, rubricGrades: [] }, 4))
      .toEqual({ score: 0, fromRubric: true });
  });
});

describe('reviewPassed', () => {
  it('passes everything when no minimum is set', () => {
    expect(reviewPassed({ overallScore: 3, rubricScore: 0 }, undefined, 4)).toBe(true);
    expect(reviewPassed({ overallScore: 3, rubricScore: 0 }, 0, 4)).toBe(true);
  });

  it('fails a high-quality workbook that missed the rubric', () => {
    const result = { overallScore: 98, rubricScore: 25, rubricGrades: [grade(true), grade(false), grade(false), grade(false)] };
    expect(reviewPassed(result, 70, 4)).toBe(false);
  });

  it('passes when the rubric is met', () => {
    const result = { overallScore: 62, rubricScore: 100, rubricGrades: [grade(true), grade(true)] };
    expect(reviewPassed(result, 70, 2)).toBe(true);
  });

  it('passes on the threshold exactly', () => {
    expect(reviewPassed({ overallScore: 0, rubricScore: 70 }, 70, 10)).toBe(true);
  });
});

describe('collectRubricGrades', () => {
  const CRITERIA = ['B12 holds a formula', 'B16 holds a formula', 'Values agree with source', 'Labels are intact'];
  const g = (id: unknown, passed: unknown, comment = 'checked') => ({ id, passed, comment });

  it('grades every criterion by its id', () => {
    const out = collectRubricGrades(CRITERIA, [g(1, true), g(2, false), g(3, true), g(4, false)]);
    expect(out).toMatchObject({ covered: 4, ungraded: 0 });
    expect(out.grades.map(x => x.criterion)).toEqual(CRITERIA);
    expect(out.grades.map(x => x.passed)).toEqual([true, false, true, false]);
  });

  it('places grades by id regardless of the order they arrive in', () => {
    const out = collectRubricGrades(CRITERIA, [g(4, true), g(1, false), g(3, true), g(2, true)]);
    expect(out.grades.map(x => x.passed)).toEqual([false, true, true, true]);
  });

  it('takes the criterion text from the instructor, never from the model', () => {
    const out = collectRubricGrades(CRITERIA, [{ id: 1, passed: true, comment: 'ok', criterion: 'Something the model made up' }]);
    expect(out.grades[0].criterion).toBe(CRITERIA[0]);
  });

  it('ignores a repeated id instead of letting it cover a skipped criterion', () => {
    // Four grades, but id 4 was never graded.
    const out = collectRubricGrades(CRITERIA, [g(1, true), g(1, true), g(2, true), g(3, true)]);
    expect(out).toMatchObject({ covered: 3, ungraded: 1 });
    expect(out.grades[3]).toEqual({ criterion: CRITERIA[3], passed: false, comment: UNGRADED_COMMENT });
    expect(rubricPassRate(out.grades, CRITERIA.length)).toBe(75);
  });

  it('keeps the first verdict for a repeated id, not the last', () => {
    const out = collectRubricGrades(CRITERIA, [g(1, false, 'first'), g(1, true, 'second')]);
    expect(out.grades[0]).toMatchObject({ passed: false, comment: 'first' });
    expect(out.covered).toBe(1);
  });

  it('discards ids that are not on the list', () => {
    const out = collectRubricGrades(CRITERIA, [g(1, true), g(5, true), g(0, true), g(-2, true), g(2.5, true)]);
    expect(out).toMatchObject({ covered: 1, ungraded: 3 });
    expect(out.grades.filter(x => x.passed)).toHaveLength(1);
  });

  it('discards an entry with no id or no boolean verdict', () => {
    const out = collectRubricGrades(CRITERIA, [
      g(1, true),
      { id: 2, comment: 'no verdict' },
      { id: 3, passed: 'yes', comment: 'wrong type' },
      { passed: true, comment: 'no id' },
      null,
    ]);
    expect(out).toMatchObject({ covered: 1, ungraded: 3 });
  });

  it('accepts an id sent as a numeric string', () => {
    const out = collectRubricGrades(CRITERIA, [g('2', true), g(' 3 ', false)]);
    expect(out.covered).toBe(2);
    expect(out.grades[1].passed).toBe(true);
    expect(out.grades[2].passed).toBe(false);
  });

  it('marks every criterion failed when nothing usable came back', () => {
    for (const raw of [[], undefined, null, 'rubricGrades', { id: 1, passed: true }]) {
      const out = collectRubricGrades(CRITERIA, raw);
      expect(out).toMatchObject({ covered: 0, ungraded: 4 });
      expect(out.grades.every(x => !x.passed)).toBe(true);
      expect(rubricPassRate(out.grades, CRITERIA.length)).toBe(0);
    }
  });

  it('defaults a missing comment to empty rather than dropping the verdict', () => {
    const out = collectRubricGrades(CRITERIA, [{ id: 1, passed: true }]);
    expect(out.grades[0]).toEqual({ criterion: CRITERIA[0], passed: true, comment: '' });
  });

  it('returns nothing to grade when there is no rubric', () => {
    expect(collectRubricGrades([], [{ id: 1, passed: true }])).toEqual({ grades: [], covered: 0, ungraded: 0 });
  });
});

describe('collectRubricGrades across attempts', () => {
  const CRITERIA = ['One', 'Two', 'Three', 'Four'];
  const g = (id: number, passed: boolean, comment = '') => ({ id, passed, comment });

  it('merges attempts that graded different criteria', () => {
    // Neither attempt covers more than the other; together they cover the rubric.
    const out = collectRubricGrades(CRITERIA, [g(1, true), g(2, false)], [g(3, true), g(4, true)]);
    expect(out).toMatchObject({ covered: 4, ungraded: 0 });
    expect(out.grades.map(x => x.passed)).toEqual([true, false, true, true]);
    expect(rubricPassRate(out.grades, CRITERIA.length)).toBe(75);
  });

  it('keeps the earlier attempt verdict when both graded the same criterion', () => {
    const out = collectRubricGrades(CRITERIA, [g(1, false, 'first attempt')], [g(1, true, 'second attempt'), g(2, true)]);
    expect(out.grades[0]).toMatchObject({ passed: false, comment: 'first attempt' });
    expect(out.grades[1].passed).toBe(true);
    expect(out.covered).toBe(2);
  });

  it('is unchanged by an attempt that adds nothing', () => {
    const first = [g(1, true), g(2, true)];
    expect(collectRubricGrades(CRITERIA, first, [g(1, false)])).toEqual(collectRubricGrades(CRITERIA, first));
  });

  it('takes grades from a later attempt when the first returned nothing usable', () => {
    const out = collectRubricGrades(CRITERIA, 'not an array', [g(1, true), g(2, true), g(3, true), g(4, true)]);
    expect(out).toMatchObject({ covered: 4, ungraded: 0 });
  });
});
