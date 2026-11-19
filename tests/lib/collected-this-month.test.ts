// "Collected this month" on the Subscriptions page: every recorded subscription payment since the
// first of the month (UTC), split into online (Paystack) and recorded, per currency.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/provision-individual-student', () => ({ provisionIndividualStudent: vi.fn() }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivatedBatch: vi.fn() }));
vi.mock('@/lib/resend-audience', () => ({ addToResendAudience: vi.fn() }));
vi.mock('@/lib/notify-subscription-payment-request', () => ({ notifySubscriptionPaymentRequest: vi.fn() }));

import { getCollectedThisMonth } from '@/lib/db-subscriptions';

function stub(rows: any[]) {
  const calls: { gte?: [string, string]; in?: [string, string[]] } = {};
  const query: any = {
    select: () => query,
    gte: (col: string, value: string) => { calls.gte = [col, value]; return query; },
    in: (col: string, ids: string[]) => { calls.in = [col, ids]; return query; },
    order: () => query,
    range: () => Promise.resolve({ data: rows, count: rows.length, error: null }),
  };
  return { db: { from: () => query } as any, calls };
}

describe('getCollectedThisMonth', () => {
  it('splits online and recorded payments per currency', async () => {
    const { db } = stub([
      { amount: 45, currency: 'GHS', payment_method: 'Paystack card' },
      { amount: '38.62', currency: 'ghs', payment_method: 'Paystack mobile_money' },
      { amount: 23, currency: 'GHS', payment_method: 'MTN Mobile Money' },
      { amount: 20, currency: 'USD', payment_method: null },
    ]);
    const totals = await getCollectedThisMonth(db, null);
    expect(totals).toEqual([
      { currency: 'GHS', online: 83.62, recorded: 23 },
      { currency: 'USD', online: 0, recorded: 20 },
    ]);
  });

  it('counts from the first of the month in UTC', async () => {
    const { db, calls } = stub([]);
    await getCollectedThisMonth(db, null);
    const now = new Date();
    expect(calls.gte).toEqual(['paid_at', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()]);
    expect(calls.in).toBeUndefined();
  });

  it('is scoped to the given subscriptions, and empty when there are none', async () => {
    const scoped = stub([{ amount: 45, currency: 'GHS', payment_method: 'Paystack' }]);
    expect(await getCollectedThisMonth(scoped.db, ['s1'])).toEqual([{ currency: 'GHS', online: 45, recorded: 0 }]);
    expect(scoped.calls.in).toEqual(['subscription_id', ['s1']]);
    const none = stub([{ amount: 45, currency: 'GHS', payment_method: 'Paystack' }]);
    expect(await getCollectedThisMonth(none.db, [])).toEqual([]);
  });
});
