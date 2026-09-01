import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const purchaseOrRenewSubscription = vi.hoisted(() => vi.fn());
const cancelSubscription = vi.hoisted(() => vi.fn());
const changeSubscriptionPlan = vi.hoisted(() => vi.fn());
const createSubscriptionPaymentRequest = vi.hoisted(() => vi.fn());
const approveSubscriptionPaymentConfirmation = vi.hoisted(() => vi.fn());
const rejectSubscriptionPaymentConfirmation = vi.hoisted(() => vi.fn());
const cancelSubscriptionPaymentRequest = vi.hoisted(() => vi.fn());
const deleteSubscriptionPlan = vi.hoisted(() => vi.fn());
const bulkAssignSubscriptionStudents = vi.hoisted(() => vi.fn());
const provisionIndividualStudent = vi.hoisted(() => vi.fn());
const sendIndividualStudentSetupEmail = vi.hoisted(() => vi.fn());
const sendIndividualLearnerWelcome = vi.hoisted(() => vi.fn());
const notifySubscriptionPaymentRequest = vi.hoisted(() => vi.fn().mockResolvedValue({ sent: true }));
const notifySubscriptionActivated = vi.hoisted(() => vi.fn().mockResolvedValue({ sent: true }));
const addToResendAudience = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getSubscriptionPlans = vi.hoisted(() => vi.fn());
const getSubscriptions = vi.hoisted(() => vi.fn());
const getEligibleSubscriptionStudents = vi.hoisted(() => vi.fn());
const getSubscriptionForStudent = vi.hoisted(() => vi.fn());
const getSubscriptionHistory = vi.hoisted(() => vi.fn());
const getSubscriptionPaymentRequests = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireUser, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/db-subscriptions', () => ({
  purchaseOrRenewSubscription,
  cancelSubscription,
  changeSubscriptionPlan,
  createSubscriptionPaymentRequest,
  approveSubscriptionPaymentConfirmation,
  rejectSubscriptionPaymentConfirmation,
  cancelSubscriptionPaymentRequest,
  deleteSubscriptionPlan,
  bulkAssignSubscriptionStudents,
  getSubscriptionPlans,
  getSubscriptions,
  getEligibleSubscriptionStudents,
  getSubscriptionForStudent,
  getSubscriptionHistory,
  getSubscriptionPaymentRequests,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
// after() schedules work for once the response is sent and needs a Next request context,
// which vitest does not provide. The route's post-response email is not what these tests
// cover, so it is a no-op here.
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Runs the callback, matching learning-paths.test.ts and certification-path-access.test.ts.
  // A no-op stub would leave the approval-to-email path asserted by nothing.
  after: (task: any) => { if (typeof task === 'function') return task(); },
}));
vi.mock('@/lib/notify-individual-learner-welcome', () => ({
  sendIndividualLearnerWelcome,
  learnerNeedsSetup: () => false,
  LEARNER_SETUP_FIELDS: 'account_origin, password_set_at, setup_email_sent_at',
}));
vi.mock('@/lib/notify-subscription-payment-request', () => ({ notifySubscriptionPaymentRequest }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivated, notifySubscriptionActivatedBatch: vi.fn() }));
vi.mock('@/lib/provision-individual-student', () => ({
  provisionIndividualStudent,
  sendIndividualStudentSetupEmail,
}));
vi.mock('@/lib/resend-audience', () => ({ addToResendAudience }));

import { GET, POST } from '@/app/api/payments/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function getRequest(action: string, params = '') {
  return new NextRequest(`http://localhost/api/payments?action=${action}${params}`, {
    headers: { authorization: 'Bearer token' },
  });
}

