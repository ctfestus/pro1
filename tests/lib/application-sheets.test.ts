import { beforeEach, describe, expect, it, vi } from 'vitest';

const spreadsheetGet = vi.fn();
const valuesGet = vi.fn();
const valuesAppend = vi.fn();
const valuesUpdate = vi.fn();
const valuesBatchClear = vi.fn();
const spreadsheetBatchUpdate = vi.fn();

vi.mock('@/lib/sheets', () => ({
  getGoogleSpreadsheetId: () => 'sheet-1',
  getGoogleSheetsClient: () => ({
    spreadsheets: {
      get: spreadsheetGet,
      batchUpdate: spreadsheetBatchUpdate,
      values: { get: valuesGet, append: valuesAppend, update: valuesUpdate, batchClear: valuesBatchClear },
    },
  }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { deleteApplicationFormData, resetApplicationSheetsSetupForTests, saveApplicationForm } from '@/lib/application-sheets';

const headers: Record<string, string[]> = {
  ApplicationForms: ['id', 'owner_id', 'owner_email', 'slug', 'status', 'created_at', 'updated_at', 'config_json'],
  ApplicationSubmissions: ['id', 'form_id', 'reference', 'email', 'state', 'stage_id', 'assigned_reviewer_id', 'assigned_reviewer_email', 'score', 'created_at', 'updated_at', 'submitted_at', 'token_hash', 'answers_json', 'private_notes_json', 'status_history_json', 'messages_json'],
  ApplicationAudit: ['id', 'entity_type', 'entity_id', 'action', 'actor_id', 'actor_email', 'occurred_at', 'details_json'],
};

beforeEach(() => {
  vi.clearAllMocks(); resetApplicationSheetsSetupForTests();
  spreadsheetGet.mockResolvedValue({ data: { sheets: Object.keys(headers).map(title => ({ properties: { title } })) } });
  valuesGet.mockImplementation(({ range }: { range: string }) => {
    const title = Object.keys(headers).find(name => range.includes(name))!;
    return Promise.resolve({ data: { values: range.endsWith('1:1') ? [headers[title]] : [headers[title]] } });
  });
  valuesAppend.mockResolvedValue({ data: {} }); valuesUpdate.mockResolvedValue({ data: {} }); valuesBatchClear.mockResolvedValue({ data: {} });
});

describe('application Google Sheets storage', () => {
  it('appends application records with RAW values to managed tabs', async () => {
    await saveApplicationForm({
      id: 'form-1', ownerId: 'owner-1', ownerEmail: '=unsafe@example.com', slug: 'bootcamp', status: 'draft',
      createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', config: newApplicationFormConfig(),
    });
    expect(valuesAppend).toHaveBeenCalledOnce();
    expect(valuesAppend.mock.calls[0][0].valueInputOption).toBe('RAW');
    expect(valuesAppend.mock.calls[0][0].requestBody.values[0][2]).toBe('=unsafe@example.com');
    expect(spreadsheetBatchUpdate).not.toHaveBeenCalled();
  });

  it('clears the form and its related submission rows', async () => {
    valuesGet.mockImplementation(({ range }: { range: string }) => {
      const title = Object.keys(headers).find(name => range.includes(name))!;
      if (range.endsWith('1:1')) return Promise.resolve({ data: { values: [headers[title]] } });
      if (title === 'ApplicationForms') return Promise.resolve({ data: { values: [headers[title], ['form-1'], ['form-2']] } });
      if (title === 'ApplicationSubmissions') return Promise.resolve({ data: { values: [headers[title], ['submission-1', 'form-1'], ['submission-2', 'form-2'], ['submission-3', 'form-1']] } });
      return Promise.resolve({ data: { values: [headers[title]] } });
    });

    await expect(deleteApplicationFormData('form-1')).resolves.toEqual({ deleted: true, submissionCount: 2 });
    expect(valuesBatchClear).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { ranges: [
        "'ApplicationForms'!A2:H2",
        "'ApplicationSubmissions'!A2:Q2",
        "'ApplicationSubmissions'!A4:Q4",
      ] },
    }));
  });
});
