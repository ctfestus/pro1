import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spreadsheetGet: vi.fn(), spreadsheetBatchUpdate: vi.fn(), valuesGet: vi.fn(), valuesBatchGet: vi.fn(),
  valuesAppend: vi.fn(), valuesUpdate: vi.fn(), valuesBatchUpdate: vi.fn(), valuesClear: vi.fn(),
  driveCreate: vi.fn(), driveUpdate: vi.fn(), driveList: vi.fn(), getForm: vi.fn(),
  indexSelectResult: null as any, insertError: null as any, dbInsert: vi.fn(), dbUpdate: vi.fn(),
  dbDelete: vi.fn(), dbUpsert: vi.fn(),
}));

vi.mock('@/lib/sheets', () => ({
  getApplicationResponsesFolderId: () => 'shared-drive-folder',
  getGoogleDriveClient: () => ({ files: { create: mocks.driveCreate, update: mocks.driveUpdate, list: mocks.driveList } }),
  getGoogleSheetsClient: () => ({
    spreadsheets: {
      get: mocks.spreadsheetGet,
      batchUpdate: mocks.spreadsheetBatchUpdate,
      values: {
        get: mocks.valuesGet,
        batchGet: mocks.valuesBatchGet,
        append: mocks.valuesAppend,
        update: mocks.valuesUpdate,
        batchUpdate: mocks.valuesBatchUpdate,
        clear: mocks.valuesClear,
      },
    },
  }),
}));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: () => ({
      select: () => {
        const query: any = {
          eq: vi.fn(() => query),
          contains: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({ data: mocks.indexSelectResult, error: null })),
        };
        return query;
      },
      insert: mocks.dbInsert,
      update: mocks.dbUpdate,
      delete: mocks.dbDelete,
      upsert: mocks.dbUpsert,
    }),
  }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import {
  createApplicationResponseSpreadsheet,
  DuplicateApplicationError,
  getApplicationSubmissionByTokenHash,
  saveApplicationSubmission,
  syncApplicationResponseSchema,
} from '@/lib/application-sheets';

const layout = {
  version: 2 as const,
  schemaHash: 'schema-hash',
  storageFolderId: 'form-folder-1',
  uploadsFolderId: 'uploads-folder-1',
  responsesSheetId: 1,
  statusHistorySheetId: 2,
  privateNotesSheetId: 3,
  emailsSheetId: 4,
  filesSheetId: 5,
};
const config = newApplicationFormConfig();
const responseKeys = [
  'meta:reference', 'meta:email',
  ...config.questions.filter(question => question.type !== 'text_block').map(question => `question:${question.id}`),
  'meta:state', 'meta:status', 'meta:stage_id', 'meta:assigned_reviewer_email', 'meta:assigned_reviewer_id',
  'meta:score', 'meta:created_at', 'meta:submitted_at', 'meta:updated_at', 'meta:id',
];
const form = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const,
  responseSpreadsheetId: 'response-sheet-1', responseSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/response-sheet-1/edit',
  responseSheetLayout: layout, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', config,
};
const submission = {
  id: 'submission-1', formId: form.id, reference: 'APP-1', email: '=unsafe@example.com', state: 'submitted' as const,
  stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '', score: null,
  createdAt: '2026-09-25T01:00:00.000Z', updatedAt: '2026-09-25T01:00:00.000Z', submittedAt: '2026-09-25T01:00:00.000Z',
  tokenHash: 'hash-1', answers: {}, privateNotes: [], statusHistory: [{
    id: 'status-1', stageId: 'submitted', stageName: 'Submitted', actorEmail: '=unsafe@example.com',
    occurredAt: '2026-09-25T01:00:00.000Z',
  }], messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.indexSelectResult = null;
  mocks.insertError = null;
  mocks.getForm.mockResolvedValue(form);
  mocks.driveCreate
    .mockResolvedValueOnce({ data: { id: 'form-folder-1' } })
    .mockResolvedValueOnce({ data: { id: 'response-sheet-1', webViewLink: form.responseSpreadsheetUrl } })
    .mockResolvedValueOnce({ data: { id: 'uploads-folder-1' } });
  mocks.driveUpdate.mockResolvedValue({ data: {} });
  mocks.driveList.mockResolvedValue({ data: { files: [] } });
  mocks.spreadsheetGet
    .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 99, title: 'Sheet1' } }] } })
    .mockResolvedValueOnce({ data: { sheets: [
      { properties: { sheetId: 1, title: 'Responses' } },
      { properties: { sheetId: 2, title: '_StatusHistory' } },
      { properties: { sheetId: 3, title: '_PrivateNotes' } },
      { properties: { sheetId: 4, title: '_Emails' } },
      { properties: { sheetId: 5, title: '_Files' } },
    ] } });
  mocks.spreadsheetBatchUpdate.mockResolvedValue({ data: {} });
  mocks.valuesBatchUpdate.mockResolvedValue({ data: {} });
  mocks.valuesAppend.mockResolvedValue({ data: { updates: { updatedRange: "'Responses'!A3:N3" } } });
  mocks.valuesUpdate.mockResolvedValue({ data: {} });
  mocks.valuesClear.mockResolvedValue({ data: {} });
  mocks.valuesGet.mockResolvedValue({ data: { values: [] } });
  mocks.valuesBatchGet.mockResolvedValue({ data: { valueRanges: [] } });
  mocks.dbInsert.mockImplementation(async () => ({ error: mocks.insertError }));
  mocks.dbUpdate.mockImplementation(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  mocks.dbDelete.mockImplementation(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  mocks.dbUpsert.mockResolvedValue({ error: null });
});