function authenticateAs(role: string) {
  requireUser.mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
    getActorDb: () => makeSupabaseStub({ students: { data: { role }, error: null } }),
    serviceDb: makeSupabaseStub({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  createClient.mockReturnValue({});
  purchaseOrRenewSubscription.mockResolvedValue({ ok: true, paymentId: 'pay-1' });
  createSubscriptionPaymentRequest.mockResolvedValue({ ok: true, requestId: 'request-1' });
  approveSubscriptionPaymentConfirmation.mockResolvedValue({ ok: true, paymentId: 'pay-approved', alreadyProcessed: false });
  rejectSubscriptionPaymentConfirmation.mockResolvedValue({ ok: true });
  deleteSubscriptionPlan.mockResolvedValue({ ok: true });
  bulkAssignSubscriptionStudents.mockResolvedValue({ requested: 2, errors: [] });
  provisionIndividualStudent.mockResolvedValue({ studentId: 'student-new', isNewAccount: true });
  sendIndividualStudentSetupEmail.mockResolvedValue(undefined);
  addToResendAudience.mockResolvedValue(undefined);
  getSubscriptionPlans.mockResolvedValue([]);
  getSubscriptions.mockResolvedValue([]);
  getEligibleSubscriptionStudents.mockResolvedValue([]);
  getSubscriptionPaymentRequests.mockResolvedValue([]);
  getSubscriptionForStudent.mockResolvedValue(null);
  getSubscriptionHistory.mockResolvedValue([]);
});

describe('subscription read authorization', () => {
  it('passes only instructor-owned plan ids to service-role list reads', async () => {
    authenticateAs('instructor');
    const db = makeSupabaseStub({
      subscription_plans: { data: [{ id: 'plan-owned' }], error: null },
    });
    createClient.mockReturnValue(db);

    const response = await GET(getRequest('subscription-list'));
    expect(response.status).toBe(200);
    expect(getSubscriptions).toHaveBeenCalledWith(db, ['plan-owned']);
    expect(getEligibleSubscriptionStudents).not.toHaveBeenCalled();
  });

  it('refuses an instructor reading a student subscription on another plan', async () => {
    authenticateAs('instructor');
    const db = makeSupabaseStub({
      subscription_plans: { data: [{ id: 'plan-owned' }], error: null },
    });
    createClient.mockReturnValue(db);
    getSubscriptionForStudent.mockResolvedValue({ id: 'subscription-1', plan_id: 'plan-other' });

    const response = await GET(getRequest('subscription-status', '&studentId=student-1'));
    expect(response.status).toBe(403);
  });

  it('keeps the global subscription view for admins', async () => {
    authenticateAs('admin');
    const db = makeSupabaseStub({});
    createClient.mockReturnValue(db);

    const response = await GET(getRequest('subscription-list'));
    expect(response.status).toBe(200);
    expect(getSubscriptions).toHaveBeenCalledWith(db, null);
    expect(getEligibleSubscriptionStudents).toHaveBeenCalledWith(db);
  });
});

describe('subscription payment actions', () => {
  it('resolves an owned payment incident through the atomic database function', async () => {
    authenticateAs('instructor');
    const rpc = vi.fn((fn: string) => {
      expect(fn).toBe('resolve_paystack_review_incident');
      return { data: { ok: true }, error: null };
    });
    const db = makeSupabaseStub({
      paystack_review_incidents: { data: { id: 'incident-1', plan_id: 'plan-1', status: 'open' }, error: null },
      subscription_plans: { data: { id: 'plan-1', created_by: 'admin-1' }, error: null },
    }, rpc);
    createClient.mockReturnValue(db);

    const response = await POST(request({
      action: 'resolve-paystack-incident', incidentId: 'incident-1', resolutionNote: 'Handled in Paystack',
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('resolve_paystack_review_incident', expect.objectContaining({
      p_incident_id: 'incident-1', p_actor_id: 'admin-1', p_resolution_note: 'Handled in Paystack',
    }));
  });

  // The tick box starts off, and the save used to keep only ticked rows -- so typing an amount and
  // saving silently discarded it, leaving a plan that looked active and could not be bought.
  it('keeps a price amount that was typed but not ticked', async () => {
    authenticateAs('admin');
    const rpc = vi.fn(() => ({ data: { ok: true }, error: null }));
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'admin-1' }, error: null },
    }, rpc));

    const response = await POST(request({
      action: 'save-subscription-plan-prices',
      planId: 'plan-1',
      prices: [{ durationMonths: 3, amount: 300, currency: 'GHS', isActive: false }],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('replace_subscription_plan_prices', expect.objectContaining({
      p_prices: [expect.objectContaining({ duration_months: 3, amount: 300, is_active: false })],
    }));
  });

  // The mirror of the bug above: filtering blank rows before validating meant ticking a duration
  // and forgetting its amount also vanished on save, with Save reporting success.
  it('refuses to save a duration switched on with no amount', async () => {
    authenticateAs('admin');
    const rpc = vi.fn(() => ({ data: { ok: true }, error: null }));
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'admin-1' }, error: null },
    }, rpc));

    const response = await POST(request({
      action: 'save-subscription-plan-prices',
      planId: 'plan-1',
      prices: [{ durationMonths: 3, amount: '', currency: 'GHS', isActive: true }],
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/3 mo/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('drops a row with no amount rather than failing the save', async () => {
    authenticateAs('admin');
    const rpc = vi.fn(() => ({ data: { ok: true }, error: null }));
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'admin-1' }, error: null },
    }, rpc));

    const response = await POST(request({
      action: 'save-subscription-plan-prices',
      planId: 'plan-1',
      prices: [{ durationMonths: 1, amount: '', currency: 'GHS', isActive: false }],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('replace_subscription_plan_prices', expect.objectContaining({ p_prices: [] }));
  });

  it('refuses to activate a plan without an active price', async () => {
    authenticateAs('admin');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: null, error: null },
      subscription_plan_prices: { data: [], error: null },
      subscription_plan_content: { data: [{ content_table: 'courses', content_id: 'course-1' }], error: null },
    }));

    const response = await POST(request({ action: 'update-subscription-plan', planId: 'plan-1', status: 'active' }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/active price/i);
  });

  it('refuses to activate a plan without linked content', async () => {
    authenticateAs('admin');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: null, error: null },
      subscription_plan_prices: { data: [{ id: 'price-1' }], error: null },
      subscription_plan_content: { data: [], error: null },
    }));

    const response = await POST(request({ action: 'update-subscription-plan', planId: 'plan-1', status: 'active' }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/published content/i);
  });

  it('refuses to activate a plan whose linked content is no longer published', async () => {
    authenticateAs('admin');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: null, error: null },
      subscription_plan_prices: { data: [{ id: 'price-1' }], error: null },
      subscription_plan_content: { data: [{ content_table: 'courses', content_id: 'course-1' }], error: null },
      courses: { data: [], error: null },
    }));

    const response = await POST(request({ action: 'update-subscription-plan', planId: 'plan-1', status: 'active' }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/attached content.*none of it is published/i);
  });

  it('activates a plan with an active price and published content', async () => {
    authenticateAs('admin');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plan_prices: { data: [{ id: 'price-1' }], error: null },
      subscription_plan_content: { data: [{ content_table: 'courses', content_id: 'course-1' }], error: null },
      courses: { data: [{ id: 'course-1' }], error: null },
      subscription_plans: { data: null, error: null },
    }));

    const response = await POST(request({ action: 'update-subscription-plan', planId: 'plan-1', status: 'active' }));

    expect(response.status).toBe(200);
  });

  it('rejects a student role', async () => {
    authenticateAs('student');
    const response = await POST(request({ action: 'create-subscription' }));
    expect(response.status).toBe(403);
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('validates duration, amount, and idempotency key', async () => {
    authenticateAs('admin');
    const response = await POST(request({
      action: 'create-subscription', studentId: 'student-1', planId: 'plan-1', durationMonths: 2,
      amount: 100, idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(400);
  });

  it.each(['create-subscription', 'renew-subscription'])('%s reaches the same transactional function', async action => {
    authenticateAs('instructor');
    const db = makeSupabaseStub({ subscription_plans: { data: { id: 'plan-1', created_by: 'admin-1' }, error: null } });
    createClient.mockReturnValue(db);
    const response = await POST(request({
      action, studentId: 'student-1', planId: 'plan-1', durationMonths: 3, amount: 250,
      currency: 'GHS', idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(200);
    expect(purchaseOrRenewSubscription).toHaveBeenCalledWith(db, expect.objectContaining({
      studentId: 'student-1', planId: 'plan-1', durationMonths: 3, idempotencyKey: 'attempt-1', createdBy: 'admin-1',
    }));
  });

  // Every subscription action here reaches the database through the service role, which bypasses
  // RLS, and the role gate at the top of the handler admits any instructor. Without an owner
  // check an instructor can move money on another instructor's plans.
  it('refuses to credit a subscription on a plan owned by another instructor', async () => {
    authenticateAs('instructor');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'someone-else' }, error: null },
    }));
    const response = await POST(request({
      action: 'create-subscription', studentId: 'student-1', planId: 'plan-1', durationMonths: 3,
      amount: 250, currency: 'GHS', idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(403);
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('lets an admin act on any plan', async () => {
    authenticateAs('admin');
    createClient.mockReturnValue(makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'someone-else' }, error: null },
    }));
    const response = await POST(request({
      action: 'create-subscription', studentId: 'student-1', planId: 'plan-1', durationMonths: 3,
      amount: 250, currency: 'GHS', idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(200);
    expect(purchaseOrRenewSubscription).toHaveBeenCalled();
  });

  it('refuses to cancel a subscription on a plan owned by another instructor', async () => {
    authenticateAs('instructor');
    createClient.mockReturnValue(makeSupabaseStub({
      individual_subscriptions: { data: { id: 'sub-1', plan_id: 'plan-1' }, error: null },
      subscription_plans: { data: { id: 'plan-1', created_by: 'someone-else' }, error: null },
    }));
    const response = await POST(request({ action: 'cancel-subscription', subscriptionId: 'sub-1' }));
    expect(response.status).toBe(403);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('maps model or idempotency conflicts to 409', async () => {
    authenticateAs('admin');
    purchaseOrRenewSubscription.mockRejectedValue({ code: '23505', message: 'already belongs to bootcamp' });
    const response = await POST(request({
      action: 'create-subscription', studentId: 'student-1', planId: 'plan-1', durationMonths: 1,
      amount: 100, idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(409);
  });

  it('changes a plan without sending billing or duration fields', async () => {
    authenticateAs('admin');
    changeSubscriptionPlan.mockResolvedValue({ ok: true, planId: 'plan-2' });
    const response = await POST(request({
      action: 'change-subscription-plan', subscriptionId: 'sub-1', planId: 'plan-2',
      amount: 999, durationMonths: 12,
    }));
    expect(response.status).toBe(200);
    expect(changeSubscriptionPlan).toHaveBeenCalledWith({}, {
      subscriptionId: 'sub-1', planId: 'plan-2', changedBy: 'admin-1', notes: undefined,
    });
  });

  it('assigns payment terms without activating the subscription', async () => {
    authenticateAs('admin');
    const response = await POST(request({
      action: 'create-subscription-payment-request', studentId: 'student-1', planId: 'plan-1',
      durationMonths: 6, amount: 500, currency: 'GHS', dueDate: '2026-09-01',
    }));
    expect(response.status).toBe(200);
    expect(createSubscriptionPaymentRequest).toHaveBeenCalledWith({}, {
      studentId: 'student-1', planId: 'plan-1', durationMonths: 6, amount: 500,
      currency: 'GHS', dueDate: '2026-09-01', createdBy: 'admin-1',
    });
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('reports an open online checkout as a conflict when assigning payment terms', async () => {
    authenticateAs('admin');
    createSubscriptionPaymentRequest.mockRejectedValue({
      code: '55006',
      message: 'an online checkout is already open for this learner',
    });

    const response = await POST(request({
      action: 'create-subscription-payment-request', studentId: 'student-1', planId: 'plan-1',
      durationMonths: 3, amount: 250, currency: 'GHS',
      dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('finish or clear it') });
  });

  it('reports an existing learner open checkout as a conflict during assignment', async () => {
    authenticateAs('admin');
    provisionIndividualStudent.mockResolvedValue({ studentId: 'student-1', isNewAccount: false });
    createSubscriptionPaymentRequest.mockRejectedValue({
      code: '55006',
      message: 'an online checkout is already open for this learner',
    });

    const response = await POST(request({
      action: 'assign-new-subscription-student', mode: 'request', email: 'student@example.com',
      fullName: 'Student One', planId: 'plan-1', durationMonths: 3, amount: 250,
      currency: 'GHS', dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('finish or clear it') });
  });

  it('creates a learner account and payment request in one action', async () => {
    authenticateAs('admin');
    const response = await POST(request({
      action: 'assign-new-subscription-student', mode: 'request', fullName: 'Ada Mensah',
      email: 'ada@example.com', planId: 'plan-1', durationMonths: 3, amount: 300,
      currency: 'GHS', dueDate: '2026-09-01',
    }));
    expect(response.status).toBe(200);
    expect(provisionIndividualStudent).toHaveBeenNthCalledWith(1, expect.anything(), {
      email: 'ada@example.com', fullName: 'Ada Mensah', notify: false, claimModel: false,
    });
    expect(createSubscriptionPaymentRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      studentId: 'student-new', planId: 'plan-1', durationMonths: 3, amount: 300,
    }));
    expect(provisionIndividualStudent).toHaveBeenCalledTimes(1);
    expect(addToResendAudience).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada Mensah' });
    // The route no longer chooses the message. It calls the request sender, which decides
    // from durable state whether the learner gets the combined welcome or a request-only
    // notice -- so a retry after a failed welcome cannot downgrade to the plan-only email.
    expect(notifySubscriptionPaymentRequest).toHaveBeenCalledWith(expect.anything(), {
      requestId: 'request-1',
    });
    expect(sendIndividualStudentSetupEmail).not.toHaveBeenCalled();
    expect(purchaseOrRenewSubscription).not.toHaveBeenCalled();
  });

  it('creates a learner account and activates an already-paid subscription in one action', async () => {
    authenticateAs('admin');
    const response = await POST(request({
      action: 'assign-new-subscription-student', mode: 'paid', fullName: 'Ada Mensah',
      email: 'ada@example.com', planId: 'plan-1', durationMonths: 6, amount: 600,
      currency: 'GHS', idempotencyKey: 'new-learner-attempt-1', paymentMethod: 'bank',
    }));
    expect(response.status).toBe(200);
    expect(purchaseOrRenewSubscription).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      studentId: 'student-new', planId: 'plan-1', durationMonths: 6,
      idempotencyKey: 'new-learner-attempt-1',
    }));
    expect(provisionIndividualStudent).toHaveBeenCalledTimes(1);
    expect(addToResendAudience).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada Mensah' });
    expect(createSubscriptionPaymentRequest).not.toHaveBeenCalled();
  });

  it('keeps a new learner in the audience when the learner email fails', async () => {
    authenticateAs('admin');
    notifySubscriptionPaymentRequest.mockRejectedValueOnce(new Error('Email unavailable'));
    const response = await POST(request({
      action: 'assign-new-subscription-student', mode: 'request', fullName: 'Ada Mensah',
      email: 'ada@example.com', planId: 'plan-1', durationMonths: 3, amount: 300,
      currency: 'GHS', dueDate: '2026-09-01',
    }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(addToResendAudience).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada Mensah' });
    expect(data.notificationWarning).toBe('Email unavailable');
  });

  it('creates bulk payment requests using shared defaults', async () => {
    authenticateAs('admin');
    const rows = [{ email: 'ada@example.com' }, { email: 'kwame@example.com', duration_months: 3 }];
    const response = await POST(request({
      action: 'bulk-subscription-payment-requests', mode: 'request', batchId: 'batch-1', planId: 'plan-1', rows,
      defaults: { durationMonths: 1, amount: 200, currency: 'GHS', dueDate: '2026-09-01' },
    }));
    expect(response.status).toBe(200);
    expect(bulkAssignSubscriptionStudents).toHaveBeenCalledWith({}, {
      planId: 'plan-1', rows,
      mode: 'request', batchId: 'batch-1',
      defaults: { durationMonths: 1, amount: 200, currency: 'GHS', dueDate: '2026-09-01', paymentMethod: undefined, paymentReference: undefined, notes: undefined },
      createdBy: 'admin-1',
    });
  });

  it('records bulk paid subscriptions without requiring a payment deadline', async () => {
    authenticateAs('admin');
    const rows = [{ email: 'ada@example.com' }];
    const response = await POST(request({
      action: 'bulk-subscription-payment-requests', mode: 'paid', batchId: 'batch-paid-1', planId: 'plan-1', rows,
      defaults: { durationMonths: 3, amount: 300, currency: 'GHS', paymentMethod: 'Bank transfer', paymentReference: 'BATCH-22' },
    }));
    expect(response.status).toBe(200);
    expect(bulkAssignSubscriptionStudents).toHaveBeenCalledWith({}, {
      planId: 'plan-1', mode: 'paid', batchId: 'batch-paid-1', rows,
      defaults: { durationMonths: 3, amount: 300, currency: 'GHS', dueDate: null, paymentMethod: 'Bank transfer', paymentReference: 'BATCH-22', notes: undefined },
      createdBy: 'admin-1',
    });
  });

  it('rejects empty or oversized bulk imports', async () => {
    authenticateAs('admin');
    const response = await POST(request({
      action: 'bulk-subscription-payment-requests', planId: 'plan-1', rows: [],
      defaults: { durationMonths: 1, amount: 200, currency: 'GHS', dueDate: '2026-09-01' },
    }));
    expect(response.status).toBe(400);
    expect(bulkAssignSubscriptionStudents).not.toHaveBeenCalled();
  });

  it('requires a reason when rejecting a subscription confirmation', async () => {
    authenticateAs('admin');
    const response = await POST(request({ action: 'reject-subscription-confirmation', confirmationId: 'conf-1' }));
    expect(response.status).toBe(400);
    expect(rejectSubscriptionPaymentConfirmation).not.toHaveBeenCalled();
  });

  it('approves through the transactional confirmation RPC wrapper', async () => {
    authenticateAs('admin');
    const response = await POST(request({ action: 'approve-subscription-confirmation', confirmationId: 'conf-1' }));
    expect(response.status).toBe(200);
    expect(approveSubscriptionPaymentConfirmation).toHaveBeenCalledWith({}, {
      confirmationId: 'conf-1', reviewedBy: 'admin-1', adminNotes: undefined,
    });
    // Approval is the moment access starts for the request flow, so the payment it produced
    // must reach the activation sender. after() runs for real above, so this covers the
    // post-response hop rather than stopping at the database wrapper.
    expect(notifySubscriptionActivated).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-approved' });
  });

  it('still hands the payment to the activation sender when the approval is replayed', async () => {
    authenticateAs('admin');
    // Migration 177 returns the original payment on a replay so a failed activation email
    // can be retried by approving again.
    approveSubscriptionPaymentConfirmation.mockResolvedValue({
      ok: true, paymentId: 'pay-approved', alreadyProcessed: true,
    });

    const response = await POST(request({ action: 'approve-subscription-confirmation', confirmationId: 'conf-1' }));

    expect(response.status).toBe(200);
    expect(notifySubscriptionActivated).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-approved' });
  });

  it('deletes an unused plan through the guarded RPC wrapper', async () => {
    authenticateAs('admin');
    const response = await POST(request({ action: 'delete-subscription-plan', planId: 'plan-1' }));
    expect(response.status).toBe(200);
    expect(deleteSubscriptionPlan).toHaveBeenCalledWith({}, 'plan-1');
  });

  it('saves public plan prices through admin-only payments route', async () => {
    authenticateAs('admin');
    const db = makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'someone-else' }, error: null },
    }, (fn, args) => {
      expect(fn).toBe('replace_subscription_plan_prices');
      expect(args.p_prices).toHaveLength(4);
      return { data: { ok: true, count: 4 }, error: null };
    });
    createClient.mockReturnValue(db);
    const response = await POST(request({
      action: 'save-subscription-plan-prices',
      planId: 'plan-1',
      prices: [
        { durationMonths: 1, amount: 120, currency: 'ghs', isActive: true },
        { durationMonths: 3, amount: 300, currency: 'GHS', isActive: true },
        { durationMonths: 6, amount: 560, currency: 'GHS', isActive: true },
        { durationMonths: 12, amount: 1000, currency: 'GHS', isActive: true },
      ],
    }));
    expect(response.status).toBe(200);
  });

  it('prevents non-owner instructors from changing public plan prices', async () => {
    authenticateAs('instructor');
    const db = makeSupabaseStub({
      subscription_plans: { data: { id: 'plan-1', created_by: 'someone-else' }, error: null },
    });
    createClient.mockReturnValue(db);
    const response = await POST(request({
      action: 'save-subscription-plan-prices',
      planId: 'plan-1',
      prices: [{ durationMonths: 1, amount: 120, currency: 'GHS', isActive: true }],
    }));
    expect(response.status).toBe(403);
  });
});
