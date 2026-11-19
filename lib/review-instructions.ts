// What the AI reviewers are asked for: the shared grading rules, the rubric block and the response
// schema. One wording and one schema, so every reviewer treats a rubric the same way.
//
// Two modes. With a rubric the review IS the rubric: a verdict per criterion, carrying where the
// problem is and the fix when it is not met, plus a short summary -- no findings list, no
// recommendations, no quality categories and no model-chosen score (the route computes the score from
// the verdicts, see lib/review-gate). Without a rubric the reviewer runs its own audit and scores it.

import type { JsonSchema } from '@/lib/ai';

export const REVIEW_GRADING_INSTRUCTIONS = `GRADING RULES - these take precedence over any other guidance in this prompt:
- Judge only what the task asked for. Never invent requirements.
- Never deduct for facts that cannot be verified from the submission and supplied data, such as screenshot interaction or an unavailable database schema. State the evidence limitation; do not claim unverified work is correct or incorrect. Required work that is demonstrably absent still counts against the submission.
- Label any optional improvement "Optional". Optional advice never reduces a score or fails a criterion.
- Do not pad. When there is nothing to correct, return an empty list rather than inventing a finding or a recommendation.`;

/**
 * For a review without a rubric: the task the student was set, which the review is judged against,
 * so the reviewer's built-in checklist cannot take over. Empty when the step has no task text.
 */
export function taskInstructions(task: string): string {
  if (!task) return '';
  return `THE TASK THE STUDENT WAS SET:
${task}

Judge the work against this task. Use the review areas in these instructions only where they bear on it: a point the task does not need is at most an Optional suggestion and never lowers a score.
`;
}

/**
 * The rubric block for a review prompt. `location` says what a location is for this kind of work,
 * for example 'the cell or range, e.g. "Sheet1!C12"'.
 */
export function rubricInstructions(rubric: readonly string[], location: string): string {
  return `INSTRUCTOR RUBRIC - THIS IS THE WHOLE REVIEW
The rubric below is what the student was asked to do. Review the submission against these criteria and nothing else. Do not comment on anything the rubric does not ask for, even if you would normally flag it.

Criteria:
${rubric.map((criterion, i) => `id ${i + 1}: ${criterion}`).join('\n')}

Return:
- rubricGrades: one entry per id, each id exactly once: its "id" as numbered above, a "passed" boolean, a 1-2 sentence "comment" naming the evidence you checked, and two fields for a criterion that is not met: "location" (${location}) and "fix" (the exact change that would meet the criterion). Return "" for location and fix when the criterion is met. A criterion passes or fails as a whole; pass it only when the submission shows it was met. Ids you omit are marked as not met, and ids that are not on this list are discarded.
- For an "Assessment Note" line, return passed: true, "" for location and fix, and say in the comment how you applied the note. A note is guidance on how to grade, not a requirement to fail.
- executiveSummary: 2-3 sentences addressed to the student on which criteria were met and which were not.`;
}

const strings = (fields: readonly string[]) => ({
  type: 'object',
  properties: Object.fromEntries(fields.map(field => [field, { type: 'string' }])),
  required: [...fields],
});

const CATEGORIES = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name:      { type: 'string' },
      score:     { type: 'number' },
      summary:   { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' } },
      gaps:      { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'score', 'summary', 'strengths', 'gaps'],
  },
};

// Required whenever a rubric is in play: left optional, a model drops the grades often enough that
// every criterion would come back "not graded" and fail the student for the model's omission.
export const RUBRIC_GRADES = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id:       { type: 'integer', description: 'The criterion id as numbered in the instructor rubric.' },
      passed:   { type: 'boolean' },
      comment:  { type: 'string' },
      location: { type: 'string' },
      fix:      { type: 'string' },
    },
    required: ['id', 'passed', 'comment', 'location', 'fix'],
  },
};

/**
 * Response schema for a review. With a rubric it is the summary and the grades, which carry their
 * own fixes. Without one, `findings` is the list of corrections and its string fields, for example
 * { key: 'issues', fields: ['lines', 'severity', 'title', 'detail', 'fix'] }; leave it out for a
 * brief review that returns no findings. Every property listed is required.
 */
export function reviewSchema(opts: { findings?: { key: string; fields: readonly string[] }; hasRubric: boolean }): JsonSchema {
  if (opts.hasRubric) {
    return {
      type: 'object',
      properties: { executiveSummary: { type: 'string' }, rubricGrades: RUBRIC_GRADES },
      required: ['executiveSummary', 'rubricGrades'],
    };
  }
  const properties: Record<string, JsonSchema> = { executiveSummary: { type: 'string' }, overallScore: { type: 'number' } };
  if (opts.findings) {
    properties[opts.findings.key] = { type: 'array', items: strings(opts.findings.fields) };
    properties.categories = CATEGORIES;
  }
  properties.topRecommendations = { type: 'array', items: { type: 'string' } };
  return { type: 'object', properties, required: Object.keys(properties) };
}
