import { NextRequest, NextResponse, after } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { paymentConfirmationApprovedEmail, paymentConfirmationRejectedEmail, overdueNotificationEmail } from '@/lib/email-templates';
import {
  getEnrollmentRows,
  recordPayment,
  markOutstanding,
  restoreAccess,
  getPaymentHistory,
  editPayment,
  deletePayment,
  recomputeEnrollmentAccessPublic,
} from '@/lib/db-payments';
import { isIndividualCohort } from '@/lib/cohort-kind';
import { notifySubscriptionPaymentRequest } from '@/lib/notify-subscription-payment-request';
import { notifySubscriptionActivated } from '@/lib/notify-subscription-activated';
import { provisionIndividualStudent } from '@/lib/provision-individual-student';
import { addToResendAudience } from '@/lib/resend-audience';
import {
  cancelSubscription,
  cancelSubscriptionPaymentRequest,
  bulkAssignSubscriptionStudents,
  changeSubscriptionPlan,
  createSubscriptionPaymentRequest,
  createSubscriptionPlan,
  deleteSubscriptionPlan,
  getEligibleSubscriptionStudents,
  getSubscriptionForStudent,
  getSubscriptionHistory,
  getSubscriptionPlans,
  getSubscriptions,
  getSubscriptionPaymentRequests,
  approveSubscriptionPaymentConfirmation,
  rejectSubscriptionPaymentConfirmation,
  purchaseOrRenewSubscription,
} from '@/lib/db-subscriptions';

const resend = new Resend(process.env.RESEND_API_KEY);

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

async function getSessionUser(req: NextRequest): Promise<{ id: string; email: string; role: string } | null> {
  const auth = await requireUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  const { data: student } = await auth.getActorDb()
    .from('students')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase(), role: student?.role ?? 'student' };
}

