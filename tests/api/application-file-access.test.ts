import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), getSubmission: vi.fn(), getForm: vi.fn(), getUploadsFolder: vi.fn(), driveGet: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireRole: mocks.requireRole,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/application-sheets', () => ({
  getApplicationSubmission: mocks.getSubmission,
  getApplicationUploadsFolderId: mocks.getUploadsFolder,
}));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/sheets', () => ({ getGoogleDriveClient: () => ({ files: { get: mocks.driveGet } }) }));

import { GET } from '@/app/api/application-submissions/[id]/files/[questionId]/route';

const form = { id: 'form-1', ownerId: 'owner-1' };
const submission = {
  id: 'submission-1', formId: form.id, assignedReviewerId: 'reviewer-1',
  answers: { 'question-1': {
    publicId: 'drive/form-1/submission-1/drive-file-1',
    url: 'https://drive.google.com/file/d/drive-file-1/view',
    name: 'resume.pdf', size: 6, type: 'application/pdf',
  } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ role: 'staff', actor: { id: 'reviewer-1' } });
  mocks.getSubmission.mockResolvedValue(submission);
  mocks.getForm.mockResolvedValue(form);
  mocks.getUploadsFolder.mockResolvedValue('uploads-folder-1');
  mocks.driveGet.mockImplementation(async ({ alt }: { alt?: string }) => alt === 'media'
    ? { data: new TextEncoder().encode('resume') }
    : { data: {
      id: 'drive-file-1', name: 'resume.pdf', mimeType: 'application/pdf', parents: ['uploads-folder-1'],
      trashed: false, appProperties: { applicationFormId: 'form-1', applicationSubmissionId: 'submission-1' },
    } });
});

describe('staff applicant file access', () => {
  it('opens an assigned applicant file using the service account', async () => {
    const response = await GET(new Request('http://localhost/api/application-submissions/submission-1/files/question-1') as any, {
      params: Promise.resolve({ id: 'submission-1', questionId: 'question-1' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(await response.text()).toBe('resume');
    expect(mocks.driveGet).toHaveBeenCalledTimes(2);
  });

  it('denies an unassigned staff member before reading Drive', async () => {
    mocks.requireRole.mockResolvedValueOnce({ role: 'staff', actor: { id: 'other-reviewer' } });
    const response = await GET(new Request('http://localhost/api/application-submissions/submission-1/files/question-1') as any, {
      params: Promise.resolve({ id: 'submission-1', questionId: 'question-1' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.driveGet).not.toHaveBeenCalled();
  });
});