describe('per-form Google Sheets response storage', () => {
  it('creates one Drive folder containing the response sheet and applicant uploads', async () => {
    const draftForm = { ...form, responseSpreadsheetId: undefined, responseSpreadsheetUrl: undefined, responseSheetLayout: undefined };
    const result = await createApplicationResponseSpreadsheet(draftForm);

    expect(result).toEqual(expect.objectContaining({
      id: 'response-sheet-1',
      url: form.responseSpreadsheetUrl,
      layout: expect.objectContaining({ storageFolderId: 'form-folder-1', uploadsFolderId: 'uploads-folder-1' }),
    }));
    expect(mocks.driveCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      supportsAllDrives: true,
      requestBody: expect.objectContaining({ parents: ['shared-drive-folder'], mimeType: 'application/vnd.google-apps.folder' }),
    }));
    expect(mocks.driveCreate.mock.calls[1][0].requestBody.parents).toEqual(['form-folder-1']);
    expect(mocks.driveCreate.mock.calls[2][0].requestBody.parents).toEqual(['form-folder-1']);
  });

  it('claims the database index before appending one canonical response row', async () => {
    await saveApplicationSubmission(submission);

    expect(mocks.dbInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: submission.id, form_id: form.id, token_hashes: ['hash-1'], state: 'submitted', sync_state: 'pending',
    }));
    expect(mocks.dbInsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.valuesAppend.mock.invocationCallOrder[0]);
    expect(mocks.valuesAppend).toHaveBeenCalledOnce();
    expect(mocks.valuesAppend.mock.calls[0][0]).toEqual(expect.objectContaining({
      valueInputOption: 'RAW',
      range: "'Responses'!A:A",
    }));
    expect(mocks.valuesAppend.mock.calls[0][0].requestBody.values[0][1]).toBe('=unsafe@example.com');
    expect(mocks.spreadsheetBatchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { requests: [expect.objectContaining({ appendCells: expect.objectContaining({ sheetId: 2 }) })] },
    }));
  });

  it('keeps drafts out of the visible response sheet', async () => {
    await saveApplicationSubmission({ ...submission, state: 'draft', submittedAt: '', statusHistory: [] });
    expect(mocks.dbInsert).toHaveBeenCalledOnce();
    expect(mocks.valuesAppend).not.toHaveBeenCalled();
  });

  it('does not write to Google Sheets when the duplicate claim fails', async () => {
    mocks.insertError = { code: '23505', message: 'duplicate' };
    await expect(saveApplicationSubmission(submission)).rejects.toBeInstanceOf(DuplicateApplicationError);
    expect(mocks.valuesAppend).not.toHaveBeenCalled();
  });

  it('rolls back the claimed row when normalized event storage fails', async () => {
    mocks.spreadsheetBatchUpdate.mockRejectedValueOnce(new Error('Sheets unavailable'));
    mocks.valuesGet.mockResolvedValueOnce({ data: { values: [[submission.id]] } });
    await expect(saveApplicationSubmission(submission)).rejects.toThrow('Sheets unavailable');
    expect(mocks.valuesClear).toHaveBeenCalledWith(expect.objectContaining({
      range: expect.stringContaining('A3:'),
    }));
    expect(mocks.dbDelete).toHaveBeenCalledOnce();
  });

  it('updates only headers when questions change and keeps removed answer columns', async () => {
    const removedKey = `question:${config.questions[0].id}`;
    const edited = {
      ...form,
      config: {
        ...config,
        questions: [...config.questions.slice(1), { id: 'new-question', label: 'New question', type: 'short_text' as const, required: false }],
      },
    };
    mocks.valuesGet.mockResolvedValueOnce({ data: { values: [responseKeys.map(key => key), responseKeys] } });

    const updated = await syncApplicationResponseSchema(edited);

    expect(updated.columnKeys).toEqual([...responseKeys, 'question:new-question']);
    expect(updated.columnKeys).toContain(removedKey);
    expect(mocks.valuesGet.mock.calls[0][0].range).toBe("'Responses'!1:2");
    expect(mocks.valuesUpdate.mock.calls[0][0].requestBody.values).toHaveLength(2);
    expect(mocks.valuesClear).not.toHaveBeenCalled();
  });

  it('finds the submission ID before updating a stale row and preserves removed answers', async () => {
    const removedQuestion = config.questions[0];
    const edited = {
      ...form,
      config: { ...config, questions: config.questions.filter(question => question.id !== removedQuestion.id) },
      responseSheetLayout: { ...layout, columnKeys: responseKeys },
    };
    mocks.getForm.mockResolvedValueOnce(edited);
    mocks.indexSelectResult = {
      id: submission.id, form_id: form.id, owner_id: form.ownerId, token_hashes: ['hash-1'],
      email_hash: 'email-hash', reference: submission.reference, state: 'submitted', sheet_row: 7,
      stage_id: 'submitted', assigned_reviewer_id: null, assigned_reviewer_email: '', score: null,
      sync_state: 'synced', last_sync_error: null, created_at: submission.createdAt, updated_at: submission.updatedAt,
    };
    const wrong = Array(responseKeys.length).fill('');
    wrong[responseKeys.indexOf('meta:id')] = 'someone-else';
    const correct = Array(responseKeys.length).fill('');
    correct[responseKeys.indexOf('meta:id')] = submission.id;
    correct[responseKeys.indexOf(`question:${removedQuestion.id}`)] = 'Preserved answer';
    mocks.valuesBatchGet
      .mockResolvedValueOnce({ data: { valueRanges: [{ values: [wrong] }] } })
      .mockResolvedValueOnce({ data: { valueRanges: [{ values: [[], [], correct] }] } });

    await saveApplicationSubmission(submission);

    expect(mocks.valuesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      range: expect.stringMatching(/!A5:[A-Z]+5$/),
      requestBody: { values: [expect.arrayContaining(['Preserved answer'])] },
    }));
    expect(mocks.valuesUpdate.mock.calls[0][0].range).not.toContain('7:');
    expect(mocks.dbUpdate).toHaveBeenCalledWith({ sheet_row: 5 });
  });

  it('loads a status link by its indexed row instead of scanning all responses', async () => {
    const questionCount = config.questions.filter(question => question.type !== 'text_block').length;
    const row = Array(questionCount + 12).fill('');
    row[0] = submission.reference;
    row[1] = submission.email;
    row[questionCount + 2] = 'submitted';
    row[questionCount + 3] = 'Submitted';
    row[questionCount + 4] = 'submitted';
    row[questionCount + 8] = submission.createdAt;
    row[questionCount + 9] = submission.submittedAt;
    row[questionCount + 10] = submission.updatedAt;
    row[questionCount + 11] = submission.id;
    mocks.indexSelectResult = {
      id: submission.id, form_id: form.id, owner_id: form.ownerId, token_hashes: ['hash-1'],
      email_hash: 'email-hash', reference: submission.reference, state: 'submitted', sheet_row: 7,
      stage_id: 'submitted', assigned_reviewer_id: null, assigned_reviewer_email: '', score: null,
      sync_state: 'synced', last_sync_error: null, created_at: submission.createdAt, updated_at: submission.updatedAt,
    };
    mocks.valuesBatchGet.mockResolvedValue({ data: { valueRanges: [
      { values: [row] }, { values: [] }, { values: [] }, { values: [] }, { values: [] },
    ] } });

    await expect(getApplicationSubmissionByTokenHash('hash-1')).resolves.toEqual(expect.objectContaining({ id: submission.id }));
    expect(mocks.valuesBatchGet.mock.calls[0][0].ranges).toHaveLength(1);
    expect(mocks.valuesBatchGet.mock.calls[0][0].ranges[0]).toMatch(/!A7:[A-Z]+7$/);
    expect(mocks.valuesBatchGet.mock.calls[0][0].ranges[0]).not.toContain('A3:');
  });
});
