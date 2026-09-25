import {
  type ApplicationAuditRecord,
  type ApplicationFormRecord,
  type ApplicationSubmissionRecord,
} from '@/lib/application-forms';
import { getGoogleSheetsClient, getGoogleSpreadsheetId } from '@/lib/sheets';

const FORM_SHEET = 'ApplicationForms';
const SUBMISSION_SHEET = 'ApplicationSubmissions';
const AUDIT_SHEET = 'ApplicationAudit';

const FORM_HEADERS = ['id', 'owner_id', 'owner_email', 'slug', 'status', 'created_at', 'updated_at', 'config_json'] as const;
const SUBMISSION_HEADERS = [
  'id', 'form_id', 'reference', 'email', 'state', 'stage_id', 'assigned_reviewer_id',
  'assigned_reviewer_email', 'score', 'created_at', 'updated_at', 'submitted_at',
  'token_hash', 'answers_json', 'private_notes_json', 'status_history_json', 'messages_json',
] as const;
const AUDIT_HEADERS = ['id', 'entity_type', 'entity_id', 'action', 'actor_id', 'actor_email', 'occurred_at', 'details_json'] as const;

let setupPromise: Promise<void> | null = null;

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

async function ensureApplicationSheets(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const spreadsheetId = getGoogleSpreadsheetId();
    const sheets = getGoogleSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const existing = new Set((meta.data.sheets ?? []).map(sheet => sheet.properties?.title).filter(Boolean));
    const definitions = [
      { title: FORM_SHEET, headers: FORM_HEADERS },
      { title: SUBMISSION_SHEET, headers: SUBMISSION_HEADERS },
      { title: AUDIT_SHEET, headers: AUDIT_HEADERS },
    ];
    const missing = definitions.filter(item => !existing.has(item.title));
    if (missing.length) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: missing.map(item => ({ addSheet: { properties: { title: item.title } } })) },
        });
      } catch (error) {
        // Concurrent cold starts can both try to create the tabs. Verify before failing.
        const retry = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
        const retryTitles = new Set((retry.data.sheets ?? []).map(sheet => sheet.properties?.title).filter(Boolean));
        if (missing.some(item => !retryTitles.has(item.title))) throw error;
      }
    }
    for (const item of definitions) {
      const range = `${quoteSheet(item.title)}!1:1`;
      const current = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const header = current.data.values?.[0] ?? [];
      if (header.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${quoteSheet(item.title)}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [[...item.headers]] },
        });
      } else if (item.headers.some((name, index) => header[index] !== name)) {
        throw new Error(`${item.title} is an application-managed sheet and its header row has changed.`);
      }
    }
  })().catch(error => {
    setupPromise = null;
    throw error;
  });
  return setupPromise;
}

async function rows(title: string, width: string): Promise<string[][]> {
  await ensureApplicationSheets();
  const res = await getGoogleSheetsClient().spreadsheets.values.get({
    spreadsheetId: getGoogleSpreadsheetId(),
    range: `${quoteSheet(title)}!A:${width}`,
  });
  return (res.data.values ?? []).slice(1).map(row => row.map(asText));
}

async function append(title: string, values: unknown[]): Promise<void> {
  await ensureApplicationSheets();
  await getGoogleSheetsClient().spreadsheets.values.append({
    spreadsheetId: getGoogleSpreadsheetId(),
    range: `${quoteSheet(title)}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values.map(asText)] },
  });
}

async function replaceRow(title: string, width: string, rowIndex: number, values: unknown[]): Promise<void> {
  await getGoogleSheetsClient().spreadsheets.values.update({
    spreadsheetId: getGoogleSpreadsheetId(),
    range: `${quoteSheet(title)}!A${rowIndex}:${width}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values.map(asText)] },
  });
}

function formFromRow(row: string[]): ApplicationFormRecord {
  return {
    id: row[0], ownerId: row[1], ownerEmail: row[2], slug: row[3], status: row[4] as ApplicationFormRecord['status'],
    createdAt: row[5], updatedAt: row[6], config: parseJson(row[7], {} as ApplicationFormRecord['config']),
  };
}

