import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyQStashRequest = vi.hoisted(() => vi.fn());
const expireSubscription = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => vi.fn());
const notifySubscriptionActivatedBatch = vi.hoisted(() => vi.fn());
const notifySubscriptionPaymentRequest = vi.hoisted(() => vi.fn());
const retryStoredPaystackWebhookEvents = vi.hoisted(() => vi.fn());
const retryPaystackIncidentNotifications = vi.hoisted(() => vi.fn());
const reconcileStalePaystackTransactions = vi.hoisted(() => vi.fn());

vi.mock('@/lib/qstash', () => ({ verifyQStashRequest }));
vi.mock('@/lib/db-subscriptions', () => ({ expireSubscription }));
vi.mock('@/lib/admin-client', () => ({ adminClient }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivatedBatch }));
vi.mock('@/lib/notify-subscription-payment-request', () => ({ notifySubscriptionPaymentRequest }));
vi.mock('@/lib/paystack-webhook-processing', () => ({
  retryStoredPaystackWebhookEvents,
  retryPaystackIncidentNotifications,
}));
vi.mock('@/lib/paystack-subscriptions', () => ({ reconcileStalePaystackTransactions }));

import { POST } from '@/app/api/cron/subscription-expiry-sweep/route';

function request() {
  return new NextRequest('http://localhost/api/cron/subscription-expiry-sweep', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyQStashRequest.mockResolvedValue({ valid: true, body: '' });
  notifySubscriptionActivatedBatch.mockResolvedValue({ sent: 0, skipped: 0, failed: 0 });
  notifySubscriptionPaymentRequest.mockResolvedValue({ sent: false });
  retryStoredPaystackWebhookEvents.mockResolvedValue({ processed: 0, failed: 0 });
  retryPaystackIncidentNotifications.mockResolvedValue({ sent: 0 });
  reconcileStalePaystackTransactions.mockResolvedValue({ processed: 0, failed: 0 });
});

describe('subscription expiry sweep', () => {
  it('rejects an invalid QStash request', async () => {
    verifyQStashRequest.mockResolvedValue({ valid: false, body: '' });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it('continues after one subscription fails and reports all counts', async () => {
    // The expiry query is now bounded and ordered, and the run also sweeps the two email
    // queues and the pre-expiry warnings, so the stub has to be chainable and awaitable
    // rather than resolving on a specific terminal method.
    const expiring = [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }];
    let firstQuery = true;
    const builder: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const data = firstQuery ? expiring : [];
          firstQuery = false;
          const result = { data, error: null };
          return Promise.resolve(result).then.bind(Promise.resolve(result));
        }
        return () => builder;
      },
    });
    adminClient.mockReturnValue({ from: vi.fn(() => builder), rpc: async () => ({ error: null }) });
    expireSubscription
      .mockResolvedValueOnce({ ok: true, skipped: false })
      .mockResolvedValueOnce({ ok: true, skipped: true })
      .mockRejectedValueOnce(new Error('temporary failure'));

    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ processed: 3, expired: 1, skipped: 1, failed: 1 });
    expect(expireSubscription).toHaveBeenCalledTimes(3);
  });
});
