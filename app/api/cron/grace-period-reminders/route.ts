/**
 * Daily cron -- Grace period payment warning emails.
 * Triggered by QStash at 08:00 every day (same schedule as deadline-reminders).
 * QStash schedule: 0 8 * * * POST /api/cron/grace-period-reminders
 *
 * Sends two notifications per missed installment:
 *   1. grace_period_start    -- first run after the installment goes overdue while
 *                               the student is still within the grace window.
 *   2. grace_period_expiring -- when 1 day remains in the grace window.
 *
 * Deduplication: sent_nudges with a 90-day lookback so each nudge type fires
 * at most once per installment regardless of how many times the cron runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { gracePeriodWarningEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) {
    console.error('[cron/grace-period-reminders] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const db  = adminClient();
  const t   = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const dashboardUrl = t.appUrl || process.env.APP_URL || '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [enrollRes, settingsRes] = await Promise.all([
    db
      .from('bootcamp_enrollments')
      .select(`
        id,
        student_id,
        cohort_id,
        payment_plan,
        total_fee,
        paid_total,
        students ( full_name, email, payment_exempt ),
        payment_installments ( id, due_date, status )
      `)
      .not('student_id', 'is', null)
      .is('released_at', null)
      .not('payment_plan', 'in', '("waived","sponsored")')
      .neq('access_status', 'completed'),
    db
      .from('cohort_payment_settings')
      .select('cohort_id, grace_period_days')
      .not('grace_period_days', 'is', null),
  ]);

  if (enrollRes.error) {
    console.error('[cron/grace-period-reminders] enrollment fetch failed:', enrollRes.error);
    return NextResponse.json({ error: enrollRes.error.message }, { status: 500 });
  }

  // cohort_id -> grace days (only cohorts with grace period > 0)
  const graceMap: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) {
    if (s.grace_period_days != null && s.grace_period_days > 0) {
      graceMap[s.cohort_id] = s.grace_period_days;
    }
  }

  type GraceCandidate = {
    enrollmentId: string;
    studentId: string;
    studentName: string;
    email: string;
    installmentId: string;
    graceEndDate: Date;
    daysLeft: number;
  };

  const candidates: GraceCandidate[] = [];

  for (const enroll of enrollRes.data ?? []) {
    const student = (enroll as any).students;
    if (!student?.email) continue;
    if (student.payment_exempt) continue;

    const graceDays = graceMap[(enroll as any).cohort_id];
    if (!graceDays || graceDays <= 0) continue;

    if (Number(enroll.paid_total) <= 0) continue;
    if (Number(enroll.paid_total) >= Number(enroll.total_fee)) continue;

    // Find the earliest overdue unpaid installment
    const installments: { id: string; due_date: string; status: string }[] = (enroll as any).payment_installments ?? [];
    const overdue = installments
      .filter(i => (i.status === 'unpaid' || i.status === 'partial') && new Date(i.due_date) < today)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

    if (!overdue) continue;

    const graceEnd = new Date(overdue.due_date);
    graceEnd.setDate(graceEnd.getDate() + graceDays);
    graceEnd.setHours(0, 0, 0, 0);

    // Only proceed if still within grace window
    if (today > graceEnd) continue;

    const daysLeft = Math.ceil((graceEnd.getTime() - today.getTime()) / 86400000);

    const email = (student.email as string).trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

    candidates.push({
      enrollmentId:  enroll.id,
      studentId:     enroll.student_id as string,
      studentName:   student.full_name || 'there',
      email,
      installmentId: overdue.id,
      graceEndDate:  graceEnd,
      daysLeft,
    });
  }

  if (!candidates.length) {
    console.log('[cron/grace-period-reminders] no grace-period students found');
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  // Load existing nudges for these installments (90-day lookback)
  const installmentIds = [...new Set(candidates.map(c => c.installmentId))];
  const since90Days    = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: existingNudges } = await db
    .from('sent_nudges')
    .select('student_id, form_id, nudge_type')
    .in('nudge_type', ['grace_period_start', 'grace_period_expiring'])
    .in('form_id', installmentIds)
    .gte('sent_at', since90Days);

  const nudgedSet = new Set<string>();
  for (const n of existingNudges ?? []) nudgedSet.add(`${n.student_id}|${n.form_id}|${n.nudge_type}`);

  type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
  const emailBatch:   EmailPayload[] = [];
  const nudgeRecords: { student_id: string; form_id: string; nudge_type: string }[] = [];
  let skipped = 0;

  for (const c of candidates) {
    const graceEndStr = c.graceEndDate.toISOString().slice(0, 10);
    const startKey    = `${c.studentId}|${c.installmentId}|grace_period_start`;
    const expiringKey = `${c.studentId}|${c.installmentId}|grace_period_expiring`;

    if (!nudgedSet.has(startKey)) {
      // First notification: grace period has started
      emailBatch.push({
        from:    FROM,
        to:      c.email,
        subject: `Your payment is overdue: access protected until ${graceEndStr}`,
        html:    gracePeriodWarningEmail({
          name: c.studentName, graceEndDate: graceEndStr, daysLeft: c.daysLeft, dashboardUrl, branding,
        }),
      });
      nudgeRecords.push({ student_id: c.studentId, form_id: c.installmentId, nudge_type: 'grace_period_start' });
      nudgedSet.add(startKey);
    } else if (c.daysLeft <= 1 && !nudgedSet.has(expiringKey)) {
      // Second notification: 1 day before grace expires
      emailBatch.push({
        from:    FROM,
        to:      c.email,
        subject: `Urgent: your grace period ends tomorrow (${graceEndStr})`,
        html:    gracePeriodWarningEmail({
          name: c.studentName, graceEndDate: graceEndStr, daysLeft: 1, dashboardUrl, branding,
        }),
      });
      nudgeRecords.push({ student_id: c.studentId, form_id: c.installmentId, nudge_type: 'grace_period_expiring' });
      nudgedSet.add(expiringKey);
    } else {
      skipped++;
    }
  }

  if (!emailBatch.length) {
    console.log(`[cron/grace-period-reminders] sent=0 skipped=${skipped}`);
    return NextResponse.json({ ok: true, sent: 0, skipped });
  }

  const sentKeySet = new Set<string>();
  const batches    = chunk(emailBatch, BATCH_SIZE);
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchNudges = nudgeRecords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      await resend.batch.send(batches[i]);
      sent += batches[i].length;
      for (const n of batchNudges) sentKeySet.add(`${n.student_id}|${n.form_id}|${n.nudge_type}`);
    } catch (err) {
      console.error('[cron/grace-period-reminders] batch send failed:', err);
    }
  }

  if (sentKeySet.size) {
    const toInsert = nudgeRecords.filter(n => sentKeySet.has(`${n.student_id}|${n.form_id}|${n.nudge_type}`));
    if (toInsert.length) await db.from('sent_nudges').insert(toInsert);
  }

  console.log(`[cron/grace-period-reminders] sent=${sent} skipped=${skipped}`);
  return NextResponse.json({ ok: true, sent, skipped });
}
