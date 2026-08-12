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
const createClient = vi.hoisted(() => vi.fn());

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
  getSubscriptionForStudent: vi.fn(),
  getSubscriptionHistory: vi.fn(),
  getSubscriptionPaymentRequests: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { POST } from '@/app/api/payments/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function authenticateAs(role: string) {
  requireUser.mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
    supabase: makeSupabaseStub({ students: { data: { role }, error: null } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  createClient.mockReturnValue({});
  purchaseOrRenewSubscription.mockResolvedValue({ ok: true, paymentId: 'pay-1' });
  createSubscriptionPaymentRequest.mockResolvedValue({ ok: true, requestId: 'request-1' });
  approveSubscriptionPaymentConfirmation.mockResolvedValue({ ok: true });
  rejectSubscriptionPaymentConfirmation.mockResolvedValue({ ok: true });
  deleteSubscriptionPlan.mockResolvedValue({ ok: true });
  bulkAssignSubscriptionStudents.mockResolvedValue({ requested: 2, errors: [] });
});

describe('subscription payment actions', () => {
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
    const response = await POST(request({
      action, studentId: 'student-1', planId: 'plan-1', durationMonths: 3, amount: 250,
      currency: 'GHS', idempotencyKey: 'attempt-1',
    }));
    expect(response.status).toBe(200);
    expect(purchaseOrRenewSubscription).toHaveBeenCalledWith({}, expect.objectContaining({
      studentId: 'student-1', planId: 'plan-1', durationMonths: 3, idempotencyKey: 'attempt-1', createdBy: 'admin-1',
    }));
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

  it('creates bulk payment requests using shared defaults', async () => {
    authenticateAs('admin');
    const rows = [{ email: 'ada@example.com' }, { email: 'kwame@example.com', duration_months: 3 }];
    const response = await POST(request({
      action: 'bulk-subscription-payment-requests', planId: 'plan-1', rows,
      defaults: { durationMonths: 1, amount: 200, currency: 'GHS', dueDate: '2026-09-01' },
    }));
    expect(response.status).toBe(200);
    expect(bulkAssignSubscriptionStudents).toHaveBeenCalledWith({}, {
      planId: 'plan-1', rows,
      defaults: { durationMonths: 1, amount: 200, currency: 'GHS', dueDate: '2026-09-01' },
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
  });

  it('deletes an unused plan through the guarded RPC wrapper', async () => {
    authenticateAs('admin');
    const response = await POST(request({ action: 'delete-subscription-plan', planId: 'plan-1' }));
    expect(response.status).toBe(200);
    expect(deleteSubscriptionPlan).toHaveBeenCalledWith({}, 'plan-1');
  });
});
