import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSubmission: vi.fn(), getForm: vi.fn(), getUploadsFolder: vi.fn(), driveCreate: vi.fn(), bumpRateLimit: vi.fn(),
}));

vi.mock('@/lib/application-sheets', () => ({
  getApplicationSubmissionByTokenHash: mocks.getSubmission,
  getApplicationUploadsFolderId: mocks.getUploadsFolder,
}));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/application-access', () => ({ hashApplicationAccessToken: () => 'token-hash' }));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ bumpRateLimit: mocks.bumpRateLimit }));
vi.mock('@/lib/sheets', () => ({
  getGoogleDriveClient: () => ({ files: { create: mocks.driveCreate } }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { POST } from '@/app/api/public/applications/[token]/upload/route';

const form = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const,
  responseSpreadsheetId: 'sheet-1', responseSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
  responseSheetLayout: {
    version: 2 as const, schemaHash: 'hash', storageFolderId: 'form-folder-1', uploadsFolderId: 'uploads-folder-1',
    responsesSheetId: 1, statusHistorySheetId: 2, privateNotesSheetId: 3, emailsSheetId: 4, filesSheetId: 5,
  },
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
  config: newApplicationFormConfig(),
};
const submission = {
  id: 'submission-1', formId: form.id, reference: 'APP-1', email: 'applicant@example.com', state: 'draft' as const,
  stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '', score: null, createdAt: '', updatedAt: '',
  submittedAt: '', tokenHash: 'token-hash', answers: {}, privateNotes: [], statusHistory: [], messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bumpRateLimit.mockResolvedValue(false);
  mocks.getSubmission.mockResolvedValue(submission);
  mocks.getForm.mockResolvedValue(form);
  mocks.getUploadsFolder.mockResolvedValue('uploads-folder-1');
  mocks.driveCreate.mockResolvedValue({ data: {
    id: 'drive-file-1', webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
  } });
});

describe('applicant file uploads', () => {
  it('rejects a file over the deployment body limit before calling Drive', async () => {
    const data = new FormData();
    data.set('file', new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }));
    const response = await POST(new Request('http://localhost/api/public/applications/token/upload', {
      method: 'POST', body: data,
    }) as any, { params: Promise.resolve({ token: 'token' }) });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Files must be 4 MB or smaller.' });
    expect(mocks.driveCreate).not.toHaveBeenCalled();
  });

  it('stores the file in the form Drive folder and returns a sheet-safe Drive reference', async () => {
    const data = new FormData();
    data.set('file', new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
    const response = await POST(new Request('http://localhost/api/public/applications/token/upload', {
      method: 'POST', body: data,
    }) as any, { params: Promise.resolve({ token: 'token' }) });
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.driveCreate).toHaveBeenCalledWith(expect.objectContaining({
      supportsAllDrives: true,
      requestBody: expect.objectContaining({ parents: ['uploads-folder-1'], name: 'APP-1 - resume.pdf' }),
      media: expect.objectContaining({ mimeType: 'application/pdf' }),
    }));
    expect(value.file).toEqual(expect.objectContaining({
      url: 'https://drive.google.com/file/d/drive-file-1/view',
      publicId: 'drive/form-1/submission-1/drive-file-1',
      name: 'resume.pdf',
    }));
  });
});
