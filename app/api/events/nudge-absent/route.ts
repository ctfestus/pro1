import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { missedSessionEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { eventId, sessionDate, studentIds } = body;
  if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 });

  // Optional: restrict the nudge to a specific subset of students (e.g. when
  // some absentees were excused). Empty/absent means "all absent students".
  const allowList: Set<string> | null =
    Array.isArray(studentIds) && studentIds.length > 0 ? new Set(studentIds as string[]) : null;

  // Confirm caller owns the event
  const { data: event } = await supabase
    .from('events')
    .select('id, title, slug, meeting_link, user_id, event_date')
    .eq('id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Event not found or access denied' }, { status: 404 });

  // Registrations with join tokens and student details
  const { data: regs } = await supabase
    .from('event_registrations')
    .select('student_id, join_token, student:students(full_name, email)')
    .eq('event_id', eventId);

  if (!regs || regs.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No registrations' });
  }

  // Attendance for the target session date (all-time if no date given)
  let attendedIds = new Set<string>();
  if (sessionDate) {
    const { data: att } = await supabase
      .from('live_attendance')
      .select('student_id')
      .eq('event_id', eventId)
      .eq('session_date', sessionDate);
    attendedIds = new Set((att ?? []).map((a: any) => a.student_id as string));
  } else {
    const { data: att } = await supabase
      .from('live_attendance')
      .select('student_id')
      .eq('event_id', eventId);
    attendedIds = new Set((att ?? []).map((a: any) => a.student_id as string));
  }

  const absentRegs = regs.filter((r: any) =>
    !attendedIds.has(r.student_id) && (!allowList || allowList.has(r.student_id))
  );
  if (absentRegs.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No absent students' });
  }

  const t        = await getTenantSettings();
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  // Fall back to the event's own date (not today) so the reminder is dated to the
  // actual session even when no sessionDate is supplied by the caller.
  const targetDate = sessionDate ?? event.event_date ?? new Date().toISOString().slice(0, 10);

  let sent = 0;
  for (const reg of absentRegs) {
    const student = (reg as any).student as any;
    if (!student?.email) continue;

    const joinUrl = reg.join_token ? `${t.appUrl}/api/join?token=${reg.join_token}` : undefined;
    const html = missedSessionEmail({
      name:         student.full_name ?? 'there',
      eventTitle:   event.title ?? 'Live Session',
      sessionDate:  targetDate,
      joinUrl,
      meetingLink:  event.meeting_link ?? undefined,
      dashboardUrl: `${t.appUrl}/student`,
      branding,
    });

    try {
      await resend.emails.send({
        from: FROM,
        to:   student.email,
        subject: `We missed you at ${event.title ?? 'the session'}`,
        html,
      });
      sent++;
    } catch (err) {
      console.error('[nudge-absent] send error for student', reg.student_id, err);
    }
  }

  return NextResponse.json({ sent, total: absentRegs.length });
}
