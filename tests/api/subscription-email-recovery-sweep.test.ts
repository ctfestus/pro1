import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyQStashRequest = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => vi.fn());
const expireSubscription = vi.hoisted(() => vi.fn());
const notifySubscriptionActivatedBatch = vi.hoisted(() => vi.fn());
const notifySubscriptionPaymentRequest = vi.hoisted(() => vi.fn());

vi.mock('@/lib/qstash', () => ({ verifyQStashRequest }));
vi.mock('@/lib/admin-client', () => ({ adminClient }));
vi.mock('@/lib/db-subscriptions', () => ({ expireSubscription }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivatedBatch }));
vi.mock('@/lib/notify-subscription-payment-request', () => ({ notifySubscriptionPaymentRequest }));

import { POST } from '@/app/api/cron/subscription-expiry-sweep/route';

// Records the filters the sweep applies, so the eligibility rule itself is asserted rather
// than assumed.
function makeDb(
  pendingPaymentIds: string[],
  pendingRequestIds: string[] = [],
  expiringIds: string[] = [],
) {
  const filters: Array<[string, ...unknown[]]> = [];
  const db: any = {
    from(table: string) {
      const builder: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            const data = table === 'subscription_payments'
              ? pendingPaymentIds.map(id => ({ id }))
              : table === 'subscription_payment_requests'
                ? pendingRequestIds.map(id => ({ id }))
                : table === 'individual_subscriptions'
                  ? expiringIds.map(id => ({ id }))
                  : [];
            return Promise.resolve({ data, error: null }).then.bind(Promise.resolve({ data, error: null }));
          }
          return (...args: unknown[]) => { filters.push([String(prop), ...args]); return builder; };
        },
      });
      return builder;
    },
  };
  return { db: { ...db, rpc: async () => ({ error: null }) }, filters };
}

function cronRequest() {
  return new NextRequest('http://localhost/api/cron/subscription-expiry-sweep', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyQStashRequest.mockResolvedValue({ valid: true });
  notifySubscriptionActivatedBatch.mockResolvedValue({ sent: 0, skipped: 0, failed: 0 });
  notifySubscriptionPaymentRequest.mockResolvedValue({ sent: true });
});

// An approval's activation email runs after the response, so a failure is invisible to the
// instructor, and approval removes the item from their queue. Without this sweep the replay
// path that migration 177 opened has nothing that triggers it, and the learner is never
// told their subscription started.
describe('activation email recovery sweep', () => {
  it('retries payments whose email never went out', async () => {
    const { db } = makeDb(['pay-1', 'pay-2']);
    adminClient.mockReturnValue(db);
    notifySubscriptionActivatedBatch.mockResolvedValue({ sent: 2, skipped: 0, failed: 0 });

    const response = await POST(cronRequest());
    const body = await response.json();

    expect(notifySubscriptionActivatedBatch).toHaveBeenCalledWith(db, { paymentIds: ['pay-1', 'pay-2'] });
    expect(body.emailsRetried).toBe(2);
  });

  it('only picks up completed payments whose email is still undelivered', async () => {
    const { db, filters } = makeDb(['pay-1']);
    adminClient.mockReturnValue(db);

    await POST(cronRequest());

    expect(filters).toContainEqual(['eq', 'status', 'completed']);
    expect(filters).toContainEqual(['is', 'activation_email_sent_at', null]);
    // Deleted learners are deliberately NOT excluded here: the sender settles their rows
    // as nothing-to-do, and filtering them out would leave them pending forever.
    expect(filters).not.toContainEqual(['not', 'student_id', 'is', null]);
    // Bounded so a backlog cannot run past the function timeout.
    expect(filters.some(f => f[0] === 'limit')).toBe(true);
  });

  it('does not call the mailer when nothing is outstanding', async () => {
    const { db } = makeDb([]);
    adminClient.mockReturnValue(db);

    const response = await POST(cronRequest());

    expect(notifySubscriptionActivatedBatch).not.toHaveBeenCalled();
    expect((await response.json()).emailsRetried).toBe(0);
  });

  it('reports a mail outage without failing the sweep', async () => {
    const { db } = makeDb(['pay-1']);
    adminClient.mockReturnValue(db);
    notifySubscriptionActivatedBatch.mockRejectedValue(new Error('Resend is down'));

    const response = await POST(cronRequest());
    const body = await response.json();

    // Expiry already succeeded. Returning 500 would make QStash retry the whole sweep.
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.emailRetryError).toBe('Resend is down');
  });

  it('continues retrying payment requests after one learner fails', async () => {
    const { db } = makeDb([], ['req-1', 'req-2', 'req-3']);
    adminClient.mockReturnValue(db);
    notifySubscriptionPaymentRequest
      .mockRejectedValueOnce(new Error('Invalid recipient'))
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: true });

    const response = await POST(cronRequest());
    const body = await response.json();

    expect(notifySubscriptionPaymentRequest).toHaveBeenCalledTimes(3);
    expect(body.requestEmailsRetried).toBe(2);
    expect(body.requestEmailRetriesFailed).toBe(1);
  });

  it('stays unauthorized without a valid QStash signature', async () => {
    verifyQStashRequest.mockResolvedValue({ valid: false });

    const response = await POST(cronRequest());

    expect(response.status).toBe(401);
    expect(notifySubscriptionActivatedBatch).not.toHaveBeenCalled();
  });
});
