import { describe, expect, it } from 'vitest';
import { reviewTask } from '@/lib/review-target';

describe('reviewTask', () => {
  it('uses a course question and its context-free text', () => {
    expect(reviewTask({ question: '<p>Rank the <b>top five</b> products.</p>' })).toBe('Rank the top five products.');
  });

  it('uses an assignment task title and its description', () => {
    expect(reviewTask({ title: 'Revenue model', description: '<p>Build the Q3 forecast.</p>' })).toBe('Revenue model\n\nBuild the Q3 forecast.');
  });

  it('prefers the email a VE step showed over its plain description', () => {
    expect(reviewTask({ label: 'Send the deck', emailBody: 'Include a churn slide.', description: 'old text' })).toBe('Send the deck\n\nInclude a churn slide.');
  });

  it('is empty when the step has no task text', () => {
    expect(reviewTask({ rubric: ['x'] })).toBe('');
  });
});
