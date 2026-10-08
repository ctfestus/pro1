import fs from 'node:fs';
import { expect, it } from 'vitest';
import { REVIEW_GRADING_INSTRUCTIONS } from '@/lib/review-instructions';

it.each([
  'excel-review', 'code-review', 'dashboard-critique',
  'document-review', 'written-review', 've-answer-review',
])('%s uses the shared grading rules', feature => {
  const source = fs.readFileSync(`app/api/${feature}/route.ts`, 'utf8');
  expect(source.replace(/^import .*REVIEW_GRADING_INSTRUCTIONS.*$/m, '')).toContain('REVIEW_GRADING_INSTRUCTIONS');
});

it('uses an 80-point complete-work floor and rubric-first dashboard scoring', () => {
  expect(REVIEW_GRADING_INSTRUCTIONS).toContain('at least 80 out of 100');
  const instruction = fs.readFileSync('app/api/dashboard-critique/route.ts', 'utf8')
    .split('\n').find(line => line.startsWith('- overallScore:'));
  expect(instruction).toContain('score rubric completion only');
  expect(instruction).toContain('at least 80 when every criterion passes');
  expect(instruction).toContain('Only when no rubric is supplied, use the weighted average');
});
