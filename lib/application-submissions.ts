import { createHash } from 'crypto';
import { adminClient } from '@/lib/admin-client';
import { getApplicationForm } from '@/lib/application-form-store';
import { APPLICATION_UPLOAD_BUCKET } from '@/lib/application-storage';
import {
  isApplicationContentBlock,
  type ApplicationAnswer,
  type ApplicationAuditRecord,
  type ApplicationMessage,
  type ApplicationPrivateNote,
  type ApplicationStatusEvent,
  type ApplicationSubmissionRecord,
} from '@/lib/application-forms';

const TABLE = 'application_submissions';
const SELECT_COLUMNS = [
  'id', 'form_id', 'owner_id', 'token_hashes', 'email_hash', 'email', 'reference', 'state',
  'stage_id', 'assigned_reviewer_id', 'assigned_reviewer_email', 'score', 'answers',
  'question_labels', 'status_history', 'private_notes', 'messages', 'submitted_at',
  'created_at', 'updated_at',
].join(',');

type SubmissionRow = {
  id: string;
  form_id: string;
  owner_id: string;
  token_hashes: string[];
  email_hash: string;
  email: string;
  reference: string;
  state: ApplicationSubmissionRecord['state'];
  stage_id: string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_email: string;
  score: number | null;
  answers: Record<string, ApplicationAnswer>;
  question_labels: Record<string, string>;
  status_history: ApplicationStatusEvent[];
  private_notes: ApplicationPrivateNote[];
  messages: ApplicationMessage[];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export class DuplicateApplicationError extends Error {
  constructor() {
    super('An application has already been submitted for this email address.');
    this.name = 'DuplicateApplicationError';
  }
}

export class ApplicationConcurrentUpdateError extends Error {
  constructor() {
    super('This application was just updated by someone else. Reload and try again.');
    this.name = 'ApplicationConcurrentUpdateError';
  }
}

export function isDuplicateApplicationError(error: unknown): error is DuplicateApplicationError {
  return error instanceof DuplicateApplicationError;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function fromRow(row: SubmissionRow): ApplicationSubmissionRecord {
  return {
    id: row.id,
    formId: row.form_id,
    reference: row.reference,
    email: row.email,
    state: row.state,
    stageId: row.stage_id,
    assignedReviewerId: row.assigned_reviewer_id ?? '',
    assignedReviewerEmail: row.assigned_reviewer_email,
    score: row.score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at ?? '',
    tokenHash: (row.token_hashes ?? []).join(','),
    answers: row.answers ?? {},
    questionLabels: row.question_labels ?? {},
    privateNotes: row.private_notes ?? [],
    statusHistory: row.status_history ?? [],
    messages: row.messages ?? [],
  };
}

async function find(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await adminClient().from(TABLE).select(SELECT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load the application: ${error.message}`);
  return data as SubmissionRow | null;
}

export async function listApplicationSubmissions(formId?: string): Promise<ApplicationSubmissionRecord[]> {
  const result: ApplicationSubmissionRecord[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = adminClient().from(TABLE).select(SELECT_COLUMNS).eq('state', 'submitted')
      .order('updated_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (formId) query = query.eq('form_id', formId);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load application submissions: ${error.message}`);
    const rows = (data ?? []) as unknown as SubmissionRow[];
    result.push(...rows.map(fromRow));
    if (rows.length < pageSize) return result;
  }
}

export async function getApplicationSubmission(id: string): Promise<ApplicationSubmissionRecord | null> {
  const row = await find(id);
  return row ? fromRow(row) : null;
}

export async function getApplicationSubmissionByTokenHash(tokenHash: string): Promise<ApplicationSubmissionRecord | null> {
  const { data, error } = await adminClient().from(TABLE).select(SELECT_COLUMNS)
    .contains('token_hashes', [tokenHash]).maybeSingle();
  if (error) throw new Error(`Could not load the application status: ${error.message}`);
  return data ? fromRow(data as unknown as SubmissionRow) : null;
}

export async function getApplicationSubmissionByEmail(formId: string, email: string): Promise<ApplicationSubmissionRecord | null> {
  const { data, error } = await adminClient().from(TABLE).select(SELECT_COLUMNS)
    .eq('form_id', formId).eq('email_hash', emailHash(email)).eq('state', 'submitted').maybeSingle();
  if (error) throw new Error(`Could not check for an existing application: ${error.message}`);
  return data ? fromRow(data as unknown as SubmissionRow) : null;
}

export async function saveApplicationSubmission(item: ApplicationSubmissionRecord, expectedUpdatedAt?: string): Promise<void> {
  const form = await getApplicationForm(item.formId);
  if (!form) throw new Error('Application form not found.');
  const existing = await find(item.id);
  const labels = Object.fromEntries(form.config.questions
    .filter(question => !isApplicationContentBlock(question))
    .map(question => [question.id, question.label]));
  const row = {
    id: item.id,
    form_id: form.id,
    owner_id: form.ownerId,
    token_hashes: item.tokenHash.split(',').filter(Boolean),
    email_hash: emailHash(item.email),
    email: item.email,
    reference: item.reference,
    state: item.state,
    stage_id: item.stageId,
    assigned_reviewer_id: item.assignedReviewerId || null,
    assigned_reviewer_email: item.assignedReviewerEmail,
    score: item.score,
    answers: item.answers,
    question_labels: { ...labels, ...existing?.question_labels, ...item.questionLabels },
    status_history: item.statusHistory,
    private_notes: item.privateNotes,
    messages: item.messages,
    submitted_at: item.submittedAt || null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
  let update = adminClient().from(TABLE).update(row).eq('id', item.id);
  if (existing?.state === 'draft' && item.state === 'submitted') update = update.eq('state', 'draft');
  if (expectedUpdatedAt) update = update.eq('updated_at', expectedUpdatedAt);
  const result = existing
    ? await update.select('id').maybeSingle()
    : await adminClient().from(TABLE).insert(row);
  if (result.error?.code === '23505') throw new DuplicateApplicationError();
  if (result.error) throw new Error(`Could not save this application: ${result.error.message}`);
  if (existing && !result.data) {
    if (expectedUpdatedAt) throw new ApplicationConcurrentUpdateError();
    if (existing.state === 'draft' && item.state === 'submitted') throw new DuplicateApplicationError();
    throw new Error('This application changed while saving. Please try again.');
  }
}

export async function listApplicationFormIdsForReviewer(reviewerId: string): Promise<string[]> {
  const { data, error } = await adminClient().from(TABLE).select('form_id').eq('assigned_reviewer_id', reviewerId);
  if (error) throw new Error(`Could not load reviewer assignments: ${error.message}`);
  return [...new Set((data ?? []).map(row => String(row.form_id)))];
}

/**
 * Submitted-application counts per form, for the forms list. One paged query over form_id
 * only, instead of a fetch per card. `reviewerId` limits counts to that reviewer's assignments.
 */
export async function countSubmittedApplicationsByForm(formIds: string[], reviewerId?: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(formIds.map(id => [id, 0]));
  if (!formIds.length) return counts;
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = adminClient().from(TABLE).select('form_id').eq('state', 'submitted').in('form_id', formIds)
      .order('id').range(offset, offset + pageSize - 1);
    if (reviewerId) query = query.eq('assigned_reviewer_id', reviewerId);
    const { data, error } = await query;
    if (error) throw new Error(`Could not count applications: ${error.message}`);
    for (const row of data ?? []) counts[String(row.form_id)] = (counts[String(row.form_id)] ?? 0) + 1;
    if ((data ?? []).length < pageSize) return counts;
  }
}

export async function pruneExpiredApplicationDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminClient().from(TABLE).select('id,form_id')
    .eq('state', 'draft').lt('created_at', cutoff).limit(20);
  if (error) throw new Error(`Could not find expired application drafts: ${error.message}`);
  for (const row of data ?? []) {
    const { data: deleted, error: deleteError } = await adminClient().from(TABLE).delete()
      .eq('id', row.id).eq('state', 'draft').lt('created_at', cutoff).select('id').maybeSingle();
    if (deleteError) throw new Error(`Could not remove an expired application draft: ${deleteError.message}`);
    if (!deleted) continue;
    const folder = `${row.form_id}/${row.id}`;
    const bucket = adminClient().storage.from(APPLICATION_UPLOAD_BUCKET);
    const { data: files, error: listError } = await bucket.list(folder, { limit: 1000 });
    if (listError) throw new Error(`Could not list expired application files: ${listError.message}`);
    const paths = (files ?? []).filter(file => file.id).map(file => `${folder}/${file.name}`);
    if (paths.length) {
      const { error: removeError } = await bucket.remove(paths);
      if (removeError) throw new Error(`Could not remove expired application files: ${removeError.message}`);
    }
  }
}

export async function appendApplicationAudit(item: ApplicationAuditRecord): Promise<void> {
  let formId = item.entityType === 'form' ? item.entityId : String(item.details.formId ?? '');
  if (!formId && item.entityType === 'submission') {
    const { data } = await adminClient().from(TABLE).select('form_id').eq('id', item.entityId).maybeSingle();
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
