import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { adminPaymentConfirmationEmail, paymentConfirmationAcknowledgedEmail } from '@/lib/email-templates';
import {
  createPaystackDirectCheckout,
  createPaystackSubscriptionCheckout,
  processPaystackSubscriptionReference,
  assertNothingCollected,
} from '@/lib/paystack-subscriptions';
import { cancelSubscriptionPaymentRequest, createSubscriptionPaymentRequest } from '@/lib/db-subscriptions';
import { PaymentError, paymentErrorResponse } from '@/lib/payment-errors';
import { paystackIsConfigured } from '@/lib/paystack';
import {
  PURCHASABLE_CONTENT_TABLES,
  eligiblePlanIds,
  loadPlansForContent,
} from '@/lib/subscription-plan-access';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

async function caller(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  const { data } = await auth.getActorDb().from('students').select('role').eq('id', auth.user.id).maybeSingle();
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase(), role: data?.role ?? 'student' };
}

async function resolveContent(db: ReturnType<typeof adminClient>, planId?: string | null) {
  if (!planId) return [];
  const { data: coverage, error } = await db.from('subscription_plan_content')
    .select('id, content_table, content_id').eq('plan_id', planId).order('added_at');
  if (error) throw error;
  const resolved: any[] = [];
  for (const table of ['courses', 'virtual_experiences', 'certifications', 'learning_paths']) {
    const rows = (coverage ?? []).filter(row => row.content_table === table);
    if (!rows.length) continue;
    const { data: titles, error: titleError } = await db.from(table).select('id, title').in('id', rows.map(row => row.content_id));
    if (titleError) throw titleError;
    const names = new Map((titles ?? []).map(row => [row.id, row.title]));
    rows.forEach(row => { const title = names.get(row.content_id); if (title) resolved.push({ ...row, title }); });
  }
  return resolved;
}

