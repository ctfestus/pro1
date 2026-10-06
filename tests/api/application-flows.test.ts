import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), listForms: vi.fn(), getForm: vi.fn(), getFormBySlug: vi.fn(), getSubmission: vi.fn(),
  getSubmissionByTokenHash: vi.fn(), listSubmissions: vi.fn(), saveForm: vi.fn(),
  deleteStoredForm: vi.fn(), saveSubmission: vi.fn(), appendAudit: vi.fn(), sendConfirmation: vi.fn(),
  sendDecision: vi.fn(), related: vi.fn(), deleteFiles: vi.fn(), reviewerFormIds: vi.fn(),
  pruneDrafts: vi.fn(),
  countFiles: vi.fn(),
}));
const { requireRole, listForms, getForm, getFormBySlug, getSubmission, getSubmissionByTokenHash, listSubmissions,
  saveForm, deleteStoredForm, saveSubmission, appendAudit, sendConfirmation, sendDecision, related,
  deleteFiles, reviewerFormIds, pruneDrafts } = mocks;

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({
  listApplicationForms: mocks.listForms,
  getApplicationForm: mocks.getForm,
  getApplicationFormBySlug: mocks.getFormBySlug,
  saveApplicationForm: mocks.saveForm,
  deleteApplicationForm: mocks.deleteStoredForm,
}));
vi.mock('@/lib/application-submissions', () => ({
  ApplicationConcurrentUpdateError: class ApplicationConcurrentUpdateError extends Error {
    constructor() { super('This application was just updated by someone else. Reload and try again.'); }
  },
  getApplicationSubmission: mocks.getSubmission,
  getApplicationSubmissionByTokenHash: mocks.getSubmissionByTokenHash,
  listApplicationSubmissions: mocks.listSubmissions,
  saveApplicationSubmission: mocks.saveSubmission,
  appendApplicationAudit: mocks.appendAudit,
  pruneExpiredApplicationDrafts: mocks.pruneDrafts,
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
  isDuplicateApplicationError: (error: any) => Boolean(error?.duplicateApplication),
}));
vi.mock('@/lib/application-email', () => ({
  sendApplicationConfirmationEmail: mocks.sendConfirmation,
  sendApplicationDecisionEmail: mocks.sendDecision,
}));
vi.mock('@/lib/application-related', () => ({ resolveApplicationRelatedItems: mocks.related }));
vi.mock('@/lib/application-storage', () => ({
  normalizeApplicationStorageAnswers: async (_form: any, _submissionId: string, answers: any) => ({ answers, errors: {} }),
  deleteApplicationFormFiles: mocks.deleteFiles,
  countApplicationFormFiles: mocks.countFiles,
}));

import { newApplicationFee, newApplicationFormConfig } from '@/lib/application-forms';
import { ApplicationConcurrentUpdateError } from '@/lib/application-submissions';
import { POST as createForm } from '@/app/api/application-forms/route';
import { DELETE as deleteForm, GET as getFormById, PATCH as updateForm } from '@/app/api/application-forms/[id]/route';
import { GET as exportSubmissions } from '@/app/api/application-forms/[id]/submissions/route';
import { GET as getPublicForm, POST as submitPublicForm } from '@/app/api/public/application-forms/[slug]/route';
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
let persistedSubmission: any;

beforeEach(() => {
  vi.clearAllMocks();
  persistedSubmission = { ...structuredClone(submission), state: 'submitted', submittedAt: '2026-09-28T00:01:00.000Z' };
  requireRole.mockResolvedValue({ role: 'admin', actor: { id: 'owner-1', email: 'owner@example.com' }, user: { id: 'owner-1' }, serviceDb: {} });
  listForms.mockResolvedValue([]); getForm.mockResolvedValue(form); getFormBySlug.mockResolvedValue(form); getSubmission.mockImplementation(async () => persistedSubmission);
  getSubmissionByTokenHash.mockResolvedValue(submission); listSubmissions.mockResolvedValue([submission]);
  saveForm.mockResolvedValue(undefined); deleteStoredForm.mockResolvedValue(true); saveSubmission.mockImplementation(async (item: any) => { persistedSubmission = item; }); appendAudit.mockResolvedValue(undefined);
  deleteFiles.mockResolvedValue(undefined); reviewerFormIds.mockResolvedValue([]);
  mocks.countFiles.mockResolvedValue(0);
  pruneDrafts.mockResolvedValue(undefined);
  sendConfirmation.mockResolvedValue(undefined); sendDecision.mockResolvedValue(undefined); related.mockResolvedValue([]);
});

