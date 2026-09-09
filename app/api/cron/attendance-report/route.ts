import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Receiver } from '@upstash/qstash';
import { Resend } from 'resend';
import { attendanceReportEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { studentsStillInCohorts } from '@/lib/cohort-roster';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY!,
});

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get('upstash-signature') ?? '';
  try {
    await receiver.verify({ signature, body });
  } catch {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const day = now.getUTCDay(); // 6 = Saturday
  if (day !== 6) {
    return NextResponse.json({ skipped: 'not Saturday' });
  }

  const today = now.toISOString().slice(0, 10);
  const supabase = adminClient();

  // 1. All events with a meeting link (live sessions)
  const { data: allLiveEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, title, user_id, event_date, recurrence, recurrence_end_date, recurrence_days, cohort_ids')
    .not('meeting_link', 'is', null);

  if (eventsError) {
    console.error('[attendance-report] events query error:', eventsError.message);
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  // Filter to events that are scheduled for today:
  // - one-time: event_date = today
  // - recurring: started on or before today and not yet ended
  const scheduledToday = (allLiveEvents ?? []).filter((e: any) => {
    if (!e.event_date) return false;
    if (e.recurrence === 'once' || !e.recurrence) return e.event_date === today;
    const days: number[] = Array.isArray(e.recurrence_days) ? e.recurrence_days : [];
    const onThisDay = days.length === 0 || days.includes(day);
    return onThisDay && e.event_date <= today && (!e.recurrence_end_date || e.recurrence_end_date >= today);
  });

  if (scheduledToday.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No live sessions scheduled today' });
  }

  const eventIds = scheduledToday.map((e: any) => e.id as string);

  // 2. Today's attendance (could be empty -- that's fine, those are no-shows)
  const { data: todayAttendance } = await supabase
    .from('live_attendance')
    .select('event_id, student_id, joined_at')
    .eq('session_date', today)
    .in('event_id', eventIds);

  // 3. All admin emails
  const { data: adminStudents } = await supabase
    .from('students')
    .select('id, email')
    .eq('role', 'admin');

  const adminEmailSet = new Set<string>(
    (adminStudents ?? []).map((a: any) => a.email as string).filter(Boolean)
  );

  // 4. Tenant branding
  const t            = await getTenantSettings();
  const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const dashboardUrl = `${t.appUrl}/dashboard`;

  let sent = 0;

  for (const event of scheduledToday) {
    const { data: allRegs } = await supabase
      .from('event_registrations')
      .select('student_id, student:students(full_name, email)')
      .eq('event_id', event.id);

    // A registration is never removed when a student leaves the cohort, so reading the rows raw
    // listed people who cannot open the event any more -- and counted them as no-shows. Narrow the
    // roster to current cohort members; the attendance rows themselves are left alone.
    let stillEnrolled: Set<string>;
    try {
      stillEnrolled = await studentsStillInCohorts(
        supabase,
        (allRegs ?? []).map((r: any) => r.student_id as string),
        (event as any).cohort_ids ?? [],
      );
    } catch (err) {
      // One event whose roster cannot be read must not cost every other event its report.
      console.error('[attendance-report] roster lookup failed for event', event.id, err);
      continue;
    }
    const regs = (allRegs ?? []).filter((r: any) => stillEnrolled.has(r.student_id));

    if (regs.length === 0) continue; // nobody currently in the cohort -- nothing to report

    const eventAttendance = (todayAttendance ?? []).filter((a: any) => a.event_id === event.id);
    const attendedIds     = new Set(eventAttendance.map((a: any) => a.student_id as string));

    const attended = regs
      .filter((r: any) => attendedIds.has(r.student_id))
      .map((r: any) => ({
        name:     (r.student as any)?.full_name ?? 'Unknown',
        email:    (r.student as any)?.email     ?? '',
        joinedAt: eventAttendance.find((a: any) => a.student_id === r.student_id)?.joined_at ?? '',
      }));

    const missed = regs
      .filter((r: any) => !attendedIds.has(r.student_id))
      .map((r: any) => ({
        name:  (r.student as any)?.full_name ?? 'Unknown',
        email: (r.student as any)?.email     ?? '',
      }));

    const { data: instructor } = await supabase
      .from('students')
      .select('email')
      .eq('id', event.user_id)
      .maybeSingle();

    const recipients = new Set<string>(adminEmailSet);
    if (instructor?.email) recipients.add(instructor.email);

    const to = [...recipients].filter(Boolean);
    if (to.length === 0) continue;

    const html    = attendanceReportEmail({ eventTitle: event.title ?? 'Live Session', sessionDate: today, attended, missed, dashboardUrl, branding });
    const subject = `Attendance Report: ${event.title ?? 'Live Session'} (${today})`;

    try {
      await resend.emails.send({ from: FROM, to, subject, html });
      sent++;
    } catch (err) {
      console.error('[attendance-report] send error for event', event.id, err);
    }
  }

  return NextResponse.json({ sent, scheduled: scheduledToday.length, date: today });
}
