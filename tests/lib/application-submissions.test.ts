import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), getForm: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { DuplicateApplicationError, getApplicationSubmissionByTokenHash, saveApplicationSubmission } from '@/lib/application-submissions';

const form = {
  id: 'form-1', ownerId: 'owner-1', config: newApplicationFormConfig(),
};
const submission = {
  id: 'submission-1', formId: form.id, email: 'applicant@example.com', reference: 'APP-1',
  state: 'submitted' as const, stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '',
  score: null, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:01:00.000Z',
  submittedAt: '2026-09-28T00:01:00.000Z', tokenHash: 'hash-1',
  answers: { old_question: 'Retained answer' }, questionLabels: { old_question: 'Old question' },
  privateNotes: [{ id: 'note-1', body: 'Private', authorEmail: 'reviewer@example.com', createdAt: '2026-09-28T00:01:00.000Z' }],
  statusHistory: [{ id: 'status-1', stageId: 'submitted', stageName: 'Submitted', actorEmail: 'applicant@example.com', occurredAt: '2026-09-28T00:01:00.000Z' }],
  messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getForm.mockResolvedValue(form);
  const query: any = {
    eq: vi.fn(() => query), contains: vi.fn(() => query), select: vi.fn(() => query),
    maybeSingle: mocks.maybeSingle, insert: mocks.insert, update: mocks.update,
  };
  mocks.from.mockReturnValue(query);
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue(query);
});

describe('Supabase application responses', () => {
  it('stores answers and review fields in the database without creating a sheet', async () => {
    await saveApplicationSubmission(submission);
    expect(mocks.from).toHaveBeenCalledWith('application_submissions');
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      email: 'applicant@example.com', answers: { old_question: 'Retained answer' },
      question_labels: expect.objectContaining({ old_question: 'Old question' }),
      status_history: submission.statusHistory, private_notes: submission.privateNotes, messages: [],
    }));
  });

  it('rejects a second submitted application for the same form and email', async () => {
    mocks.insert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate' } });
    await expect(saveApplicationSubmission(submission)).rejects.toBeInstanceOf(DuplicateApplicationError);
  });

  it('rejects a stale draft that another request already submitted', async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: { state: 'draft', question_labels: {}, token_hashes: ['hash-1'] }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(saveApplicationSubmission(submission)).rejects.toBeInstanceOf(DuplicateApplicationError);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('resolves status-link tokens from the database row', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: {
      id: submission.id, form_id: submission.formId, email: submission.email,
      reference: submission.reference, state: submission.state, stage_id: submission.stageId,
      assigned_reviewer_id: null, assigned_reviewer_email: '', score: null,
      created_at: submission.createdAt, updated_at: submission.updatedAt,
      submitted_at: submission.submittedAt, token_hashes: ['hash-1'],
      answers: submission.answers, question_labels: submission.questionLabels,
      status_history: [], private_notes: [], messages: [],
    }, error: null });
    const found = await getApplicationSubmissionByTokenHash('hash-1');
    expect(found?.answers.old_question).toBe('Retained answer');
    expect(found?.tokenHash).toBe('hash-1');
  });
});
