import { describe, expect, it } from 'vitest';
import { mergeRubricCriteria } from '@/lib/rubric-criteria';

describe('mergeRubricCriteria', () => {
  it('appends new criteria while preserving the existing order', () => {
    expect(mergeRubricCriteria(['Accuracy'], ['Clear labels', 'Actionable insights'])).toEqual([
      'Accuracy',
      'Clear labels',
      'Actionable insights',
    ]);
  });

  it('removes blank, non-string, and normalized duplicate criteria', () => {
    expect(mergeRubricCriteria(
      ['Uses formulas correctly'],
      ['  uses   formulas correctly  ', '', null, 'Explains every REVIEW result'],
    )).toEqual(['Uses formulas correctly', 'Explains every REVIEW result']);
  });
});

