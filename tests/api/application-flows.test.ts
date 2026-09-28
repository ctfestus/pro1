import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), listForms: vi.fn(), getForm: vi.fn(), getFormBySlug: vi.fn(), getSubmission: vi.fn(),
  getSubmissionByTokenHash: vi.fn(), listSubmissions: vi.fn(), saveForm: vi.fn(),
  deleteStoredForm: vi.fn(), saveSubmission: vi.fn(), appendAudit: vi.fn(), sendConfirmation: vi.fn(),
  sendDecision: vi.fn(), related: vi.fn(), createSpreadsheet: vi.fn(), trashSpreadsheet: vi.fn(), reviewerFormIds: vi.fn(),
  syncSchema: vi.fn(), reserveToken: vi.fn(), restoreTokens: vi.fn(),
}));
const { requireRole, listForms, getForm, getFormBySlug, getSubmission, getSubmissionByTokenHash, listSubmissions,
  saveForm, deleteStoredForm, saveSubmission, appendAudit, sendConfirmation, sendDecision, related,
  createSpreadsheet, trashSpreadsheet, reviewerFormIds, syncSchema, reserveToken, restoreTokens } = mocks;

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({
  listApplicationForms: mocks.listForms,
  getApplicationForm: mocks.getForm,
  getApplicationFormBySlug: mocks.getFormBySlug,
  saveApplicationForm: mocks.saveForm,
  deleteApplicationForm: mocks.deleteStoredForm,
}));
vi.mock('@/lib/application-sheets', () => ({
  getApplicationSubmission: mocks.getSubmission,
  getApplicationSubmissionByTokenHash: mocks.getSubmissionByTokenHash,
  listApplicationSubmissions: mocks.listSubmissions,
  saveApplicationSubmission: mocks.saveSubmission,
  appendApplicationAudit: mocks.appendAudit,
  createApplicationResponseSpreadsheet: mocks.createSpreadsheet,
  trashApplicationResponseSpreadsheet: mocks.trashSpreadsheet,
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
  syncApplicationResponseSchema: mocks.syncSchema,
  reserveApplicationAccessToken: mocks.reserveToken,
  restoreApplicationAccessTokens: mocks.restoreTokens,
  isDuplicateApplicationError: (error: any) => Boolean(error?.duplicateApplication),
}));
vi.mock('@/lib/application-email', () => ({
  sendApplicationConfirmationEmail: mocks.sendConfirmation,
  sendApplicationDecisionEmail: mocks.sendDecision,
}));
vi.mock('@/lib/application-related', () => ({ resolveApplicationRelatedItems: mocks.related }));
vi.mock('@/lib/application-drive', () => ({
  normalizeApplicationDriveAnswers: async (_form: any, _submissionId: string, answers: any) => ({ answers, errors: {} }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { POST as createForm } from '@/app/api/application-forms/route';
import { DELETE as deleteForm, GET as getFormById, PATCH as updateForm } from '@/app/api/application-forms/[id]/route';
import { GET as exportSubmissions } from '@/app/api/application-forms/[id]/submissions/route';
import { POST as submitPublicForm } from '@/app/api/public/application-forms/[slug]/route';
import { GET as applicantStatus } from '@/app/api/public/applications/[token]/route';
import { PATCH as reviewApplication } from '@/app/api/application-submissions/[id]/route';

const config = newApplicationFormConfig();
const form = { id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'bootcamp', status: 'published' as const, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', config };
const requiredAnswers = Object.fromEntries(config.questions.filter(question => question.required).map(question => [question.id,
  question.type === 'consent' ? true
    : question.type === 'yes_no' ? 'Yes'
      : question.type === 'phone' ? '+233200000000'
        : ['single_choice', 'dropdown'].includes(question.type) ? question.options?.[0]
          : 'Answer',
]));
const submission = { id: 'submission-1', formId: form.id, reference: 'APP-1', email: 'applicant@example.com', state: 'draft' as const, stageId: 'submitted', assignedReviewerId: '', assignedReviewerEmail: '', score: null, createdAt: '', updatedAt: '', submittedAt: '', tokenHash: 'hash', answers: {}, privateNotes: [], statusHistory: [], messages: [] };

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ role: 'admin', actor: { id: 'owner-1', email: 'owner@example.com' }, user: { id: 'owner-1' }, serviceDb: {} });
  listForms.mockResolvedValue([]); getForm.mockResolvedValue(form); getFormBySlug.mockResolvedValue(form); getSubmission.mockResolvedValue(submission);
  getSubmissionByTokenHash.mockResolvedValue(submission); listSubmissions.mockResolvedValue([submission]);
  saveForm.mockResolvedValue(undefined); deleteStoredForm.mockResolvedValue(true); saveSubmission.mockResolvedValue(undefined); appendAudit.mockResolvedValue(undefined);
  createSpreadsheet.mockResolvedValue({
    id: 'response-sheet-1',
    url: 'https://docs.google.com/spreadsheets/d/response-sheet-1/edit',
    layout: {
      version: 2, schemaHash: 'schema-hash', storageFolderId: 'form-folder-1', uploadsFolderId: 'uploads-folder-1',
      responsesSheetId: 1, statusHistorySheetId: 2, privateNotesSheetId: 3, emailsSheetId: 4, filesSheetId: 5,
    },
  });
  trashSpreadsheet.mockResolvedValue(undefined); reviewerFormIds.mockResolvedValue([]);
  syncSchema.mockResolvedValue({
    version: 2, schemaHash: 'schema-hash', storageFolderId: 'form-folder-1', uploadsFolderId: 'uploads-folder-1',
    responsesSheetId: 1, statusHistorySheetId: 2, privateNotesSheetId: 3, emailsSheetId: 4, filesSheetId: 5,
  });
  reserveToken.mockResolvedValue(['hash']); restoreTokens.mockResolvedValue(undefined);
  sendConfirmation.mockResolvedValue(undefined); sendDecision.mockResolvedValue(undefined); related.mockResolvedValue([]);
});

describe('application end-to-end route boundaries', () => {
  it('creates an editable draft form', async () => {
    const response = await createForm(new Request('http://localhost/api/application-forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: 'scholarship' }) }) as any);
    expect(response.status).toBe(200);
    expect((await response.json()).form.status).toBe('draft');
    expect(saveForm).toHaveBeenCalledOnce();
  });

  it('saves a custom registration URL', async () => {
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'data-bootcamp-2026' }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(200);
    expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({ slug: 'data-bootcamp-2026' }));
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      details: { fromSlug: 'bootcamp', toSlug: 'data-bootcamp-2026' },
    }));
  });

  it('creates a dedicated response spreadsheet when a form is first published', async () => {
    getForm.mockResolvedValue({ ...form, status: 'draft', responseSpreadsheetId: undefined, responseSpreadsheetUrl: undefined });
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(200);
    expect(createSpreadsheet).toHaveBeenCalledOnce();
    expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({
      responseSpreadsheetId: 'response-sheet-1',
      responseSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/response-sheet-1/edit',
      responseSheetLayout: expect.objectContaining({ version: 2, uploadsFolderId: 'uploads-folder-1' }),
    }));
  });

  it('rejects a registration URL already used by another form', async () => {
    listForms.mockResolvedValue([{ ...form, id: 'form-2', slug: 'data-bootcamp-2026' }]);
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'data-bootcamp-2026' }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('already in use');
  });

  it('deletes an owned form and its submissions', async () => {
    const response = await deleteForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'DELETE',
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, submissionCount: 1, spreadsheetTrashed: true });
    expect(deleteStoredForm).toHaveBeenCalledWith(form.id);
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deleted',
      details: expect.objectContaining({ title: form.config.title, submissionCount: 1 }),
    }));
  });

  it('prevents an instructor from deleting another instructor form', async () => {
    requireRole.mockResolvedValue({ role: 'instructor', actor: { id: 'other-owner', email: 'other@example.com' }, user: { id: 'other-owner' }, serviceDb: {} });
    const response = await deleteForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'DELETE',
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(403);
    expect(deleteStoredForm).not.toHaveBeenCalled();
  });

  it('checks staff assignment in the index without reading response rows', async () => {
    requireRole.mockResolvedValue({
      role: 'staff', actor: { id: 'reviewer-1', email: 'reviewer@example.com' }, user: { id: 'reviewer-1' }, serviceDb: {},
    });
    reviewerFormIds.mockResolvedValue(['form-1']);
    const response = await getFormById(new Request('http://localhost/api/application-forms/form-1') as any, {
      params: Promise.resolve({ id: form.id }),
    });
    expect(response.status).toBe(200);
    expect(reviewerFormIds).toHaveBeenCalledWith('reviewer-1');
    expect(listSubmissions).not.toHaveBeenCalled();
  });

  it('submits directly from the shared registration URL without an email-link step', async () => {
    const relatedItem = { id: 'course-1', title: 'Data bootcamp', slug: 'data-bootcamp', type: 'course' };
    related.mockResolvedValue([relatedItem]);
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: requiredAnswers }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(value.submission.state).toBe('submitted');
    expect(value.token).toBeTruthy();
    expect(value.postSubmission).toEqual(config.postSubmission);
    expect(value.relatedItems).toEqual([relatedItem]);
    expect(saveSubmission.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      email: 'applicant@example.com',
      state: 'submitted',
    }));
    expect(sendConfirmation).toHaveBeenCalledOnce();
  });

  it('returns a conflict when the atomic duplicate claim is rejected', async () => {
    saveSubmission.mockRejectedValueOnce({
      duplicateApplication: true,
      message: 'An application has already been submitted for this email address.',
    });
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: requiredAnswers }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('already been submitted');
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it('does not store rich text blocks as applicant answers', async () => {
    getFormBySlug.mockResolvedValue({
      ...form,
      config: {
        ...config,
        questions: [...config.questions, { id: 'context', label: 'Before you apply', type: 'text_block', required: false, richText: '<p>Read this first.</p>' }],
      },
    });
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: { ...requiredAnswers, context: 'not an answer' } }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });

    expect(response.status).toBe(200);
    expect(saveSubmission.mock.calls.at(-1)?.[0].answers).not.toHaveProperty('context');
  });

  it('returns applicant status without private review data', async () => {
    getSubmissionByTokenHash.mockResolvedValue({ ...submission, state: 'submitted', privateNotes: [{ id: 'n', body: 'private' }], tokenHash: 'secret' });
    const response = await applicantStatus(new Request('http://localhost') as any, { params: Promise.resolve({ token: 'token' }) });
    const value = await response.json();
    expect(value.submission.status).toBe('Application received');
    expect(value.submission.privateNotes).toBeUndefined();
    expect(value.submission.tokenHash).toBeUndefined();
  });

  it('exports submitted applications as CSV without secure tokens or private notes', async () => {
    listSubmissions.mockResolvedValue([{
      ...submission,
      state: 'submitted',
      submittedAt: '2026-09-26T10:00:00.000Z',
      privateNotes: [{ id: 'note-1', body: 'Internal only' }],
      answers: requiredAnswers,
    }]);
    const response = await exportSubmissions(
      new NextRequest('http://localhost/api/application-forms/form-1/submissions?format=csv'),
      { params: Promise.resolve({ id: form.id }) },
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('bootcamp-applications.csv');
    expect(csv).toContain('applicant@example.com');
    expect(csv).not.toContain('hash');
    expect(csv).not.toContain('Internal only');
  });

  it('records private review notes and stage changes', async () => {
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'Strong application', stageId: 'screening', score: 88 }) }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(200);
    const saved = saveSubmission.mock.calls.at(-1)?.[0];
    expect(saved.privateNotes[0].body).toBe('Strong application');
    expect(saved.stageId).toBe('screening');
    expect(saved.score).toBe(88);
  });

  it('resolves reviewer email from the server instead of trusting the browser', async () => {
    const reviewerQuery: any = {
      eq: vi.fn(() => reviewerQuery),
      in: vi.fn(() => reviewerQuery),
      maybeSingle: vi.fn(async () => ({
        data: { id: 'reviewer-1', email: 'reviewer@example.com', role: 'instructor' }, error: null,
      })),
    };
    requireRole.mockResolvedValue({
      role: 'admin', actor: { id: 'owner-1', email: 'owner@example.com' }, user: { id: 'owner-1' },
      serviceDb: { from: vi.fn(() => ({ select: vi.fn(() => reviewerQuery) })) },
    });
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedReviewerId: 'reviewer-1', assignedReviewerEmail: 'spoofed@example.com' }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(200);
    expect(saveSubmission.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      assignedReviewerId: 'reviewer-1',
      assignedReviewerEmail: 'reviewer@example.com',
    }));
  });

  it('moves the application stage when a decision message is sent', async () => {
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { type: 'acceptance', subject: 'Application accepted', body: 'Welcome to the programme.' },
      }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(200);
    const saved = saveSubmission.mock.calls.at(-1)?.[0];
    expect(saved.stageId).toBe('accepted');
    expect(saved.statusHistory.at(-1)).toEqual(expect.objectContaining({
      stageId: 'accepted',
      stageName: 'Accepted',
      messageType: 'acceptance',
    }));
    expect(sendDecision).toHaveBeenCalledOnce();

    getSubmissionByTokenHash.mockResolvedValue(saved);
    const statusResponse = await applicantStatus(new Request('http://localhost') as any, { params: Promise.resolve({ token: 'token' }) });
    expect((await statusResponse.json()).submission.status).toBe('Accepted');
  });

  it('does not save a stage change when the decision email fails', async () => {
    sendDecision.mockRejectedValueOnce(new Error('Email unavailable'));
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { type: 'acceptance', subject: 'Application accepted', body: 'Welcome to the programme.' },
      }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(503);
    expect(reserveToken).toHaveBeenCalledOnce();
    expect(restoreTokens).toHaveBeenCalledWith(submission.id, ['hash']);
    expect(saveSubmission).not.toHaveBeenCalled();
  });
});
