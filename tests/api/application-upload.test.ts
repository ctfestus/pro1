import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSubmission: vi.fn(), getForm: vi.fn(), signedUpload: vi.fn(), bumpRateLimit: vi.fn(),
}));

vi.mock('@/lib/application-submissions', () => ({
  getApplicationSubmissionByTokenHash: mocks.getSubmission,
}));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/application-access', () => ({ hashApplicationAccessToken: () => 'token-hash' }));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ bumpRateLimit: mocks.bumpRateLimit }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl: mocks.signedUpload }) } }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { POST } from '@/app/api/public/applications/[token]/upload/route';

const config = newApplicationFormConfig();
const fileQuestion = { id: 'portfolio', label: 'Portfolio', type: 'file' as const, required: false };
const form = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const,
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
  config: { ...config, questions: [...config.questions, fileQuestion] },
};
const submission = {
  id: 'submission-1', formId: form.id, reference: 'APP-1', email: 'applicant@example.com', state: 'draft' as const,
  stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '', score: null,
  createdAt: new Date().toISOString(), updatedAt: '', submittedAt: '', tokenHash: 'token-hash',
  answers: {}, privateNotes: [], statusHistory: [], messages: [],
};

async function prepareUpload(size: number, questionId = fileQuestion.id) {
  return POST(new Request('http://localhost/api/public/applications/token/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, name: 'resume.pdf', size, type: 'application/pdf' }),
  }) as any, { params: Promise.resolve({ token: 'token' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bumpRateLimit.mockResolvedValue(false);
  mocks.getSubmission.mockResolvedValue(submission);
  mocks.getForm.mockResolvedValue(form);
  mocks.signedUpload.mockResolvedValue({ data: { token: 'signed-upload-token' }, error: null });
});

describe('applicant file uploads', () => {
  it('issues a scoped signed upload without proxying the file through Vercel', async () => {
    const response = await prepareUpload(6 * 1024 * 1024);
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.signedUpload).toHaveBeenCalledWith(expect.stringMatching(/^form-1\/submission-1\/[a-f0-9]{12}-[a-f0-9-]+\.pdf$/));
    expect(value).toEqual(expect.objectContaining({
      bucket: 'application-uploads', uploadToken: 'signed-upload-token',
      file: expect.objectContaining({ name: 'resume.pdf', size: 6 * 1024 * 1024, url: '' }),
    }));
    expect(value.file.publicId).toBe(`supabase/${value.path}`);
  });

  it('rejects files over 10 MB and non-file questions', async () => {
    expect((await prepareUpload(10 * 1024 * 1024 + 1)).status).toBe(413);
    expect((await prepareUpload(100, config.questions[0].id)).status).toBe(400);
    expect(mocks.signedUpload).not.toHaveBeenCalled();
  });
});