export async function GET(req: NextRequest) {
  const session = await caller(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requestedId = req.nextUrl.searchParams.get('studentId');
  if (requestedId && requestedId !== session.id && !['admin', 'instructor'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const studentId = requestedId || session.id;
  const db = adminClient();
  const contentTable = req.nextUrl.searchParams.get('contentTable');
  const contentId = req.nextUrl.searchParams.get('contentId');
  const target = contentTable && contentId && PURCHASABLE_CONTENT_TABLES.has(contentTable)
    ? { contentTable, contentId }
    : null;

  try {
    const { data: student, error: studentError } = await db.from('students')
      .select('enrollment_model').eq('id', studentId).maybeSingle();
    if (studentError) throw studentError;
    if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    const subscriptionEligible = student.enrollment_model !== 'bootcamp';
    // Whether this learner actually has bootcamp installments to pay. Used to decide who sees the
    // bootcamp payments screen: falling back to it merely because no plans are on sale showed an
    // installment page to people who had never been near a bootcamp.
    const { count: bootcampEnrollments, error: bootcampError } = await db
      .from('bootcamp_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .is('released_at', null);
    if (bootcampError) throw bootcampError;
    const [subscriptionRes, requestsRes, optionsRes, plans, cartRes] = await Promise.all([
      db.from('individual_subscriptions')
        .select('id, student_id, plan_id, status, duration_months, amount, currency, current_period_start, current_period_end, subscription_plans!individual_subscriptions_plan_id_fkey(id,name,description,status)')
        .eq('student_id', studentId).maybeSingle(),
      db.from('subscription_payment_requests')
        .select(`id, student_id, subscription_id, plan_id, plan_name, kind, duration_months, amount, currency, due_date, status, created_at, paid_at, created_by,
          subscription_payment_confirmations(id, amount, paid_at, method, reference, notes, receipt_url, status, reviewed_at, created_at)`)
        .eq('student_id', studentId).order('created_at', { ascending: false }),
      db.from('payment_options')
        .select('id, label, type, instructions, bank_name, account_name, account_number, branch, country, mobile_money_number, network, payment_link, platform, logo_url, sort_order')
        .eq('is_active', true).order('sort_order'),
      subscriptionEligible ? loadPlansForContent(db, target, { withContents: true }) : Promise.resolve([]),
      // The unfinished checkout, if there is one. The reservation function allows a learner only
      // one at a time, so this is a single row rather than a list.
      db.from('paystack_subscription_transactions')
        .select('reference, plan_id, plan_name, duration_months, amount, currency, authorization_url, created_at')
        .eq('student_id', studentId).eq('status', 'initialized').is('request_id', null)
        .is('cart_dismissed_at', null).not('authorization_url', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (subscriptionRes.error) throw subscriptionRes.error;
    if (requestsRes.error) throw requestsRes.error;
    if (optionsRes.error) throw optionsRes.error;

    const subscription = subscriptionRes.data;
    let payments: any[] = [];
    if (subscription?.id) {
      const { data, error } = await db.from('subscription_payments')
        .select('id, plan_name, kind, duration_months, amount, currency, period_start, period_end, paid_at, payment_method, payment_reference, created_at')
        .eq('subscription_id', subscription.id).order('created_at', { ascending: false });
      if (error) throw error;
      payments = data ?? [];
    }
    const displayPlanId = subscription?.plan_id ?? requestsRes.data?.find(row => ['pending', 'confirmation_submitted'].includes(row.status))?.plan_id;
    return NextResponse.json({
      subscription,
      requests: requestsRes.data ?? [],
      payments,
      paymentOptions: optionsRes.data ?? [],
      paystackEnabled: paystackIsConfigured(),
      plans,
      enrollmentModel: student.enrollment_model,
      subscriptionEligible,
      hasBootcampPayments: Number(bootcampEnrollments ?? 0) > 0,
      cart: cartRes.error ? null : cartRes.data,
      purchaseTarget: target,
      content: await resolveContent(db, displayPlanId),
    });
  } catch (err: any) {
    console.error('[student-subscriptions/GET]', err);
    return NextResponse.json({ error: 'Failed to load subscription payments' }, { status: 500 });
  }
}

// Whether this learner may buy this plan at all, asked before any path opens Paystack.
//
// Both buying and resuming need exactly these answers, and on any path that opens the provider
// first the card is charged before crediting is refused -- leaving the learner out of pocket with
// an incident only a person can clear. Resume skipped them entirely, so a tab left open while the
// account changed could still reach a payment page.
async function assertLearnerMayBuy(
  db: ReturnType<typeof adminClient>,
  studentId: string,
  planId: string,
) {
  const { data: student, error: studentError } = await db.from('students')
    .select('enrollment_model').eq('id', studentId).maybeSingle();
  if (studentError) throw studentError;
  if (student?.enrollment_model === 'bootcamp') {
    throw new PaymentError('forbidden', 'Your bootcamp payment plan is managed separately.', 403);
  }

  const { data: existing, error: existingError } = await db
    .from('individual_subscriptions')
    .select('plan_id, subscription_plans!individual_subscriptions_plan_id_fkey(name)')
    .eq('student_id', studentId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.plan_id !== planId) {
    const currentName = (existing as any).subscription_plans?.name;
    throw new PaymentError(
      'conflict',
      currentName
        ? `You are subscribed to ${currentName}. You can renew that plan here, but moving to a different plan needs the learning team.`
        : 'You are already subscribed to a different plan. Moving to another plan needs the learning team.',
      409,
    );
  }
}

// Scoped so return-verification polling cannot spend the checkout budget and lock a learner
// out of retrying a payment that failed.
async function enforcePaystackRateLimit(
  db: ReturnType<typeof adminClient>,
  studentId: string,
  scope: 'checkout' | 'verify' = 'checkout',
  limit = 5,
) {
  const { data, error } = await db.rpc('claim_paystack_checkout_attempt', {
    p_student_id: studentId,
    p_limit: limit,
    p_window_seconds: 600,
    p_scope: scope,
  });
  if (error) throw error;
  if (data === false) throw new PaymentError('rate_limited', 'Too many payment attempts. Please wait a few minutes and try again.', 429);
}

// Return verification is the one student-triggered action that calls Paystack on every hit,
// and the page polls it up to four times per return. The ceiling is well above normal use and
// only exists so a loop cannot spend the whole account's Paystack API budget.
const RETURN_VERIFY_ATTEMPT_LIMIT = 20;

export async function POST(req: NextRequest) {
  const session = await caller(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.action === 'start-paystack-checkout') {
    if (!body.requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    const db = adminClient();
    try {
      await enforcePaystackRateLimit(db, session.id);
      const checkout = await createPaystackSubscriptionCheckout(db, {
        requestId: String(body.requestId),
        studentId: session.id,
        email: session.email,
      });
      return NextResponse.json(checkout);
    } catch (err: any) {
      const failure = paymentErrorResponse(err, 'Failed to start online payment');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  // Resuming an unfinished checkout. Deliberately not a link straight to the stored Paystack URL:
  // a checkout session can time out, so the same reservation path that created it decides whether
  // that link is still good or a fresh one is needed.
  if (body.action === 'resume-cart') {
    const reference = String(body.reference || '').trim();
    if (!reference) return NextResponse.json({ error: 'reference is required' }, { status: 400 });
    const db = adminClient();
    try {
      await enforcePaystackRateLimit(db, session.id);
      // The current cart specifically -- not merely a row this learner once owned. Without the
      // status and dismissal conditions, an old abandoned or already-paid reference would be
      // accepted and reopened.
      const { data: cart, error } = await db.from('paystack_subscription_transactions')
        .select('student_id, plan_id, duration_months, status, request_id')
        .eq('reference', reference)
        .eq('status', 'initialized')
        .is('request_id', null)
        .is('cart_dismissed_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!cart || cart.student_id !== session.id) {
        throw new PaymentError('not_found', 'That checkout is no longer open.', 404);
      }

      // Priced from what the plan costs today, never from what the row remembers. A cart can sit
      // for days, and reopening it at a stale figure would sell access at a price that no longer
      // exists -- and would only be noticed after the learner had paid it.
      const { data: current, error: currentError } = await db.from('subscription_plan_prices')
        .select('amount, currency, is_active, subscription_plans!subscription_plan_prices_plan_id_fkey(name, status, cohort_id)')
        .eq('plan_id', cart.plan_id).eq('duration_months', cart.duration_months)
        .eq('is_active', true).maybeSingle();
      if (currentError) throw currentError;
      const currentPlan = (current as any)?.subscription_plans;
      if (!current || currentPlan?.status !== 'active') {
        throw new PaymentError('conflict', 'That plan is no longer on sale. Choose one of the current plans instead.', 409);
      }
      const { data: cohort, error: cohortError } = await db.from('cohorts')
        .select('cohort_kind').eq('id', currentPlan.cohort_id).maybeSingle();
      if (cohortError) throw cohortError;
      if (!cohort || !['legacy_individual', 'subscription_plan'].includes(cohort.cohort_kind)) {
        throw new PaymentError('conflict', 'That plan is not available for individual subscription.', 409);
      }
      // The account can have changed since the cart was made: a learner moved onto a bootcamp, or
      // given a different plan. Same checks the purchase path runs, before Paystack opens.
      await assertLearnerMayBuy(db, session.id, cart.plan_id);

      const outcome = await createPaystackDirectCheckout(db, {
        studentId: session.id,
        email: session.email,
        planId: cart.plan_id,
        planName: currentPlan.name,
        durationMonths: cart.duration_months,
        amount: Number(current.amount),
        currency: current.currency || 'GHS',
      });
      if (outcome.kind === 'settled') {
        return NextResponse.json({ ok: true, settled: outcome.status, reference: outcome.reference });
      }
      return NextResponse.json({ ok: true, checkout: outcome });
    } catch (err) {
      const failure = paymentErrorResponse(err, 'Could not reopen that checkout');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  // Clearing an unfinished checkout. Guarded in the database rather than here: it refuses the
  // moment the checkout reaches a state where Paystack may hold money, because clearing it then
  // would free the learner to start a second payment for something they might already have bought.
  if (body.action === 'dismiss-cart') {
    const reference = String(body.reference || '').trim();
    if (!reference) return NextResponse.json({ error: 'reference is required' }, { status: 400 });
    const db = adminClient();
    try {
      // Our own status is not evidence that nothing was paid. A learner can complete a payment and
      // have the row still read 'initialized' until the webhook lands, so clearing on the local
      // value alone would free them to buy the same thing twice. Paystack is asked first, and
      // anything it has not finished with is credited rather than discarded.
      const { data: owned, error: ownedError } = await db.from('paystack_subscription_transactions')
        .select('student_id').eq('reference', reference).maybeSingle();
      if (ownedError) throw ownedError;
      if (!owned || owned.student_id !== session.id) {
        throw new PaymentError('not_found', 'That checkout could not be found.', 404);
      }
      await assertNothingCollected(db, { reference }, 'Your');

      const { data, error } = await db.rpc('dismiss_paystack_cart', {
        p_student_id: session.id,
        p_reference: reference,
      });
      if (error) throw error;
      if (data?.ok !== true) {
        throw new PaymentError(
          'conflict',
          data?.status === 'not_found'
            ? 'That checkout could not be found.'
            : 'This payment is already being processed and cannot be cleared. Check its status instead.',
          data?.status === 'not_found' ? 404 : 409,
        );
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      const failure = paymentErrorResponse(err, 'Could not clear that checkout');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  // Withdrawing an invoice the learner raised for themselves.
  //
  // Choosing bank transfer creates a payment request: a due date, a chasing email, and a block on
  // starting any other payment until it closes. Nothing on the learner's side could close it, so
  // picking the wrong plan or simply changing their mind meant waiting for staff to notice. They
  // can withdraw one they raised themselves. One the learning team assigned stays with the team,
  // because that is a record of what somebody decided this learner owes, not a basket item.
  if (body.action === 'cancel-my-request') {
    const requestId = String(body.requestId || '').trim();
    if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    const db = adminClient();
    try {
      const { data: request, error } = await db.from('subscription_payment_requests')
        .select('id, student_id, status, created_by').eq('id', requestId).maybeSingle();
      if (error) throw error;
      if (!request || request.student_id !== session.id) {
        throw new PaymentError('not_found', 'That payment request could not be found.', 404);
      }
      if (request.created_by !== session.id) {
        throw new PaymentError(
          'forbidden',
          'The learning team set up this payment, so they need to cancel it. Message them and they can remove it for you.',
          403,
        );
      }
      if (request.status !== 'pending') {
        throw new PaymentError(
          'conflict',
          request.status === 'confirmation_submitted'
            // Withdrawing now would drop a payment they have already told staff about.
            ? 'You have already sent a payment for this, so the learning team is reviewing it. Ask them to cancel it if it was a mistake.'
            : 'That payment request is already closed.',
          409,
        );
      }
      // Same rule as clearing a cart: closing this frees them to start paying again, so nothing
      // may have been collected against it first.
      await assertNothingCollected(db, { requestId }, 'Your');
      await cancelSubscriptionPaymentRequest(db, requestId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      const failure = paymentErrorResponse(err, 'Could not cancel that payment request');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  if (body.action === 'verify-paystack-return') {
    const reference = String(body.reference || '').trim();
    if (!reference) return NextResponse.json({ error: 'reference is required' }, { status: 400 });
    const db = adminClient();
    try {
      const { data: transaction, error } = await db.from('paystack_subscription_transactions')
        .select('student_id').eq('reference', reference).maybeSingle();
      if (error) throw error;
      if (!transaction || transaction.student_id !== session.id) {
        throw new PaymentError('not_found', 'Payment could not be found.', 404);
      }
      await enforcePaystackRateLimit(db, session.id, 'verify', RETURN_VERIFY_ATTEMPT_LIMIT);
      const result = await processPaystackSubscriptionReference(db, reference);
      return NextResponse.json(result);
    } catch (err) {
      const failure = paymentErrorResponse(err, 'We could not verify this payment yet.');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  if (body.action === 'purchase-plan') {
    if (!body.priceId) return NextResponse.json({ error: 'priceId is required' }, { status: 400 });
    const db = adminClient();
    try {
      const { data: price, error } = await db
        .from('subscription_plan_prices')
        .select('id, plan_id, duration_months, amount, currency, is_active, subscription_plans!subscription_plan_prices_plan_id_fkey(id, name, status, cohort_id)')
        .eq('id', String(body.priceId))
        .maybeSingle();
      if (error) throw error;
      const plan = (price as any)?.subscription_plans;
      if (!price || price.is_active !== true || plan?.status !== 'active') {
        return NextResponse.json({ error: 'Subscription price not found' }, { status: 404 });
      }
      await assertLearnerMayBuy(db, session.id, price.plan_id);
      const { data: cohort, error: cohortError } = await db.from('cohorts')
        .select('cohort_kind').eq('id', plan.cohort_id).maybeSingle();
      if (cohortError) throw cohortError;
      if (!cohort || !['legacy_individual', 'subscription_plan'].includes(cohort.cohort_kind)) {
        throw new PaymentError('conflict', 'This plan is not available for individual subscription.', 409);
      }

      if (body.contentTable || body.contentId) {
        const contentTable = String(body.contentTable || '');
        const contentId = String(body.contentId || '');
        if (!PURCHASABLE_CONTENT_TABLES.has(contentTable) || !contentId) {
          return NextResponse.json({ error: 'Invalid subscription content target' }, { status: 400 });
        }
        const allowedPlanIds = await eligiblePlanIds(db, contentTable, contentId);
        if (!allowedPlanIds.includes(price.plan_id)) {
          return NextResponse.json({ error: 'This plan does not include the selected content' }, { status: 409 });
        }
      }

      // Paying online raises no payment request. A request means someone asked this learner to
      // pay: it carries a deadline, a chasing email, and a place in the admin's receivables, and
      // only one can be open at a time. Creating one because somebody clicked a plan turned an
      // abandoned checkout into a debt they could not clear and locked them out of every other
      // plan. The transaction alone is the record of a checkout they started.
      if (body.paystack === true) {
        await enforcePaystackRateLimit(db, session.id);
        const outcome = await createPaystackDirectCheckout(db, {
          studentId: session.id,
          email: session.email,
          planId: price.plan_id,
          planName: (plan as any)?.name ?? 'Subscription',
          durationMonths: price.duration_months,
          amount: Number(price.amount),
          currency: price.currency || 'GHS',
        });
        // Recovering a stuck checkout can find that Paystack already took the payment. There is
        // nothing left to buy, so this is a success the page reloads on -- not an error that
        // leaves them looking at a stale screen and clicking pay again.
        if (outcome.kind === 'settled') {
          return NextResponse.json({ ok: true, settled: outcome.status, reference: outcome.reference });
        }
        return NextResponse.json({ ok: true, checkout: outcome });
      }

      // Bank transfer and mobile money still raise one, because that is the flow where the
      // learner needs somewhere to submit a receipt and an admin needs something to approve.
      //
      // Never while a checkout is open: a learner holding a payable Paystack link and a bank
      // transfer for the same plan can settle both. That check lives inside the function below,
      // under the lock it already takes on the learner's row, because doing it here first and
      // inserting second let a checkout opened in between slip through.
      const dueDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const requestResult = await createSubscriptionPaymentRequest(db, {
        studentId: session.id,
        planId: price.plan_id,
        durationMonths: price.duration_months,
        amount: Number(price.amount),
        currency: price.currency || 'GHS',
        dueDate,
        createdBy: session.id,
      });
      return NextResponse.json(requestResult);
    } catch (err: any) {
      if (err?.code === '55006') {
        const failure = new PaymentError(
          'conflict',
          'You have an online checkout open. Finish it or remove it before paying another way.',
          409,
        );
        return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
      }
      if (err?.code === '23505') {
        const failure = new PaymentError('conflict', 'A payment request is already open for this subscription.', 409);
        return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
      }
      const failure = paymentErrorResponse(err, 'Failed to purchase subscription plan');
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  if (body.action !== 'submit-confirmation') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const amount = Number(body.amount);
  if (!body.requestId || !Number.isFinite(amount) || amount <= 0 || !body.paidAt) {
    return NextResponse.json({ error: 'requestId, amount, and paidAt are required' }, { status: 400 });
  }
  if (body.receiptUrl) {
    try {
      const parsed = new URL(body.receiptUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch { return NextResponse.json({ error: 'Receipt URL must be a valid http:// or https:// URL' }, { status: 400 }); }
  }

  const db = adminClient();
  try {
    const { data, error } = await db.rpc('submit_subscription_payment_confirmation', {
      p_request_id: body.requestId,
      p_student_id: session.id,
      p_amount: amount,
      p_paid_at: body.paidAt,
      p_method: body.method ?? null,
      p_reference: body.reference ?? null,
      p_notes: body.notes ?? null,
      p_receipt_url: body.receiptUrl ?? null,
    });
    if (error) throw error;

    if (process.env.RESEND_API_KEY) {
      void (async () => {
        try {
          const [{ data: student }, { data: request }, settings] = await Promise.all([
            db.from('students').select('full_name').eq('id', session.id).maybeSingle(),
            db.from('subscription_payment_requests').select('currency').eq('id', body.requestId).maybeSingle(),
            getTenantSettings(),
          ]);
          const from = process.env.RESEND_FROM_EMAIL || `${settings.senderName} <${settings.supportEmail}>`;
          const branding = { logoUrl: settings.logoUrl, emailBannerUrl: settings.emailBannerUrl, teamName: settings.teamName, appName: settings.appName, appUrl: settings.appUrl };
          const name = student?.full_name || 'there';
          const currency = request?.currency || 'GHS';
          await resend.batch.send([
            { from, to: session.email, subject: 'We received your subscription payment confirmation', html: paymentConfirmationAcknowledgedEmail({ name, amount, currency, dashboardUrl: settings.appUrl, branding }) },
            { from, to: settings.supportEmail || process.env.RESEND_FROM_EMAIL || from, subject: `New subscription payment confirmation from ${name}`, html: adminPaymentConfirmationEmail({ studentName: name, studentEmail: session.email, amount, currency, adminUrl: `${settings.appUrl}/dashboard#subscriptions`, branding }) },
          ]);
        } catch { /* Notification failures do not roll back the submitted confirmation. */ }
      })();
    }
    return NextResponse.json(data);
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'This payment confirmation has already been submitted.', code: 'conflict' }, { status: 409 });
    }
    console.error('[student-subscriptions/submit-confirmation]', err);
    return NextResponse.json({ error: 'Failed to submit payment confirmation', code: 'internal_error' }, { status: 500 });
  }
}
