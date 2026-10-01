import { beforeEach, describe, expect, it, vi } from 'vitest';

// The assign flow shared by the Cohorts screen and application admissions: an account keeps
// its one enrollment row (moved, and reattached when released) rather than getting a second
// full-fee schedule; only an account with no enrollment gets a new admission record.

const mocks = vi.hoisted(() => ({
  createAdmissionRecord: vi.fn(),
  activateEnrollment: vi.fn(),
  rpc: vi.fn(),
  calls: [] as Array<[string, string, unknown[]]>,
  rows: {} as Record<string, any>,
}));

vi.mock('@/lib/db-payments', () => ({ createAdmissionRecord: mocks.createAdmissionRecord, activateEnrollment: mocks.activateEnrollment }));

import { assignStudentToCohort } from '@/lib/assign-student-cohort';

function fakeDb() {
  return {
    rpc: mocks.rpc,
    from(table: string) {
      const builder: any = {};
      let isPresignupQuery = false;
      for (const method of ['select', 'update', 'eq', 'is', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          mocks.calls.push([table, method, args]);
          if (method === 'is' && args[0] === 'student_id') isPresignupQuery = true;
          return builder;
        };
      }
      builder.maybeSingle = async () => ({ data: (isPresignupQuery ? mocks.rows.presignup : mocks.rows[table]) ?? null, error: null });
      builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null });
      return builder;
    },
  } as any;
}

const updates = (table: string) => mocks.calls.filter(([name, method]) => name === table && method === 'update').map(([, , args]) => args[0]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.rows = {};
  mocks.rpc.mockResolvedValue({ error: null });
});

describe('assignStudentToCohort', () => {
  it('moves an existing enrollment instead of creating another', async () => {
    mocks.rows.bootcamp_enrollments = { id: 'enr-1', cohort_id: 'old-cohort', released_at: null };
    await assignStudentToCohort(fakeDb(), { studentId: 'stu-1', email: 'A@example.com', cohortId: 'new-cohort' });
    expect(updates('bootcamp_enrollments')).toEqual([expect.objectContaining({ cohort_id: 'new-cohort' })]);
    expect(mocks.rpc).not.toHaveBeenCalledWith('reattach_released_enrollment', expect.anything());
    expect(mocks.createAdmissionRecord).not.toHaveBeenCalled();
    expect(updates('students')).toEqual([{ cohort_id: 'new-cohort' }]);
  });

  it('reattaches a released enrollment', async () => {
    mocks.rows.bootcamp_enrollments = { id: 'enr-1', cohort_id: 'new-cohort', released_at: '2026-05-01T00:00:00Z' };
    await assignStudentToCohort(fakeDb(), { studentId: 'stu-1', email: 'a@example.com', cohortId: 'new-cohort' });
    expect(mocks.rpc).toHaveBeenCalledWith('reattach_released_enrollment', { p_enrollment_id: 'enr-1' });
    expect(updates('bootcamp_enrollments')).toEqual([]);
    expect(mocks.createAdmissionRecord).not.toHaveBeenCalled();
  });

  it('creates an admission from the cohort settings only when there is no enrollment at all', async () => {
    mocks.rows.cohort_payment_settings = { total_fee: 3000, deposit_percent: 50, currency: 'GHS', payment_plan: 'flexible' };
    mocks.rows.cohorts = { start_date: '2026-10-20', end_date: null };
    await assignStudentToCohort(fakeDb(), { studentId: 'stu-1', email: 'A@example.com', cohortId: 'new-cohort' });
    expect(mocks.createAdmissionRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: 'a@example.com', cohortId: 'new-cohort', totalFee: 3000, depositRequired: 1500 }));
    expect(mocks.activateEnrollment).toHaveBeenCalledWith(expect.anything(), 'a@example.com', 'new-cohort', 'stu-1');
  });

  it('refuses a cohort without a fee and leaves the cohort pointer alone', async () => {
    await expect(assignStudentToCohort(fakeDb(), { studentId: 'stu-1', email: 'a@example.com', cohortId: 'new-cohort' }))
      .rejects.toThrow('Set payment settings for this cohort before assigning students.');
    expect(updates('students')).toEqual([]);
  });
});
