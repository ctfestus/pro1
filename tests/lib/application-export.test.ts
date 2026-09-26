import { describe, expect, it } from 'vitest';
import { applicationSubmissionsCsv } from '@/lib/application-export';
import { newApplicationFormConfig } from '@/lib/application-forms';

describe('application submission export', () => {
  it('exports applicant answers and review fields without private data', () => {
    const config = newApplicationFormConfig('bootcamp');
    const question = config.questions[0];
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
  });
});
