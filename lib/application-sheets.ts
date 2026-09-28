import { createHash } from 'crypto';
import type {
  ApplicationAnswer,
  ApplicationAuditRecord,
  ApplicationFileAnswer,
  ApplicationFormRecord,
  ApplicationMessage,
  ApplicationPrivateNote,
  ApplicationQuestion,
  ApplicationSheetLayout,
  ApplicationStatusEvent,
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
const STATUS_SHEET = '_StatusHistory';
const NOTES_SHEET = '_PrivateNotes';
const EMAILS_SHEET = '_Emails';
const FILES_SHEET = '_Files';

const STATUS_HEADERS = ['id', 'submission_id', 'stage_id', 'stage_name', 'actor_email', 'occurred_at', 'message_type'];
const NOTES_HEADERS = ['id', 'submission_id', 'body', 'author_email', 'created_at'];
const EMAIL_HEADERS = ['id', 'submission_id', 'type', 'subject', 'body', 'sent_at', 'sent_by'];
const FILE_HEADERS = ['submission_id', 'question_id', 'url', 'storage_key', 'name', 'size', 'type'];

type SubmissionIndexRow = {
  id: string;
  form_id: string;
  owner_id: string;
  token_hashes: string[];
  email_hash: string;
  reference: string;
  state: ApplicationSubmissionRecord['state'];
  sheet_row: number | null;
  stage_id: string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_email: string;
  score: number | null;
  sync_state: 'pending' | 'synced' | 'failed';
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type ResponseColumn = { key: string; label: string };

const INDEX_COLUMNS = [
  'id', 'form_id', 'owner_id', 'token_hashes', 'email_hash', 'reference', 'state', 'sheet_row',
  'stage_id', 'assigned_reviewer_id', 'assigned_reviewer_email', 'score', 'sync_state',
  'last_sync_error', 'created_at', 'updated_at',
].join(',');

export class DuplicateApplicationError extends Error {
  constructor() {
    super('An application has already been submitted for this email address.');
    this.name = 'DuplicateApplicationError';
  }
}

export function isDuplicateApplicationError(error: unknown): error is DuplicateApplicationError {
  return error instanceof DuplicateApplicationError;
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
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

function schemaHash(form: ApplicationFormRecord): string {
  return createHash('sha256').update(JSON.stringify({
    questions: form.config.questions.map(question => ({ id: question.id, label: question.label, type: question.type })),
    stages: form.config.stages.map(stage => ({ id: stage.id, name: stage.name })),
  })).digest('hex').slice(0, 24);
}

function responseColumns(form: ApplicationFormRecord): ResponseColumn[] {
  return [
    { key: 'meta:reference', label: 'Reference' },
    { key: 'meta:email', label: 'Email' },
    ...form.config.questions.filter(question => question.type !== 'text_block').map(question => ({
      key: `question:${question.id}`,
      label: question.label,
    })),
    { key: 'meta:state', label: 'Submission state' },
    { key: 'meta:status', label: 'Status' },
    { key: 'meta:stage_id', label: 'Stage ID' },
    { key: 'meta:assigned_reviewer_email', label: 'Assigned reviewer' },
    { key: 'meta:assigned_reviewer_id', label: 'Assigned reviewer ID' },
    { key: 'meta:score', label: 'Score' },
    { key: 'meta:created_at', label: 'Created at' },
    { key: 'meta:submitted_at', label: 'Submitted at' },
    { key: 'meta:updated_at', label: 'Last updated' },
    { key: 'meta:id', label: 'Submission ID' },
  ];
}

function answerCell(answer: ApplicationAnswer): string | number | boolean {
  if (answer === null || answer === undefined) return '';
  if (Array.isArray(answer)) return JSON.stringify(answer);
  if (typeof answer === 'object') return answer.url;
  return answer;
}

function responseRow(form: ApplicationFormRecord, item: ApplicationSubmissionRecord): Array<string | number | boolean> {
  const stage = form.config.stages.find(value => value.id === item.stageId);
  return responseColumns(form).map(column => {
    if (column.key.startsWith('question:')) return answerCell(item.answers[column.key.slice('question:'.length)]);
    if (column.key === 'meta:reference') return item.reference;
    if (column.key === 'meta:email') return item.email;
    if (column.key === 'meta:state') return item.state;
    if (column.key === 'meta:status') return stage?.name ?? item.stageId;
    if (column.key === 'meta:stage_id') return item.stageId;
    if (column.key === 'meta:assigned_reviewer_email') return item.assignedReviewerEmail;
    if (column.key === 'meta:assigned_reviewer_id') return item.assignedReviewerId;
    if (column.key === 'meta:score') return item.score ?? '';
    if (column.key === 'meta:created_at') return item.createdAt;
    if (column.key === 'meta:submitted_at') return item.submittedAt;
    if (column.key === 'meta:updated_at') return item.updatedAt;
    return item.id;
  });
}

function questionAnswer(question: ApplicationQuestion, raw: unknown, file?: ApplicationFileAnswer): ApplicationAnswer {
  if (question.type === 'file') {
    if (file) return file;
    return raw ? { url: String(raw), publicId: '', name: 'Uploaded file', size: 0, type: '' } : null;
  }
  if (raw === '' || raw === null || raw === undefined) return null;
  if (question.type === 'multiple_choice') {
    try { return JSON.parse(String(raw)) as string[]; } catch { return String(raw).split(',').map(value => value.trim()).filter(Boolean); }
  }
  if (question.type === 'number') return Number(raw);
  if (question.type === 'consent') return raw === true || String(raw).toLowerCase() === 'true';
  return String(raw);
}

function fileRows(item: ApplicationSubmissionRecord): unknown[][] {
  return Object.entries(item.answers).flatMap(([questionId, answer]) => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || !('url' in answer)) return [];
    const file = answer as ApplicationFileAnswer;
    return [[item.id, questionId, file.url, file.publicId, file.name, file.size, file.type]];
  });
}

function statusRows(item: ApplicationSubmissionRecord): unknown[][] {
  return item.statusHistory.map(event => [event.id, item.id, event.stageId, event.stageName, event.actorEmail, event.occurredAt, event.messageType ?? '']);
}

function noteRows(item: ApplicationSubmissionRecord): unknown[][] {
  return item.privateNotes.map(note => [note.id, item.id, note.body, note.authorEmail, note.createdAt]);
}

function emailRows(item: ApplicationSubmissionRecord): unknown[][] {
  return item.messages.map(message => [message.id, item.id, message.type, message.subject, message.body, message.sentAt, message.sentBy]);
}

function rawCell(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: asText(value) } };
}

