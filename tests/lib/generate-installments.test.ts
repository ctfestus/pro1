import { describe, expect, it } from 'vitest';
import { generateInstallments } from '@/lib/db-payments';

// payment_installments.amount_due must be above zero (migration 069), so a schedule may never
// contain a zero row: one made every admission with nothing paid fail to activate.

const start = new Date('2026-10-20T00:00:00Z');
const amounts = (rows: { amount_due: number }[]) => rows.map(row => row.amount_due);

describe('generateInstallments', () => {
  it('starts with the deposit when nothing has been paid yet', () => {
    const rows = generateInstallments('e1', 3000, 0, 3, start, 1500);
    expect(amounts(rows)).toEqual([1500, 750, 750]);
    expect(rows[0].due_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('starts with the amount paid at admission when there is one', () => {
    expect(amounts(generateInstallments('e1', 3000, 1000, 3, start, 1500))).toEqual([1000, 1000, 1000]);
  });

  it('never produces a zero installment', () => {
    // No payment and no deposit: the whole fee is spread over the later installments.
    expect(amounts(generateInstallments('e1', 3000, 0, 3, start, 0))).toEqual([1500, 1500]);
    expect(generateInstallments('e1', 3000, 0, 1, start, 0)).toEqual([]);
    for (const rows of [generateInstallments('e1', 3000, 0, 4, start, 1000), generateInstallments('e1', 3000, 0, 3, start)]) {
      expect(rows.every(row => row.amount_due > 0)).toBe(true);
    }
  });

  it('stops at the fee when the deposit or payment covers it', () => {
    expect(amounts(generateInstallments('e1', 3000, 0, 3, start, 3000))).toEqual([3000]);
    expect(amounts(generateInstallments('e1', 3000, 3500, 3, start, 1500))).toEqual([3000]);
  });
});
