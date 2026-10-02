import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COHORT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), getForm: vi.fn(), listSubmissions: vi.fn(), audit: vi.fn(), reviewerFormIds: vi.fn(),
  admitStudents: vi.fn(), assign: vi.fn(), sendEmails: vi.fn(), markAdmitted: vi.fn(),
  single: {} as Record<string, any>,
  lists: {} as Record<string, any[]>,
  filters: [] as Array<[string, string, unknown[]]>,
  rejectAllowlistDelete: false,
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: mocks.getForm }));
vi.mock('@/lib/application-submissions', () => ({
  listApplicationSubmissions: mocks.listSubmissions,
  appendApplicationAudit: mocks.audit,
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
}));
vi.mock('@/lib/admit-students', () => ({
  admitStudents: mocks.admitStudents,
  sendCohortAccessEmails: mocks.sendEmails,
  admissionAppUrl: async () => 'https://academy.test',
}));
vi.mock('@/lib/assign-student-cohort', () => ({ assignStudentToCohort: mocks.assign }));
vi.mock('@/lib/account-state-server', () => ({ markExistingAccountAdmitted: mocks.markAdmitted }));
// A tiny query builder: filters are recorded and return the builder; maybeSingle resolves the
// table's single row, while range or awaiting the query resolves its list. Enrollments read by
// student_id (each account's latest enrollment) resolve the 'enrollments_by_student' list.
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    auth: { admin: { getUserById: mocks.getAuthUser } },
    from: (table: string) => {
      const builder: any = {};
      let list = table;
      let deleting = false;
      for (const method of ['select', 'eq', 'neq', 'order', 'in', 'not', 'is', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          mocks.filters.push([table, method, args]);
          if (method === 'delete') deleting = true;
          if (table === 'bootcamp_enrollments' && method === 'in' && args[0] === 'student_id') list = 'enrollments_by_student';
          // Unlinked admission records left by an earlier attempt.
          if (table === 'bootcamp_enrollments' && method === 'is' && args[0] === 'student_id') list = 'presignups';
          return builder;
        };
      }
      builder.maybeSingle = async () => ({ data: mocks.single[table] ?? null, error: null });
      builder.range = async () => ({ data: mocks.lists[list] ?? [], error: null });
      builder.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        if (table === 'cohort_allowed_emails' && deleting && mocks.rejectAllowlistDelete) return reject(new Error('allowlist unavailable'));
        return resolve({ data: mocks.lists[list] ?? [], error: null });
      };
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
const access = (accessState = 'active', confirmed = 'active') => ({ access_state: accessState, access_state_confirmed: confirmed });

