/**
 * Weekly cron -- At-risk student digest for instructors.
 * Triggered by QStash every Monday at 07:00 (before the student digest).
 *
 * Risk signals (additive score):
 *   +2  last_login_at more than 7 days ago
 *   +2  has a stalled course or VE attempt (started, not completed, 7+ days idle)
 *   +3  payment access_status is overdue. Grace is deliberately not a signal here: it is not
 *       stored on the enrollment (computeAccess derives it per read), and the daily sweep
 *       records a student inside grace as active, so this job cannot see it without
 *       recomputing access from installments.
 *   +1  enrolled 14+ days with zero completed items
 *
 * Students scoring >= 2 are included. Score >= 5 = HIGH RISK.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { atRiskDigestEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const supabase = adminClient();
  const now = Date.now();
  const sevenDaysAgo  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  // 1. All active students (non-instructor). Paged: an unpaged scan stopped at the project's row
  // cap, so on a large tenant every student past it was silently never scored -- and the id list it
  // produced was then long enough to build a request URL a proxy could reject.
  const students = await fetchAllRows<any>((from, to) => supabase
    .from('students')
    .select('id, full_name, email, cohort_id, last_login_at, created_at, role', { count: 'exact' })
    .eq('role', 'student').order('id').range(from, to));

  if (!students.length) return NextResponse.json({ ok: true, sent: 0 });

  const studentIds = students.map((s: any) => s.id);

  // 2. Stalled attempts (started, not completed, idle 7+ days)
  const [stalledCourse, stalledVe, enrollments, completions] = await Promise.all([
    fetchAllRowsByIds<any>(studentIds, (idChunk, from, to) => supabase.from('course_attempts')
      .select('student_id', { count: 'exact' })
      .is('completed_at', null)
      .lt('updated_at', sevenDaysAgo)
      .in('student_id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(studentIds, (idChunk, from, to) => supabase.from('guided_project_attempts')
      .select('student_id', { count: 'exact' })
      .is('completed_at', null)
      .lt('updated_at', sevenDaysAgo)
      .in('student_id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(studentIds, (idChunk, from, to) => supabase.from('bootcamp_enrollments')
      .select('student_id, access_status', { count: 'exact' })
      .is('released_at', null)
      .in('student_id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(studentIds, (idChunk, from, to) => supabase.from('course_attempts')
      .select('student_id', { count: 'exact' })
      .not('completed_at', 'is', null)
      .in('student_id', idChunk).order('id').range(from, to)),
  ]);

  const stalledSet   = new Set([
    ...stalledCourse.map((a: any) => a.student_id),
    ...stalledVe.map((a: any) => a.student_id),
  ]);
  const overdueSet   = new Set(
    enrollments
      .filter((e: any) => e.access_status === 'overdue')
      .map((e: any) => e.student_id)
  );
  const completedSet = new Set(completions.map((c: any) => c.student_id));

  // 3. Score each student
  type RiskyStudent = { name: string; email: string; riskScore: number; reasons: string[] };
  const atRisk: RiskyStudent[] = [];

  for (const s of students) {
    if (!s.email) continue;
    let score = 0;
    const reasons: string[] = [];

    const lastLogin = s.last_login_at ? new Date(s.last_login_at).getTime() : 0;
    if (!lastLogin || lastLogin < now - 7 * 24 * 60 * 60 * 1000) {
      score += 2; reasons.push('inactive 7+ days');
    }
    if (stalledSet.has(s.id)) {
      score += 2; reasons.push('stalled progress');
    }
    if (overdueSet.has(s.id)) {
      score += 3; reasons.push('payment overdue');
    }
    const enrolled14DaysAgo = s.created_at && new Date(s.created_at).getTime() < now - 14 * 24 * 60 * 60 * 1000;
    if (enrolled14DaysAgo && !completedSet.has(s.id)) {
      score += 1; reasons.push('no completions yet');
    }

    if (score >= 2) {
      atRisk.push({ name: s.full_name || 'Unknown', email: s.email, riskScore: score, reasons });
    }
  }

  if (!atRisk.length) {
    console.log('[cron/at-risk-digest] no at-risk students this week');
    return NextResponse.json({ ok: true, sent: 0, atRisk: 0 });
  }

  // Sort highest risk first
  atRisk.sort((a, b) => b.riskScore - a.riskScore);

  // 4. Fetch all instructors
  const instructors = await fetchAllRows<any>((from, to) => supabase
    .from('students').select('full_name, email', { count: 'exact' })
    .eq('role', 'instructor').order('id').range(from, to));

  if (!instructors.length) {
    console.log('[cron/at-risk-digest] no instructors found');
    return NextResponse.json({ ok: true, sent: 0, atRisk: atRisk.length });
  }

  const t = await getTenantSettings();
  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  let sent = 0;
  for (const instructor of instructors) {
    if (!instructor.email) continue;
    try {
      await resend.emails.send({
        from: FROM,
        to: instructor.email,
        subject: `At-risk students this week: ${atRisk.length} need attention`,
        html: atRiskDigestEmail({
          instructorName: instructor.full_name || 'there',
          students: atRisk,
          dashboardUrl: `${t.appUrl}/dashboard`,
          branding,
        }),
      });
      sent++;
    } catch (err) {
      console.error('[cron/at-risk-digest] send failed:', err);
    }
  }

  console.log(`[cron/at-risk-digest] sent=${sent} atRisk=${atRisk.length}`);
  return NextResponse.json({ ok: true, sent, atRisk: atRisk.length });
}
