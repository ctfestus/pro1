import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COHORT = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), getForm: vi.fn(), listSubmissions: vi.fn(), audit: vi.fn(), reviewerFormIds: vi.fn(),
  admitStudents: vi.fn(),
  tables: {} as Record<string, any>,
}));

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/application-submissions', () => ({
  listApplicationSubmissions: mocks.listSubmissions,
  appendApplicationAudit: mocks.audit,
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
}));
vi.mock('@/lib/admit-students', () => ({ admitStudents: mocks.admitStudents }));
// A tiny query builder: every filter returns itself; maybeSingle/range resolve the table's canned data.
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      const builder: any = {};
      for (const method of ['select', 'eq', 'neq', 'order', 'in']) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: mocks.tables[table] ?? null, error: null });
      builder.range = async () => ({ data: mocks.tables[table] ?? [], error: null });
      return builder;
    },
  }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { GET, POST } from '@/app/api/application-forms/[id]/admit/route';

const config = newApplicationFormConfig('bootcamp');
const nameQuestion = { id: 'full-name', label: 'Full name', type: 'short_text' as const, required: true };
const baseForm = {
  id: 'form-1', ownerId: 'owner-1', ownerEmail: '', slug: 'bootcamp', status: 'published' as const, createdAt: '', updatedAt: '',
  config: { ...config, questions: [nameQuestion, ...config.questions], admission: { cohortId: COHORT, nameQuestionId: 'full-name' } },
};
const submission = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id, formId: 'form-1', email, state: 'submitted', stageId: 'accepted', answers: { 'full-name': `  Name ${id}  ` }, ...extra,
});

const as = (role: string, id = 'owner-1') => mocks.requireRole.mockResolvedValue({ role, actor: { id, email: `${id}@example.com` } });
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/application-forms/form-1/admit', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'form-1' }) });
const get = () => GET(new NextRequest('http://localhost/api/application-forms/form-1/admit'), { params: Promise.resolve({ id: 'form-1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  as('instructor');
  mocks.getForm.mockResolvedValue(baseForm);
  mocks.tables = {
    cohorts: { id: COHORT, name: 'October Cohort', start_date: '2026-10-20', status: 'active', cohort_kind: 'bootcamp' },
    cohort_payment_settings: { total_fee: 3000 },
    bootcamp_enrollments: [],
  };
  mocks.listSubmissions.mockResolvedValue([
    submission('s1', 'ama@example.com'),
    submission('s2', 'kofi@example.com'),
    submission('draft', 'draft@example.com', { state: 'draft' }),
  ]);
  mocks.admitStudents.mockResolvedValue({ inserted: 2, updated: 0, provisioned: 2, setupEmailsSent: 2, errors: [] });
  mocks.audit.mockResolvedValue(undefined);
});

describe('POST /api/application-forms/[id]/admit', () => {
  it('admits the selected submitted applications through the shared admissions pipeline', async () => {
    const response = await post({ submissionIds: ['s1', 's2', 'draft', 'other-form'] });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [
      { email: 'ama@example.com', full_name: 'Name s1' },
      { email: 'kofi@example.com', full_name: 'Name s2' },
    ]);
    expect(body.results.map((item: any) => [item.submissionId, item.status])).toEqual([['s1', 'admitted'], ['s2', 'admitted']]);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({ action: 'admitted', entityId: 's1', details: { cohortId: COHORT } });
  });

  it('reports failures per applicant and treats a failed setup email as admitted', async () => {
    mocks.admitStudents.mockResolvedValue({ inserted: 1, updated: 0, provisioned: 1, setupEmailsSent: 0, errors: [
      { email: 'Ama@example.com', error: 'This email already belongs to a staff or admin account.' },
      { email: 'kofi@example.com', error: 'Account created, but the setup email could not be sent.' },
    ] });
    const body = await (await post({ submissionIds: ['s1', 's2'] })).json();
    expect(body.results).toEqual([
      { submissionId: 's1', email: 'ama@example.com', status: 'failed', message: 'This email already belongs to a staff or admin account.' },
      { submissionId: 's2', email: 'kofi@example.com', status: 'admitted', message: 'Account created, but the setup email could not be sent.' },
    ]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('allows only admins and the form owner', async () => {
    as('instructor', 'someone-else');
    expect((await post({ submissionIds: ['s1'] })).status).toBe(403);
    as('admin', 'any-admin');
    expect((await post({ submissionIds: ['s1'] })).status).toBe(200);
  });

  it('refuses when no cohort is chosen, or the cohort is missing a fee or start date', async () => {
    mocks.getForm.mockResolvedValue({ ...baseForm, config: { ...baseForm.config, admission: undefined } });
    expect((await (await post({ submissionIds: ['s1'] })).json()).error).toContain('Review flow settings');

    mocks.getForm.mockResolvedValue(baseForm);
    mocks.tables.cohort_payment_settings = null;
    const noFee = await post({ submissionIds: ['s1'] });
    expect(noFee.status).toBe(400);
    expect((await noFee.json()).error).toBe('Set the fee for this cohort before admitting applicants.');

    mocks.tables.cohort_payment_settings = { total_fee: 3000 };
    mocks.tables.cohorts = { ...mocks.tables.cohorts, start_date: null };
    expect((await (await post({ submissionIds: ['s1'] })).json()).error).toBe('Set a start date for this cohort before admitting applicants.');
    expect(mocks.admitStudents).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized selection', async () => {
    expect((await post({ submissionIds: [] })).status).toBe(400);
    expect((await post({ submissionIds: Array.from({ length: 101 }, (_, index) => `s${index}`) })).status).toBe(400);
  });
});

describe('GET /api/application-forms/[id]/admit', () => {
  it('marks applications whose email is already enrolled in the cohort, ignoring case', async () => {
    mocks.tables.bootcamp_enrollments = [{ email: 'AMA@example.com' }];
    const body = await (await get()).json();
    expect(body).toMatchObject({ cohort: { id: COHORT, name: 'October Cohort', ready: true }, admittedSubmissionIds: ['s1'], canAdmit: true });
  });

  it('lets assigned reviewers see admission status without the Admit action', async () => {
    as('staff', 'reviewer-1');
    mocks.reviewerFormIds.mockResolvedValue(['form-1']);
    expect(await (await get()).json()).toMatchObject({ canAdmit: false });
    mocks.reviewerFormIds.mockResolvedValue([]);
    expect((await get()).status).toBe(403);
  });
});
