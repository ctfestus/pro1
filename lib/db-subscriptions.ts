import type { SupabaseClient } from '@supabase/supabase-js';
import { provisionIndividualStudent } from '@/lib/provision-individual-student';
import { notifySubscriptionActivatedBatch } from '@/lib/notify-subscription-activated';
import { addToResendAudience } from '@/lib/resend-audience';
import { notifySubscriptionPaymentRequest } from '@/lib/notify-subscription-payment-request';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface SubscriptionPurchaseInput {
  studentId: string;
  planId: string;
  durationMonths: 1 | 3 | 6 | 12;
  amount: number;
  currency: string;
  idempotencyKey: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface SubscriptionMutationResult {
  ok: boolean;
  subscriptionId?: string;
  paymentId?: string;
  alreadyProcessed?: boolean;
  skipped?: boolean;
  reason?: string;
  status?: SubscriptionStatus;
}

export async function purchaseOrRenewSubscription(
  db: SupabaseClient,
  input: SubscriptionPurchaseInput,
): Promise<SubscriptionMutationResult> {
  const { data, error } = await db.rpc('purchase_or_renew_individual_subscription', {
    p_student_id: input.studentId,
    p_plan_id: input.planId,
    p_duration_months: input.durationMonths,
    p_amount: input.amount,
    p_currency: input.currency,
    p_idempotency_key: input.idempotencyKey,
    p_payment_method: input.paymentMethod ?? null,
    p_payment_reference: input.paymentReference ?? null,
    p_notes: input.notes ?? null,
    p_created_by: input.createdBy,
  });
  if (error) throw error;
  return data as SubscriptionMutationResult;
}

async function closeSubscription(
  db: SupabaseClient,
  subscriptionId: string,
  status: 'cancelled' | 'expired',
): Promise<SubscriptionMutationResult> {
  const { data, error } = await db.rpc('close_individual_subscription', {
    p_subscription_id: subscriptionId,
    p_new_status: status,
  });
  if (error) throw error;
  return data as SubscriptionMutationResult;
}

export function cancelSubscription(db: SupabaseClient, subscriptionId: string) {
  return closeSubscription(db, subscriptionId, 'cancelled');
}

export function expireSubscription(db: SupabaseClient, subscriptionId: string) {
  return closeSubscription(db, subscriptionId, 'expired');
}

export async function changeSubscriptionPlan(
  db: SupabaseClient,
  input: { subscriptionId: string; planId: string; changedBy: string; notes?: string | null },
) {
  const { data, error } = await db.rpc('change_individual_subscription_plan', {
    p_subscription_id: input.subscriptionId,
    p_new_plan_id: input.planId,
    p_changed_by: input.changedBy,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getSubscriptionForStudent(db: SupabaseClient, studentId: string) {
  const { data, error } = await db
    .from('individual_subscriptions')
    .select('id, student_id, plan_id, cohort_id, status, duration_months, amount, currency, current_period_start, current_period_end, cancelled_at, created_at, updated_at, subscription_plans!individual_subscriptions_plan_id_fkey ( id, name, description, status )')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSubscriptionHistory(db: SupabaseClient, subscriptionId: string) {
  const { data, error } = await db
    .from('subscription_payments')
    .select('id, subscription_id, student_id, plan_id, plan_name, status, is_activating, kind, duration_months, amount, currency, period_start, period_end, paid_at, payment_method, payment_reference, notes, created_by, created_at')
    .eq('subscription_id', subscriptionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSubscriptionPlan(
  db: SupabaseClient,
  input: { name: string; description?: string | null; createdBy: string },
) {
  const { data, error } = await db.rpc('create_individual_subscription_plan', {
    p_name: input.name,
    p_description: input.description ?? null,
    p_created_by: input.createdBy,
  });
  if (error) throw error;
  return data;
}

export async function getSubscriptionPlans(db: SupabaseClient, activeOnly = false, planIds: string[] | null = null) {
  if (planIds && planIds.length === 0) return [];
  let query = db
    .from('subscription_plans')
    .select('id, name, description, cohort_id, status, created_by, created_at, updated_at, subscription_plan_prices(id, duration_months, amount, currency, is_active, sort_order)')
    .order('name');
  if (activeOnly) query = query.eq('status', 'active');
  if (planIds) query = query.in('id', planIds);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getSubscriptions(db: SupabaseClient, planIds: string[] | null = null) {
  if (planIds && planIds.length === 0) return [];
  let query = db
    .from('individual_subscriptions')
    .select('id, student_id, plan_id, cohort_id, status, duration_months, amount, currency, current_period_start, current_period_end, cancelled_at, created_at, updated_at, students!individual_subscriptions_student_id_fkey ( id, full_name, email, cohort_id, enrollment_model ), subscription_plans!individual_subscriptions_plan_id_fkey ( id, name, description, status )')
    .not('student_id', 'is', null);
  if (planIds) query = query.in('plan_id', planIds);
  const { data, error } = await query.order('current_period_end', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getEligibleSubscriptionStudents(db: SupabaseClient) {
  const [
    { data: students, error: studentError },
    { data: subscriptions, error: subscriptionError },
    { data: openRequests, error: requestError },
  ] = await Promise.all([
    db.from('students')
      .select('id, full_name, email, cohort_id, enrollment_model')
      .eq('role', 'student')
      .is('cohort_id', null)
      .order('full_name'),
    db.from('individual_subscriptions').select('student_id').not('student_id', 'is', null),
    db.from('subscription_payment_requests').select('student_id')
      .in('status', ['pending', 'confirmation_submitted']).not('student_id', 'is', null),
  ]);
  if (studentError) throw studentError;
  if (subscriptionError) throw subscriptionError;
  if (requestError) throw requestError;
  const unavailable = new Set([
    ...(subscriptions ?? []).map(row => row.student_id),
    ...(openRequests ?? []).map(row => row.student_id),
  ]);
  return (students ?? []).filter(student => !unavailable.has(student.id));
}

export async function createSubscriptionPaymentRequest(
  db: SupabaseClient,
  input: {
    studentId: string;
    planId: string;
    durationMonths: 1 | 3 | 6 | 12;
    amount: number;
    currency: string;
    dueDate: string;
    createdBy: string;
  },
) {
  const { data, error } = await db.rpc('create_individual_subscription_payment_request', {
    p_student_id: input.studentId,
    p_plan_id: input.planId,
    p_duration_months: input.durationMonths,
    p_amount: input.amount,
    p_currency: input.currency,
    p_due_date: input.dueDate,
    p_created_by: input.createdBy,
  });
  if (error) throw error;
  return data;
}

export async function getSubscriptionPaymentRequests(db: SupabaseClient, planIds: string[] | null = null) {
  if (planIds && planIds.length === 0) return [];
  let query = db
    .from('subscription_payment_requests')
    .select(`
      id, student_id, subscription_id, plan_id, plan_name, kind, duration_months,
      amount, currency, due_date, status, created_at, paid_at, cancelled_at,
      students!subscription_payment_requests_student_id_fkey ( id, full_name, email ),
      subscription_payment_confirmations (
        id, request_id, student_id, amount, paid_at, method, reference, notes,
        receipt_url, status, admin_notes, reviewed_at, created_at
      )
    `)
    .not('student_id', 'is', null);
  if (planIds) query = query.in('plan_id', planIds);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function approveSubscriptionPaymentConfirmation(
  db: SupabaseClient,
  input: { confirmationId: string; reviewedBy: string; adminNotes?: string | null },
) {
  const { data, error } = await db.rpc('approve_subscription_payment_confirmation', {
    p_confirmation_id: input.confirmationId,
    p_reviewed_by: input.reviewedBy,
    p_admin_notes: input.adminNotes ?? null,
  });
  if (error) throw error;
  return data;
}

export async function rejectSubscriptionPaymentConfirmation(
  db: SupabaseClient,
  input: { confirmationId: string; reviewedBy: string; adminNotes?: string | null },
) {
  const { data, error } = await db.rpc('reject_subscription_payment_confirmation', {
    p_confirmation_id: input.confirmationId,
    p_reviewed_by: input.reviewedBy,
    p_admin_notes: input.adminNotes ?? null,
  });
  if (error) throw error;
  return data;
}

export async function cancelSubscriptionPaymentRequest(db: SupabaseClient, requestId: string) {
  const { data, error } = await db.rpc('cancel_subscription_payment_request', { p_request_id: requestId });
  if (error) throw error;
  return data;
}

export async function deleteSubscriptionPlan(db: SupabaseClient, planId: string) {
  const { data, error } = await db.rpc('delete_unused_subscription_plan', { p_plan_id: planId });
  if (error) throw error;
  return data;
}

export interface BulkSubscriptionStudentRow {
  email: string;
  full_name?: string | null;
  duration_months?: number | string | null;
  amount?: number | string | null;
  currency?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  notes?: string | null;
}

export async function bulkAssignSubscriptionStudents(
  db: SupabaseClient,
  input: {
    planId: string;
    mode: 'request' | 'paid';
    batchId: string;
    rows: BulkSubscriptionStudentRow[];
    defaults: {
      durationMonths: number;
      amount: number;
      currency: string;
      dueDate?: string | null;
      paymentMethod?: string | null;
      paymentReference?: string | null;
      notes?: string | null;
    };
    createdBy: string;
  },
) {
  const result = {
    requested: 0,
    activated: 0,
    newAccounts: 0,
    existingStudents: 0,
    paymentEmailsSent: 0,
    errors: [] as { row: number; email: string; error: string }[],
    warnings: [] as { row: number; email: string; warning: string }[],
  };
  const seen = new Set<string>();
  const activationPaymentIds: string[] = [];

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const email = String(row.email ?? '').trim().toLowerCase();
    let provisioned: { studentId: string; isNewAccount: boolean } | null = null;
    try {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required.');
      if (seen.has(email)) throw new Error('Duplicate email in this import.');
      seen.add(email);

      const durationMonths = Number(row.duration_months || input.defaults.durationMonths);
      const amount = Number(row.amount || input.defaults.amount);
      const currency = String(row.currency || input.defaults.currency).trim().toUpperCase();
      const dueDate = String(row.due_date || input.defaults.dueDate || '').trim();
      const paymentMethod = String(row.payment_method || input.defaults.paymentMethod || '').trim() || null;
      const paymentReference = String(row.payment_reference || input.defaults.paymentReference || '').trim() || null;
      const notes = String(row.notes || input.defaults.notes || '').trim() || null;
      if (![1, 3, 6, 12].includes(durationMonths)) throw new Error('Duration must be 1, 3, 6, or 12 months.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0.');
      if (!currency) throw new Error('Currency is required.');
      if (input.mode === 'request') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) throw new Error('Due date must use YYYY-MM-DD.');
        if (dueDate < new Date().toISOString().slice(0, 10)) throw new Error('Due date cannot be in the past.');
      }

      provisioned = await provisionIndividualStudent(db, { email, fullName: row.full_name, notify: false, claimModel: false });
      let request: any = null;
      let purchase: any = null;
      if (input.mode === 'request') {
        request = await createSubscriptionPaymentRequest(db, {
          studentId: provisioned.studentId,
          planId: input.planId,
          durationMonths: durationMonths as 1 | 3 | 6 | 12,
          amount,
          currency,
          dueDate,
          createdBy: input.createdBy,
        });
        result.requested += 1;
      } else {
        purchase = await purchaseOrRenewSubscription(db, {
          studentId: provisioned.studentId,
          planId: input.planId,
          durationMonths: durationMonths as 1 | 3 | 6 | 12,
          amount,
          currency,
          idempotencyKey: `bulk-subscription:${input.batchId}:${email}`,
          paymentMethod,
          paymentReference,
          notes,
          createdBy: input.createdBy,
        });
        result.activated += 1;
        // Every payment id is collected, including ones the RPC reports as already
        // processed: a previous run may have committed the payment and then failed to
        // deliver, and that learner still needs their email. The delivery stamp on each
        // payment decides what actually gets sent, so a fully successful re-run sends
        // nothing. Collected rather than sent per learner because a large import would
        // otherwise make one API call per row and trip Resend's rate limit.
        // Every payment id, regardless of whether the account is new: the sender decides
        // from durable state whether the learner gets the combined welcome or the plan-only
        // notice, so this no longer has to guess.
        if (purchase.paymentId) {
          activationPaymentIds.push(purchase.paymentId);
        }
      }
      if (provisioned.isNewAccount) result.newAccounts += 1;
      else result.existingStudents += 1;

      if (provisioned.isNewAccount) await addToResendAudience({ email, name: row.full_name });

      // Paid rows are mailed together after the loop. Request rows are mailed here; the
      // sender picks the combined welcome or the request-only notice from durable state.
      if (input.mode === 'request') {
        try {
          const { sent } = await notifySubscriptionPaymentRequest(db, { requestId: request.requestId });
          if (sent) result.paymentEmailsSent += 1;
        } catch (emailError: any) {
          result.warnings.push({ row: index + 1, email, warning: `Payment request created, but notification email failed: ${emailError.message ?? 'Unknown error'}` });
        }
      }
    } catch (error: any) {
      if (provisioned?.isNewAccount) await db.auth.admin.deleteUser(provisioned.studentId).catch(() => {});
      result.errors.push({ row: index + 1, email, error: error.message ?? 'Import failed' });
    }
  }

  // Sent once for the whole import. A failure here must not undo any subscription that
  // was already committed, so it is reported as a warning against the batch.
  if (activationPaymentIds.length) {
    try {
      const { sent, failed } = await notifySubscriptionActivatedBatch(db, {
        paymentIds: activationPaymentIds,
      });
      result.paymentEmailsSent += sent;
      if (failed > 0) {
        result.warnings.push({
          row: 0,
          email: '',
          warning: `${failed} learner email${failed === 1 ? '' : 's'} could not be sent and will be retried automatically.`,
        });
      }
    } catch (emailError: any) {
      result.warnings.push({
        row: 0,
        email: '',
        warning: `Subscriptions were activated, but some confirmation emails could not be sent: ${emailError.message ?? 'Unknown error'}. Re-running this import will retry only the learners who were not emailed.`,
      });
    }
  }

  return result;
}
