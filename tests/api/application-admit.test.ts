import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COHORT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), getForm: vi.fn(), listSubmissions: vi.fn(), audit: vi.fn(), reviewerFormIds: vi.fn(),
  admitStudents: vi.fn(),
  single: {} as Record<string, any>,
  lists: {} as Record<string, any[]>,
  filters: [] as Array<[string, string, unknown[]]>,
}));

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/application-submissions', () => ({
  listApplicationSubmissions: mocks.listSubmissions,
  appendApplicationAudit: mocks.audit,
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
}));
vi.mock('@/lib/admit-students', () => ({ admitStudents: mocks.admitStudents }));
// A tiny query builder: filters are recorded and return the builder; maybeSingle resolves the
// table's single row, while range or awaiting the query resolves its list.
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      const builder: any = {};
      for (const method of ['select', 'eq', 'neq', 'order', 'in', 'not', 'is']) {
        builder[method] = (...args: unknown[]) => { mocks.filters.push([table, method, args]); return builder; };
      }
      builder.maybeSingle = async () => ({ data: mocks.single[table] ?? null, error: null });
      builder.range = async () => ({ data: mocks.lists[table] ?? [], error: null });
      builder.then = (resolve: (value: unknown) => void) => resolve({ data: mocks.lists[table] ?? [], error: null });
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
const ALL = ['new', 'nocohort', 'other', 'here', 'staff'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters = [];
  as('instructor');
  mocks.getForm.mockResolvedValue(baseForm);
  mocks.single = {
    cohorts: { id: COHORT, name: 'October Cohort', start_date: '2026-10-20', status: 'active', cohort_kind: 'bootcamp' },
    cohort_payment_settings: { total_fee: 3000 },
  };
  mocks.lists = {
    // One applicant per group: no account, account without a cohort, account in another
    // cohort, already admitted here, and a staff account.
    students: [
      { id: 'u-nocohort', email: 'nocohort@example.com', role: 'student', cohort_id: null },
      { id: 'u-other', email: 'other@example.com', role: 'student', cohort_id: OTHER },
      { id: 'u-here', email: 'here@example.com', role: 'student', cohort_id: COHORT },
      { id: 'u-staff', email: 'staff@example.com', role: 'staff', cohort_id: null },
    ],
    cohorts: [{ id: OTHER, name: 'March Cohort' }],
    bootcamp_enrollments: [{ email: 'here@example.com' }],
  };
  mocks.listSubmissions.mockResolvedValue([
    submission('new', 'new@example.com'),
    submission('nocohort', 'nocohort@example.com'),
    submission('other', 'other@example.com'),
    submission('here', 'here@example.com'),
    submission('staff', 'staff@example.com'),
    submission('draft', 'draft@example.com', { state: 'draft' }),
  ]);
  mocks.admitStudents.mockImplementation(async (_db: unknown, _cohort: string, rows: { email: string }[]) => ({
    inserted: rows.length, updated: 0, provisioned: rows.length, setupEmailsSent: rows.length,
    admittedEmails: rows.map(row => row.email), errors: [],
  }));
  mocks.audit.mockResolvedValue(undefined);
});

