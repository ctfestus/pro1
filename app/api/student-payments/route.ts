import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { paymentConfirmationAcknowledgedEmail, adminPaymentConfirmationEmail } from '@/lib/email-templates';

const resend = new Resend(process.env.RESEND_API_KEY);

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

async function getSessionStudent(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const auth = await requireUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase() };
}

// GET -- return enrollment, installments, payments, confirmations, payment options
export async function GET(req: NextRequest) {
  const caller = await getSessionStudent(req);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = adminClient();

  // Allow admins/instructors to view any student's payments via ?studentId=
  const requestedId = req.nextUrl.searchParams.get('studentId');
  let targetStudentId = caller.id;

  if (requestedId && requestedId !== caller.id) {
    const { data: callerRecord } = await db
      .from('students')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();
    if (!callerRecord || !['admin', 'instructor'].includes(callerRecord.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    targetStudentId = requestedId;
  }

  try {
    const [enrollRes, optionsRes] = await Promise.all([
      db
        .from('bootcamp_enrollments')
        .select(`
          id, cohort_id, total_fee, currency, payment_plan,
          deposit_required, paid_total, access_status, access_until,
          bootcamp_starts_at, bootcamp_ends_at,
          payment_installments ( id, due_date, amount_due, amount_paid, status )
        `)
        .eq('student_id', targetStudentId)
        // A released enrollment (migration 171) is history, not the student's current one.
        .is('released_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('payment_options')
        .select('id, label, type, instructions, bank_name, account_name, account_number, branch, country, mobile_money_number, network, payment_link, platform, logo_url, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ]);

    if (!enrollRes.data) {
      return NextResponse.json({
        enrollment: null,
        installments: [],
        payments: [],
        confirmations: [],
        paymentOptions: optionsRes.data ?? [],
      });
    }

    const enrollment = enrollRes.data;
    const enrollmentId = enrollment.id;

    const [paymentsRes, confirmationsRes] = await Promise.all([
      db
        .from('payments')
        .select('id, amount, paid_at, method, reference, notes, created_at')
        .eq('enrollment_id', enrollmentId)
        .order('paid_at', { ascending: false }),
      db
        .from('student_payment_confirmations')
        .select('id, amount, paid_at, method, reference, notes, receipt_url, status, admin_notes, created_at')
        .eq('enrollment_id', enrollmentId)
        .order('created_at', { ascending: false }),
    ]);

    const installments = (enrollment.payment_installments ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    return NextResponse.json({
      enrollment: {
        id:              enrollment.id,
        cohort_id:       enrollment.cohort_id,
        total_fee:       Number(enrollment.total_fee),
        currency:        enrollment.currency ?? 'GHS',
        payment_plan:    enrollment.payment_plan,
        deposit_required: Number(enrollment.deposit_required),
        paid_total:      Number(enrollment.paid_total),
        balance:         Math.max(0, Number(enrollment.total_fee) - Number(enrollment.paid_total)),
        access_status:   enrollment.access_status,
        access_until:    enrollment.access_until,
        bootcamp_starts_at: enrollment.bootcamp_starts_at,
        bootcamp_ends_at:   enrollment.bootcamp_ends_at,
      },
      installments,
      payments:          paymentsRes.data ?? [],
      confirmations:     confirmationsRes.data ?? [],
      paymentOptions:    optionsRes.data ?? [],
    });
  } catch (err: any) {
    console.error('[student-payments/GET]', err);
    return NextResponse.json({ error: err.message ?? 'Failed to load payment data' }, { status: 500 });
  }
}

// POST -- submit payment confirmation
export async function POST(req: NextRequest) {
  const student = await getSessionStudent(req);
  if (!student) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { enrollmentId, amount, paidAt, method, reference, notes, receiptUrl } = body;

  if (!enrollmentId || !amount || !paidAt) {
    return NextResponse.json({ error: 'enrollmentId, amount, and paidAt are required' }, { status: 400 });
  }
  if (Number(amount) <= 0) {
    return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
  }
  if (receiptUrl != null && receiptUrl !== '') {
    try {
      const parsed = new URL(receiptUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return NextResponse.json({ error: 'receiptUrl must be an https:// or http:// URL' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'receiptUrl is not a valid URL' }, { status: 400 });
    }
  }

  const db = adminClient();

  try {
    // Verify enrollment belongs to this student
    const { data: enrollment } = await db
      .from('bootcamp_enrollments')
      .select('id, cohort_id')
      .eq('id', enrollmentId)
      .eq('student_id', student.id)
      .maybeSingle();

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    const { error: insertErr } = await db
      .from('student_payment_confirmations')
      .insert({
        enrollment_id: enrollmentId,
        student_id:    student.id,
        cohort_id:     enrollment.cohort_id,
        amount:        Number(amount),
        paid_at:       paidAt,
        method:        method ?? null,
        reference:     reference ?? null,
        notes:         notes ?? null,
        receipt_url:   receiptUrl ?? null,
        status:        'pending',
      });

    if (insertErr) throw insertErr;

    // Fire-and-forget: acknowledge student + notify admin
    if (process.env.RESEND_API_KEY) {
      ;(async () => {
        try {
          const [{ data: studentRow }, { data: enroll }, t] = await Promise.all([
            db.from('students').select('full_name').eq('id', student.id).maybeSingle(),
            db.from('bootcamp_enrollments').select('currency').eq('id', enrollmentId).maybeSingle(),
            getTenantSettings(),
          ]);
          const FROM        = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
          const dashboardUrl = t.appUrl || process.env.APP_URL || '';
          const branding    = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
          const studentName = studentRow?.full_name || 'there';
          const currency    = enroll?.currency ?? 'GHS';
          const adminUrl    = `${t.appUrl || process.env.APP_URL || ''}/dashboard#payments`;

          await resend.batch.send([
            {
              from:    FROM,
              to:      student.email,
              subject: 'We received your payment confirmation',
              html:    paymentConfirmationAcknowledgedEmail({ name: studentName, amount: Number(amount), currency, dashboardUrl, branding }),
            },
            {
              from:    FROM,
              to:      t.supportEmail || process.env.RESEND_FROM_EMAIL || FROM,
              subject: `New payment confirmation from ${studentName}`,
              html:    adminPaymentConfirmationEmail({ studentName, studentEmail: student.email, amount: Number(amount), currency, adminUrl, branding }),
            },
          ]);
        } catch { /* non-blocking */ }
      })();
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[student-payments/POST]', err);
    return NextResponse.json({ error: err.message ?? 'Failed to submit confirmation' }, { status: 500 });
  }
}
