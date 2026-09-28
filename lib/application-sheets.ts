import { createHash } from 'crypto';
import type {
  ApplicationAnswer,
  ApplicationAuditRecord,
  ApplicationFormRecord,
  ApplicationSubmissionRecord,
} from '@/lib/application-forms';
import { getApplicationForm } from '@/lib/application-form-store';
import { adminClient } from '@/lib/admin-client';
import {
  getApplicationResponsesFolderId,
  getGoogleDriveClient,
  getGoogleSheetsClient,
} from '@/lib/sheets';

const RESPONSE_SHEET = 'Responses';
const DATA_SHEET = '_ApplicationData';
const DATA_HEADERS = [
  'id', 'form_id', 'reference', 'email', 'state', 'stage_id', 'assigned_reviewer_id',
  'assigned_reviewer_email', 'score', 'created_at', 'updated_at', 'submitted_at',
  'token_hash', 'answers_json', 'private_notes_json', 'status_history_json', 'messages_json',
] as const;

type SubmissionIndexRow = {
  id: string;
  form_id: string;
  owner_id: string;
  token_hashes: string[];
  email_hash: string;
  state: ApplicationSubmissionRecord['state'];
  assigned_reviewer_id: string | null;
};

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? JSON.parse(String(value)) as T : fallback;
  } catch {
    return fallback;
  }
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function submissionFromRow(row: string[]): ApplicationSubmissionRecord {
  return {
    id: row[0], formId: row[1], reference: row[2], email: row[3], state: row[4] as ApplicationSubmissionRecord['state'],
    stageId: row[5], assignedReviewerId: row[6], assignedReviewerEmail: row[7], score: row[8] === '' ? null : Number(row[8]),
    createdAt: row[9], updatedAt: row[10], submittedAt: row[11], tokenHash: row[12],
    answers: parseJson(row[13], {}), privateNotes: parseJson(row[14], []), statusHistory: parseJson(row[15], []), messages: parseJson(row[16], []),
  };
}

function submissionToRow(item: ApplicationSubmissionRecord): string[] {
  return [
    item.id, item.formId, item.reference, item.email, item.state, item.stageId,
    item.assignedReviewerId, item.assignedReviewerEmail, item.score ?? '', item.createdAt,
    item.updatedAt, item.submittedAt, item.tokenHash, JSON.stringify(item.answers),
    JSON.stringify(item.privateNotes), JSON.stringify(item.statusHistory), JSON.stringify(item.messages),
  ].map(asText);
}

function answerCell(answer: ApplicationAnswer): string | number | boolean {
  if (answer === null || answer === undefined) return '';
  if (Array.isArray(answer)) return answer.join(', ');
  if (typeof answer === 'object') return answer.url;
  return answer;
}

function responseColumns(form: ApplicationFormRecord) {
  return [
    { key: 'meta:reference', label: 'Reference' },
    { key: 'meta:email', label: 'Email' },
    ...form.config.questions.filter(question => question.type !== 'text_block').map(question => ({
      key: `question:${question.id}`,
      label: question.label,
    })),
    { key: 'meta:status', label: 'Status' },
    { key: 'meta:assigned_reviewer_email', label: 'Assigned reviewer' },
    { key: 'meta:score', label: 'Score' },
    { key: 'meta:submitted_at', label: 'Submitted at' },
    { key: 'meta:updated_at', label: 'Last updated' },
    { key: 'meta:id', label: 'Submission ID' },
  ];
}

function responseRow(form: ApplicationFormRecord, item: ApplicationSubmissionRecord): Array<string | number | boolean> {
  const stage = form.config.stages.find(value => value.id === item.stageId);
  return responseColumns(form).map(column => {
    if (column.key.startsWith('question:')) return answerCell(item.answers[column.key.slice('question:'.length)]);
    if (column.key === 'meta:reference') return item.reference;
    if (column.key === 'meta:email') return item.email;
    if (column.key === 'meta:status') return stage?.name ?? item.stageId;
    if (column.key === 'meta:assigned_reviewer_email') return item.assignedReviewerEmail;
    if (column.key === 'meta:score') return item.score ?? '';
    if (column.key === 'meta:submitted_at') return item.submittedAt;
    if (column.key === 'meta:updated_at') return item.updatedAt;
    return item.id;
  });
}

async function dataRows(form: ApplicationFormRecord): Promise<string[][]> {
  if (!form.responseSpreadsheetId) return [];
  const result = await getGoogleSheetsClient().spreadsheets.values.get({
    spreadsheetId: form.responseSpreadsheetId,
    range: `${quoteSheet(DATA_SHEET)}!A:Q`,
  });
  return (result.data.values ?? []).slice(1).map(row => row.map(asText));
}