function appendCellsRequest(sheetId: number, rows: unknown[][]) {
  return {
    appendCells: {
      sheetId,
      fields: 'userEnteredValue',
      rows: rows.map(values => ({ values: values.map(rawCell) })),
    },
  };
}

async function withGoogleBackoff<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number((error as { code?: number; response?: { status?: number } }).code
        ?? (error as { response?: { status?: number } }).response?.status ?? 0);
      if (![429, 500, 502, 503, 504].includes(status) || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt) + Math.floor(Math.random() * 100)));
    }
  }
  throw lastError;
}

function requireLayout(form: ApplicationFormRecord): ApplicationSheetLayout {
  if (!form.responseSpreadsheetId || form.responseSheetLayout?.version !== 2) {
    throw new Error('This form response sheet needs the application storage migration before it can be used.');
  }
  return form.responseSheetLayout;
}

function indexPayload(form: ApplicationFormRecord, item: ApplicationSubmissionRecord, sheetRow: number | null, syncState: SubmissionIndexRow['sync_state'], lastError: string | null) {
  return {
    id: item.id,
    form_id: item.formId,
    owner_id: form.ownerId,
    token_hashes: item.tokenHash.split(',').filter(Boolean),
    email_hash: emailHash(item.email),
    reference: item.reference,
    state: item.state,
    sheet_row: sheetRow,
    stage_id: item.stageId,
    assigned_reviewer_id: item.assignedReviewerId || null,
    assigned_reviewer_email: item.assignedReviewerEmail,
    score: item.score,
    sync_state: syncState,
    last_sync_error: lastError,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

async function getIndexById(id: string): Promise<SubmissionIndexRow | null> {
  const { data, error } = await adminClient().from('application_submission_index').select(INDEX_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not locate application submission: ${error.message}`);
  return data as SubmissionIndexRow | null;
}

async function claimIndex(form: ApplicationFormRecord, item: ApplicationSubmissionRecord, existing: SubmissionIndexRow | null): Promise<void> {
  const payload = indexPayload(form, item, existing?.sheet_row ?? null, 'pending', null);
  const result = existing
    ? await adminClient().from('application_submission_index').update(payload).eq('id', item.id)
    : await adminClient().from('application_submission_index').insert(payload);
  if (result.error?.code === '23505') throw new DuplicateApplicationError();
  if (result.error) throw new Error(`Could not reserve this application: ${result.error.message}`);
}

async function restoreIndex(existing: SubmissionIndexRow | null, id: string, message: string): Promise<void> {
  if (!existing) {
    await adminClient().from('application_submission_index').delete().eq('id', id);
    return;
  }
  await adminClient().from('application_submission_index').upsert({ ...existing, sync_state: 'failed', last_sync_error: message }, { onConflict: 'id' });
}

async function completeIndex(form: ApplicationFormRecord, item: ApplicationSubmissionRecord, sheetRow: number | null): Promise<void> {
  const { error } = await adminClient().from('application_submission_index')
    .update(indexPayload(form, item, sheetRow, 'synced', null))
    .eq('id', item.id);
  if (error) throw new Error(`Could not finalize the application index: ${error.message}`);
}

function parseUpdatedRow(updatedRange?: string | null): number {
  const match = updatedRange?.match(/![A-Z]+(\d+):/i);
  const row = Number(match?.[1] ?? 0);
  if (!Number.isInteger(row) || row < 3) throw new Error('Google Sheets did not return the new response row.');
  return row;
}

type WorkbookValues = {
  responses: unknown[][];
  statuses: unknown[][];
  notes: unknown[][];
  emails: unknown[][];
  files: unknown[][];
};

async function readWorkbook(form: ApplicationFormRecord, responseRange: string, includeAuxiliary = true): Promise<WorkbookValues> {
  requireLayout(form);
  const result = await withGoogleBackoff(() => getGoogleSheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: form.responseSpreadsheetId!,
    ranges: [
      `${quoteSheet(RESPONSE_SHEET)}!${responseRange}`,
      ...(includeAuxiliary ? [
        `${quoteSheet(STATUS_SHEET)}!A2:G`,
        `${quoteSheet(NOTES_SHEET)}!A2:E`,
        `${quoteSheet(EMAILS_SHEET)}!A2:G`,
        `${quoteSheet(FILES_SHEET)}!A2:G`,
      ] : []),
    ],
  }));
  const ranges = result.data.valueRanges ?? [];
  return {
    responses: ranges[0]?.values ?? [],
    statuses: ranges[1]?.values ?? [],
    notes: ranges[2]?.values ?? [],
    emails: ranges[3]?.values ?? [],
    files: ranges[4]?.values ?? [],
  };
}

function statusEvents(rows: unknown[][], submissionId: string): ApplicationStatusEvent[] {
  return rows.filter(row => asText(row[1]) === submissionId).map(row => ({
    id: asText(row[0]), stageId: asText(row[2]), stageName: asText(row[3]), actorEmail: asText(row[4]),
    occurredAt: asText(row[5]), ...(row[6] ? { messageType: asText(row[6]) } : {}),
  }));
}

function privateNotes(rows: unknown[][], submissionId: string): ApplicationPrivateNote[] {
  return rows.filter(row => asText(row[1]) === submissionId).map(row => ({
    id: asText(row[0]), body: asText(row[2]), authorEmail: asText(row[3]), createdAt: asText(row[4]),
  }));
}

function messages(rows: unknown[][], submissionId: string): ApplicationMessage[] {
  return rows.filter(row => asText(row[1]) === submissionId).map(row => ({
    id: asText(row[0]), type: asText(row[2]) as ApplicationMessage['type'], subject: asText(row[3]),
    body: asText(row[4]), sentAt: asText(row[5]), sentBy: asText(row[6]),
  }));
}

function files(rows: unknown[][], submissionId: string): Map<string, ApplicationFileAnswer> {
  return new Map(rows.filter(row => asText(row[0]) === submissionId).map(row => [asText(row[1]), {
    url: asText(row[2]), publicId: asText(row[3]), name: asText(row[4]), size: Number(row[5] ?? 0), type: asText(row[6]),
  }]));
}

function submissionFromResponse(
  form: ApplicationFormRecord,
  row: unknown[],
  index: SubmissionIndexRow,
  workbook: WorkbookValues,
): ApplicationSubmissionRecord {
  const columns = responseColumns(form);
  const values = new Map(columns.map((column, position) => [column.key, row[position]]));
  const submissionId = asText(values.get('meta:id'));
  const fileMap = files(workbook.files, submissionId);
  const answers = Object.fromEntries(form.config.questions
    .filter(question => question.type !== 'text_block')
    .map(question => [question.id, questionAnswer(question, values.get(`question:${question.id}`), fileMap.get(question.id))]));
  return {
    id: submissionId,
    formId: form.id,
    reference: asText(values.get('meta:reference')),
    email: asText(values.get('meta:email')).toLowerCase(),
    state: asText(values.get('meta:state')) as ApplicationSubmissionRecord['state'],
    stageId: asText(values.get('meta:stage_id')),
    assignedReviewerId: asText(values.get('meta:assigned_reviewer_id')),
    assignedReviewerEmail: asText(values.get('meta:assigned_reviewer_email')),
    score: values.get('meta:score') === '' || values.get('meta:score') === undefined ? null : Number(values.get('meta:score')),
    createdAt: asText(values.get('meta:created_at')),
    updatedAt: asText(values.get('meta:updated_at')),
    submittedAt: asText(values.get('meta:submitted_at')),
    tokenHash: (index.token_hashes ?? []).join(','),
    answers,
    privateNotes: privateNotes(workbook.notes, submissionId),
    statusHistory: statusEvents(workbook.statuses, submissionId),
    messages: messages(workbook.emails, submissionId),
  };
}

function draftFromIndex(index: SubmissionIndexRow): ApplicationSubmissionRecord {
  return {
    id: index.id, formId: index.form_id, reference: index.reference, email: '', state: 'draft',
    stageId: index.stage_id, assignedReviewerId: index.assigned_reviewer_id ?? '',
    assignedReviewerEmail: index.assigned_reviewer_email, score: index.score,
    createdAt: index.created_at, updatedAt: index.updated_at, submittedAt: '',
    tokenHash: (index.token_hashes ?? []).join(','), answers: {}, privateNotes: [], statusHistory: [], messages: [],
  };
}

async function appendAuxiliaryRows(form: ApplicationFormRecord, item: ApplicationSubmissionRecord, existing?: WorkbookValues): Promise<void> {
  const layout = requireLayout(form);
  const knownStatus = new Set((existing?.statuses ?? []).map(row => asText(row[0])));
  const knownNotes = new Set((existing?.notes ?? []).map(row => asText(row[0])));
  const knownEmails = new Set((existing?.emails ?? []).map(row => asText(row[0])));
  const knownFiles = new Set((existing?.files ?? []).map(row => `${asText(row[0])}:${asText(row[1])}`));
  const statuses = statusRows(item).filter(row => !knownStatus.has(asText(row[0])));
  const notes = noteRows(item).filter(row => !knownNotes.has(asText(row[0])));
  const emails = emailRows(item).filter(row => !knownEmails.has(asText(row[0])));
  const filesToAdd = fileRows(item).filter(row => !knownFiles.has(`${asText(row[0])}:${asText(row[1])}`));
  const requests = [
    ...(statuses.length ? [appendCellsRequest(layout.statusHistorySheetId, statuses)] : []),
    ...(notes.length ? [appendCellsRequest(layout.privateNotesSheetId, notes)] : []),
    ...(emails.length ? [appendCellsRequest(layout.emailsSheetId, emails)] : []),
    ...(filesToAdd.length ? [appendCellsRequest(layout.filesSheetId, filesToAdd)] : []),
  ];
  if (!requests.length) return;
  await withGoogleBackoff(() => getGoogleSheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: form.responseSpreadsheetId!,
    requestBody: { requests },
  }));
}

export async function createApplicationResponseSpreadsheet(form: ApplicationFormRecord): Promise<{ id: string; url: string; layout: ApplicationSheetLayout }> {
  const parentFolderId = getApplicationResponsesFolderId();
  const drive = getGoogleDriveClient();
  const storageFolder = await withGoogleBackoff(() => drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: `${form.config.title.trim().slice(0, 120)} - Applications`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
      appProperties: { applicationFormId: form.id, purpose: 'application-storage' },
    },
    fields: 'id',
  }));
  const storageFolderId = storageFolder.data.id;
  if (!storageFolderId) throw new Error('Google Drive did not return the application folder ID.');
  try {
    const [created, uploadsFolder] = await Promise.all([
      withGoogleBackoff(() => drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: `${form.config.title.trim().slice(0, 120)} - Responses`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [storageFolderId],
          appProperties: { applicationFormId: form.id, purpose: 'application-responses' },
        },
        fields: 'id,webViewLink',
      })),
      withGoogleBackoff(() => drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: 'Applicant uploads',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [storageFolderId],
          appProperties: { applicationFormId: form.id, purpose: 'application-uploads' },
        },
        fields: 'id',
      })),
    ]);
    const id = created.data.id;
    const uploadsFolderId = uploadsFolder.data.id;
    if (!id || !uploadsFolderId) throw new Error('Google Drive did not create the application storage files.');
    const sheets = getGoogleSheetsClient();
    const initial = await withGoogleBackoff(() => sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' }));
    const firstSheetId = initial.data.sheets?.[0]?.properties?.sheetId;
    if (firstSheetId === undefined) throw new Error('Google Sheets did not create an initial worksheet.');
    await withGoogleBackoff(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [
        { updateSheetProperties: { properties: { sheetId: firstSheetId, title: RESPONSE_SHEET }, fields: 'title' } },
        { addSheet: { properties: { title: STATUS_SHEET, hidden: true } } },
        { addSheet: { properties: { title: NOTES_SHEET, hidden: true } } },
        { addSheet: { properties: { title: EMAILS_SHEET, hidden: true } } },
        { addSheet: { properties: { title: FILES_SHEET, hidden: true } } },
      ] },
    }));
    const meta = await withGoogleBackoff(() => sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' }));
    const sheetId = (title: string) => {
      const value = meta.data.sheets?.find(sheet => sheet.properties?.title === title)?.properties?.sheetId;
      if (typeof value !== 'number') throw new Error(`Google Sheets did not create ${title}.`);
      return value;
    };
    const layout: ApplicationSheetLayout = {
      version: 2,
      schemaHash: schemaHash(form),
      storageFolderId,
      uploadsFolderId,
      responsesSheetId: sheetId(RESPONSE_SHEET),
      statusHistorySheetId: sheetId(STATUS_SHEET),
      privateNotesSheetId: sheetId(NOTES_SHEET),
      emailsSheetId: sheetId(EMAILS_SHEET),
      filesSheetId: sheetId(FILES_SHEET),
    };
    const columns = responseColumns(form);
    await withGoogleBackoff(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${quoteSheet(RESPONSE_SHEET)}!A1`, values: [columns.map(column => column.label), columns.map(column => column.key)] },
          { range: `${quoteSheet(STATUS_SHEET)}!A1`, values: [STATUS_HEADERS] },
          { range: `${quoteSheet(NOTES_SHEET)}!A1`, values: [NOTES_HEADERS] },
          { range: `${quoteSheet(EMAILS_SHEET)}!A1`, values: [EMAIL_HEADERS] },
          { range: `${quoteSheet(FILES_SHEET)}!A1`, values: [FILE_HEADERS] },
        ],
      },
    }));
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const managedSheetIds = [layout.responsesSheetId, layout.statusHistorySheetId, layout.privateNotesSheetId, layout.emailsSheetId, layout.filesSheetId];
    await withGoogleBackoff(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [
        { updateSheetProperties: { properties: { sheetId: layout.responsesSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        { updateDimensionProperties: { range: { sheetId: layout.responsesSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
        ...managedSheetIds.map(managedSheetId => ({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId: managedSheetId },
              description: 'Managed by the application forms service',
              warningOnly: false,
              editors: { users: [serviceAccountEmail] },
            },
          },
        })),
      ] },
    }));
    return { id, url: created.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${id}/edit`, layout };
  } catch (error) {
    await drive.files.update({ fileId: storageFolderId, supportsAllDrives: true, requestBody: { trashed: true } }).catch(() => undefined);
    throw error;
  }
}

export async function getApplicationUploadsFolderId(form: ApplicationFormRecord): Promise<string> {
  const layout = requireLayout(form);
  if (layout.uploadsFolderId) return layout.uploadsFolderId;
  const parentFolderId = layout.storageFolderId ?? getApplicationResponsesFolderId();
  const drive = getGoogleDriveClient();
  const escapedFormId = form.id.replace(/'/g, "\\'");
  const escapedParentId = parentFolderId.replace(/'/g, "\\'");
  const found = await withGoogleBackoff(() => drive.files.list({
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    q: `'${escapedParentId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='applicationFormId' and value='${escapedFormId}' } and appProperties has { key='purpose' and value='application-uploads' }`,
    fields: 'files(id)',
    pageSize: 1,
  }));
  const existingId = found.data.files?.[0]?.id;
  if (existingId) return existingId;
  const created = await withGoogleBackoff(() => drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: 'Applicant uploads',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
      appProperties: { applicationFormId: form.id, purpose: 'application-uploads' },
    },
    fields: 'id',
  }));
  if (!created.data.id) throw new Error('Google Drive did not create the applicant uploads folder.');
  return created.data.id;
}