const as = (role: string, id = 'owner-1') => mocks.requireRole.mockResolvedValue({ role, actor: { id, email: `${id}@example.com` } });
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/application-forms/form-1/admit', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'form-1' }) });
const get = () => GET(new NextRequest('http://localhost/api/application-forms/form-1/admit'), { params: Promise.resolve({ id: 'form-1' }) });
const ALL = ['new', 'nocohort', 'other', 'here', 'staff'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters = [];
  mocks.rejectAllowlistDelete = false;
  mocks.getAuthUser.mockResolvedValue({ data: { user: { app_metadata: { access_state: 'active' } } }, error: null });
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
    bootcamp_enrollments: [{ email: 'here@example.com', student_id: 'u-here', student: access() }],
    // Latest enrollment per account: the account in another cohort and the one admitted here
    // each have one; the cohort-less account has none.
    enrollments_by_student: [
      { student_id: 'u-other', cohort_id: OTHER, released_at: null },
      { student_id: 'u-here', cohort_id: COHORT, released_at: null },
    ],
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
  mocks.assign.mockResolvedValue(undefined);
  mocks.markAdmitted.mockResolvedValue(undefined);
  mocks.sendEmails.mockResolvedValue({ sent: 0, errors: [] });
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

  it('isolates an unavailable auth lookup to that selected applicant', async () => {
    mocks.lists.bootcamp_enrollments = [{ email: 'here@example.com', student_id: 'u-here', student: access('active', 'pending') }];
    mocks.getAuthUser.mockResolvedValue({ data: { user: null }, error: { message: 'auth service unavailable' } });
    const response = await post({ submissionIds: ['new', 'here'], check: true });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.applicants.map((item: any) => [item.submissionId, item.group])).toEqual([
      ['new', 'new'],
      ['here', 'unconfirmed'],
    ]);
    expect(mocks.getAuthUser).toHaveBeenCalledTimes(1);
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

  it('moves students from other cohorts only when asked, keeping their one enrollment', async () => {
    const body = await (await post({ submissionIds: ['other'], moveFromOtherCohorts: true })).json();
    // The Cohorts screen's assign flow moves the existing row; no second admission is created.
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), { studentId: 'u-other', email: 'other@example.com', cohortId: COHORT });
    expect(mocks.markAdmitted).toHaveBeenCalledWith(expect.anything(), 'u-other');
    expect(mocks.sendEmails).toHaveBeenCalledWith(expect.anything(), {
      cohortId: COHORT, appUrl: 'https://academy.test',
      accounts: [{ email: 'other@example.com', name: 'Name other', studentId: 'u-other', isNewAccount: false, passwordSetAt: null }],
    });
    expect(body.results).toEqual([{ submissionId: 'other', email: 'other@example.com', status: 'admitted' }]);
  });

  it('treats an account with no cohort pointer but a live enrollment elsewhere as in another cohort', async () => {
    mocks.lists.students = [{ id: 'u-nocohort', email: 'nocohort@example.com', role: 'student', cohort_id: null }];
    mocks.lists.enrollments_by_student = [{ student_id: 'u-nocohort', cohort_id: OTHER, released_at: null }];
    const body = await (await post({ submissionIds: ['nocohort'], check: true })).json();
    expect(body.applicants[0]).toMatchObject({ group: 'other_cohort', currentCohortName: 'March Cohort' });
  });

  it('reattaches a released enrollment instead of creating a second one', async () => {
    // Released from this cohort earlier: no live admission, but the old row still exists.
    mocks.lists.bootcamp_enrollments = [];
    mocks.lists.enrollments_by_student = [{ student_id: 'u-here', cohort_id: COHORT, released_at: '2026-05-01T00:00:00Z' }];
    const body = await (await post({ submissionIds: ['here'] })).json();
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), { studentId: 'u-here', email: 'here@example.com', cohortId: COHORT });
    expect(body.results[0]).toMatchObject({ submissionId: 'here', status: 'admitted' });
  });

  it('reports an assign failure as failed and an email failure as admitted with a warning', async () => {
    mocks.lists.enrollments_by_student = [
      { student_id: 'u-other', cohort_id: OTHER, released_at: null },
      { student_id: 'u-nocohort', cohort_id: OTHER, released_at: '2026-05-01T00:00:00Z' },
    ];
    mocks.assign.mockImplementation(async (_db: unknown, input: { email: string }) => {
      if (input.email === 'other@example.com') throw new Error('Set payment settings for this cohort before assigning students.');
    });
    mocks.sendEmails.mockResolvedValue({ sent: 0, errors: [{ email: 'nocohort@example.com', error: 'Admitted, but the setup email could not be prepared: rate limited' }] });
    const body = await (await post({ submissionIds: ['nocohort', 'other'], moveFromOtherCohorts: true })).json();
    expect(body.results).toEqual([
      { submissionId: 'nocohort', email: 'nocohort@example.com', status: 'admitted', message: 'Admitted, but the setup email could not be prepared: rate limited' },
      { submissionId: 'other', email: 'other@example.com', status: 'failed', message: 'Set payment settings for this cohort before assigning students.' },
    ]);
    expect(mocks.markAdmitted).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('keeps an incomplete activation retryable after the cohort move succeeds', async () => {
    mocks.markAdmitted.mockRejectedValue(new Error('auth service unavailable'));
    const body = await (await post({ submissionIds: ['other'], moveFromOtherCohorts: true })).json();
    expect(mocks.markAdmitted).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmails).toHaveBeenCalledWith(expect.anything(), { cohortId: COHORT, appUrl: 'https://academy.test', accounts: [] });
    expect(body.results).toEqual([{
      submissionId: 'other', email: 'other@example.com', status: 'failed',
      message: 'Cohort assignment succeeded, but account access could not be activated. Retry this applicant: auth service unavailable',
    }]);
    expect(mocks.audit).not.toHaveBeenCalled();

    // The profile write can succeed before its cached claim fails. The durable confirmation
    // remains pending, so only this selected applicant's auth claim is checked on retry.
    mocks.lists.students = [{ id: 'u-other', email: 'other@example.com', role: 'student', cohort_id: COHORT, access_state: 'active' }];
    mocks.lists.bootcamp_enrollments = [{ email: 'other@example.com', student_id: 'u-other', student: access('active', 'pending') }];
    mocks.lists.enrollments_by_student = [{ student_id: 'u-other', cohort_id: COHORT, released_at: null }];
    mocks.getAuthUser.mockResolvedValue({ data: { user: { app_metadata: { access_state: 'pending' } } }, error: null });
    mocks.markAdmitted.mockResolvedValue(undefined);
    const retry = await (await post({ submissionIds: ['other'] })).json();
    expect(retry.results).toEqual([{ submissionId: 'other', email: 'other@example.com', status: 'admitted' }]);
  });

  it('continues the batch when allowlist cleanup rejects', async () => {
    mocks.rejectAllowlistDelete = true;
    mocks.lists.enrollments_by_student = [
      { student_id: 'u-nocohort', cohort_id: OTHER, released_at: '2026-05-01T00:00:00Z' },
      { student_id: 'u-other', cohort_id: OTHER, released_at: null },
    ];
    const response = await post({ submissionIds: ['nocohort', 'other'], moveFromOtherCohorts: true });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { submissionId: 'nocohort', email: 'nocohort@example.com', status: 'admitted', message: 'Admitted to the cohort, but the old allowlist entry could not be removed: allowlist unavailable' },
      { submissionId: 'other', email: 'other@example.com', status: 'admitted', message: 'Admitted to the cohort, but the old allowlist entry could not be removed: allowlist unavailable' },
    ]);
    expect(mocks.markAdmitted).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
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

  it('marks only the selected applicant unconfirmed when its auth claim cannot be checked', async () => {
    mocks.lists.bootcamp_enrollments = [{ email: 'here@example.com', student_id: 'u-here', student: access('active', 'pending') }];
    mocks.getAuthUser.mockResolvedValue({ data: { user: null }, error: { message: 'auth service unavailable' } });
    const response = await post({ submissionIds: ['here'] });
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([{
      submissionId: 'here', email: 'here@example.com', status: 'failed',
      message: 'Account access could not be confirmed. Try this applicant again.',
    }]);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.sendEmails).toHaveBeenCalledWith(expect.anything(), { cohortId: COHORT, appUrl: 'https://academy.test', accounts: [] });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.getAuthUser).toHaveBeenCalledTimes(1);
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

describe('POST /api/application-forms/[id]/admit: payment received', () => {
  const payment = { amount: 1200, paidAt: '2026-09-30', method: ' Mobile Money ', reference: 'MM-123' };

  it('offers a payment only when checking one new admission', async () => {
    const one = await (await post({ submissionIds: ['new'], check: true })).json();
    expect(one.cohort).toMatchObject({ fee: 3000 });
    expect(one.applicants[0].paymentAllowed).toBe(true);
    // A cohort-less account with no enrollment gets a new admission, so it can take a payment too.
    expect((await (await post({ submissionIds: ['nocohort'], check: true })).json()).applicants[0].paymentAllowed).toBe(true);
    // An existing enrollment keeps its own payment history.
    expect((await (await post({ submissionIds: ['other'], check: true })).json()).applicants[0].paymentAllowed).toBeUndefined();
    const many = await (await post({ submissionIds: ['new', 'nocohort'], check: true })).json();
    expect(many.applicants.some((item: any) => item.paymentAllowed)).toBe(false);
  });

  it('records the payment with the new admission', async () => {
    const body = await (await post({ submissionIds: ['new'], payment })).json();
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [{
      email: 'new@example.com', full_name: 'Name new',
      amount_paid: 1200, paid_at: '2026-09-30', payment_method: 'Mobile Money', payment_reference: 'MM-123',
    }]);
    expect(body.results[0]).toMatchObject({ status: 'admitted' });
    expect(mocks.audit.mock.calls[0][0].details).toMatchObject({ amountPaid: 1200 });
  });

  it('refuses a payment for several applicants or for an existing enrollment, changing nothing', async () => {
    expect((await post({ submissionIds: ['new', 'nocohort'], payment })).status).toBe(400);
    expect((await post({ submissionIds: ['other'], moveFromOtherCohorts: true, payment })).status).toBe(400);
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('keeps a payment left by a failed earlier attempt instead of claiming a new one', async () => {
    // The first attempt wrote the admission record and payment, then the account step failed.
    mocks.lists.presignups = [{ id: 'enr-new', email: 'new@example.com' }];
    mocks.lists.payments = [{ enrollment_id: 'enr-new' }];
    const check = await (await post({ submissionIds: ['new'], check: true })).json();
    expect(check.applicants[0]).toMatchObject({ group: 'new', paymentRecorded: true });
    expect(check.applicants[0].paymentAllowed).toBeUndefined();

    const refused = await post({ submissionIds: ['new'], payment });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain('already recorded');
    expect(mocks.admitStudents).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();

    // Retrying without a payment admits them and audits no new amount.
    await post({ submissionIds: ['new'] });
    expect(mocks.admitStudents).toHaveBeenCalledWith(expect.anything(), COHORT, [{ email: 'new@example.com', full_name: 'Name new' }]);
    expect(mocks.audit.mock.calls[0][0].details.amountPaid).toBeUndefined();
  });

  it('still offers a payment when an earlier attempt recorded none', async () => {
    mocks.lists.presignups = [{ id: 'enr-new', email: 'new@example.com' }];
    mocks.lists.payments = [];
    expect((await (await post({ submissionIds: ['new'], check: true })).json()).applicants[0].paymentAllowed).toBe(true);
  });

  it('refuses an unusable amount or date', async () => {
    const error = async (value: unknown) => (await (await post({ submissionIds: ['new'], payment: value })).json()).error;
    expect(await error({ amount: 100, paidAt: '2026-02-31' })).toBe('The payment date is not valid.');
    expect(await error({ amount: 100, paidAt: '2026-13-01' })).toBe('The payment date is not valid.');
    expect(await error({ amount: 0 })).toContain('Enter the amount paid');
    expect(await error({ amount: 3000.5 })).toBe('The amount paid cannot be more than the cohort fee.');
    expect(await error({ amount: 10.123 })).toContain('two decimal places');
    expect(await error({ amount: 100, paidAt: '2999-01-01' })).toBe('The payment date cannot be in the future.');
    expect(await error({ amount: 100, paidAt: '30/09/2026' })).toBe('The payment date is not valid.');
    expect(mocks.admitStudents).not.toHaveBeenCalled();
  });
});

describe('GET /api/application-forms/[id]/admit', () => {
  it('counts only live admissions linked to an account, ignoring case', async () => {
    mocks.lists.bootcamp_enrollments = [{ email: 'HERE@example.com', student_id: 'u-here', student: access() }];
    const body = await (await get()).json();
    expect(body).toMatchObject({ cohort: { id: COHORT, name: 'October Cohort', ready: true }, admittedSubmissionIds: ['here'], canAdmit: true });
    const enrollmentFilters = mocks.filters.filter(([table]) => table === 'bootcamp_enrollments').map(([, method, args]) => [method, ...args]);
    expect(enrollmentFilters).toEqual(expect.arrayContaining([['not', 'student_id', 'is', null], ['is', 'released_at', null]]));
  });

  it('does not badge an enrollment whose account access is still restricted', async () => {
    mocks.lists.students = [{ id: 'u-here', email: 'here@example.com', role: 'student', cohort_id: COHORT, access_state: 'pending' }];
    mocks.lists.bootcamp_enrollments = [{ email: 'here@example.com', student_id: 'u-here', student: access('pending', 'pending') }];
    const body = await (await get()).json();
    expect(body.admittedSubmissionIds).toEqual([]);
  });

  it('uses the database confirmation on page load without reading auth users', async () => {
    mocks.lists.students = [{ id: 'u-here', email: 'here@example.com', role: 'student', cohort_id: COHORT, access_state: 'active' }];
    mocks.lists.bootcamp_enrollments = [{ email: 'here@example.com', student_id: 'u-here', student: access('active', 'pending') }];
    mocks.getAuthUser.mockResolvedValue({ data: { user: { app_metadata: { access_state: 'pending' } } }, error: null });
    const body = await (await get()).json();
    expect(body.admittedSubmissionIds).toEqual([]);
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
  });

  it('loads hundreds of admitted applicants without per-person auth calls', async () => {
    const admissions = Array.from({ length: 500 }, (_, index) => ({
      email: `student${index}@example.com`, student_id: `u-${index}`, student: access(),
    }));
    mocks.lists.bootcamp_enrollments = admissions;
    mocks.listSubmissions.mockResolvedValue(admissions.map((item, index) => submission(`s-${index}`, item.email)));
    const body = await (await get()).json();
    expect(body.admittedSubmissionIds).toHaveLength(500);
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
    expect(mocks.filters.filter(([table, method]) => table === 'bootcamp_enrollments' && method === 'select')).toHaveLength(1);
  });

  it('lets assigned reviewers see admission status without the Admit action', async () => {
    as('staff', 'reviewer-1');
    mocks.reviewerFormIds.mockResolvedValue(['form-1']);
    expect(await (await get()).json()).toMatchObject({ canAdmit: false });
    mocks.reviewerFormIds.mockResolvedValue([]);
    expect((await get()).status).toBe(403);
  });
});
