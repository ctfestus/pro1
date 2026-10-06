import { Resend } from 'resend';
import { confirmationEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { adminClient } from '@/lib/admin-client';

const resend = new Resend(process.env.RESEND_API_KEY);
const BATCH_SIZE = 100;

/**
 * For each student in the given cohorts, idempotently creates an event_registrations
 * row (via register_event_attendee RPC, which generates a join_token) and sends a
 * personalised confirmation email containing the tracked /api/join link.
 *
 * Safe to call multiple times -- the RPC skips already-registered students.
 */
export async function autoRegisterEventCohorts(
  supabase: ReturnType<typeof adminClient>,
  eventId: string,
  cohortIds: string[],
): Promise<void> {
  if (!cohortIds.length) return;

  const t = await getTenantSettings();
  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  const { data: event } = await supabase
    .from('events')
    .select('id, title, slug, event_date, event_time, timezone, location, meeting_link, event_type')
    .eq('id', eventId)
    .maybeSingle();

  if (!event) return;

  const { data: students } = await supabase
    .from('students')
    .select('id, email, full_name')
    .in('cohort_id', cohortIds);

  if (!students?.length) return;

  const batch: Parameters<typeof resend.batch.send>[0] = [];

  for (const student of students) {
    const email = (student.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

    const { error: rpcError } = await supabase.rpc('register_event_attendee', {
      p_event_id:   eventId,
      p_student_id: student.id,
    });
    if (rpcError) {
      console.error('[auto-register-event] rpc error:', rpcError.message);
      continue;
    }

    const { data: reg } = await supabase
      .from('event_registrations')
      .select('join_token')
      .eq('event_id', eventId)
      .eq('student_id', student.id)
      .maybeSingle();

    const joinToken: string | null = reg?.join_token ?? null;
    const joinUrl = joinToken ? `${t.appUrl}/api/join?token=${joinToken}` : undefined;
    const formUrl = `${t.appUrl}/${event.slug ?? eventId}`;

    const html = confirmationEmail({
      name:          student.full_name || student.email,
      eventTitle:    event.title       || '',
      eventDate:     event.event_date  ? String(event.event_date) : '',
      eventTime:     event.event_time  ? String(event.event_time) : '',
      eventTimezone: event.timezone    || '',
      eventLocation: event.location    || '',
      meetingLink:   event.meeting_link || '',
      joinUrl,
      formUrl,
      customTitle:  'You have been added to an upcoming event',
      customBody:   'You have been enrolled in an upcoming event. Your place is confirmed -- no registration needed.',
      branding,
    });

    const fallbackSubject = `Upcoming event: ${event.title || 'Event'}`;
    const rendered = await applyEmailTemplate({
      key: 'event_confirmation', fallbackSubject, fallbackHtml: html,
      variables: {
        student_name: student.full_name || student.email, event_title: event.title || 'Event',
        event_time_display: [event.event_date, event.event_time, event.timezone].filter(Boolean).join(' '),
        event_location: event.location || (event.meeting_link ? 'Online' : 'To be announced'),
      },
      branding,
    });
    batch.push({ from: FROM, to: email, subject: rendered.subject, html: rendered.html });

    if (batch.length >= BATCH_SIZE) {
      await resend.batch.send(batch.splice(0, BATCH_SIZE)).catch(err =>
        console.error('[auto-register-event] email batch error:', err),
      );
    }
  }

  if (batch.length) {
    await resend.batch.send(batch).catch(err =>
      console.error('[auto-register-event] email batch error:', err),
    );
  }
}
