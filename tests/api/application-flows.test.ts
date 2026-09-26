import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), listForms: vi.fn(), getForm: vi.fn(), getFormBySlug: vi.fn(), getSubmission: vi.fn(),
  getSubmissionByTokenHash: vi.fn(), listSubmissions: vi.fn(), saveForm: vi.fn(),
  saveSubmission: vi.fn(), appendAudit: vi.fn(), sendConfirmation: vi.fn(),
  sendDecision: vi.fn(), related: vi.fn(),
}));
const { requireRole, listForms, getForm, getFormBySlug, getSubmission, getSubmissionByTokenHash, listSubmissions,
  saveForm, saveSubmission, appendAudit, sendConfirmation, sendDecision, related } = mocks;

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-sheets', () => ({
  listApplicationForms: mocks.listForms,
  getApplicationForm: mocks.getForm,
  getApplicationFormBySlug: mocks.getFormBySlug,
  getApplicationSubmission: mocks.getSubmission,
  getApplicationSubmissionByTokenHash: mocks.getSubmissionByTokenHash,
  listApplicationSubmissions: mocks.listSubmissions,
  saveApplicationForm: mocks.saveForm,
  saveApplicationSubmission: mocks.saveSubmission,
  appendApplicationAudit: mocks.appendAudit,
}));
vi.mock('@/lib/application-email', () => ({
  sendApplicationConfirmationEmail: mocks.sendConfirmation,
  sendApplicationDecisionEmail: mocks.sendDecision,
}));
vi.mock('@/lib/application-related', () => ({ resolveApplicationRelatedItems: mocks.related }));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { POST as createForm } from '@/app/api/application-forms/route';
import { PATCH as updateForm } from '@/app/api/application-forms/[id]/route';
import { GET as exportSubmissions } from '@/app/api/application-forms/[id]/submissions/route';
import { POST as submitPublicForm } from '@/app/api/public/application-forms/[slug]/route';
import { GET as applicantStatus, POST as submitApplication } from '@/app/api/public/applications/[token]/route';
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
  saveForm.mockResolvedValue(undefined); saveSubmission.mockResolvedValue(undefined); appendAudit.mockResolvedValue(undefined);
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

  it('validates and stores a submitted application with a reference', async () => {
    const response = await submitApplication(new Request('http://localhost/api/public/applications/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: requiredAnswers }) }) as any, { params: Promise.resolve({ token: 'token' }) });
    expect(response.status).toBe(200);
    expect(saveSubmission.mock.calls.at(-1)?.[0].state).toBe('submitted');
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'submitted' }));
  });

  it('submits directly from the shared registration URL without an email-link step', async () => {
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: requiredAnswers }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    const value = await response.json();

    expect(response.status).toBe(200);
    expect(value.submission.state).toBe('submitted');
    expect(value.token).toBeTruthy();
    expect(saveSubmission.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      email: 'applicant@example.com',
      state: 'submitted',
    }));
    expect(sendConfirmation).toHaveBeenCalledOnce();
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
});