async function syncResponseView(form: ApplicationFormRecord, rows: string[][]): Promise<void> {
  const columns = responseColumns(form);
  const width = columnName(columns.length - 1);
  const values = [
    columns.map(column => column.label),
    columns.map(column => column.key),
    ...rows.filter(row => row[0]).map(row => responseRow(form, submissionFromRow(row))),
  ];
  const sheets = getGoogleSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: form.responseSpreadsheetId!,
    range: `${quoteSheet(RESPONSE_SHEET)}!A:ZZ`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: form.responseSpreadsheetId!,
    range: `${quoteSheet(RESPONSE_SHEET)}!A1:${width}${values.length}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

async function ensureApplicationSpreadsheet(form: ApplicationFormRecord): Promise<void> {
  if (!form.responseSpreadsheetId) throw new Error('This form does not have a response spreadsheet. Publish it to create one.');
  const sheets = getGoogleSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: form.responseSpreadsheetId,
    fields: 'sheets.properties(sheetId,title,hidden)',
  });
  const existing = meta.data.sheets ?? [];
  const titles = new Set(existing.map(sheet => sheet.properties?.title).filter(Boolean));
  const requests: Array<Record<string, unknown>> = [];
  if (!titles.has(RESPONSE_SHEET)) {
    const first = existing.find(sheet => sheet.properties?.title === 'Sheet1');
    if (first?.properties?.sheetId !== undefined) {
      requests.push({ updateSheetProperties: { properties: { sheetId: first.properties.sheetId, title: RESPONSE_SHEET }, fields: 'title' } });
    } else {
      requests.push({ addSheet: { properties: { title: RESPONSE_SHEET } } });
    }
  }
  if (!titles.has(DATA_SHEET)) requests.push({ addSheet: { properties: { title: DATA_SHEET, hidden: true } } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: form.responseSpreadsheetId, requestBody: { requests } });

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: form.responseSpreadsheetId,
    range: `${quoteSheet(DATA_SHEET)}!1:1`,
  });
  const currentDataHeader = header.data.values?.[0] ?? [];
  if (!currentDataHeader.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: form.responseSpreadsheetId,
      range: `${quoteSheet(DATA_SHEET)}!A1:Q1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...DATA_HEADERS]] },
    });
  } else if (DATA_HEADERS.some((name, index) => currentDataHeader[index] !== name)) {
    throw new Error('The internal application data sheet header has changed.');
  }

  const responseHeader = await sheets.spreadsheets.values.get({
    spreadsheetId: form.responseSpreadsheetId,
    range: `${quoteSheet(RESPONSE_SHEET)}!1:2`,
  });
  const expectedKeys = responseColumns(form).map(column => column.key);
  const currentKeys = responseHeader.data.values?.[1] ?? [];
  if (expectedKeys.length !== currentKeys.length || expectedKeys.some((key, index) => currentKeys[index] !== key)) {
    await syncResponseView(form, await dataRows(form));
  }
  if (currentKeys.length === 0) {
    const refreshed = requests.length
      ? await sheets.spreadsheets.get({ spreadsheetId: form.responseSpreadsheetId, fields: 'sheets.properties(sheetId,title)' })
      : meta;
    const responseSheetId = refreshed.data.sheets?.find(sheet => sheet.properties?.title === RESPONSE_SHEET)?.properties?.sheetId;
    if (responseSheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: form.responseSpreadsheetId,
        requestBody: { requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: responseSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: responseSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
              properties: { hiddenByUser: true },
              fields: 'hiddenByUser',
            },
          },
        ] },
      });
    }
  }
}

