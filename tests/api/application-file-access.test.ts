import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), getSubmission: vi.fn(), getForm: vi.fn(), signedUrl: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireRole: mocks.requireRole,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/application-submissions', () => ({ getApplicationSubmission: mocks.getSubmission }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({ storage: { from: () => ({ createSignedUrl: mocks.signedUrl }) } }),
}));

import { GET } from '@/app/api/application-submissions/[id]/files/[questionId]/route';
import { applicationQuestionFilePrefix } from '@/lib/application-storage';

const form = { id: 'form-1', ownerId: 'owner-1' };
const filePath = `form-1/submission-1/${applicationQuestionFilePrefix('question-1')}-12345678-1234-1234-1234-123456789abc.pdf`;
const submission = {
  id: 'submission-1', formId: form.id, assignedReviewerId: 'reviewer-1',
  answers: { 'question-1': {
    publicId: `supabase/${filePath}`,
    url: '', name: 'resume.pdf', size: 6, type: 'application/pdf',
  } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ role: 'staff', actor: { id: 'reviewer-1' } });
  mocks.getSubmission.mockResolvedValue(submission);
  mocks.getForm.mockResolvedValue(form);
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed-file' }, error: null });
});

describe('staff applicant file access', () => {
  it('issues a short-lived private download link for the assigned reviewer', async () => {
    const response = await GET(new Request('http://localhost/api/application-submissions/submission-1/files/question-1') as any, {
      params: Promise.resolve({ id: 'submission-1', questionId: 'question-1' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://storage.example/signed-file' });
    expect(mocks.signedUrl).toHaveBeenCalledWith(filePath, 60);
  });

  it('denies an unassigned staff member before signing the file', async () => {
    mocks.requireRole.mockResolvedValueOnce({ role: 'staff', actor: { id: 'other-reviewer' } });
    const response = await GET(new Request('http://localhost/api/application-submissions/submission-1/files/question-1') as any, {
      params: Promise.resolve({ id: 'submission-1', questionId: 'question-1' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it('does not reuse a file uploaded for a different question', async () => {
    mocks.getSubmission.mockResolvedValueOnce({
      ...submission, answers: { 'other-question': submission.answers['question-1'] },
    });
    const response = await GET(new Request('http://localhost/api/application-submissions/submission-1/files/other-question') as any, {
      params: Promise.resolve({ id: 'submission-1', questionId: 'other-question' }),
    });
    expect(response.status).toBe(404);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });
});
