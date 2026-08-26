import { describe, expect, it } from 'vitest';
import { getPaystackReviewQueue, getSweepHeartbeat } from '@/lib/paystack-review-queue';

const HOUR = 3_600_000;

function stubDb(tables: Record<string, any>) {
  const calls: string[] = [];
  const chain = (result: any): any => new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const promise = Promise.resolve(result);
        return (promise as any)[prop].bind(promise);
      }
      return (...args: any[]) => {
        if (prop === 'in') calls.push(`in:${JSON.stringify(args)}`);
        return chain(result);
      };
    },
    apply: () => chain(result),
  });
  return {
    calls,
    db: {
      from(table: string) {
        const entry = tables[table];
        if (entry === undefined) throw new Error(`unexpected table ${table}`);
        const result = Array.isArray(entry.queue) ? entry.queue.shift() : entry;
        return chain(result ?? { data: [], error: null });
      },
    } as any,
  };
}

const FRESH_HEARTBEAT = {
  data: { last_success_at: new Date().toISOString(), last_summary: { expired: 2 } }, error: null,
};

describe('Paystack review queue', () => {
  it('returns one incident row plus stalled checkouts', async () => {
    const incident = {
      id: 'incident-1', reference: 'sub-a', reason: 'paystack:refund.processed',
      kind: 'lifecycle_event', event_name: 'refund.processed', amount: 50, currency: 'GHS',
      student_id: 'student-1', plan_id: 'plan-1', blocks_credit: false, status: 'open',
      created_at: new Date().toISOString(), notification_sent_at: null, notification_error: null,
      students: { full_name: 'Ama', email: 'ama@example.com' }, subscription_plans: { name: 'Pro' },
    };
    const stalled = {
      id: 'tx-1', reference: 'sub-b', status: 'pending', amount: 100, currency: 'GHS',
      plan_name: 'Pro', student_id: 'student-2', updated_at: new Date(Date.now() - 12 * HOUR).toISOString(),
      students: { full_name: 'Kofi', email: 'kofi@example.com' },
    };
    const { db } = stubDb({
      paystack_review_incidents: { data: [incident], error: null },
      paystack_subscription_transactions: { data: [stalled], error: null },
      cron_heartbeats: FRESH_HEARTBEAT,
    });

    const result = await getPaystackReviewQueue(db);
    expect(result.items.map(item => item.kind).sort()).toEqual(['incident', 'stalled']);
    expect(result.items.find(item => item.kind === 'incident')).toMatchObject({
      studentName: 'Ama', planName: 'Pro', amount: 50,
    });
  });

  it('scopes both incident and stalled queries to instructor-owned plans', async () => {
    const { db, calls } = stubDb({
      paystack_review_incidents: { data: [], error: null },
      paystack_subscription_transactions: { data: [], error: null },
      cron_heartbeats: FRESH_HEARTBEAT,
    });
    await getPaystackReviewQueue(db, { planIds: ['plan-1'] });
    expect(calls.filter(call => call === 'in:["plan_id",["plan-1"]]')).toHaveLength(2);
  });

  it('does not query payment data for an instructor with no plans', async () => {
    const { db } = stubDb({ cron_heartbeats: FRESH_HEARTBEAT });
    await expect(getPaystackReviewQueue(db, { planIds: [] })).resolves.toMatchObject({ items: [] });
  });
});

describe('expiry heartbeat', () => {
  it('reports a missing heartbeat as stale', async () => {
    const { db } = stubDb({ cron_heartbeats: { data: null, error: null } });
    await expect(getSweepHeartbeat(db)).resolves.toMatchObject({ stale: true, lastSuccessAt: null });
  });

  it('returns the latest successful summary', async () => {
    const { db } = stubDb({ cron_heartbeats: FRESH_HEARTBEAT });
    await expect(getSweepHeartbeat(db)).resolves.toMatchObject({ stale: false, summary: { expired: 2 } });
  });
});