describe('application end-to-end route boundaries', () => {
  it('creates an editable draft form', async () => {
    const response = await createForm(new Request('http://localhost/api/application-forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: 'scholarship' }) }) as any);
    expect(response.status).toBe(200);
    expect((await response.json()).form.status).toBe('draft');
    expect(saveForm).toHaveBeenCalledOnce();
  });

  it('does not report form creation as failed after a noncritical audit error', async () => {
    appendAudit.mockRejectedValueOnce(new Error('Audit unavailable'));
    const response = await createForm(new Request('http://localhost/api/application-forms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'bootcamp' }),
    }) as any);
    expect(response.status).toBe(200);
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

  it('publishes a form without creating a Google spreadsheet', async () => {
    getForm.mockResolvedValue({ ...form, status: 'draft' });
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(200);
    expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
    }));
  });

  it('saves one display-only fee and exposes its selected currency to applicants', async () => {
    const fee = { ...newApplicationFee('application'), amount: 25, currency: 'NGN' };
    const updatedConfig = { ...config, fee };
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: updatedConfig }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(200);
    expect(saveForm).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ fee }) }));

    getFormBySlug.mockResolvedValue({ ...form, config: updatedConfig });
    const publicResponse = await getPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp') as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).form.config.fee).toEqual(fee);
  });

  it('rejects a fee with an invalid amount before saving the form', async () => {
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...config, fee: { ...newApplicationFee(), amount: 0 } } }),
    }) as any, { params: Promise.resolve({ id: form.id }) });

    expect(response.status).toBe(400);
    expect(saveForm).not.toHaveBeenCalled();
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
    expect(await response.json()).toEqual({ deleted: true, submissionCount: 1, uploadsRemoved: true });
    expect(deleteStoredForm).toHaveBeenCalledWith(form.id);
    expect(deleteFiles).toHaveBeenCalledWith(form.id);
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deleted',
      details: expect.objectContaining({ title: form.config.title, submissionCount: 1 }),
    }));
  });

  it('continues deleting an owned form when its audit write fails', async () => {
    appendAudit.mockRejectedValueOnce(new Error('Audit unavailable'));
    const response = await deleteForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'DELETE',
    }) as any, { params: Promise.resolve({ id: form.id }) });
    expect(response.status).toBe(200);
    expect(deleteStoredForm).toHaveBeenCalledWith(form.id);
  });

  it('reports the permanent deletion impact before removing a form', async () => {
    listSubmissions.mockResolvedValue([submission, { ...submission, id: 'submission-2' }]);
    mocks.countFiles.mockResolvedValue(3);
    const response = await getFormById(new Request('http://localhost/api/application-forms/form-1?deleteImpact=1') as any, {
      params: Promise.resolve({ id: form.id }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).deletionImpact).toEqual({ submissionCount: 2, fileCount: 3 });
  });

  it('does not disclose the full deletion impact to assigned staff', async () => {
    requireRole.mockResolvedValue({ role: 'staff', actor: { id: 'reviewer-1', email: 'reviewer@example.com' }, user: { id: 'reviewer-1' }, serviceDb: {} });
    reviewerFormIds.mockResolvedValue(['form-1']);
    const response = await getFormById(new Request('http://localhost/api/application-forms/form-1?deleteImpact=1') as any, {
      params: Promise.resolve({ id: form.id }),
    });
    expect(response.status).toBe(403);
    expect(listSubmissions).not.toHaveBeenCalled();
    expect(mocks.countFiles).not.toHaveBeenCalled();
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

  it('rejects answers that fail instructor response validation before saving', async () => {
    const shortQuestion = config.questions.find(question => question.required && question.type === 'short_text')!;
    getFormBySlug.mockResolvedValue({ ...form, config: {
      ...config,
      questions: config.questions.map(question => question.id === shortQuestion.id
        ? { ...question, validation: { requireUrl: true } }
        : question),
    } });
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: requiredAnswers }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).errors[shortQuestion.id]).toBe('Enter a valid HTTP or HTTPS URL.');
    expect(saveSubmission).not.toHaveBeenCalled();
  });

  it('requires an Other detail at the public submission boundary', async () => {
    const choice = { id: 'track', label: 'Track', type: 'dropdown', required: true, options: ['Data', 'Design'], allowOther: true };
    getFormBySlug.mockResolvedValue({ ...form, config: { ...config, questions: [...config.questions, choice] } });
    const post = (otherText: string) => submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: { ...requiredAnswers, track: { kind: 'other_choice', selections: ['Other (please specify)'], otherText } } }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    const invalid = await post('  ');
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).errors.track).toBe('Please specify your other answer.');
    expect(saveSubmission).not.toHaveBeenCalled();
    const valid = await post('Research');
    expect(valid.status).toBe(200);
    expect(saveSubmission.mock.calls.at(-1)?.[0].answers.track.otherText).toBe('Research');
  });

  it('returns the reference and link when audit logging fails after submission', async () => {
    appendAudit.mockRejectedValueOnce(new Error('Audit unavailable'));
    const response = await submitPublicForm(new Request('http://localhost/api/public/application-forms/bootcamp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', email: 'applicant@example.com', answers: requiredAnswers }),
    }) as any, { params: Promise.resolve({ slug: 'bootcamp' }) });
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(value.submission.reference).toBeTruthy();
    expect(value.token).toBeTruthy();
    expect(sendConfirmation).toHaveBeenCalledOnce();
  });

  it('refuses to remove a review stage used by a submitted applicant', async () => {
    listSubmissions.mockResolvedValue([{ ...submission, state: 'submitted', stageId: 'accepted' }]);
    const response = await updateForm(new Request('http://localhost/api/application-forms/form-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...config, stages: config.stages.filter(stage => stage.id !== 'accepted') } }),
    }) as any, { params: Promise.resolve({ id: form.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('1 applicant is in Accepted');
    expect(saveForm).not.toHaveBeenCalled();
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

  it('does not allow staff to review an unsubmitted upload session', async () => {
    persistedSubmission = structuredClone(submission);
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: 'accepted' }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(409);
    expect(saveSubmission).not.toHaveBeenCalled();
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
    persistedSubmission.tokenHash = 'hash,older-1,older-2,older-3,older-4';
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
    expect(saved.tokenHash.split(',')).toEqual(expect.arrayContaining(['hash', 'older-1', 'older-2', 'older-3', 'older-4']));
    expect(saved.statusHistory.at(-1)).toEqual(expect.objectContaining({
      stageId: 'accepted',
      stageName: 'Accepted',
      messageType: 'acceptance',
    }));
    expect(sendDecision).toHaveBeenCalledOnce();
    expect(saveSubmission.mock.invocationCallOrder[0]).toBeLessThan(sendDecision.mock.invocationCallOrder[0]);
    expect(sendDecision.mock.invocationCallOrder[0]).toBeLessThan(saveSubmission.mock.invocationCallOrder[1]);

    getSubmissionByTokenHash.mockResolvedValue(saved);
    const statusResponse = await applicantStatus(new Request('http://localhost') as any, { params: Promise.resolve({ token: 'token' }) });
    expect((await statusResponse.json()).submission.status).toBe('Accepted');
  });

  it('sends a custom email without changing the application stage', async () => {
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { type: 'custom', subject: 'Application update', body: 'We will be in touch soon.' } }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(200);
    expect(persistedSubmission.stageId).toBe(submission.stageId);
    expect(persistedSubmission.statusHistory).toEqual(submission.statusHistory);
    expect(sendDecision).toHaveBeenCalledOnce();
    expect(persistedSubmission.messages.at(-1)).toEqual(expect.objectContaining({ type: 'custom', subject: 'Application update' }));
  });

  it('keeps the saved decision and warns when its email fails', async () => {
    sendDecision.mockRejectedValueOnce(new Error('Email unavailable'));
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { type: 'acceptance', subject: 'Application accepted', body: 'Welcome to the programme.' },
      }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(200);
    expect((await response.json()).warning).toBe('Decision saved, but the email could not be sent.');
    expect(saveSubmission).toHaveBeenCalledOnce();
    expect(persistedSubmission.stageId).toBe('accepted');
    expect(persistedSubmission.messages).toEqual([]);
  });

  it('does not email an applicant when saving the decision fails', async () => {
    saveSubmission.mockRejectedValueOnce(new Error('Database unavailable'));
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: 'accepted', message: { type: 'acceptance', subject: 'Accepted', body: 'Welcome.' } }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(503);
    expect(sendDecision).not.toHaveBeenCalled();
  });

  it('returns a conflict for a concurrent review and sends no email', async () => {
    saveSubmission.mockRejectedValueOnce(new ApplicationConcurrentUpdateError());
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: 'accepted', message: { type: 'acceptance', subject: 'Accepted', body: 'Welcome.' } }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Reload and try again');
    expect(sendDecision).not.toHaveBeenCalled();
  });

  it('reports a saved review even when audit logging fails', async () => {
    appendAudit.mockRejectedValueOnce(new Error('Audit unavailable'));
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: 'screening' }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(200);
    expect((await response.json()).submission.stageId).toBe('screening');
  });

  it('requires a selected stage for a decision email without a matching stage', async () => {
    getForm.mockResolvedValue({ ...form, config: { ...config, stages: config.stages.filter(stage => stage.id !== 'accepted') } });
    const response = await reviewApplication(new Request('http://localhost/api/application-submissions/submission-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { type: 'acceptance', subject: 'Accepted', body: 'Welcome.' } }),
    }) as any, { params: Promise.resolve({ id: 'submission-1' }) });
    expect(response.status).toBe(400);
    expect(sendDecision).not.toHaveBeenCalled();
  });
});
