import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const createPaystackSubscriptionCheckout = vi.hoisted(() => vi.fn());
const processPaystackSubscriptionReference = vi.hoisted(() => vi.fn());
const createSubscriptionPaymentRequest = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireUser, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('resend', () => ({ Resend: class { batch = { send: vi.fn() }; } }));
vi.mock('@/lib/paystack-subscriptions', () => ({
  createPaystackSubscriptionCheckout,
  processPaystackSubscriptionReference,
}));
vi.mock('@/lib/db-subscriptions', () => ({ createSubscriptionPaymentRequest }));

import { POST } from '@/app/api/student-subscriptions/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/student-subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireUser.mockResolvedValue({
    user: { id: 'student-1', email: 'student@example.com' },
    getActorDb: () => makeSupabaseStub({ students: { data: { role: 'student' }, error: null } }),
    serviceDb: makeSupabaseStub({}),
  });
  rpc.mockResolvedValue({ data: { ok: true, confirmationId: 'conf-1' }, error: null });
  createClient.mockReturnValue({ rpc });
  createPaystackSubscriptionCheckout.mockResolvedValue({
    reference: 'sub-ref',
    authorizationUrl: 'https://checkout.paystack.com/sub-ref',
  });
  createSubscriptionPaymentRequest.mockResolvedValue({ ok: true, requestId: 'request-1', planName: 'Professional' });
  processPaystackSubscriptionReference.mockResolvedValue({ ok: true, reference: 'sub-ref', status: 'success', paymentId: 'payment-1' });
});

describe('student subscription payment confirmation', () => {
  it('does not select internal administrator notes for the student response', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/student-subscriptions/route.ts'), 'utf8');
    expect(source).not.toMatch(/subscription_payment_confirmations\([^)]*admin_notes/);
    expect(source).not.toMatch(/subscription_payments[^;]*\bnotes\b/);
  });

  it('keeps bootcamp learners on the existing installment payment surface', () => {
    const component = readFileSync(join(process.cwd(), 'components/student/subscription-payments.tsx'), 'utf8');
    expect(component).toContain('if (data?.subscriptionEligible === false) return <PaymentsSection');
  });

  it('derives student identity from the authenticated session', async () => {
    const response = await POST(request({
      action: 'submit-confirmation', requestId: 'request-1', studentId: 'someone-else',
      amount: 250, paidAt: '2026-08-11', method: 'Mobile Money', reference: 'TX-1',
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('submit_subscription_payment_confirmation', expect.objectContaining({
      p_request_id: 'request-1', p_student_id: 'student-1', p_amount: 250,
      p_paid_at: '2026-08-11', p_reference: 'TX-1',
    }));
  });

  it('rejects unsafe receipt URLs before calling the database', async () => {
    const response = await POST(request({
      action: 'submit-confirmation', requestId: 'request-1', amount: 250,
      paidAt: '2026-08-11', receiptUrl: 'javascript:alert(1)',
    }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('starts Paystack checkout from the authenticated learner only', async () => {
    const db = { rpc };
    createClient.mockReturnValue(db);
    const response = await POST(request({
      action: 'start-paystack-checkout',
      requestId: 'request-1',
      studentId: 'someone-else',
    }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.authorizationUrl).toBe('https://checkout.paystack.com/sub-ref');
    expect(createPaystackSubscriptionCheckout).toHaveBeenCalledWith(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    });
  });

  it('verifies a Paystack return only for the authenticated learner', async () => {
    const rpc = vi.fn(() => ({ data: true, error: null }));
    const db = makeSupabaseStub({
      paystack_subscription_transactions: { data: { student_id: 'student-1' }, error: null },
    }, rpc);
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'verify-paystack-return', reference: 'sub-ref' }));

    expect(response.status).toBe(200);
    expect(processPaystackSubscriptionReference).toHaveBeenCalledWith(db, 'sub-ref');
    // Metered on its own counter. Sharing the checkout counter would let the four polls the
    // return page makes lock the learner out of retrying a payment that failed.
    expect(rpc).toHaveBeenCalledWith('claim_paystack_checkout_attempt', expect.objectContaining({
      p_scope: 'verify',
    }));
  });

  it('rate limits repeated online checkout attempts', async () => {
    const db = makeSupabaseStub({}, () => ({ data: false, error: null }));
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'start-paystack-checkout', requestId: 'request-1' }));

    expect(response.status).toBe(429);
    expect(createPaystackSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('creates a subscription request from the server-side price', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: null }, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-1',
          plan_id: 'plan-1',
          duration_months: 3,
          amount: 300,
          currency: 'GHS',
          is_active: true,
          subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
    });
    createClient.mockReturnValue(db);
    const response = await POST(request({
      action: 'purchase-plan',
      priceId: 'price-1',
      amount: 1,
      durationMonths: 12,
      paystack: false,
    }));
    expect(response.status).toBe(200);
    expect(createSubscriptionPaymentRequest).toHaveBeenCalledWith(db, expect.objectContaining({
      studentId: 'student-1',
      planId: 'plan-1',
      durationMonths: 3,
      amount: 300,
      currency: 'GHS',
      createdBy: 'student-1',
    }));
    expect(createPaystackSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('can create a request and immediately start Paystack checkout', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: null }, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-1',
          plan_id: 'plan-1',
          duration_months: 12,
          amount: 1000,
          currency: 'GHS',
          is_active: true,
          subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);
    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-1', paystack: true }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.checkout.authorizationUrl).toBe('https://checkout.paystack.com/sub-ref');
    expect(createPaystackSubscriptionCheckout).toHaveBeenCalledWith(db, {
      requestId: 'request-1',
      studentId: 'student-1',
      email: 'student@example.com',
    });
  });

  it('rejects a plan that does not include the selected content', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: null }, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-1', plan_id: 'plan-1', duration_months: 1, amount: 100,
          currency: 'GHS', is_active: true, subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      subscription_plan_content: { data: [{ plan_id: 'plan-2' }], error: null },
      learning_paths: { data: [], error: null },
    });
    createClient.mockReturnValue(db);

    const response = await POST(request({
      action: 'purchase-plan', priceId: 'price-1', paystack: true,
      contentTable: 'courses', contentId: 'course-1',
    }));

    expect(response.status).toBe(409);
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
    expect(createPaystackSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('rejects bootcamp learners before creating an individual payment request', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: 'bootcamp' }, error: null },
    });
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-1', paystack: true }));

    expect(response.status).toBe(403);
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
  });
});
