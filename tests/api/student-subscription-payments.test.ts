import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const createPaystackSubscriptionCheckout = vi.hoisted(() => vi.fn());
const createPaystackDirectCheckout = vi.hoisted(() => vi.fn());
const settleUnfinishedCheckout = vi.hoisted(() => vi.fn());
const createSubscriptionPaymentRequest = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireUser, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('resend', () => ({ Resend: class { batch = { send: vi.fn() }; } }));
vi.mock('@/lib/paystack-subscriptions', () => ({
  createPaystackSubscriptionCheckout,
  createPaystackDirectCheckout,
  settleUnfinishedCheckout,
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
  createPaystackDirectCheckout.mockResolvedValue({
    reference: 'sub-ref',
    authorizationUrl: 'https://checkout.paystack.com/sub-ref',
  });
  createPaystackSubscriptionCheckout.mockResolvedValue({
    reference: 'sub-ref',
    authorizationUrl: 'https://checkout.paystack.com/sub-ref',
  });
  createSubscriptionPaymentRequest.mockResolvedValue({ ok: true, requestId: 'request-1', planName: 'Professional' });
  settleUnfinishedCheckout.mockResolvedValue({
    abandoned: false,
    result: { ok: true, reference: 'sub-ref', status: 'success', paymentId: 'payment-1' },
  });
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

  // A learner who has never bought anything was shown "Expired" and an amber "awaiting payment"
  // pill, because a null subscription fell through the branch meant for ended ones.
  it('does not tell a learner with no subscription that their access expired', () => {
    const component = readFileSync(join(process.cwd(), 'components/student/subscription-payments.tsx'), 'utf8');
    expect(component).toContain('const choosingPlan = !subscription && !openRequest;');
    expect(component).toContain('{choosingPlan ?');
    expect(component).not.toContain("!subscription ? 'Expired'");
  });

  // The bootcamp installment screen used to appear whenever no plans were on sale, so an admin
  // forgetting to price a plan showed it to learners who had never joined a bootcamp -- and hid
  // the real cause completely.
  it('only shows the bootcamp payment screen to learners who owe installments', () => {
    const component = readFileSync(join(process.cwd(), 'components/student/subscription-payments.tsx'), 'utf8');
    expect(component).toContain('if (data?.hasBootcampPayments) return <PaymentsSection');
    // Same rule on the error path: a failed request must not be dressed up as a bootcamp screen
    // for a learner whose enrollment model is simply not set yet.
    expect(component).toContain("if (error && failureEnrollmentModel === 'bootcamp')");
    expect(component).not.toContain("if (error && failureEnrollmentModel !== 'individual')");
    expect(component).toContain('No plans are on sale yet');
    const route = readFileSync(join(process.cwd(), 'app/api/student-subscriptions/route.ts'), 'utf8');
    expect(route).toContain('hasBootcampPayments');
  });

  // Resume used to accept any reference this learner had ever owned and reopen it from the row's
  // remembered price. An old abandoned or already-paid reference would be honoured, at whatever
  // the plan cost back then.
  it('will not resume a checkout that is no longer open', async () => {
    const db = makeSupabaseStub({
      paystack_subscription_transactions: { data: null, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'resume-cart', reference: 'sub-old' }));

    expect(response.status).toBe(404);
    expect(createPaystackDirectCheckout).not.toHaveBeenCalled();
  });

  it('reopens a cart at what the plan costs now, not what the row remembers', async () => {
    const db = makeSupabaseStub({
      paystack_subscription_transactions: {
        data: {
          student_id: 'student-1', plan_id: 'plan-1', duration_months: 3,
          status: 'initialized', request_id: null,
        },
        error: null,
      },
      subscription_plan_prices: {
        data: {
          amount: 450, currency: 'GHS', is_active: true,
          subscription_plans: { name: 'Pro', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      // Resume runs the same account checks the purchase path does: the learner has not moved to a
      // bootcamp, and is not already on a different plan.
      students: { data: { enrollment_model: null }, error: null },
      individual_subscriptions: { data: null, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'resume-cart', reference: 'sub-a' }));

    expect(response.status).toBe(200);
    expect(createPaystackDirectCheckout).toHaveBeenCalledWith(db, expect.objectContaining({
      planId: 'plan-1', durationMonths: 3, amount: 450, planName: 'Pro',
    }));
  });

  it('refuses to reopen a cart for a learner now on a bootcamp', async () => {
    const db = makeSupabaseStub({
      paystack_subscription_transactions: {
        data: {
          student_id: 'student-1', plan_id: 'plan-1', duration_months: 3,
          status: 'initialized', request_id: null,
        },
        error: null,
      },
      subscription_plan_prices: {
        data: {
          amount: 450, currency: 'GHS', is_active: true,
          subscription_plans: { name: 'Pro', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      students: { data: { enrollment_model: 'bootcamp' }, error: null },
      individual_subscriptions: { data: null, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'resume-cart', reference: 'sub-a' }));

    expect(response.status).toBe(403);
    expect(createPaystackDirectCheckout).not.toHaveBeenCalled();
  });

  it('refuses to reopen a cart whose plan is no longer on sale', async () => {
    const db = makeSupabaseStub({
      paystack_subscription_transactions: {
        data: {
          student_id: 'student-1', plan_id: 'plan-1', duration_months: 3,
          status: 'initialized', request_id: null,
        },
        error: null,
      },
      subscription_plan_prices: { data: null, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'resume-cart', reference: 'sub-a' }));

    expect(response.status).toBe(409);
    expect(createPaystackDirectCheckout).not.toHaveBeenCalled();
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

  it('keeps a replayed ongoing return transient and leaves its cart resumable', async () => {
    const rpc = vi.fn(() => ({ data: true, error: null }));
    const db = makeSupabaseStub({
      paystack_subscription_transactions: {
        data: {
          student_id: 'student-1', plan_id: 'plan-1', duration_months: 3,
          status: 'initialized', request_id: null,
        },
        error: null,
      },
      subscription_plan_prices: {
        data: {
          amount: 450, currency: 'GHS', is_active: true,
          subscription_plans: { name: 'Pro', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      students: { data: { enrollment_model: null }, error: null },
      individual_subscriptions: { data: null, error: null },
    }, rpc);
    createClient.mockReturnValue(db);
    settleUnfinishedCheckout.mockResolvedValue({
      abandoned: false,
      result: { ok: true, reference: 'sub-ref', status: 'ongoing' },
    });

    const first = await POST(request({ action: 'verify-paystack-return', reference: 'sub-ref' }));
    const second = await POST(request({ action: 'verify-paystack-return', reference: 'sub-ref' }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ status: 'ongoing' });
    await expect(second.json()).resolves.toMatchObject({ status: 'ongoing' });
    expect(settleUnfinishedCheckout).toHaveBeenCalledTimes(2);
    expect(settleUnfinishedCheckout).toHaveBeenNthCalledWith(1, db, 'sub-ref');
    expect(settleUnfinishedCheckout).toHaveBeenNthCalledWith(2, db, 'sub-ref');
    // Metered on its own counter. Sharing the checkout counter would let the four polls the
    // return page makes lock the learner out of retrying a payment that failed.
    expect(rpc).toHaveBeenCalledWith('claim_paystack_checkout_attempt', expect.objectContaining({
      p_scope: 'verify',
    }));

    // Both learner-triggered checks left the local row initialized, so the same reference still
    // passes the real resume route instead of disappearing from the cart and returning 404.
    const resume = await POST(request({ action: 'resume-cart', reference: 'sub-ref' }));
    expect(resume.status).toBe(200);
    expect(createPaystackDirectCheckout).toHaveBeenCalledWith(db, expect.objectContaining({
      planId: 'plan-1', durationMonths: 3, amount: 450, planName: 'Pro',
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
      // No online checkout open: the manual path refuses while one is, so a learner cannot
      // hold a payable Paystack link and a bank transfer for the same plan at once.
      paystack_subscription_transactions: { data: null, error: null },
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
      individual_subscriptions: { data: null, error: null },
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

  // A payment request means someone asked this learner to pay. Raising one because they clicked a
  // plan gave them a deadline, a chasing email, and a place in the admin's receivables -- and
  // since only one can be open at a time, abandoning the checkout locked them out of every other
  // plan with no way to clear it.
  it('buys online without raising a payment request', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: null }, error: null },
      // No online checkout open: the manual path refuses while one is, so a learner cannot
      // hold a payable Paystack link and a bank transfer for the same plan at once.
      paystack_subscription_transactions: { data: null, error: null },
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
      individual_subscriptions: { data: null, error: null },
    }, () => ({ data: true, error: null }));
    createClient.mockReturnValue(db);
    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-1', paystack: true }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.checkout.authorizationUrl).toBe('https://checkout.paystack.com/sub-ref');
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
    expect(createPaystackDirectCheckout).toHaveBeenCalledWith(db, expect.objectContaining({
      studentId: 'student-1',
      email: 'student@example.com',
      planId: 'plan-1',
      durationMonths: 12,
      amount: 1000,
      currency: 'GHS',
    }));
  });

  it('rejects a plan that does not include the selected content', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: null }, error: null },
      // No online checkout open: the manual path refuses while one is, so a learner cannot
      // hold a payable Paystack link and a bank transfer for the same plan at once.
      paystack_subscription_transactions: { data: null, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-1', plan_id: 'plan-1', duration_months: 1, amount: 100,
          currency: 'GHS', is_active: true, subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      individual_subscriptions: { data: null, error: null },
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
      subscription_plan_prices: {
        data: {
          id: 'price-1', plan_id: 'plan-1', duration_months: 1, amount: 100,
          currency: 'GHS', is_active: true, subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
    });
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-1', paystack: true }));

    expect(response.status).toBe(403);
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
  });

  // A learner may hold one plan at a time. This has to be refused before any checkout opens:
  // once a payment provider has been handed the learner, the charge succeeds and crediting is
  // refused afterwards, which costs them real money and needs a person to unpick.
  it('refuses a different plan before any checkout can open', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: 'individual' }, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-2', plan_id: 'plan-2', duration_months: 3, amount: 300,
          currency: 'GHS', is_active: true, subscription_plans: { id: 'plan-2', status: 'active', cohort_id: 'cohort-2' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      individual_subscriptions: {
        data: { plan_id: 'plan-1', subscription_plans: { name: 'Starter' } },
        error: null,
      },
    });
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-2', paystack: true }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain('Starter');
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
    // The online path calls the direct function, so this is the assertion that actually proves
    // no checkout opened. The request-scoped one is asserted too, to cover the manual path.
    expect(createPaystackDirectCheckout).not.toHaveBeenCalled();
    expect(createPaystackSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('still allows renewing the plan the learner already holds', async () => {
    const db = makeSupabaseStub({
      students: { data: { enrollment_model: 'individual' }, error: null },
      subscription_plan_prices: {
        data: {
          id: 'price-1', plan_id: 'plan-1', duration_months: 12, amount: 1000,
          currency: 'GHS', is_active: true, subscription_plans: { id: 'plan-1', status: 'active', cohort_id: 'cohort-1' },
        },
        error: null,
      },
      cohorts: { data: { cohort_kind: 'subscription_plan' }, error: null },
      individual_subscriptions: {
        data: { plan_id: 'plan-1', subscription_plans: { name: 'Starter' } },
        error: null,
      },
      // No online checkout open: the manual path refuses while one is, so a learner cannot hold a
      // payable Paystack link and a bank transfer for the same plan at once.
      paystack_subscription_transactions: { data: null, error: null },
    });
    createClient.mockReturnValue(db);

    const response = await POST(request({ action: 'purchase-plan', priceId: 'price-1', paystack: false }));

    expect(response.status).toBe(200);
    expect(createSubscriptionPaymentRequest).toHaveBeenCalledWith(db, expect.objectContaining({
      studentId: 'student-1',
      planId: 'plan-1',
    }));
  });
});
