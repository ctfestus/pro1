import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ driveGet: vi.fn(), getUploadsFolder: vi.fn() }));
vi.mock('@/lib/application-sheets', () => ({ getApplicationUploadsFolderId: mocks.getUploadsFolder }));
vi.mock('@/lib/sheets', () => ({ getGoogleDriveClient: () => ({ files: { get: mocks.driveGet } }) }));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { normalizeApplicationDriveAnswers } from '@/lib/application-drive';

const config = newApplicationFormConfig();
const fileQuestion = config.questions.find(question => question.type === 'file')!;
const form = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const,
  responseSpreadsheetId: 'sheet-1', responseSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
  responseSheetLayout: {
    version: 2 as const, schemaHash: 'hash', uploadsFolderId: 'uploads-folder-1',
    responsesSheetId: 1, statusHistorySheetId: 2, privateNotesSheetId: 3, emailsSheetId: 4, filesSheetId: 5,
  },
  createdAt: '', updatedAt: '', config,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUploadsFolder.mockResolvedValue('uploads-folder-1');
  mocks.driveGet.mockResolvedValue({ data: {
    id: 'drive-file-1', name: 'APP-1 - resume.pdf', size: '12', mimeType: 'application/pdf',
    webViewLink: 'https://drive.google.com/file/d/drive-file-1/view', parents: ['uploads-folder-1'], trashed: false,
    appProperties: { applicationFormId: 'form-1', applicationSubmissionId: 'submission-1' },
  } });
});

describe('application Drive file validation', () => {
  it('replaces browser-provided metadata with verified Drive metadata', async () => {
    const result = await normalizeApplicationDriveAnswers(form, 'submission-1', {
      [fileQuestion.id]: {
        url: 'https://malicious.example/file', publicId: 'drive/form-1/submission-1/drive-file-1',
        name: 'fake.exe', size: 1, type: 'application/x-msdownload',
      },
    });

    expect(result.errors).toEqual({});
    expect(result.answers[fileQuestion.id]).toEqual({
      url: 'https://drive.google.com/file/d/drive-file-1/view',
      publicId: 'drive/form-1/submission-1/drive-file-1',
      name: 'resume.pdf', size: 12, type: 'application/pdf',
    });
  });

  it('rejects a Drive file that belongs to another submission', async () => {
    mocks.driveGet.mockResolvedValueOnce({ data: {
      id: 'drive-file-1', parents: ['uploads-folder-1'], trashed: false,
      appProperties: { applicationFormId: 'form-1', applicationSubmissionId: 'other-submission' },
    } });
    const result = await normalizeApplicationDriveAnswers(form, 'submission-1', {
      [fileQuestion.id]: {
        url: 'https://drive.google.com/file/d/drive-file-1/view',
        publicId: 'drive/form-1/submission-1/drive-file-1', name: 'resume.pdf', size: 12, type: 'application/pdf',
      },
    });
    expect(result.errors[fileQuestion.id]).toBe('Upload a valid file for this application.');
  });
});
