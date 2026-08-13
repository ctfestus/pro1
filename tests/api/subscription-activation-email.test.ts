import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const purchaseOrRenewSubscription = vi.hoisted(() => vi.fn());
const notifySubscriptionActivated = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireUser, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivated }));
vi.mock('@/lib/db-subscriptions', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db-subscriptions')>()),
  purchaseOrRenewSubscription,
}));

import { POST } from '@/app/api/payments/route';

function recordPayment() {
  return new NextRequest('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify({
      action: 'create-subscription',
      studentId: 'student-1',
      planId: 'plan-1',
      durationMonths: 3,
      amount: 500,
      currency: 'GHS',
      idempotencyKey: 'key-1',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireUser.mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
    supabase: makeSupabaseStub({ students: { data: { role: 'admin' }, error: null } }),
  });
  createClient.mockReturnValue({ from: vi.fn(), rpc: vi.fn() });
});

// Recording a learner as already paid activates their access immediately, and until now
// said nothing to the learner. The retry case matters just as much: recording a payment is
// safely repeatable, so if the email were not held to the same rule an admin retrying
// after a timeout would tell the learner twice that their subscription had started.
describe('subscription activation email', () => {
  it('notifies the learner when a payment is actually recorded', async () => {
    purchaseOrRenewSubscription.mockResolvedValue({
      ok: true, subscriptionId: 'sub-1', paymentId: 'pay-1', alreadyProcessed: false,
    });

    const response = await POST(recordPayment());

    expect(response.status).toBe(200);
    expect(notifySubscriptionActivated).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-1' });
  });

  // The route no longer decides whether the learner has already been told. It attempts
  // delivery every time and the payment's delivery stamp settles it, because a retry is
  // exactly when a previously failed email needs to go out.
  it('still attempts delivery when the payment was already processed', async () => {
    purchaseOrRenewSubscription.mockResolvedValue({
      ok: true, subscriptionId: 'sub-1', paymentId: 'pay-1', alreadyProcessed: true,
    });

    const response = await POST(recordPayment());

    expect(response.status).toBe(200);
    expect(notifySubscriptionActivated).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-1' });
  });

  it('keeps the subscription when the email fails, and reports it', async () => {
    purchaseOrRenewSubscription.mockResolvedValue({
      ok: true, subscriptionId: 'sub-1', paymentId: 'pay-1', alreadyProcessed: false,
    });
    notifySubscriptionActivated.mockRejectedValue(new Error('Resend is down'));

    const response = await POST(recordPayment());
    const body = await response.json();

    // The payment is committed; a failed email must never turn it into an error.
    expect(response.status).toBe(200);
    expect(body.subscriptionId).toBe('sub-1');
    expect(body.activationWarning).toBe('Resend is down');
  });
});