// -- GET --

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');

  if (action === 'installments') {
    const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const { data, error } = await db
        .from('payment_installments')
        .select('id, due_date, amount_due, amount_paid, status')
        .eq('enrollment_id', enrollmentId)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return NextResponse.json({ installments: data ?? [] });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load installments' }, { status: 500 });
    }
  }

  if (action === 'history') {
    const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const payments = await getPaymentHistory(db, enrollmentId);
      return NextResponse.json({ payments });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load payment history' }, { status: 500 });
    }
  }

  if (action === 'summary') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
      const db = adminClient();
      const { rows, cohorts } = await getEnrollmentRows(db);
      return NextResponse.json({ rows, cohorts });
    } catch (err: any) {
      console.error('[payments/summary]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to load payment data' }, { status: 500 });
    }
  }

  if (action === 'confirmations') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const { data, error } = await db
        .from('student_payment_confirmations')
        .select(`
          id, amount, paid_at, method, reference, notes, receipt_url,
          status, admin_notes, reviewed_at, created_at,
          enrollment_id, cohort_id,
          students!student_id ( full_name, email ),
          cohorts ( name )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ confirmations: data ?? [] });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load confirmations' }, { status: 500 });
    }
  }

  if (action === 'payment-options') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const { data, error } = await db
        .from('payment_options')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return NextResponse.json({ options: data ?? [] });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load payment options' }, { status: 500 });
    }
  }

  if (action === 'payment-config') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const { data, error } = await db
        .from('payment_config')
        .select('outstanding_cohort_id')
        .eq('id', 'default')
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ config: data ?? {} });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load payment config' }, { status: 500 });
    }
  }

  if (action === 'grace-periods') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      const { data, error } = await db
        .from('cohort_payment_settings')
        .select('cohort_id, grace_period_days');
      if (error) throw error;
      return NextResponse.json({ gracePeriods: data ?? [] });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load grace periods' }, { status: 500 });
    }
  }

  if (action === 'subscription-plans') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
      return NextResponse.json({ plans: await getSubscriptionPlans(adminClient(), req.nextUrl.searchParams.get('activeOnly') === 'true') });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load subscription plans' }, { status: 500 });
    }
  }

  if (action === 'subscription-list') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
      const db = adminClient();
      const [subscriptions, eligibleStudents] = await Promise.all([
        getSubscriptions(db),
        getEligibleSubscriptionStudents(db),
      ]);
      return NextResponse.json({ subscriptions, eligibleStudents });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load subscriptions' }, { status: 500 });
    }
  }

  if (action === 'subscription-payment-requests') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
      return NextResponse.json({ requests: await getSubscriptionPaymentRequests(adminClient()) });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load subscription payment requests' }, { status: 500 });
    }
  }

  if (action === 'subscription-status' || action === 'subscription-history' || action === 'subscription-plan-content') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const studentId = req.nextUrl.searchParams.get('studentId');
    const planId = req.nextUrl.searchParams.get('planId');
    if (action !== 'subscription-plan-content' && !studentId) return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
    if (action === 'subscription-plan-content' && !planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });

    try {
      const db = adminClient();
      const subscription = studentId ? await getSubscriptionForStudent(db, studentId) : null;
      if (action === 'subscription-status') return NextResponse.json({ subscription });
      if (action === 'subscription-history' && !subscription) return NextResponse.json({ payments: [] });
      if (action === 'subscription-history') {
        return NextResponse.json({ payments: await getSubscriptionHistory(db, subscription!.id) });
      }

      const { data: coverage, error } = await db
        .from('subscription_plan_content')
        .select('id, content_table, content_id, added_at, notified_at')
        .eq('plan_id', planId)
        .order('added_at', { ascending: false });
      if (error) throw error;

      const resolved: any[] = [];
      for (const table of ['courses', 'virtual_experiences', 'certifications', 'learning_paths']) {
        const rows = (coverage ?? []).filter(row => row.content_table === table);
        if (rows.length === 0) continue;
        const { data: titles, error: titleError } = await db
          .from(table)
          .select('id, title')
          .in('id', rows.map(row => row.content_id));
        if (titleError) throw titleError;
        const titleMap = new Map((titles ?? []).map(row => [row.id, row.title]));
        for (const row of rows) {
          const title = titleMap.get(row.content_id);
          if (title) resolved.push({ ...row, title });
        }
      }
      return NextResponse.json({ content: resolved });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load subscription data' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// -- POST --

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['instructor', 'admin'].includes(sessionUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = adminClient();

  if (body.action === 'create-subscription-plan') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'Plan name is required' }, { status: 400 });
    try {
      return NextResponse.json(await createSubscriptionPlan(db, {
        name: body.name,
        description: body.description,
        createdBy: sessionUser.id,
      }));
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to create subscription plan' }, { status: 500 });
    }
  }

  if (body.action === 'delete-subscription-plan') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    try {
      return NextResponse.json(await deleteSubscriptionPlan(db, body.planId));
    } catch (err: any) {
      const conflict = String(err?.message ?? '').includes('cannot be deleted');
      return NextResponse.json({ error: err.message ?? 'Failed to delete subscription plan' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'update-subscription-plan') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'Plan name cannot be empty' }, { status: 400 });
      updates.name = name;
    }
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.status !== undefined) {
      if (!['active', 'inactive'].includes(body.status)) {
        return NextResponse.json({ error: 'status must be active or inactive' }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No plan changes were provided' }, { status: 400 });
    }
    try {
      const { error } = await db.from('subscription_plans').update(updates).eq('id', body.planId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to update subscription plan' }, { status: 500 });
    }
  }

  if (body.action === 'assign-new-subscription-student') {
    const mode = body.mode === 'paid' ? 'paid' : body.mode === 'request' ? 'request' : null;
    const durationMonths = Number(body.durationMonths);
    const amount = Number(body.amount);
    const currency = String(body.currency || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();
    if (!mode) return NextResponse.json({ error: 'Payment workflow must be request or paid' }, { status: 400 });
    if (!body.planId || ![1, 3, 6, 12].includes(durationMonths)) {
      return NextResponse.json({ error: 'planId and a duration of 1, 3, 6, or 12 months are required' }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid learner email is required' }, { status: 400 });
    }
    if (!fullName) return NextResponse.json({ error: 'Learner name is required' }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    if (!currency) return NextResponse.json({ error: 'Currency is required' }, { status: 400 });
    if (mode === 'request') {
      if (!body.dueDate || Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`))) {
        return NextResponse.json({ error: 'A valid payment deadline is required' }, { status: 400 });
      }
      if (body.dueDate < new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'Payment deadline cannot be in the past' }, { status: 400 });
      }
    } else if (!body.idempotencyKey?.trim()) {
      return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
    }

    let provisioned: { studentId: string; isNewAccount: boolean } | null = null;
    try {
      provisioned = await provisionIndividualStudent(db, {
        email,
        fullName,
        notify: false,
        claimModel: false,
      });

      let assignment: any;
      let notificationWarning: string | null = null;
      if (mode === 'request') {
        assignment = await createSubscriptionPaymentRequest(db, {
          studentId: provisioned.studentId,
          planId: body.planId,
          durationMonths: durationMonths as 1 | 3 | 6 | 12,
          amount,
          currency,
          dueDate: body.dueDate,
          createdBy: sessionUser.id,
        });
        // The sender picks the right message from durable state: a learner who cannot sign
        // in yet receives the combined welcome, everyone else the request on its own.
        try {
          await notifySubscriptionPaymentRequest(db, { requestId: assignment.requestId });
        } catch (notificationError: any) {
          notificationWarning = notificationError.message ?? 'Payment notification email failed';
        }
      } else {
        assignment = await purchaseOrRenewSubscription(db, {
          studentId: provisioned.studentId,
          planId: body.planId,
          durationMonths: durationMonths as 1 | 3 | 6 | 12,
          amount,
          currency,
          idempotencyKey: body.idempotencyKey,
          paymentMethod: body.paymentMethod,
          paymentReference: body.paymentReference,
          notes: body.notes,
          createdBy: sessionUser.id,
        });
      }

      let activationWarning: string | null = null;

      if (provisioned.isNewAccount) await addToResendAudience({ email, name: fullName });

      // The request path already mailed above. For the paid path the sender decides which
      // message applies: a learner who cannot sign in yet gets the combined welcome with a
      // setup link, everyone else the access notice. Retries still attempt delivery; the
      // delivery stamps prevent a second copy and the hourly sweep picks up failures.
      if (mode === 'paid' && assignment.paymentId) {
        try {
          await notifySubscriptionActivated(db, { paymentId: assignment.paymentId });
        } catch (emailError: any) {
          activationWarning = emailError.message ?? 'Subscription email failed';
        }
      }

      return NextResponse.json({
        ...assignment,
        studentId: provisioned.studentId,
        isNewAccount: provisioned.isNewAccount,
        notificationWarning,
        activationWarning,
      });
    } catch (err: any) {
      if (provisioned?.isNewAccount) {
        await db.auth.admin.deleteUser(provisioned.studentId).catch(() => {});
      }
      const conflict = err?.code === '23505'
        || String(err?.message ?? '').includes('already belongs')
        || String(err?.message ?? '').includes('before assigning')
        || String(err?.message ?? '').includes('idempotency key');
      return NextResponse.json({ error: err.message ?? 'Failed to create and assign learner' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'create-subscription' || body.action === 'renew-subscription') {
    const durationMonths = Number(body.durationMonths);
    const amount = Number(body.amount);
    if (!body.studentId || !body.planId || ![1, 3, 6, 12].includes(durationMonths)) {
      return NextResponse.json({ error: 'studentId, planId, and a duration of 1, 3, 6, or 12 months are required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 });
    }
    if (!body.idempotencyKey?.trim()) {
      return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
    }
    try {
      const result = await purchaseOrRenewSubscription(db, {
        studentId: body.studentId,
        planId: body.planId,
        durationMonths: durationMonths as 1 | 3 | 6 | 12,
        amount,
        currency: String(body.currency || 'GHS'),
        idempotencyKey: body.idempotencyKey,
        paymentMethod: body.paymentMethod,
        paymentReference: body.paymentReference,
        notes: body.notes,
        createdBy: sessionUser.id,
      });
      // Attempted on every request, including a retry the RPC reports as already
      // processed: the first attempt may have committed the payment and then failed to
      // deliver. notifySubscriptionActivated is a no-op once the payment is stamped, so a
      // successful email is never repeated.
      let activationWarning: string | null = null;
      if (result.paymentId) {
        try {
          await notifySubscriptionActivated(db, { paymentId: result.paymentId });
        } catch (emailError: any) {
          activationWarning = emailError.message ?? 'Subscription email failed';
        }
      }
      return NextResponse.json({ ...result, activationWarning });
    } catch (err: any) {
      const conflict = err?.code === '23505'
        || String(err?.message ?? '').includes('already belongs')
        || String(err?.message ?? '').includes('idempotency key');
      return NextResponse.json({ error: err.message ?? 'Failed to save subscription' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'create-subscription-payment-request') {
    const durationMonths = Number(body.durationMonths);
    const amount = Number(body.amount);
    if (!body.studentId || !body.planId || ![1, 3, 6, 12].includes(durationMonths)) {
      return NextResponse.json({ error: 'studentId, planId, and a duration of 1, 3, 6, or 12 months are required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    if (!body.dueDate || Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`))) {
      return NextResponse.json({ error: 'A valid payment deadline is required' }, { status: 400 });
    }
    if (body.dueDate < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: 'Payment deadline cannot be in the past' }, { status: 400 });
    }
    if (!String(body.currency || '').trim()) return NextResponse.json({ error: 'Currency is required' }, { status: 400 });
    try {
      const result = await createSubscriptionPaymentRequest(db, {
        studentId: body.studentId,
        planId: body.planId,
        durationMonths: durationMonths as 1 | 3 | 6 | 12,
        amount,
        currency: String(body.currency || 'GHS'),
        dueDate: body.dueDate,
        createdBy: sessionUser.id,
      });
      try {
        await notifySubscriptionPaymentRequest(db, { requestId: result.requestId });
        return NextResponse.json({ ...result, notificationSent: true });
      } catch (notificationError: any) {
        return NextResponse.json({ ...result, notificationSent: false, notificationWarning: notificationError.message ?? 'Notification email failed' });
      }
    } catch (err: any) {
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('before assigning');
      return NextResponse.json({ error: err.message ?? 'Failed to assign subscription payment' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'bulk-subscription-payment-requests') {
    const mode = body.mode === 'paid' ? 'paid' : 'request';
    const batchId = String(body.batchId || '').trim();
    const durationMonths = Number(body.defaults?.durationMonths);
    const amount = Number(body.defaults?.amount);
    const currency = String(body.defaults?.currency || '').trim();
    const dueDate = String(body.defaults?.dueDate || '').trim();
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 500) {
      return NextResponse.json({ error: 'Provide between 1 and 500 student rows' }, { status: 400 });
    }
    if (![1, 3, 6, 12].includes(durationMonths) || !Number.isFinite(amount) || amount <= 0 || !currency) {
      return NextResponse.json({ error: 'Valid default duration, amount, and currency are required' }, { status: 400 });
    }
    if (mode === 'request' && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)) || dueDate < new Date().toISOString().slice(0, 10))) {
      return NextResponse.json({ error: 'A valid payment deadline that is not in the past is required' }, { status: 400 });
    }
    if (mode === 'paid' && !batchId) {
      return NextResponse.json({ error: 'batchId is required when recording paid subscriptions' }, { status: 400 });
    }
    try {
      return NextResponse.json(await bulkAssignSubscriptionStudents(db, {
        planId: body.planId,
        mode,
        batchId,
        rows: body.rows,
        defaults: {
          durationMonths,
          amount,
          currency,
          dueDate: mode === 'request' ? dueDate : null,
          paymentMethod: body.defaults?.paymentMethod,
          paymentReference: body.defaults?.paymentReference,
          notes: body.defaults?.notes,
        },
        createdBy: sessionUser.id,
      }));
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to import subscription students' }, { status: 500 });
    }
  }

  if (body.action === 'approve-subscription-confirmation' || body.action === 'reject-subscription-confirmation') {
    if (!body.confirmationId) return NextResponse.json({ error: 'confirmationId is required' }, { status: 400 });
    if (body.action === 'reject-subscription-confirmation' && !String(body.adminNotes || '').trim()) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });
    }
    try {
      const result = body.action === 'approve-subscription-confirmation'
        ? await approveSubscriptionPaymentConfirmation(db, { confirmationId: body.confirmationId, reviewedBy: sessionUser.id, adminNotes: body.adminNotes })
        : await rejectSubscriptionPaymentConfirmation(db, { confirmationId: body.confirmationId, reviewedBy: sessionUser.id, adminNotes: body.adminNotes });

      if (process.env.RESEND_API_KEY) {
        // after() runs once the response is sent and is not cut off by the serverless
        // freeze that drops a bare fire-and-forget promise. Approval is the moment access
        // actually starts for the request flow, so this is the learner's only notice.
        after(async () => {
          try {
            // Migration 177 makes a replayed approval return the payment the original
            // approval created, so a failed activation email can be retried by approving
            // again. The delivery stamp stops a successful one being resent.
            const approvedPaymentId = body.action === 'approve-subscription-confirmation'
              ? (result as any)?.paymentId
              : null;
            if (approvedPaymentId) {
              await notifySubscriptionActivated(db, { paymentId: approvedPaymentId });
              return;
            }
            const { data: confirmation } = await db.from('subscription_payment_confirmations')
              .select('amount, student_id, subscription_payment_requests!inner(currency)')
              .eq('id', body.confirmationId).maybeSingle();
            if (!confirmation?.student_id) return;
            const [{ data: student }, settings] = await Promise.all([
              db.from('students').select('full_name,email').eq('id', confirmation.student_id).maybeSingle(),
              getTenantSettings(),
            ]);
            if (!student?.email) return;
            const from = process.env.RESEND_FROM_EMAIL || `${settings.senderName} <${settings.supportEmail}>`;
            const branding = { logoUrl: settings.logoUrl, emailBannerUrl: settings.emailBannerUrl, teamName: settings.teamName, appName: settings.appName, appUrl: settings.appUrl };
            const currency = (confirmation.subscription_payment_requests as any)?.currency || 'GHS';
            const approved = body.action === 'approve-subscription-confirmation';
            await resend.emails.send({
              from, to: student.email,
              subject: approved ? 'Your subscription payment has been approved' : 'Your subscription payment could not be verified',
              html: approved
                ? paymentConfirmationApprovedEmail({ name: student.full_name || 'there', amount: Number(confirmation.amount), currency, dashboardUrl: settings.appUrl, adminNotes: body.adminNotes, branding })
                : paymentConfirmationRejectedEmail({ name: student.full_name || 'there', amount: Number(confirmation.amount), currency, dashboardUrl: settings.appUrl, adminNotes: body.adminNotes, branding }),
            });
          } catch { /* Payment state is authoritative; email is best effort. */ }
        });
      }
      return NextResponse.json(result);
    } catch (err: any) {
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('already been processed');
      return NextResponse.json({ error: err.message ?? 'Failed to review subscription confirmation' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'cancel-subscription-payment-request') {
    if (!body.requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    try {
      return NextResponse.json(await cancelSubscriptionPaymentRequest(db, body.requestId));
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to cancel payment request' }, { status: 409 });
    }
  }

  if (body.action === 'change-subscription-plan') {
    if (!body.subscriptionId || !body.planId) {
      return NextResponse.json({ error: 'subscriptionId and planId are required' }, { status: 400 });
    }
    try {
      return NextResponse.json(await changeSubscriptionPlan(db, {
        subscriptionId: body.subscriptionId,
        planId: body.planId,
        changedBy: sessionUser.id,
        notes: body.notes,
      }));
    } catch (err: any) {
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('not active');
      return NextResponse.json({ error: err.message ?? 'Failed to change subscription plan' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'cancel-subscription') {
    if (!body.subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }
    try {
      return NextResponse.json(await cancelSubscription(db, body.subscriptionId));
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to cancel subscription' }, { status: 500 });
    }
  }

  // record-payment -- insert payment, apply to installments, recompute access
  if (body.action === 'record-payment') {
    const { enrollmentId, amount, paidAt, method, reference, notes } = body;
    if (!enrollmentId || !amount) {
      return NextResponse.json({ error: 'enrollmentId and amount are required' }, { status: 400 });
    }
    try {
      const { data: enroll } = await db
        .from('bootcamp_enrollments')
        .select('student_id, cohort_id, email')
        .eq('id', enrollmentId)
        .single();
      if (!enroll) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

      await recordPayment(db, {
        enrollmentId,
        amount:      Number(amount),
        paidAt,
        method,
        reference,
        notes,
        payerEmail:  enroll.email,
        cohortId:    enroll.cohort_id,
        studentId:   enroll.student_id ?? undefined,
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/record-payment]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to record payment' }, { status: 500 });
    }
  }

  // edit-enrollment -- update fee, plan; recompute access
  // Bootcamp dates are cohort-level and updated via save-settings, not here.
  if (body.action === 'edit-enrollment') {
    const { enrollmentId, total_fee, deposit_required, payment_plan } = body;
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
    try {
      const updates: any = { updated_at: new Date().toISOString() };
      if (total_fee        !== undefined) updates.total_fee        = Number(total_fee);
      if (deposit_required !== undefined) updates.deposit_required = Number(deposit_required);
      if (payment_plan     !== undefined) updates.payment_plan     = payment_plan;

      await db.from('bootcamp_enrollments').update(updates).eq('id', enrollmentId);

      const { data: enroll } = await db
        .from('bootcamp_enrollments')
        .select('cohort_id')
        .eq('id', enrollmentId)
        .single();
      const { data: settings } = await db
        .from('cohort_payment_settings')
        .select('post_bootcamp_access_months')
        .eq('cohort_id', enroll!.cohort_id)
        .maybeSingle();

      await recomputeEnrollmentAccessPublic(db, enrollmentId, settings?.post_bootcamp_access_months ?? 3);

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/edit-enrollment]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to update enrollment' }, { status: 500 });
    }
  }

  // mark-waived -- set payment_plan to waived, recompute access + auto-restore cohort
  if (body.action === 'mark-waived') {
    const { enrollmentId } = body;
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
    try {
      const { data: enroll } = await db
        .from('bootcamp_enrollments')
        .select('cohort_id, student_id')
        .eq('id', enrollmentId)
        .single();
      if (!enroll) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

      await db.from('bootcamp_enrollments').update({
        payment_plan: 'waived',
        updated_at:   new Date().toISOString(),
      }).eq('id', enrollmentId);

      // Set payment_exempt so waived students are never auto-moved to outstanding
      if (enroll.student_id) {
        await db.from('students').update({ payment_exempt: true }).eq('id', enroll.student_id);
      }

      const { data: settings } = await db
        .from('cohort_payment_settings')
        .select('post_bootcamp_access_months')
        .eq('cohort_id', enroll.cohort_id)
        .maybeSingle();

      // recomputeEnrollmentAccessPublic computes access_status='waived' and
      // auto-restores cohort via getOutstandingCohortAction
      await recomputeEnrollmentAccessPublic(db, enrollmentId, settings?.post_bootcamp_access_months ?? 3);

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/mark-waived]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to mark waived' }, { status: 500 });
    }
  }

  // move-to-outstanding -- move student to outstanding cohort, save original_cohort_id
  if (body.action === 'move-to-outstanding') {
    const { studentId, outstandingCohortId } = body;
    if (!studentId || !outstandingCohortId) {
      return NextResponse.json({ error: 'studentId and outstandingCohortId are required' }, { status: 400 });
    }
    try {
      const result = await markOutstanding(db, studentId, outstandingCohortId);
      return NextResponse.json({ ok: true, ...result });
    } catch (err: any) {
      console.error('[payments/move-to-outstanding]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to move student' }, { status: 500 });
    }
  }

  // restore-cohort -- move student back to original cohort
  if (body.action === 'restore-cohort') {
    const { studentId } = body;
    if (!studentId) return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
    try {
      await restoreAccess(db, studentId);
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/restore-cohort]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to restore cohort' }, { status: 500 });
    }
  }

  // toggle-exempt -- grant or revoke payment exemption
  if (body.action === 'toggle-exempt') {
    const { studentId, exempt } = body;
    if (!studentId || typeof exempt !== 'boolean') {
      return NextResponse.json({ error: 'studentId and exempt (boolean) are required' }, { status: 400 });
    }
    try {
      if (exempt) {
        // If student is currently in the outstanding cohort, restore them first
        const { data: student } = await db
          .from('students')
          .select('cohort_id, original_cohort_id')
          .eq('id', studentId)
          .maybeSingle();

        if (student?.original_cohort_id) {
          await db.from('students').update({
            cohort_id:          student.original_cohort_id,
            original_cohort_id: null,
            payment_exempt:     true,
          }).eq('id', studentId);
        } else {
          await db.from('students').update({ payment_exempt: true }).eq('id', studentId);
        }
      } else {
        // Remove exemption then move to outstanding if their payment status warrants it
        await db.from('students').update({ payment_exempt: false }).eq('id', studentId);

        const [{ data: enroll }, { data: config }] = await Promise.all([
          db.from('bootcamp_enrollments')
            .select('access_status')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false })
            .maybeSingle(),
          db.from('payment_config')
            .select('outstanding_cohort_id')
            .eq('id', 'default')
            .maybeSingle(),
        ]);

        const restrictedStatus = ['overdue', 'pending_deposit'].includes(enroll?.access_status ?? '');
        const outstandingCohortId = config?.outstanding_cohort_id;
        if (restrictedStatus && outstandingCohortId) {
          await markOutstanding(db, studentId, outstandingCohortId);
        }
      }
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to update exemption' }, { status: 500 });
    }
  }

  // edit-installment -- update a single installment's due_date
  if (body.action === 'edit-installment') {
    const { installmentId, due_date } = body;
    if (!installmentId || !due_date) {
      return NextResponse.json({ error: 'installmentId and due_date are required' }, { status: 400 });
    }
    try {
      const { error } = await db
        .from('payment_installments')
        .update({ due_date, updated_at: new Date().toISOString() })
        .eq('id', installmentId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to update installment' }, { status: 500 });
    }
  }

  // edit-payment -- update amount/date/method/reference/notes, recompute paid_total + access
  if (body.action === 'edit-payment') {
    const { paymentId, amount, paidAt, method, reference, notes } = body;
    if (!paymentId) return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });
    try {
      await editPayment(db, paymentId, {
        ...(amount    !== undefined && { amount: Number(amount) }),
        ...(paidAt    !== undefined && { paid_at: paidAt }),
        ...(method    !== undefined && { method:    method    ?? null }),
        ...(reference !== undefined && { reference: reference ?? null }),
        ...(notes     !== undefined && { notes:     notes     ?? null }),
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/edit-payment]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to edit payment' }, { status: 500 });
    }
  }

  // delete-payment -- remove record, recompute paid_total + access
  if (body.action === 'delete-payment') {
    const { paymentId } = body;
    if (!paymentId) return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });
    try {
      await deletePayment(db, paymentId);
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/delete-payment]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to delete payment' }, { status: 500 });
    }
  }

  // approve-confirmation -- approve student payment confirmation and record the payment
  if (body.action === 'approve-confirmation') {
    const { confirmationId, adminNotes } = body;
    if (!confirmationId) return NextResponse.json({ error: 'confirmationId is required' }, { status: 400 });
    try {
      // Step 1: Atomically claim the confirmation by flipping pending -> approved.
      // The .eq('status','pending') guard means only one concurrent request can win;
      // any duplicate or retry gets 0 rows back and is rejected before touching payments.
      const { data: conf, error: claimErr } = await db
        .from('student_payment_confirmations')
        .update({
          status:      'approved',
          reviewed_by: sessionUser.id,
          reviewed_at: new Date().toISOString(),
          admin_notes: adminNotes ?? null,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', confirmationId)
        .eq('status', 'pending')
        .select('id, enrollment_id, student_id, cohort_id, amount, paid_at, method, reference, notes')
        .single();

      if (claimErr || !conf) {
        return NextResponse.json({ error: 'Confirmation not found or already processed' }, { status: 409 });
      }

      // Step 2: Record the payment. If this fails, roll back the confirmation to
      // pending so an admin can retry without needing manual DB intervention.
      try {
        const { data: enroll } = await db
          .from('bootcamp_enrollments')
          .select('email')
          .eq('id', conf.enrollment_id)
          .single();
        if (!enroll) throw new Error('Enrollment not found');

        await recordPayment(db, {
          enrollmentId:   conf.enrollment_id,
          amount:         Number(conf.amount),
          paidAt:         conf.paid_at,
          method:         conf.method ?? undefined,
          reference:      conf.reference ?? undefined,
          notes:          conf.notes ?? undefined,
          payerEmail:     enroll.email,
          cohortId:       conf.cohort_id,
          studentId:      conf.student_id ?? undefined,
          confirmationId: conf.id,
        });
      } catch (payErr: any) {
        // Roll back so the confirmation can be retried
        await db
          .from('student_payment_confirmations')
          .update({ status: 'pending', reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() })
          .eq('id', confirmationId);
        throw payErr;
      }

      // Fire-and-forget: notify student of approval
      if (process.env.RESEND_API_KEY) {
        ;(async () => {
          try {
            const [{ data: studentRow }, { data: enroll }, t] = await Promise.all([
              db.from('students').select('full_name').eq('id', conf.student_id).maybeSingle(),
              db.from('bootcamp_enrollments').select('currency, email').eq('id', conf.enrollment_id).single(),
              getTenantSettings(),
            ]);
            const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
            const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
            const studentName  = studentRow?.full_name || 'there';
            const studentEmail = enroll?.email || '';
            const currency     = enroll?.currency ?? 'GHS';
            const dashboardUrl = t.appUrl || process.env.APP_URL || '';
            if (studentEmail) {
              await resend.emails.send({
                from:    FROM,
                to:      studentEmail,
                subject: 'Your payment confirmation has been approved',
                html:    paymentConfirmationApprovedEmail({ name: studentName, amount: Number(conf.amount), currency, dashboardUrl, adminNotes: adminNotes ?? null, branding }),
              });
            }
          } catch { /* non-blocking */ }
        })();
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/approve-confirmation]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to approve confirmation' }, { status: 500 });
    }
  }

  // reject-confirmation -- reject student payment confirmation
  if (body.action === 'reject-confirmation') {
    const { confirmationId, adminNotes } = body;
    if (!confirmationId) return NextResponse.json({ error: 'confirmationId is required' }, { status: 400 });
    try {
      const { data: conf, error: confErr } = await db
        .from('student_payment_confirmations')
        .select('id, status')
        .eq('id', confirmationId)
        .single();
      if (confErr || !conf) return NextResponse.json({ error: 'Confirmation not found' }, { status: 404 });
      if (conf.status !== 'pending') {
        return NextResponse.json({ error: 'Confirmation is not pending' }, { status: 409 });
      }

      const { data: updConf, error: updErr } = await db
        .from('student_payment_confirmations')
        .update({
          status:      'rejected',
          reviewed_by: sessionUser.id,
          reviewed_at: new Date().toISOString(),
          admin_notes: adminNotes ?? null,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', confirmationId)
        .select('student_id, enrollment_id, amount')
        .single();
      if (updErr) throw updErr;

      // Fire-and-forget: notify student of rejection
      if (process.env.RESEND_API_KEY && updConf) {
        ;(async () => {
          try {
            const [{ data: studentRow }, { data: enroll }, t] = await Promise.all([
              db.from('students').select('full_name').eq('id', updConf.student_id).maybeSingle(),
              db.from('bootcamp_enrollments').select('currency, email').eq('id', updConf.enrollment_id).single(),
              getTenantSettings(),
            ]);
            const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
            const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
            const studentName  = studentRow?.full_name || 'there';
            const studentEmail = enroll?.email || '';
            const currency     = enroll?.currency ?? 'GHS';
            const dashboardUrl = t.appUrl || process.env.APP_URL || '';
            if (studentEmail) {
              await resend.emails.send({
                from:    FROM,
                to:      studentEmail,
                subject: 'Your payment confirmation could not be verified',
                html:    paymentConfirmationRejectedEmail({ name: studentName, amount: Number(updConf.amount), currency, dashboardUrl, adminNotes: adminNotes ?? null, branding }),
              });
            }
          } catch { /* non-blocking */ }
        })();
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/reject-confirmation]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to reject confirmation' }, { status: 500 });
    }
  }

  // save-grace-period -- update grace_period_days for a specific cohort
  if (body.action === 'save-grace-period') {
    const { cohortId, gracePeriodDays } = body;
    if (!cohortId) return NextResponse.json({ error: 'cohortId is required' }, { status: 400 });
    let days: number | null = null;
    if (gracePeriodDays !== '' && gracePeriodDays != null) {
      const parsed = Number(gracePeriodDays);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        return NextResponse.json({ error: 'Grace period must be a whole number between 0 and 365.' }, { status: 400 });
      }
      days = parsed;
    }
    try {
      const { data: updated, error } = await db
        .from('cohort_payment_settings')
        .update({ grace_period_days: days, updated_at: new Date().toISOString() })
        .eq('cohort_id', cohortId)
        .select('cohort_id');
      if (error) throw error;
      if (!updated || updated.length === 0) throw new Error('Payment settings for this cohort have not been configured yet. Set them in Payment Settings first.');
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/save-grace-period]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to save grace period' }, { status: 500 });
    }
  }

  // save-payment-config -- upsert global payment behaviour settings
  if (body.action === 'save-payment-config') {
    const { outstandingCohortId } = body;
    try {
      if (outstandingCohortId) {
        const { data: targetCohort } = await db.from('cohorts').select('cohort_kind').eq('id', outstandingCohortId).maybeSingle();
        if (isIndividualCohort(targetCohort?.cohort_kind)) {
          return NextResponse.json({ error: 'A synthetic individual-enrollment cohort cannot be the outstanding cohort -- every overdue student platform-wide would inherit that one student\'s course access.' }, { status: 400 });
        }
      }
      const { error } = await db.from('payment_config').upsert({
        id:                    'default',
        outstanding_cohort_id: outstandingCohortId || null,
        updated_at:            new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/save-payment-config]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to save payment config' }, { status: 500 });
    }
  }

  // save-payment-option -- create or update a global payment option
  if (body.action === 'save-payment-option') {
    const {
      id, label, type, instructions,
      bank_name, account_name, account_number, branch, country,
      mobile_money_number, network,
      payment_link, platform,
      logo_url, is_active, sort_order,
    } = body;
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
    try {
      const payload: any = {
        label,
        type:                type ?? 'bank_transfer',
        instructions:        instructions ?? null,
        bank_name:           bank_name ?? null,
        account_name:        account_name ?? null,
        account_number:      account_number ?? null,
        branch:              branch ?? null,
        country:             country ?? null,
        mobile_money_number: mobile_money_number ?? null,
        network:             network ?? null,
        payment_link:        payment_link ?? null,
        platform:            platform ?? null,
        logo_url:            logo_url ?? null,
        is_active:           typeof is_active === 'boolean' ? is_active : true,
        sort_order:          typeof sort_order === 'number' ? sort_order : 0,
        updated_at:          new Date().toISOString(),
      };
      if (id) {
        const { error } = await db.from('payment_options').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await db.from('payment_options').insert(payload);
        if (error) throw error;
      }
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/save-payment-option]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to save payment option' }, { status: 500 });
    }
  }

  // delete-payment-option -- remove a global payment option
  if (body.action === 'delete-payment-option') {
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    try {
      const { error } = await db.from('payment_options').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/delete-payment-option]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to delete payment option' }, { status: 500 });
    }
  }

  // send-payment-reminder -- email a reminder to a student with an outstanding balance
  if (body.action === 'send-payment-reminder') {
    const { enrollmentId } = body;
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
    try {
      const [{ data: enroll }, t] = await Promise.all([
        db.from('bootcamp_enrollments')
          .select('email, student_id, total_fee, paid_total')
          .eq('id', enrollmentId)
          .single(),
        getTenantSettings(),
      ]);
      if (!enroll) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      const balance = Math.max(0, Number(enroll.total_fee) - Number(enroll.paid_total));
      if (balance <= 0) return NextResponse.json({ error: 'No outstanding balance' }, { status: 400 });
      const email = (enroll.email ?? '').trim().toLowerCase();
      if (!email) return NextResponse.json({ error: 'No email address for this enrollment' }, { status: 400 });
      let studentName = 'there';
      if (enroll.student_id) {
        const { data: s } = await db.from('students').select('full_name').eq('id', enroll.student_id).maybeSingle();
        if (s?.full_name) studentName = s.full_name;
      }
      const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
      const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
      const dashboardUrl = t.appUrl || process.env.APP_URL || '';
      await resend.emails.send({
        from:    FROM,
        to:      email,
        subject: 'Payment reminder - outstanding balance on your account',
        html:    overdueNotificationEmail({ name: studentName, dashboardUrl, branding }),
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/send-payment-reminder]', err);
      return NextResponse.json({ error: err.message ?? 'Failed to send reminder' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
