import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_APPLICATION_RESPONSES_FOLDER_ID',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const legacySpreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const folderId = process.env.GOOGLE_APPLICATION_RESPONSES_FOLDER_ID;

const dataHeaders = [
  'id', 'form_id', 'reference', 'email', 'state', 'stage_id', 'assigned_reviewer_id',
  'assigned_reviewer_email', 'score', 'created_at', 'updated_at', 'submitted_at',
  'token_hash', 'answers_json', 'private_notes_json', 'status_history_json', 'messages_json',
];

function parseJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function cell(value) {
  return value === null || value === undefined ? '' : String(value);
}

function quoteSheet(title) {
  return `'${title.replaceAll("'", "''")}'`;
}

function responseColumns(form) {
  return [
    { key: 'meta:reference', label: 'Reference' },
    { key: 'meta:email', label: 'Email' },
    ...(form.config.questions ?? []).filter(question => question.type !== 'text_block').map(question => ({
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

function answerCell(answer) {
  if (answer === null || answer === undefined) return '';
  if (Array.isArray(answer)) return answer.join(', ');
  if (typeof answer === 'object') return answer.url ?? '';
  return answer;
}

function responseRow(form, row) {
  const answers = parseJson(row[13], {});
  const stage = (form.config.stages ?? []).find(item => item.id === row[5]);
  return responseColumns(form).map(column => {
    if (column.key.startsWith('question:')) return answerCell(answers[column.key.slice(9)]);
    if (column.key === 'meta:reference') return row[2];
    if (column.key === 'meta:email') return row[3];
    if (column.key === 'meta:status') return stage?.name ?? row[5];
    if (column.key === 'meta:assigned_reviewer_email') return row[7];
    if (column.key === 'meta:score') return row[8];
    if (column.key === 'meta:submitted_at') return row[11];
    if (column.key === 'meta:updated_at') return row[10];
    return row[0];
  });
}

async function legacyRows(title, width) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: legacySpreadsheetId,
    range: `${quoteSheet(title)}!A:${width}`,
  });
  return (result.data.values ?? []).slice(1).map(row => row.map(cell));
}

async function createResponseSpreadsheet(form, submissions) {
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: `${form.config.title.trim().slice(0, 120)} - Responses`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id,webViewLink',
  });
  if (!created.data.id) throw new Error(`Could not create a response spreadsheet for ${form.id}.`);
  const spreadsheetId = created.data.id;
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const firstSheetId = meta.data.sheets?.[0]?.properties?.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [
      { updateSheetProperties: { properties: { sheetId: firstSheetId, title: 'Responses', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
      { addSheet: { properties: { title: '_ApplicationData', hidden: true } } },
      { updateDimensionProperties: { range: { sheetId: firstSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    ] },
  });
  const columns = responseColumns(form);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${quoteSheet('_ApplicationData')}!A1`, values: [dataHeaders, ...submissions] },
        { range: `${quoteSheet('Responses')}!A1`, values: [
          columns.map(column => column.label),
          columns.map(column => column.key),
          ...submissions.map(row => responseRow(form, row)),
        ] },
      ],
    },
  });
  return {
    id: spreadsheetId,
    url: created.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

const [formRows, submissionRows, auditRows] = await Promise.all([
  legacyRows('ApplicationForms', 'H'),
  legacyRows('ApplicationSubmissions', 'Q'),
  legacyRows('ApplicationAudit', 'H'),
]);

let migratedForms = 0;
let migratedSubmissions = 0;
for (const row of formRows.filter(value => value[0])) {
  const form = {
    id: row[0], ownerId: row[1], ownerEmail: row[2], slug: row[3], status: row[4],
    createdAt: row[5], updatedAt: row[6], config: parseJson(row[7], {}),
  };
  const { data: existing, error: existingError } = await db
    .from('application_forms')
    .select('response_spreadsheet_id,response_spreadsheet_url')
    .eq('id', form.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) continue;

  const formSubmissions = submissionRows.filter(value => value[0] && value[1] === form.id);
  const needsSpreadsheet = form.status !== 'draft' || formSubmissions.length > 0;
  const spreadsheet = needsSpreadsheet ? await createResponseSpreadsheet(form, formSubmissions) : null;
  const { error: formError } = await db.from('application_forms').insert({
    id: form.id,
    owner_id: form.ownerId,
    owner_email: form.ownerEmail,
    slug: form.slug,
    status: form.status,
    config: form.config,
    response_spreadsheet_id: spreadsheet?.id ?? null,
    response_spreadsheet_url: spreadsheet?.url ?? null,
    created_at: form.createdAt,
    updated_at: form.updatedAt,
  });
  if (formError) throw formError;

  if (formSubmissions.length) {
    const indexRows = formSubmissions.map(value => ({
      id: value[0],
      form_id: form.id,
      owner_id: form.ownerId,
      token_hashes: value[12].split(',').filter(Boolean),
      email_hash: createHash('sha256').update(value[3].trim().toLowerCase()).digest('hex'),
      state: value[4],
      assigned_reviewer_id: value[6] || null,
      created_at: value[9],
      updated_at: value[10],
    }));
    const { error: indexError } = await db.from('application_submission_index').insert(indexRows);
    if (indexError) throw indexError;
  }
  migratedForms += 1;
  migratedSubmissions += formSubmissions.length;
  console.log(`Migrated ${form.slug}: ${formSubmissions.length} response(s).`);
}

const knownForms = new Map(formRows.filter(row => row[0]).map(row => [row[0], row[1]]));
const auditInserts = auditRows.filter(row => row[0]).map(row => {
  const details = parseJson(row[7], {});
  const formId = row[1] === 'form' ? row[2] : String(details.formId ?? '');
  return {
    id: row[0], form_id: formId, owner_id: knownForms.get(formId), entity_type: row[1], entity_id: row[2],
    action: row[3], actor_id: row[4] || null, actor_email: row[5], occurred_at: row[6], details,
  };
}).filter(row => row.form_id && row.owner_id);
if (auditInserts.length) {
  const { error } = await db.from('application_audit_log').upsert(auditInserts, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

console.log(`Migration complete. ${migratedForms} form(s) and ${migratedSubmissions} response(s) migrated.`);
console.log('The legacy application tabs were not changed and remain available as a backup.');
