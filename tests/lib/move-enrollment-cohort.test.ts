import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveEnrollmentToCohort, recordPayment } from '@/lib/db-payments';

// Moving a student keeps the agreed fee and what they paid, and rebuilds the installments from
// the new cohort's dates. The case this was written for: admitted into an August cohort on
// 31 Oct with 1,500 of 2,800 paid, so the old schedule left 1,300 due on the join day.
// The rebuild and both cohort pointers are written by one RPC (migration 230); these pin what the
// app sends it and that it writes nothing else that could be left half done. Payments go through
// an RPC holding the same enrollment row lock (migration 231), so the two cannot interleave.

type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row[]>, rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }) {
  const writes: Array<[string, string]> = [];
  const rpc = vi.fn(async (name: string) => (name === 'move_enrollment_to_cohort' ? rpcResult : { data: null, error: null }));
  const db = {
    rpc,
    writes,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v));
      const builder: any = {
        select: () => builder,
        order: () => builder,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return builder; },
        delete: () => { writes.push([table, 'delete']); return builder; },
        update: () => { writes.push([table, 'update']); return builder; },
        insert: () => { writes.push([table, 'insert']); return builder; },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  };
  return db;
}

const tables = () => ({
  bootcamp_enrollments: [{ id: 'enr-1', cohort_id: 'aug', total_fee: 2800, deposit_required: 1680, paid_total: 1500, payment_plan: 'flexible', student_id: 'stu-1' }],
  cohorts: [{ id: 'oct', start_date: '2026-10-31' }],
  cohort_payment_settings: [{ cohort_id: 'oct', installment_count: 3, post_bootcamp_access_months: 3 }],
});

const move = (db: ReturnType<typeof fakeDb>) => moveEnrollmentToCohort(db as any, { enrollmentId: 'enr-1', studentId: 'stu-1', cohortId: 'oct' });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('moveEnrollmentToCohort', () => {
  it('sends the rebuilt schedule, the agreed fee split and the figures it was built from', async () => {
    const db = fakeDb(tables());
    await move(db);

    expect(db.rpc).toHaveBeenCalledWith('move_enrollment_to_cohort', {
      p_enrollment_id:       'enr-1',
      p_student_id:          'stu-1',
      p_cohort_id:           'oct',
      p_expected_cohort_id:  'aug',
      p_expected_paid_total: 1500,
      p_installments: [
        { due_date: '2026-11-05', amount_due: 1500 },
        { due_date: '2026-12-05', amount_due: 650 },
        { due_date: '2027-01-05', amount_due: 650 },
      ],
    });
    // Installments, the enrollment and the student are only written inside the RPC. Access is
    // recomputed by the caller once its whole assignment is done.
    expect(db.writes).toEqual([]);
  });

  it.each([
    ['stale', 'changed while it was being moved'],
    ['no_start_date', 'Set a start date'],
    ['not_found', 'Enrollment not found'],
  ])('reports a %s refusal as an error', async (outcome, message) => {
    const db = fakeDb(tables(), { data: outcome, error: null });
    await expect(move(db)).rejects.toThrow(message);
    expect(db.writes).toEqual([]);
  });

  it('refuses a cohort without a start date before calling the RPC', async () => {
    const t = tables();
    t.cohorts[0].start_date = null as any;
    const db = fakeDb(t);
    await expect(move(db)).rejects.toThrow('Set a start date');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
});

describe('recordPayment', () => {
  it('applies the payment through the locked RPC, not by writing installments directly', async () => {
    const db = fakeDb(tables());
    await recordPayment(db as any, { enrollmentId: 'enr-1', amount: 650, payerEmail: 'a@example.com', cohortId: 'aug', studentId: 'stu-1' });
    expect(db.rpc).toHaveBeenCalledWith('apply_enrollment_payment', { p_enrollment_id: 'enr-1', p_amount: 650 });
    expect(db.writes.filter(([table]) => table === 'payment_installments')).toEqual([]);
  });
});
