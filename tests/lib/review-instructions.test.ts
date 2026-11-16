import fs from 'node:fs';
import { expect, it } from 'vitest';
import { REVIEW_GRADING_INSTRUCTIONS, rubricInstructions } from '@/lib/review-instructions';

it.each([
  'excel-review', 'code-review', 'dashboard-critique',
  'document-review', 'written-review', 've-answer-review',
])('%s uses the shared grading rules', feature => {
  const source = fs.readFileSync(`app/api/${feature}/route.ts`, 'utf8');
  expect(source.replace(/^import .*REVIEW_GRADING_INSTRUCTIONS.*$/m, '')).toContain('REVIEW_GRADING_INSTRUCTIONS');
});

it('keeps the shared rules to the task and forbids padding', () => {
  expect(REVIEW_GRADING_INSTRUCTIONS).toContain('Never invent requirements');
  expect(REVIEW_GRADING_INSTRUCTIONS).toContain('Do not pad');
});

it('makes the rubric the whole review, by id, with corrections only for failed criteria', () => {
  const block = rubricInstructions(['Uses SUMIFS', 'Assessment Note: accept alternatives'], 'issues');
  expect(block).toContain('id 2: Assessment Note: accept alternatives');
  expect(block).toContain('these criteria and nothing else');
  expect(block).toContain('Ids you omit are marked as not met');
  expect(block).toContain('- issues: only for failed criteria');
  expect(block).toContain('Return [] when every criterion passed');
  expect(rubricInstructions(['Uses SUMIFS'])).not.toContain('only for failed criteria');
});

it.each(['excel-review', 'code-review', 'dashboard-critique', 'document-review', 'written-review'])(
  '%s builds its rubric block from the shared wording', feature => {
    expect(fs.readFileSync(`app/api/${feature}/route.ts`, 'utf8')).toContain('rubricInstructions(rubric');
  });
