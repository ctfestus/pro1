import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { adminPaymentConfirmationEmail, paymentConfirmationAcknowledgedEmail } from '@/lib/email-templates';

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

  try {
    const [subscriptionRes, requestsRes, optionsRes] = await Promise.all([
      db.from('individual_subscriptions')
        .select('id, student_id, plan_id, status, duration_months, amount, currency, current_period_start, current_period_end, subscription_plans!individual_subscriptions_plan_id_fkey(id,name,description,status)')
        .eq('student_id', studentId).maybeSingle(),
      db.from('subscription_payment_requests')
        .select(`id, student_id, subscription_id, plan_id, plan_name, kind, duration_months, amount, currency, due_date, status, created_at, paid_at,
          subscription_payment_confirmations(id, amount, paid_at, method, reference, notes, receipt_url, status, reviewed_at, created_at)`)
        .eq('student_id', studentId).order('created_at', { ascending: false }),
      db.from('payment_options')
        .select('id, label, type, instructions, bank_name, account_name, account_number, branch, country, mobile_money_number, network, payment_link, platform, logo_url, sort_order')
        .eq('is_active', true).order('sort_order'),
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
      content: await resolveContent(db, displayPlanId),
    });
  } catch (err: any) {
    console.error('[student-subscriptions/GET]', err);
    return NextResponse.json({ error: err.message ?? 'Failed to load subscription payments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await caller(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
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
    const conflict = err?.code === '23505' || String(err?.message ?? '').includes('not open');
    return NextResponse.json({ error: err.message ?? 'Failed to submit confirmation' }, { status: conflict ? 409 : 500 });
  }
}