function formToRow(form: ApplicationFormRecord): unknown[] {
  return [form.id, form.ownerId, form.ownerEmail, form.slug, form.status, form.createdAt, form.updatedAt, JSON.stringify(form.config)];
}

function submissionFromRow(row: string[]): ApplicationSubmissionRecord {
  return {
    id: row[0], formId: row[1], reference: row[2], email: row[3], state: row[4] as ApplicationSubmissionRecord['state'],
    stageId: row[5], assignedReviewerId: row[6], assignedReviewerEmail: row[7], score: row[8] === '' ? null : Number(row[8]),
    createdAt: row[9], updatedAt: row[10], submittedAt: row[11], tokenHash: row[12],
    answers: parseJson(row[13], {}), privateNotes: parseJson(row[14], []), statusHistory: parseJson(row[15], []), messages: parseJson(row[16], []),
  };
}

function submissionToRow(item: ApplicationSubmissionRecord): unknown[] {
  return [
    item.id, item.formId, item.reference, item.email, item.state, item.stageId,
    item.assignedReviewerId, item.assignedReviewerEmail, item.score ?? '', item.createdAt,
    item.updatedAt, item.submittedAt, item.tokenHash, JSON.stringify(item.answers),
    JSON.stringify(item.privateNotes), JSON.stringify(item.statusHistory), JSON.stringify(item.messages),
  ];
}

export async function listApplicationForms(): Promise<ApplicationFormRecord[]> {
  return (await rows(FORM_SHEET, 'H')).filter(row => row[0]).map(formFromRow);
}

export async function getApplicationForm(id: string): Promise<ApplicationFormRecord | null> {
  return (await listApplicationForms()).find(form => form.id === id) ?? null;
}

export async function getApplicationFormBySlug(slug: string): Promise<ApplicationFormRecord | null> {
  return (await listApplicationForms()).find(form => form.slug === slug) ?? null;
}

export async function saveApplicationForm(form: ApplicationFormRecord): Promise<void> {
  const all = await rows(FORM_SHEET, 'H');
  const index = all.findIndex(row => row[0] === form.id);
  if (index === -1) await append(FORM_SHEET, formToRow(form));
  else await replaceRow(FORM_SHEET, 'H', index + 2, formToRow(form));
}

export async function listApplicationSubmissions(formId?: string): Promise<ApplicationSubmissionRecord[]> {
  const all = (await rows(SUBMISSION_SHEET, 'Q')).filter(row => row[0]).map(submissionFromRow);
  return formId ? all.filter(item => item.formId === formId) : all;
}

export async function getApplicationSubmission(id: string): Promise<ApplicationSubmissionRecord | null> {
  return (await listApplicationSubmissions()).find(item => item.id === id) ?? null;
}

export async function getApplicationSubmissionByTokenHash(tokenHash: string): Promise<ApplicationSubmissionRecord | null> {
  return (await listApplicationSubmissions()).find(item => item.tokenHash.split(',').includes(tokenHash)) ?? null;
}

export async function getApplicationSubmissionByEmail(formId: string, email: string): Promise<ApplicationSubmissionRecord | null> {
  const normalized = email.trim().toLowerCase();
  return (await listApplicationSubmissions(formId)).find(item => item.email === normalized) ?? null;
}

export async function saveApplicationSubmission(item: ApplicationSubmissionRecord): Promise<void> {
  const all = await rows(SUBMISSION_SHEET, 'Q');
  const index = all.findIndex(row => row[0] === item.id);
  if (index === -1) await append(SUBMISSION_SHEET, submissionToRow(item));
  else await replaceRow(SUBMISSION_SHEET, 'Q', index + 2, submissionToRow(item));
}

export async function appendApplicationAudit(item: ApplicationAuditRecord): Promise<void> {
  await append(AUDIT_SHEET, [
    item.id, item.entityType, item.entityId, item.action, item.actorId,
    item.actorEmail, item.occurredAt, JSON.stringify(item.details),
  ]);
}

export function resetApplicationSheetsSetupForTests(): void {
  setupPromise = null;
}
