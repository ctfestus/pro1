import { adminClient } from '@/lib/admin-client';
import type { ApplicationFormRecord } from '@/lib/application-forms';

type ApplicationFormRow = {
  id: string;
  owner_id: string;
  owner_email: string;
  slug: string;
  status: ApplicationFormRecord['status'];
  response_spreadsheet_id: string | null;
  response_spreadsheet_url: string | null;
  response_sheet_layout: ApplicationFormRecord['responseSheetLayout'] | null;
  created_at: string;
  updated_at: string;
  config: ApplicationFormRecord['config'];
};

function fromRow(row: ApplicationFormRow): ApplicationFormRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    slug: row.slug,
    status: row.status,
    responseSpreadsheetId: row.response_spreadsheet_id ?? undefined,
    responseSpreadsheetUrl: row.response_spreadsheet_url ?? undefined,
    responseSheetLayout: row.response_sheet_layout ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config: row.config,
  };
}

function toRow(form: ApplicationFormRecord): ApplicationFormRow {
  return {
    id: form.id,
    owner_id: form.ownerId,
    owner_email: form.ownerEmail,
    slug: form.slug,
    status: form.status,
    response_spreadsheet_id: form.responseSpreadsheetId ?? null,
    response_spreadsheet_url: form.responseSpreadsheetUrl ?? null,
    response_sheet_layout: form.responseSheetLayout ?? null,
    created_at: form.createdAt,
    updated_at: form.updatedAt,
    config: form.config,
  };
}

const SELECT_COLUMNS = 'id,owner_id,owner_email,slug,status,response_spreadsheet_id,response_spreadsheet_url,response_sheet_layout,created_at,updated_at,config';

export async function listApplicationForms(): Promise<ApplicationFormRecord[]> {
  const { data, error } = await adminClient()
    .from('application_forms')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load application forms: ${error.message}`);
  return ((data ?? []) as ApplicationFormRow[]).map(fromRow);
}

export async function getApplicationForm(id: string): Promise<ApplicationFormRecord | null> {
  const { data, error } = await adminClient()
    .from('application_forms')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load application form: ${error.message}`);
  return data ? fromRow(data as ApplicationFormRow) : null;
}

export async function getApplicationFormBySlug(slug: string): Promise<ApplicationFormRecord | null> {
  const { data, error } = await adminClient()
    .from('application_forms')
    .select(SELECT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load application form: ${error.message}`);
  return data ? fromRow(data as ApplicationFormRow) : null;
}

export async function saveApplicationForm(form: ApplicationFormRecord): Promise<void> {
  const { error } = await adminClient().from('application_forms').upsert(toRow(form), { onConflict: 'id' });
  if (error) throw new Error(`Could not save application form: ${error.message}`);
}

export async function deleteApplicationForm(id: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from('application_forms')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Could not delete application form: ${error.message}`);
  return Boolean(data);
}
