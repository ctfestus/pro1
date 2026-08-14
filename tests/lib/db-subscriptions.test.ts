import { describe, expect, it, vi } from 'vitest';
import {
  approveSubscriptionPaymentConfirmation,
  cancelSubscription,
  cancelSubscriptionPaymentRequest,
  changeSubscriptionPlan,
  createSubscriptionPaymentRequest,
  deleteSubscriptionPlan,
  expireSubscription,
  getSubscriptionForStudent,
  getSubscriptionHistory,
  getSubscriptionPaymentRequests,
  getSubscriptions,
  purchaseOrRenewSubscription,
  rejectSubscriptionPaymentConfirmation,
} from '@/lib/db-subscriptions';

describe('db subscriptions', () => {
  it('passes purchase intent to the transactional RPC without generating a key', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, paymentId: 'pay-1' }, error: null });
    const db = { rpc } as any;
    await purchaseOrRenewSubscription(db, {
      studentId: 'student-1', planId: 'plan-1', durationMonths: 3, amount: 250, currency: 'GHS',
      idempotencyKey: 'attempt-1', paymentMethod: 'card', paymentReference: 'ref-1',
      notes: 'paid', createdBy: 'admin-1',
    });
    expect(rpc).toHaveBeenCalledWith('purchase_or_renew_individual_subscription', {
      p_student_id: 'student-1', p_plan_id: 'plan-1', p_duration_months: 3, p_amount: 250,
      p_currency: 'GHS', p_idempotency_key: 'attempt-1', p_payment_method: 'card',
      p_payment_reference: 'ref-1', p_notes: 'paid', p_created_by: 'admin-1',
    });
  });

  it('uses one close RPC for cancellation and expiry', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const db = { rpc } as any;
    await cancelSubscription(db, 'sub-1');
    await expireSubscription(db, 'sub-2');
    expect(rpc.mock.calls).toEqual([
      ['close_individual_subscription', { p_subscription_id: 'sub-1', p_new_status: 'cancelled' }],
      ['close_individual_subscription', { p_subscription_id: 'sub-2', p_new_status: 'expired' }],
    ]);
  });

  it('creates assigned payment requests through the transactional RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, requestId: 'request-1' }, error: null });
    await createSubscriptionPaymentRequest({ rpc } as any, {
      studentId: 'student-1', planId: 'plan-1', durationMonths: 6, amount: 900,
      currency: 'GHS', dueDate: '2026-09-01', createdBy: 'admin-1',
    });
    expect(rpc).toHaveBeenCalledWith('create_individual_subscription_payment_request', {
      p_student_id: 'student-1', p_plan_id: 'plan-1', p_duration_months: 6,
      p_amount: 900, p_currency: 'GHS', p_due_date: '2026-09-01', p_created_by: 'admin-1',
    });
  });

  it('changes only the access plan through the dedicated RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, planId: 'plan-2' }, error: null });
    const db = { rpc } as any;
    await changeSubscriptionPlan(db, {
      subscriptionId: 'sub-1', planId: 'plan-2', changedBy: 'admin-1', notes: 'Access upgrade',
    });
    expect(rpc).toHaveBeenCalledWith('change_individual_subscription_plan', {
      p_subscription_id: 'sub-1', p_new_plan_id: 'plan-2', p_changed_by: 'admin-1', p_notes: 'Access upgrade',
    });
  });

  it('returns an empty history when the query returns null', async () => {
    const builder: any = {
      select: vi.fn(() => builder), eq: vi.fn(() => builder), order: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const db = { from: vi.fn(() => builder) } as any;
    await expect(getSubscriptionHistory(db, 'sub-1')).resolves.toEqual([]);
  });

  it('selects the plan through the direct foreign key when two relationships exist', async () => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const db = { from: vi.fn(() => builder) } as any;

    await getSubscriptionForStudent(db, 'student-1');

    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining(
      'subscription_plans!individual_subscriptions_plan_id_fkey',
    ));
  });

  it('excludes deleted students from the live subscriber list', async () => {
    const builder: any = {
      select: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const db = { from: vi.fn(() => builder) } as any;

    await getSubscriptions(db);

    expect(builder.not).toHaveBeenCalledWith('student_id', 'is', null);
  });

  it('excludes deleted students from the payment-request workspace', async () => {
    const builder: any = {
      select: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const db = { from: vi.fn(() => builder) } as any;

    await getSubscriptionPaymentRequests(db);

    expect(builder.not).toHaveBeenCalledWith('student_id', 'is', null);
  });

  it('reviews subscription confirmations only through transactional RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const db = { rpc } as any;
    await approveSubscriptionPaymentConfirmation(db, { confirmationId: 'conf-1', reviewedBy: 'admin-1', adminNotes: 'Verified' });
    await rejectSubscriptionPaymentConfirmation(db, { confirmationId: 'conf-2', reviewedBy: 'admin-1', adminNotes: 'Wrong reference' });
    await cancelSubscriptionPaymentRequest(db, 'request-1');
    expect(rpc.mock.calls).toEqual([
      ['approve_subscription_payment_confirmation', { p_confirmation_id: 'conf-1', p_reviewed_by: 'admin-1', p_admin_notes: 'Verified' }],
      ['reject_subscription_payment_confirmation', { p_confirmation_id: 'conf-2', p_reviewed_by: 'admin-1', p_admin_notes: 'Wrong reference' }],
      ['cancel_subscription_payment_request', { p_request_id: 'request-1' }],
    ]);
  });

  it('deletes a plan only through the guarded database function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    await deleteSubscriptionPlan({ rpc } as any, 'plan-1');
    expect(rpc).toHaveBeenCalledWith('delete_unused_subscription_plan', { p_plan_id: 'plan-1' });
  });
});
