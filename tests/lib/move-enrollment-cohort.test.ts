import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveEnrollmentToCohort } from '@/lib/db-payments';

// Moving a student keeps the agreed fee and what they paid, and rebuilds the installments from
// the new cohort's dates. The case this was written for: admitted into an August cohort on
// 31 Oct with 1,500 of 2,800 paid, so the old schedule left 1,300 due on the join day.

type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<[string, string, unknown]> = [];
  let nextId = 1;
  const db = {
    writes,
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: 'select' | 'delete' | 'update' | 'insert' = 'select';
      let payload: any;
      const matching = () => (tables[table] ??= []).filter(r => filters.every(([k, v]) => r[k] === v));
      const run = () => {
        if (op === 'delete') tables[table] = tables[table].filter(r => !matching().includes(r));
        if (op === 'update') matching().forEach(r => Object.assign(r, payload));
        if (op === 'insert') (tables[table] ??= []).push(...payload.map((r: Row) => ({ id: `row-${nextId++}`, ...r })));
        return { data: op === 'select' ? matching().sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))) : null, error: null };
      };
      const builder: any = {
        select: () => builder,
        order: () => builder,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return builder; },
        delete: () => { op = 'delete'; writes.push([table, 'delete', null]); return builder; },
        update: (p: Row) => { op = 'update'; payload = p; writes.push([table, 'update', p]); return builder; },
        insert: (p: Row[]) => { op = 'insert'; payload = p; writes.push([table, 'insert', p]); return builder; },
        single: async () => ({ data: matching()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return builder;
    },
  };
  return db;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('moveEnrollmentToCohort', () => {
  it('rebuilds the schedule from the new cohort and keeps the fee and the payment', async () => {
    const db = fakeDb({
      bootcamp_enrollments: [{ id: 'enr-1', cohort_id: 'aug', total_fee: 2800, deposit_required: 1680, paid_total: 1500 }],
      cohorts: [{ id: 'oct', start_date: '2026-10-31', end_date: '2027-01-31' }],
      cohort_payment_settings: [{ cohort_id: 'oct', installment_count: 3, post_bootcamp_access_months: 3 }],
      payment_installments: [
        { id: 'old-1', enrollment_id: 'enr-1', due_date: '2026-09-29', amount_due: 650, amount_paid: 650, status: 'paid' },
        { id: 'old-2', enrollment_id: 'enr-1', due_date: '2026-10-29', amount_due: 650, amount_paid: 650, status: 'paid' },
        { id: 'old-3', enrollment_id: 'enr-1', due_date: '2026-10-31', amount_due: 1500, amount_paid: 200, status: 'partial' },
      ],
    });

    await expect(moveEnrollmentToCohort(db as any, 'enr-1', 'oct')).resolves.toEqual({ postBootcampAccessMonths: 3 });

    expect(db.tables.payment_installments.map(r => [r.due_date, r.amount_due, r.amount_paid, r.status])).toEqual([
      ['2026-11-05', 1500, 1500, 'paid'],
      ['2026-12-05', 650, 0, 'unpaid'],
      ['2027-01-05', 650, 0, 'unpaid'],
    ]);
    expect(db.tables.bootcamp_enrollments[0]).toMatchObject({
      cohort_id: 'oct', total_fee: 2800, paid_total: 1500, bootcamp_starts_at: '2026-10-31', bootcamp_ends_at: '2027-01-31',
    });
    // The enrollment is repointed last, so a failed rebuild leaves the move retryable.
    expect(db.writes.at(-1)).toEqual(['bootcamp_enrollments', 'update', expect.objectContaining({ cohort_id: 'oct' })]);
  });

  it('refuses a cohort without a start date and changes nothing', async () => {
    const db = fakeDb({
      bootcamp_enrollments: [{ id: 'enr-1', cohort_id: 'aug', total_fee: 2800, deposit_required: 1680, paid_total: 1500 }],
      cohorts: [{ id: 'oct', start_date: null, end_date: null }],
      payment_installments: [{ id: 'old-1', enrollment_id: 'enr-1', due_date: '2026-09-29', amount_due: 2800, amount_paid: 1500, status: 'partial' }],
    });
    await expect(moveEnrollmentToCohort(db as any, 'enr-1', 'oct')).rejects.toThrow('Set a start date');
    expect(db.writes).toEqual([]);
  });
});
