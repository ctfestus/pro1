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
import { PURCHASABLE_CONTENT_TABLES } from '@/lib/subscription-plan-access';
import { revalidatePricingPage } from '@/lib/revalidate-pricing';
import { isIndividualCohort } from '@/lib/cohort-kind';
import { notifySubscriptionPaymentRequest } from '@/lib/notify-subscription-payment-request';
import { notifySubscriptionActivated } from '@/lib/notify-subscription-activated';
import { provisionIndividualStudent } from '@/lib/provision-individual-student';
import { addToResendAudience } from '@/lib/resend-audience';
import { PaymentError, paymentErrorResponse } from '@/lib/payment-errors';
import { getPaystackReviewQueue } from '@/lib/paystack-review-queue';
import { assertNothingCollected } from '@/lib/paystack-subscriptions';
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
  getOpenPaystackCarts,
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

async function ownedPlanIds(db: ReturnType<typeof adminClient>, user: { id: string; role: string }) {
  if (user.role === 'admin') return null;
  const { data, error } = await db.from('subscription_plans').select('id').eq('created_by', user.id);
  if (error) throw error;
  return (data ?? []).map(plan => plan.id as string);
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

  if (action === 'payment-review') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const db = adminClient();
      // Instructors see the payments on plans they own; admins see everything, including events
      // that could not be matched to any plan.
      const planIds = await ownedPlanIds(db, sessionUser);
      return NextResponse.json(await getPaystackReviewQueue(db, { planIds }));
    } catch (err: any) {
      console.error('[payments/payment-review]', err);
      return NextResponse.json({ error: 'Failed to load the payment review queue' }, { status: 500 });
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
      const db = adminClient();
      const planIds = await ownedPlanIds(db, sessionUser);
      return NextResponse.json({
        plans: await getSubscriptionPlans(
          db,
          req.nextUrl.searchParams.get('activeOnly') === 'true',
          planIds,
          req.nextUrl.searchParams.get('includeArchived') === 'true',
        ),
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load subscription plans' }, { status: 500 });
    }
  }

  // Which plans already include one piece of content, for the picker in the content editors.
  // The existing plan-content action answers the opposite question -- what is in one plan -- and
  // asking it once per plan to fill a checkbox list would be a request per plan on every open.
  if (action === 'content-plans') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const contentTable = req.nextUrl.searchParams.get('contentTable') ?? '';
    const contentId = req.nextUrl.searchParams.get('contentId') ?? '';
    if (!PURCHASABLE_CONTENT_TABLES.has(contentTable) || !contentId) {
      return NextResponse.json({ error: 'contentTable and contentId are required' }, { status: 400 });
    }
    try {
      const db = adminClient();
      const planIds = await ownedPlanIds(db, sessionUser);
      let query = db.from('subscription_plan_content')
        .select('plan_id, notified_at')
        .eq('content_table', contentTable)
        .eq('content_id', contentId);
      // Scoped the same way every other subscription read is: someone who manages a subset of
      // plans is told about that subset, not about every plan on the platform.
      if (planIds) query = query.in('plan_id', planIds);
      // The content's own eligibility comes back with it. The editors store status and the
      // open-to-everyone flag in seven different shapes, and passing them in from each one would
      // put the same rule in seven places for the server to overrule anyway.
      // All four content tables carry available_to_everyone. Reading it for only two left the
      // picker blind for the other two, so it never offered to close open access and the
      // request was refused instead.
      const eligibilityCols = 'status, available_to_everyone';
      const [{ data, error }, { data: content, error: contentError }] = await Promise.all([
        query,
        db.from(contentTable).select(eligibilityCols).eq('id', contentId).maybeSingle(),
      ]);
      if (error) throw error;
      if (contentError) throw contentError;
      return NextResponse.json({
        planIds: (data ?? []).map(row => row.plan_id),
        notifiedPlanIds: (data ?? []).filter(row => row.notified_at).map(row => row.plan_id),
        contentStatus: (content as any)?.status ?? null,
        availableToEveryone: (content as any)?.available_to_everyone ?? null,
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to load plans for this content' }, { status: 500 });
    }
  }

  if (action === 'subscription-list') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['instructor', 'admin'].includes(sessionUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
      const db = adminClient();
      const planIds = await ownedPlanIds(db, sessionUser);
      // Only the subscription list is owner-scoped. Eligibility is a fact about the student --
      // no cohort, no subscription, no open payment request -- and does not belong to a plan or
      // to whoever is asking, so an instructor sees exactly the same learners here as an admin.
      // Gating it on `planIds === null` meant "admin only", which left every instructor with an
      // empty learner dropdown on a form they are allowed to submit. Ownership still scopes the
      // plans and subscriptions themselves, and every write in POST.
      const [subscriptions, eligibleStudents] = await Promise.all([
        getSubscriptions(db, planIds),
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
      const db = adminClient();
      const planIds = await ownedPlanIds(db, sessionUser);
      // Carts ride along with the requests: both are things holding a learner up, and a cart is
      // the one staff previously could not see at all.
      const [requests, carts] = await Promise.all([
        getSubscriptionPaymentRequests(db, planIds),
        getOpenPaystackCarts(db, planIds),
      ]);
      return NextResponse.json({ requests, carts });
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
      const planIds = await ownedPlanIds(db, sessionUser);
      const subscription = studentId ? await getSubscriptionForStudent(db, studentId) : null;
      if (planIds && subscription && !planIds.includes(subscription.plan_id)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (action === 'subscription-status') return NextResponse.json({ subscription });
      if (action === 'subscription-history' && !subscription) return NextResponse.json({ payments: [] });
      if (action === 'subscription-history') {
        return NextResponse.json({ payments: await getSubscriptionHistory(db, subscription!.id) });
      }

      if (planIds && !planIds.includes(planId!)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

  // Every subscription action below reaches the database through the service role, which bypasses
  // RLS entirely. The role check at the top of this handler admits any instructor, so without an
  // owner check here an instructor can rename, deactivate, delete, reprice, or cancel another
  // instructor's plans and subscriptions. Admins keep full reach.
  async function assertPlanAccess(planId: string) {
    if (sessionUser!.role === 'admin') return;
    const { data: plan, error } = await db.from('subscription_plans')
      .select('id, created_by').eq('id', planId).maybeSingle();
    if (error) throw error;
    if (!plan) throw new PaymentError('not_found', 'Subscription plan not found', 404);
    if (plan.created_by !== sessionUser!.id) {
      throw new PaymentError('forbidden', 'This subscription plan belongs to another instructor.', 403);
    }
  }

  async function assertPlanReadyForActivation(planId: string) {
    const [{ data: prices, error: priceError }, { data: links, error: linkError }] = await Promise.all([
      db.from('subscription_plan_prices').select('id').eq('plan_id', planId).eq('is_active', true).limit(1),
      db.from('subscription_plan_content').select('content_table, content_id').eq('plan_id', planId),
    ]);
    if (priceError) throw priceError;
    if (linkError) throw linkError;
    if (!prices?.length) {
      throw new PaymentError('conflict', 'Add at least one active price before activating this plan.', 409);
    }
    if (!links?.length) {
      throw new PaymentError('conflict', 'Add at least one published content item before activating this plan.', 409);
    }

    const supportedTables = new Set(['courses', 'virtual_experiences', 'certifications', 'learning_paths']);
    const contentByTable = new Map<string, string[]>();
    for (const link of links) {
      if (!supportedTables.has(link.content_table)) continue;
      const ids = contentByTable.get(link.content_table) ?? [];
      ids.push(link.content_id);
      contentByTable.set(link.content_table, ids);
    }
    for (const [table, ids] of contentByTable) {
      const { data: published, error } = await db.from(table)
        .select('id')
        .in('id', ids)
        .eq('status', 'published')
        .limit(1);
      if (error) throw error;
      if (published?.length) return;
    }
    throw new PaymentError(
      'conflict',
      'This plan has attached content, but none of it is published. Publish an attached item or add another published item before activating the plan.',
      409,
    );
  }

  async function assertSubscriptionAccess(subscriptionId: string) {
    if (sessionUser!.role === 'admin') return;
    const { data: subscription, error } = await db.from('individual_subscriptions')
      .select('id, plan_id').eq('id', subscriptionId).maybeSingle();
    if (error) throw error;
    if (!subscription) throw new PaymentError('not_found', 'Subscription not found', 404);
    await assertPlanAccess(subscription.plan_id);
  }

  async function assertRequestAccess(requestId: string) {
    if (sessionUser!.role === 'admin') return;
    const { data: request, error } = await db.from('subscription_payment_requests')
      .select('id, plan_id').eq('id', requestId).maybeSingle();
    if (error) throw error;
    if (!request) throw new PaymentError('not_found', 'Payment request not found', 404);
    await assertPlanAccess(request.plan_id);
  }

  async function assertConfirmationAccess(confirmationId: string) {
    if (sessionUser!.role === 'admin') return;
    const { data: confirmation, error } = await db.from('subscription_payment_confirmations')
      .select('id, request_id').eq('id', confirmationId).maybeSingle();
    if (error) throw error;
    if (!confirmation) throw new PaymentError('not_found', 'Payment confirmation not found', 404);
    await assertRequestAccess(confirmation.request_id);
  }

  function ownershipFailure(err: unknown, fallback: string) {
    const failure = paymentErrorResponse(err, fallback);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }

  if (body.action === 'resolve-paystack-incident') {
    if (!body.incidentId) return NextResponse.json({ error: 'incidentId is required' }, { status: 400 });
    try {
      const { data: incident, error } = await db.from('paystack_review_incidents')
        .select('id, plan_id, status')
        .eq('id', body.incidentId)
        .maybeSingle();
      if (error) throw error;
      if (!incident) throw new PaymentError('not_found', 'Payment incident not found', 404);
      if (sessionUser.role !== 'admin') {
        if (!incident.plan_id) throw new PaymentError('forbidden', 'This incident requires an administrator.', 403);
        await assertPlanAccess(incident.plan_id);
      }
      const { data: result, error: resolveError } = await db.rpc('resolve_paystack_review_incident', {
        p_incident_id: incident.id,
        p_actor_id: sessionUser.id,
        p_resolution_note: String(body.resolutionNote || '').trim() || null,
      });
      if (resolveError) throw resolveError;
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to resolve payment incident');
      console.error('[payments/resolve-paystack-incident]', err);
      return NextResponse.json({ error: 'Failed to resolve payment incident' }, { status: 500 });
    }
  }

  if (body.action === 'create-subscription-plan') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'Plan name is required' }, { status: 400 });
    try {
      const created = await createSubscriptionPlan(db, {
        name: body.name,
        description: body.description,
        createdBy: sessionUser.id,
      });
      revalidatePricingPage();
      return NextResponse.json(created);
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to create subscription plan' }, { status: 500 });
    }
  }

  if (body.action === 'delete-subscription-plan') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    try {
      await assertPlanAccess(String(body.planId));
      const deleted = await deleteSubscriptionPlan(db, body.planId);
      revalidatePricingPage();
      return NextResponse.json(deleted);
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to delete subscription plan');
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
      // A plan that is switched off is not on the pricing page, so it must not keep the one
      // best-value mark the platform allows -- nothing in the list would explain why the badge
      // could not be given to anything else.
      if (body.status === 'inactive') updates.recommended = false;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No plan changes were provided' }, { status: 400 });
    }
    try {
      await assertPlanAccess(String(body.planId));
      // An archived plan cannot be switched back on. It would be on sale while hidden from the
      // list that shows what is on sale, so nobody would see they were still selling it. The
      // database refuses this too; this is here to say why rather than surface a constraint.
      if (updates.status === 'active') {
        const { data: plan, error: readError } = await db.from('subscription_plans')
          .select('archived_at').eq('id', body.planId).maybeSingle();
        if (readError) throw readError;
        if (plan?.archived_at) {
          return NextResponse.json({
            error: 'This plan is archived. Restore it before switching it back on.',
          }, { status: 409 });
        }
      }
      if (body.status === 'active') await assertPlanReadyForActivation(String(body.planId));
      const { error } = await db.from('subscription_plans').update(updates).eq('id', body.planId);
      if (error) throw error;
      // Deactivating is the case that sent us looking: without this the public page kept
      // advertising the plan, buy button and all, until the cache timer ran out.
      revalidatePricingPage();
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to update subscription plan');
      return NextResponse.json({ error: err.message ?? 'Failed to update subscription plan' }, { status: 500 });
    }
  }

  // Putting a finished plan out of the way, or taking it back out. A plan with any history
  // cannot be deleted -- that would orphan the record of what people paid -- so this is the only
  // way the list ever gets shorter.
  // Which plan the pricing page puts in front of people. At most one, so marking a new one
  // clears the old: the database enforces that too, and racing this without clearing first would
  // fail on the unique index rather than silently keeping two.
  // Which plan the pricing page puts in front of people. One at a time, so marking a new one
  // takes it from whoever holds it -- which is why this is a single database call rather than a
  // clear followed by a set. Split in two, a failure between them left nothing marked at all,
  // and two people doing it at once could collide on the unique index.
  if (body.action === 'set-subscription-plan-recommended') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    try {
      const { data, error } = await db.rpc('set_recommended_subscription_plan', {
        p_plan_id: String(body.planId),
        p_actor_id: sessionUser.id,
        p_is_admin: sessionUser.role === 'admin',
        p_recommended: body.recommended === true,
      });
      if (error) throw error;

      const result = (data ?? {}) as { ok?: boolean; code?: string; planName?: string; recommended?: boolean };
      if (result.ok !== true) {
        // Each refusal names what to do next; the function decided, this only puts it in words.
        const said: Record<string, [string, number]> = {
          not_found: ['Subscription plan not found', 404],
          forbidden: ['You do not have permission to manage this plan.', 403],
          archived: ['This plan is archived, so visitors never see it. Restore it first.', 409],
          inactive: ['Activate this plan before marking it as best value.', 409],
          held_by_other: [
            `${result.planName ?? 'Another plan'} is currently marked best value. Ask an administrator to change it.`,
            409,
          ],
        };
        const [message, status] = said[result.code ?? ''] ?? ['Failed to update the best value plan', 500];
        return NextResponse.json({ error: message }, { status });
      }

      revalidatePricingPage();
      return NextResponse.json({ ok: true, recommended: result.recommended === true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Failed to update the best value plan' }, { status: 500 });
    }
  }

  if (body.action === 'set-subscription-plan-archived') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    const archiving = body.archived === true;
    try {
      await assertPlanAccess(String(body.planId));
      const { data: plan, error: readError } = await db.from('subscription_plans')
        .select('status').eq('id', body.planId).maybeSingle();
      if (readError) throw readError;
      if (!plan) return NextResponse.json({ error: 'Subscription plan not found' }, { status: 404 });
      // An active plan is on sale. Archiving one would take it off the pricing page as a side
      // effect of tidying a list, which is not what anyone tidying a list means to do.
      if (archiving && plan.status === 'active') {
        return NextResponse.json({
          error: 'Deactivate this plan before archiving it, so nobody loses a plan that is still on sale.',
        }, { status: 409 });
      }
      const { error } = await db.from('subscription_plans')
        .update({
          archived_at: archiving ? new Date().toISOString() : null,
          // Archiving hides the plan from visitors, so a best-value mark on it would point at a
          // card nobody can see -- and would hold the one mark the platform allows.
          ...(archiving ? { recommended: false } : {}),
        })
        .eq('id', body.planId);
      if (error) throw error;
      // Nothing on sale changes today -- archiving requires the plan to be inactive already, and
      // restoring leaves it inactive. Cleared regardless, so the rule stays "every plan write
      // clears the page" with no exception anyone has to keep true. One recomputation on a rare
      // admin action is cheaper than a reader deciding whether the reasoning still holds.
      revalidatePricingPage();
      return NextResponse.json({ ok: true, archived: archiving });
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to archive subscription plan');
      return NextResponse.json({ error: err.message ?? 'Failed to archive subscription plan' }, { status: 500 });
    }
  }

  if (body.action === 'save-subscription-plan-prices') {
    if (!body.planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    if (!Array.isArray(body.prices)) return NextResponse.json({ error: 'prices must be an array' }, { status: 400 });
    if (body.prices.some((row: any) => ![1, 3, 6, 12].includes(Number(row.durationMonths)))) {
      return NextResponse.json({ error: 'Price duration must be 1, 3, 6, or 12 months.' }, { status: 400 });
    }
    // Nothing an admin filled in gets dropped without being told. Dropping unticked rows deleted
    // an amount someone had just typed, leaving a plan that looked active and could not be bought;
    // dropping blank rows before validating did the same to a duration they had ticked but not
    // priced. So: complain about a ticked row with no amount, keep an unticked row that has one as
    // inactive, and only discard a row that is genuinely empty.
    const submitted = body.prices.map((row: any) => ({
      duration_months: Number(row.durationMonths),
      amount: Number(row.amount),
      currency: String(row.currency || 'GHS').trim().toUpperCase(),
      is_active: row.isActive === true,
      sort_order: Number(row.sortOrder ?? row.durationMonths ?? 0),
    }));
    const priced = (row: any) => Number.isFinite(row.amount) && row.amount > 0;
    const unpricedButActive = submitted.filter((row: any) => row.is_active && !priced(row));
    if (unpricedButActive.length) {
      const durations = unpricedButActive.map((row: any) => `${row.duration_months} mo`).join(', ');
      return NextResponse.json({
        error: `Enter an amount greater than 0 for the durations you switched on (${durations}), or switch them off.`,
      }, { status: 400 });
    }
    const rows = submitted.filter(priced);
    if (rows.some((row: any) => !row.currency)) {
      return NextResponse.json({ error: 'Currency is required for a price.' }, { status: 400 });
    }
    try {
      const { data: plan, error: planError } = await db
        .from('subscription_plans')
        .select('id, created_by')
        .eq('id', body.planId)
        .maybeSingle();
      if (planError) throw planError;
      if (!plan) return NextResponse.json({ error: 'Subscription plan not found' }, { status: 404 });
      if (sessionUser.role !== 'admin' && plan.created_by !== sessionUser.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const { error: replaceError } = await db.rpc('replace_subscription_plan_prices', {
        p_plan_id: body.planId,
        p_prices: rows,
        p_actor_id: sessionUser.id,
      });
      if (replaceError) throw replaceError;
      revalidatePricingPage();
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[payments/save-subscription-plan-prices]', err);
      return NextResponse.json({ error: 'Failed to save plan prices' }, { status: 500 });
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
      // Before provisioning: this creates a learner account, so a rejected request should not
      // leave one behind.
      await assertPlanAccess(String(body.planId));
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
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to assign the new subscriber');
      if (provisioned?.isNewAccount) {
        await db.auth.admin.deleteUser(provisioned.studentId).catch(() => {});
      }
      if (err?.code === '55006') {
        return NextResponse.json({
          error: 'This learner has an online checkout open. Ask them to finish or clear it before assigning payment terms.',
        }, { status: 409 });
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
      await assertPlanAccess(String(body.planId));
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
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to create subscription payment request');
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
      await assertPlanAccess(String(body.planId));
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
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to assign subscription payment');
      if (err?.code === '55006') {
        return NextResponse.json({
          error: 'This learner has an online checkout open. Ask them to finish or clear it before assigning payment terms.',
        }, { status: 409 });
      }
      const conflict = err?.code === '23505'
        || String(err?.message ?? '').includes('before assigning');
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
      await assertPlanAccess(String(body.planId));
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
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to import subscription students');
      return NextResponse.json({ error: err.message ?? 'Failed to import subscription students' }, { status: 500 });
    }
  }

  if (body.action === 'approve-subscription-confirmation' || body.action === 'reject-subscription-confirmation') {
    if (!body.confirmationId) return NextResponse.json({ error: 'confirmationId is required' }, { status: 400 });
    if (body.action === 'reject-subscription-confirmation' && !String(body.adminNotes || '').trim()) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });
    }
    try {
      await assertConfirmationAccess(String(body.confirmationId));
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
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to review subscription confirmation');
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('already been processed');
      return NextResponse.json({ error: err.message ?? 'Failed to review subscription confirmation' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'cancel-subscription-payment-request') {
    if (!body.requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    try {
      await assertRequestAccess(String(body.requestId));

      // Cancelling releases any checkout this request opened, so the learner is not left blocked
      // by something neither of you can see. Paystack decides whether that is safe: a checkout it
      // reports as paid or still in flight is settled here and moves out of 'initialized', which
      // is the only status the cancel releases. Refuse rather than cancel in that case -- closing
      // the invoice underneath a payment that went through is how it ends up needing reconciling
      // by hand.
      await assertNothingCollected(db, { requestId: String(body.requestId) }, 'Their');

      return NextResponse.json(await cancelSubscriptionPaymentRequest(db, body.requestId));
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to cancel payment request');
      return NextResponse.json({ error: err.message ?? 'Failed to cancel payment request' }, { status: 409 });
    }
  }

  // Clearing an unfinished checkout on a learner's behalf. Nothing in the dashboard could do this,
  // so the only remedy for somebody stuck behind their own cart was a database edit. Same rule as
  // the learner's own Remove button, asked of the same guard: closing it frees them to start
  // paying again, so nothing may have been collected against it.
  if (body.action === 'clear-student-cart') {
    const reference = String(body.reference || '').trim();
    if (!reference) return NextResponse.json({ error: 'reference is required' }, { status: 400 });
    try {
      const { data: cart, error } = await db.from('paystack_subscription_transactions')
        .select('reference, student_id, plan_id').eq('reference', reference).maybeSingle();
      if (error) throw error;
      if (!cart?.student_id) throw new PaymentError('not_found', 'That checkout could not be found.', 404);
      await assertPlanAccess(cart.plan_id);
      await assertNothingCollected(db, { reference }, 'Their');
      // Staff have their own closer. The learner's refuses anything with a request attached, which
      // is right for them and wrong here: a checkout stranded by an invoice that was cancelled or
      // paid is exactly the row staff need to clear and the learner cannot see at all.
      const { data: result, error: clearError } = await db.rpc('clear_paystack_checkout_for_staff', {
        p_reference: reference,
        p_actor_id: sessionUser.id,
      });
      if (clearError) throw clearError;
      if (result?.ok !== true) {
        throw new PaymentError(
          'conflict',
          result?.status === 'not_found'
            ? 'That checkout could not be found.'
            : result?.status === 'request_still_open'
            ? 'That checkout belongs to an open payment request. Cancel the request instead.'
            : 'This payment is already being processed and cannot be cleared.',
          result?.status === 'not_found' ? 404 : 409,
        );
      }
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return ownershipFailure(err, 'Failed to clear that checkout');
    }
  }

  if (body.action === 'change-subscription-plan') {
    if (!body.subscriptionId || !body.planId) {
      return NextResponse.json({ error: 'subscriptionId and planId are required' }, { status: 400 });
    }
    try {
      // Both ends: the subscription being moved and the plan it is moving to.
      await assertSubscriptionAccess(String(body.subscriptionId));
      await assertPlanAccess(String(body.planId));
      return NextResponse.json(await changeSubscriptionPlan(db, {
        subscriptionId: body.subscriptionId,
        planId: body.planId,
        changedBy: sessionUser.id,
        notes: body.notes,
      }));
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to change subscription plan');
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('not active');
      return NextResponse.json({ error: err.message ?? 'Failed to change subscription plan' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'cancel-subscription') {
    if (!body.subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }
    try {
      await assertSubscriptionAccess(String(body.subscriptionId));
      return NextResponse.json(await cancelSubscription(db, body.subscriptionId));
    } catch (err: any) {
      if (err instanceof PaymentError) return ownershipFailure(err, 'Failed to cancel subscription');
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