export async function createApplicationResponseSpreadsheet(form: ApplicationFormRecord): Promise<{ id: string; url: string }> {
  const folderId = getApplicationResponsesFolderId();
  const created = await getGoogleDriveClient().files.create({
    supportsAllDrives: true,
    requestBody: {
      name: `${form.config.title.trim().slice(0, 120)} - Responses`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id,webViewLink',
  });
  const id = created.data.id;
  if (!id) throw new Error('Google Drive did not return a spreadsheet ID.');
  const prepared = {
    ...form,
    responseSpreadsheetId: id,
    responseSpreadsheetUrl: created.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${id}/edit`,
  };
  try {
    await ensureApplicationSpreadsheet(prepared);
  } catch (error) {
    await getGoogleDriveClient().files.update({ fileId: id, supportsAllDrives: true, requestBody: { trashed: true } }).catch(() => undefined);
    throw error;
  }
  return { id, url: prepared.responseSpreadsheetUrl! };
}

export async function trashApplicationResponseSpreadsheet(spreadsheetId: string): Promise<void> {
  await getGoogleDriveClient().files.update({ fileId: spreadsheetId, supportsAllDrives: true, requestBody: { trashed: true } });
}

export async function listApplicationSubmissions(formId?: string): Promise<ApplicationSubmissionRecord[]> {
  if (formId) {
    const form = await getApplicationForm(formId);
    if (!form?.responseSpreadsheetId) return [];
    await ensureApplicationSpreadsheet(form);
    return (await dataRows(form)).filter(row => row[0]).map(submissionFromRow);
  }
  const { data, error } = await adminClient().from('application_submission_index').select('form_id');
  if (error) throw new Error(`Could not load application submission index: ${error.message}`);
  const formIds = [...new Set((data ?? []).map(row => String(row.form_id)))];
  const groups = await Promise.all(formIds.map(id => listApplicationSubmissions(id)));
  return groups.flat();
}

async function indexedSubmission(query: { id?: string; tokenHash?: string }): Promise<ApplicationSubmissionRecord | null> {
  let request = adminClient().from('application_submission_index').select('id,form_id,owner_id,token_hashes,email_hash,state,assigned_reviewer_id');
  request = query.id ? request.eq('id', query.id) : request.contains('token_hashes', [query.tokenHash!]);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error(`Could not locate application submission: ${error.message}`);
  if (!data) return null;
  const index = data as SubmissionIndexRow;
  const submissions = await listApplicationSubmissions(index.form_id);
  return submissions.find(item => item.id === index.id) ?? null;
}

export async function getApplicationSubmission(id: string): Promise<ApplicationSubmissionRecord | null> {
  return indexedSubmission({ id });
}

export async function getApplicationSubmissionByTokenHash(tokenHash: string): Promise<ApplicationSubmissionRecord | null> {
  return indexedSubmission({ tokenHash });
}

export async function getApplicationSubmissionByEmail(formId: string, email: string): Promise<ApplicationSubmissionRecord | null> {
  const normalized = email.trim().toLowerCase();
  return (await listApplicationSubmissions(formId)).find(item => item.email === normalized) ?? null;
}

export async function listApplicationFormIdsForReviewer(reviewerId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('application_submission_index')
    .select('form_id')
    .eq('assigned_reviewer_id', reviewerId);
  if (error) throw new Error(`Could not load reviewer assignments: ${error.message}`);
  return [...new Set((data ?? []).map(row => String(row.form_id)))];
}

export async function saveApplicationSubmission(item: ApplicationSubmissionRecord): Promise<void> {
  const form = await getApplicationForm(item.formId);
  if (!form?.responseSpreadsheetId) throw new Error('This form does not have a response spreadsheet.');
  await ensureApplicationSpreadsheet(form);
  const all = await dataRows(form);
  const index = all.findIndex(row => row[0] === item.id);
  const sheets = getGoogleSheetsClient();
  if (index === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: form.responseSpreadsheetId,
      range: `${quoteSheet(DATA_SHEET)}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [submissionToRow(item)] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: form.responseSpreadsheetId,
      range: `${quoteSheet(RESPONSE_SHEET)}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [responseRow(form, item)] },
    });
  } else {
    const responseWidth = columnName(responseColumns(form).length - 1);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: form.responseSpreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${quoteSheet(DATA_SHEET)}!A${index + 2}:Q${index + 2}`, values: [submissionToRow(item)] },
          { range: `${quoteSheet(RESPONSE_SHEET)}!A${index + 3}:${responseWidth}${index + 3}`, values: [responseRow(form, item)] },
        ],
      },
    });
  }
  const { error } = await adminClient().from('application_submission_index').upsert({
    id: item.id,
    form_id: item.formId,
    owner_id: form.ownerId,
    token_hashes: item.tokenHash.split(',').filter(Boolean),
    email_hash: emailHash(item.email),
    state: item.state,
    assigned_reviewer_id: item.assignedReviewerId || null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }, { onConflict: 'id' });
  if (error) throw new Error(`Could not update application submission index: ${error.message}`);
}

export async function appendApplicationAudit(item: ApplicationAuditRecord): Promise<void> {
  let formId = item.entityType === 'form' ? item.entityId : asText(item.details.formId);
  if (!formId && item.entityType === 'submission') {
    const { data } = await adminClient().from('application_submission_index').select('form_id').eq('id', item.entityId).maybeSingle();
    formId = data?.form_id ?? '';
  }
  if (!formId) throw new Error('Application audit record is missing its form ID.');
  const form = await getApplicationForm(formId);
  if (!form) throw new Error('Application audit record references an unknown form.');
  const { error } = await adminClient().from('application_audit_log').insert({
    id: item.id,
    form_id: formId,
    owner_id: form.ownerId,
    entity_type: item.entityType,
    entity_id: item.entityId,
    action: item.action,
    actor_id: item.actorId || null,
    actor_email: item.actorEmail,
    occurred_at: item.occurredAt,
    details: item.details,
  });
  if (error) throw new Error(`Could not record application activity: ${error.message}`);
}

export function resetApplicationSheetsSetupForTests(): void {
  // Kept for compatibility with focused storage tests. Workbook setup is now per form.
}