export async function syncApplicationResponseSchema(form: ApplicationFormRecord): Promise<ApplicationSheetLayout> {
  const layout = requireLayout(form);
  const nextHash = schemaHash(form);
  if (layout.schemaHash === nextHash) return layout;
  const sheets = getGoogleSheetsClient();
  const current = await withGoogleBackoff(() => sheets.spreadsheets.values.get({
    spreadsheetId: form.responseSpreadsheetId!,
    range: `${quoteSheet(RESPONSE_SHEET)}!A1:ZZZ`,
  }));
  const values = current.data.values ?? [];
  const oldKeys = (values[1] ?? []).map(asText);
  const columns = responseColumns(form);
  const nextRows = values.slice(2).filter(row => row.some(value => value !== '')).map(row => {
    const previous = new Map(oldKeys.map((key, index) => [key, row[index]]));
    return columns.map(column => {
      if (column.key === 'meta:status') {
        const stageId = asText(previous.get('meta:stage_id'));
        return form.config.stages.find(stage => stage.id === stageId)?.name ?? stageId;
      }
      return previous.get(column.key) ?? '';
    });
  });
  await withGoogleBackoff(() => sheets.spreadsheets.values.clear({
    spreadsheetId: form.responseSpreadsheetId!,
    range: `${quoteSheet(RESPONSE_SHEET)}!A:ZZZ`,
  }));
  await withGoogleBackoff(() => sheets.spreadsheets.values.update({
    spreadsheetId: form.responseSpreadsheetId!,
    range: `${quoteSheet(RESPONSE_SHEET)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [columns.map(column => column.label), columns.map(column => column.key), ...nextRows] },
  }));
  return { ...layout, schemaHash: nextHash };
}

export async function trashApplicationResponseSpreadsheet(
  spreadsheetId: string,
  layout?: ApplicationSheetLayout,
): Promise<void> {
  const targets = layout?.storageFolderId
    ? [layout.storageFolderId]
    : [...new Set([spreadsheetId, layout?.uploadsFolderId].filter((value): value is string => Boolean(value)))];
  await Promise.all(targets.map(fileId => withGoogleBackoff(() => getGoogleDriveClient().files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: { trashed: true },
  }))));
}

export async function listApplicationSubmissions(formId?: string): Promise<ApplicationSubmissionRecord[]> {
  if (!formId) {
    const { data, error } = await adminClient().from('application_submission_index').select('form_id').eq('state', 'submitted');
    if (error) throw new Error(`Could not load application submission index: ${error.message}`);
    const formIds = [...new Set((data ?? []).map(row => String(row.form_id)))];
    return (await Promise.all(formIds.map(id => listApplicationSubmissions(id)))).flat();
  }
  const form = await getApplicationForm(formId);
  if (!form?.responseSpreadsheetId) return [];
  const { data, error } = await adminClient().from('application_submission_index').select(INDEX_COLUMNS).eq('form_id', formId).eq('state', 'submitted');
  if (error) throw new Error(`Could not load application submission index: ${error.message}`);
  const indexes = (data ?? []) as unknown as SubmissionIndexRow[];
  if (!indexes.length) return [];
  const width = columnName(responseColumns(form).length - 1);
  const workbook = await readWorkbook(form, `A3:${width}`);
  const indexById = new Map(indexes.map(index => [index.id, index]));
  return workbook.responses.flatMap(row => {
    const id = asText(row[responseColumns(form).length - 1]);
    const index = indexById.get(id);
    return index ? [submissionFromResponse(form, row, index, workbook)] : [];
  });
}

async function indexedSubmission(
  query: { id?: string; tokenHash?: string },
  includeAuxiliary = true,
): Promise<ApplicationSubmissionRecord | null> {
  let request = adminClient().from('application_submission_index').select(INDEX_COLUMNS);
  request = query.id ? request.eq('id', query.id) : request.contains('token_hashes', [query.tokenHash!]);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error(`Could not locate application submission: ${error.message}`);
  if (!data) return null;
  const index = data as unknown as SubmissionIndexRow;
  if (index.state === 'draft' || !index.sheet_row) return draftFromIndex(index);
  const form = await getApplicationForm(index.form_id);
  if (!form) return null;
  const width = columnName(responseColumns(form).length - 1);
  let workbook = await readWorkbook(form, `A${index.sheet_row}:${width}${index.sheet_row}`, includeAuxiliary);
  let row = workbook.responses[0];
  if (!row || asText(row[responseColumns(form).length - 1]) !== index.id) {
    workbook = await readWorkbook(form, `A3:${width}`, includeAuxiliary);
    const offset = workbook.responses.findIndex(candidate => asText(candidate[responseColumns(form).length - 1]) === index.id);
    if (offset < 0) return null;
    row = workbook.responses[offset];
    const recoveredRow = offset + 3;
    await adminClient().from('application_submission_index').update({ sheet_row: recoveredRow }).eq('id', index.id);
    index.sheet_row = recoveredRow;
  }
  return submissionFromResponse(form, row, index, workbook);
}

export async function getApplicationSubmission(id: string): Promise<ApplicationSubmissionRecord | null> {
  return indexedSubmission({ id });
}

export async function getApplicationSubmissionByTokenHash(tokenHash: string): Promise<ApplicationSubmissionRecord | null> {
  return indexedSubmission({ tokenHash }, false);
}

export async function getApplicationSubmissionByEmail(formId: string, email: string): Promise<ApplicationSubmissionRecord | null> {
  const { data, error } = await adminClient().from('application_submission_index')
    .select('id').eq('form_id', formId).eq('email_hash', emailHash(email)).eq('state', 'submitted').maybeSingle();
  if (error) throw new Error(`Could not check for an existing application: ${error.message}`);
  return data?.id ? getApplicationSubmission(String(data.id)) : null;
}

export async function listApplicationFormIdsForReviewer(reviewerId: string): Promise<string[]> {
  const { data, error } = await adminClient().from('application_submission_index').select('form_id').eq('assigned_reviewer_id', reviewerId);
  if (error) throw new Error(`Could not load reviewer assignments: ${error.message}`);
  return [...new Set((data ?? []).map(row => String(row.form_id)))];
}

export async function reserveApplicationAccessToken(submissionId: string, tokenHash: string): Promise<string[]> {
  const index = await getIndexById(submissionId);
  if (!index) throw new Error('Application not found.');
  const previous = [...(index.token_hashes ?? [])];
  const next = [...previous, tokenHash].slice(-5);
  const { error } = await adminClient().from('application_submission_index').update({ token_hashes: next }).eq('id', submissionId);
  if (error) throw new Error(`Could not prepare the secure status link: ${error.message}`);
  return previous;
}

export async function restoreApplicationAccessTokens(submissionId: string, tokenHashes: string[]): Promise<void> {
  const { error } = await adminClient().from('application_submission_index').update({ token_hashes: tokenHashes }).eq('id', submissionId);
  if (error) throw new Error(`Could not restore the secure status link: ${error.message}`);
}

export async function saveApplicationSubmission(item: ApplicationSubmissionRecord): Promise<void> {
  const form = await getApplicationForm(item.formId);
  if (!form?.responseSpreadsheetId) throw new Error('This form does not have a response spreadsheet.');
  requireLayout(form);
  const existing = await getIndexById(item.id);
  await claimIndex(form, item, existing);
  let appendedRow: number | null = null;
  let previousResponseRow: unknown[] | null = null;
  try {
    if (item.state === 'draft') {
      await completeIndex(form, item, existing?.sheet_row ?? null);
      return;
    }
    const sheets = getGoogleSheetsClient();
    let workbook: WorkbookValues | undefined;
    let sheetRow = existing?.sheet_row ?? null;
    if (!sheetRow) {
      const appended = await withGoogleBackoff(() => sheets.spreadsheets.values.append({
        spreadsheetId: form.responseSpreadsheetId!,
        range: `${quoteSheet(RESPONSE_SHEET)}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [responseRow(form, item)] },
      }));
      sheetRow = parseUpdatedRow(appended.data.updates?.updatedRange);
      appendedRow = sheetRow;
    } else {
      const width = columnName(responseColumns(form).length - 1);
      workbook = await readWorkbook(form, `A${sheetRow}:${width}${sheetRow}`);
      previousResponseRow = workbook.responses[0] ?? null;
      await withGoogleBackoff(() => sheets.spreadsheets.values.update({
        spreadsheetId: form.responseSpreadsheetId!,
        range: `${quoteSheet(RESPONSE_SHEET)}!A${sheetRow}:${width}${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [responseRow(form, item)] },
      }));
    }
    await completeIndex(form, item, sheetRow);
    await appendAuxiliaryRows(form, item, workbook);
  } catch (error) {
    const message = (error as Error).message;
    if (appendedRow) {
      const width = columnName(responseColumns(form).length - 1);
      await getGoogleSheetsClient().spreadsheets.values.clear({
        spreadsheetId: form.responseSpreadsheetId,
        range: `${quoteSheet(RESPONSE_SHEET)}!A${appendedRow}:${width}${appendedRow}`,
      }).catch(() => undefined);
    } else if (existing?.sheet_row && previousResponseRow) {
      const width = columnName(responseColumns(form).length - 1);
      await getGoogleSheetsClient().spreadsheets.values.update({
        spreadsheetId: form.responseSpreadsheetId,
        range: `${quoteSheet(RESPONSE_SHEET)}!A${existing.sheet_row}:${width}${existing.sheet_row}`,
        valueInputOption: 'RAW',
        requestBody: { values: [previousResponseRow] },
      }).catch(() => undefined);
    }
    await restoreIndex(existing, item.id, message).catch(() => undefined);
    throw error;
  }
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
    id: item.id, form_id: formId, owner_id: form.ownerId, entity_type: item.entityType,
    entity_id: item.entityId, action: item.action, actor_id: item.actorId || null,
    actor_email: item.actorEmail, occurred_at: item.occurredAt, details: item.details,
  });
  if (error) throw new Error(`Could not record application activity: ${error.message}`);
}

export function resetApplicationSheetsSetupForTests(): void {
  // Per-form layouts are provisioned once at publish time and stored with the form record.
}
