import { describe, expect, it } from 'vitest';
import { applicationSubmissionsCsv } from '@/lib/application-export';
import { newApplicationFormConfig } from '@/lib/application-forms';

describe('application submission export', () => {
  it('exports applicant answers and review fields without private data', () => {
    const config = newApplicationFormConfig('bootcamp');
    const question = config.questions[0];
    config.questions.splice(1, 0, { id: 'context', label: 'Read before applying', type: 'text_block', required: false, richText: '<p>Helpful context</p>' });
    config.questions.splice(2, 0, { id: 'banner', label: 'Campus photo', type: 'image', required: false, image: { url: 'https://images.pexels.com/photos/1/banner.jpeg' } });
    const form = {
      id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'data-bootcamp',
      status: 'published' as const, createdAt: '', updatedAt: '', config,
    };
    const csv = applicationSubmissionsCsv(form, [{
      id: 'submission-1', formId: form.id, reference: 'APP-1', email: 'applicant@example.com',
      state: 'submitted', stageId: 'screening', assignedReviewerId: 'reviewer-1',
      assignedReviewerEmail: 'reviewer@example.com', score: 82, createdAt: '', updatedAt: '',
      submittedAt: '2026-09-26T10:00:00.000Z', tokenHash: 'private-token-hash',
      answers: { [question.id]: '=Injected formula' },
      privateNotes: [{ id: 'note-1', body: 'Internal only', authorEmail: 'admin@example.com', createdAt: '' }],
      statusHistory: [], messages: [],
    }]);

    expect(csv).toContain('"Reference","Email","Stage","Submitted at","Assigned reviewer","Score"');
    expect(csv).toContain('"APP-1","applicant@example.com","Screening"');
    expect(csv).toContain('"\'=Injected formula"');
    expect(csv).not.toContain('private-token-hash');
    expect(csv).not.toContain('Internal only');
    expect(csv).not.toContain('Read before applying');
    expect(csv).not.toContain('Campus photo');
  });

  it('keeps answers to questions removed from a published form', () => {
    const form = {
      id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp',
      status: 'published' as const, createdAt: '', updatedAt: '', config: newApplicationFormConfig(),
    };
    const csv = applicationSubmissionsCsv(form, [{
      id: 'submission-1', formId: form.id, reference: 'APP-1', email: 'applicant@example.com',
      state: 'submitted', stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '',
      score: null, createdAt: '', updatedAt: '', submittedAt: '', tokenHash: 'secret',
      answers: { removed_question: 'An earlier answer' }, questionLabels: { removed_question: 'Previous question' },
      privateNotes: [], statusHistory: [], messages: [],
    }]);
    expect(csv).toContain('"Previous question"');
    expect(csv).toContain('"An earlier answer"');
  });
});