describe('POST /api/application-forms/[id]/admit: check', () => {
  it('sorts applicants into groups without admitting anyone', async () => {
    const body = await (await post({ submissionIds: [...ALL, 'draft'], check: true })).json();
    expect(body.applicants.map((item: any) => [item.submissionId, item.group, item.currentCohortName ?? null])).toEqual([
      ['new', 'new', null],
      ['nocohort', 'no_cohort', null],
      ['other', 'other_cohort', 'March Cohort'],
      ['here', 'this_cohort', null],
      ['staff', 'staff', null],
    ]);
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('POST /api/application-forms/[id]/admit', () => {
  it('admits new and cohort-less accounts, skips other cohorts by default, and never admits staff', async () => {
    const body = await (await post({ submissionIds: ALL })).json();
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [
      { email: 'new@example.com', full_name: 'Name new' },
      { email: 'nocohort@example.com', full_name: 'Name nocohort' },
    ]);
    expect(body.results.map((item: any) => [item.submissionId, item.status, item.message ?? null])).toEqual([
      ['new', 'admitted', null],
      ['nocohort', 'admitted', null],
      ['other', 'skipped', 'Kept in March Cohort.'],
      ['here', 'skipped', 'Already in this cohort.'],
      ['staff', 'failed', 'This email belongs to a staff or admin account, so it cannot be admitted as a student.'],
    ]);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({ action: 'admitted', entityId: 'new', details: { cohortId: COHORT } });
  });

  it('moves students from other cohorts only when asked', async () => {
    await post({ submissionIds: ['other'], moveFromOtherCohorts: true });
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [{ email: 'other@example.com', full_name: 'Name other' }]);
  });

  it('uses the pipeline result, not error wording, to tell admitted from failed', async () => {
    mocks.admitStudents.mockResolvedValue({ inserted: 1, updated: 0, provisioned: 1, setupEmailsSent: 0, admittedEmails: ['nocohort@example.com'], errors: [
      { email: 'New@example.com', error: 'Could not create student account.' },
      { email: 'nocohort@example.com', error: 'Resend rate limit exceeded' },
    ] });
    const body = await (await post({ submissionIds: ['new', 'nocohort'] })).json();
    expect(body.results).toEqual([
      { submissionId: 'new', email: 'new@example.com', status: 'failed', message: 'Could not create student account.' },
      { submissionId: 'nocohort', email: 'nocohort@example.com', status: 'admitted', message: 'Resend rate limit exceeded' },
    ]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('respects "No name question" instead of guessing one', async () => {
    mocks.getForm.mockResolvedValue({ ...baseForm, config: { ...baseForm.config, admission: { cohortId: COHORT } } });
    await post({ submissionIds: ['new'] });
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [{ email: 'new@example.com', full_name: null }]);
  });

  it('allows only admins and the form owner', async () => {
    as('instructor', 'someone-else');
    expect((await post({ submissionIds: ['new'] })).status).toBe(403);
    as('admin', 'any-admin');
    expect((await post({ submissionIds: ['new'] })).status).toBe(200);
  });

  it('refuses no cohort, inactive cohorts, and cohorts missing a fee or start date', async () => {
    mocks.getForm.mockResolvedValue({ ...baseForm, config: { ...baseForm.config, admission: undefined } });
    expect((await (await post({ submissionIds: ['new'] })).json()).error).toContain('Review flow settings');
    mocks.getForm.mockResolvedValue(baseForm);

    mocks.single.cohorts = { ...mocks.single.cohorts, status: 'completed' };
    expect((await (await post({ submissionIds: ['new'] })).json()).error).toContain('no longer active');
    mocks.single.cohorts = { ...mocks.single.cohorts, status: 'active' };

    mocks.single.cohort_payment_settings = null;
    expect((await (await post({ submissionIds: ['new'] })).json()).error).toBe('Set the fee for this cohort before admitting applicants.');
    mocks.single.cohort_payment_settings = { total_fee: 3000 };

    mocks.single.cohorts = { ...mocks.single.cohorts, start_date: null };
    expect((await (await post({ submissionIds: ['new'] })).json()).error).toBe('Set a start date for this cohort before admitting applicants.');
    expect(mocks.admitStudents).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized selection', async () => {
    expect((await post({ submissionIds: [] })).status).toBe(400);
    expect((await post({ submissionIds: Array.from({ length: 101 }, (_, index) => `s${index}`) })).status).toBe(400);
  });
});

describe('GET /api/application-forms/[id]/admit', () => {
  it('counts only live admissions linked to an account, ignoring case', async () => {
    mocks.lists.bootcamp_enrollments = [{ email: 'HERE@example.com' }];
    const body = await (await get()).json();
    expect(body).toMatchObject({ cohort: { id: COHORT, name: 'October Cohort', ready: true }, admittedSubmissionIds: ['here'], canAdmit: true });
    const enrollmentFilters = mocks.filters.filter(([table]) => table === 'bootcamp_enrollments').map(([, method, args]) => [method, ...args]);
    expect(enrollmentFilters).toEqual(expect.arrayContaining([['not', 'student_id', 'is', null], ['is', 'released_at', null]]));
  });

  it('lets assigned reviewers see admission status without the Admit action', async () => {
    as('staff', 'reviewer-1');
    mocks.reviewerFormIds.mockResolvedValue(['form-1']);
    expect(await (await get()).json()).toMatchObject({ canAdmit: false });
    mocks.reviewerFormIds.mockResolvedValue([]);
    expect((await get()).status).toBe(403);
  });
});
