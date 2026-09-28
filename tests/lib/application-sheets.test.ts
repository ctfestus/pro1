import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spreadsheetGet: vi.fn(), valuesGet: vi.fn(), valuesAppend: vi.fn(), valuesUpdate: vi.fn(),
  valuesBatchUpdate: vi.fn(), valuesClear: vi.fn(), spreadsheetBatchUpdate: vi.fn(),
  driveCreate: vi.fn(), indexUpsert: vi.fn(), getForm: vi.fn(),
}));
const {
  spreadsheetGet, valuesGet, valuesAppend, valuesUpdate, valuesBatchUpdate, valuesClear,
  spreadsheetBatchUpdate, driveCreate, indexUpsert, getForm,
} = mocks;

vi.mock('@/lib/sheets', () => ({
  getApplicationResponsesFolderId: () => 'folder-1',
  getGoogleDriveClient: () => ({ files: { create: mocks.driveCreate, update: vi.fn() } }),
  getGoogleSheetsClient: () => ({
    spreadsheets: {
      get: mocks.spreadsheetGet,
      batchUpdate: mocks.spreadsheetBatchUpdate,
      values: { get: mocks.valuesGet, append: mocks.valuesAppend, update: mocks.valuesUpdate, batchUpdate: mocks.valuesBatchUpdate, clear: mocks.valuesClear },
    },
  }),
}));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({ from: () => ({ upsert: mocks.indexUpsert }) }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { createApplicationResponseSpreadsheet, saveApplicationSubmission } from '@/lib/application-sheets';

const form = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const,
  responseSpreadsheetId: 'response-sheet-1', responseSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/response-sheet-1/edit',
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', config: newApplicationFormConfig(),
};

const submission = {
  id: 'submission-1', formId: form.id, reference: 'APP-1', email: '=unsafe@example.com', state: 'submitted' as const,
  stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '', score: null,
  createdAt: '2026-09-25T01:00:00.000Z', updatedAt: '2026-09-25T01:00:00.000Z', submittedAt: '2026-09-25T01:00:00.000Z',
  tokenHash: 'hash-1', answers: {}, privateNotes: [], statusHistory: [], messages: [],
};

const dataHeaders = [
  'id', 'form_id', 'reference', 'email', 'state', 'stage_id', 'assigned_reviewer_id',
  'assigned_reviewer_email', 'score', 'created_at', 'updated_at', 'submitted_at',
  'token_hash', 'answers_json', 'private_notes_json', 'status_history_json', 'messages_json',
];

beforeEach(() => {
  vi.clearAllMocks();
  getForm.mockResolvedValue(form);
  driveCreate.mockResolvedValue({ data: { id: 'response-sheet-1', webViewLink: form.responseSpreadsheetUrl } });
  spreadsheetGet.mockResolvedValue({ data: { sheets: [
    { properties: { sheetId: 1, title: 'Responses' } },
    { properties: { sheetId: 2, title: '_ApplicationData', hidden: true } },
  ] } });
  valuesGet.mockImplementation(({ range }: { range: string }) => {
    if (range.includes('_ApplicationData') && range.endsWith('1:1')) return Promise.resolve({ data: { values: [dataHeaders] } });
    if (range.includes('Responses') && range.endsWith('1:2')) return Promise.resolve({ data: { values: [] } });
    return Promise.resolve({ data: { values: [dataHeaders] } });
  });
  valuesAppend.mockResolvedValue({ data: {} });
  valuesUpdate.mockResolvedValue({ data: {} });
  valuesBatchUpdate.mockResolvedValue({ data: {} });
  valuesClear.mockResolvedValue({ data: {} });
  spreadsheetBatchUpdate.mockResolvedValue({ data: {} });
  indexUpsert.mockResolvedValue({ error: null });
});

describe('per-form Google Sheets response storage', () => {
  it('creates a response spreadsheet in the configured Drive folder', async () => {
    await expect(createApplicationResponseSpreadsheet({ ...form, responseSpreadsheetId: undefined, responseSpreadsheetUrl: undefined }))
      .resolves.toEqual({ id: 'response-sheet-1', url: form.responseSpreadsheetUrl });
    expect(driveCreate).toHaveBeenCalledWith(expect.objectContaining({
      supportsAllDrives: true,
      requestBody: expect.objectContaining({ parents: ['folder-1'], mimeType: 'application/vnd.google-apps.spreadsheet' }),
    }));
  });

  it('writes canonical and readable response rows with RAW values', async () => {
    await saveApplicationSubmission(submission);
    expect(valuesAppend).toHaveBeenCalledTimes(2);
    expect(valuesAppend.mock.calls.every(call => call[0].valueInputOption === 'RAW')).toBe(true);
    expect(valuesAppend.mock.calls[0][0].requestBody.values[0][3]).toBe('=unsafe@example.com');
    expect(valuesAppend.mock.calls[1][0].requestBody.values[0][1]).toBe('=unsafe@example.com');
    expect(indexUpsert).toHaveBeenCalledWith(expect.objectContaining({
      id: submission.id,
      form_id: form.id,
      token_hashes: ['hash-1'],
      state: 'submitted',
    }), { onConflict: 'id' });
  });
});
