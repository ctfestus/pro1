import 'server-only';
import { Resend } from 'resend';
import { confirmationEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { eventLocalDate, getNextScheduledSessionDate } from '@/lib/event-sessions';
import { displayTime } from '@/lib/events/public-event';

/**
 * The confirmation a public registrant gets. For an online event it carries their tracked
 * /api/join link: the meeting link itself is never shown on the page, so the address they typed
 * has to be theirs to get in. Sent again (same link) when the same address registers twice.
 */
export async function sendPublicRegistrationEmail(opts: {
  to: string;
  name: string;
  joinToken: string;
  event: {
    title: string;
    slug: string;
    event_date: string | null;
    event_time: string | null;
    timezone: string | null;
    location: string | null;
    event_type: string | null;
    meeting_link: string | null;
    recurrence?: string | null;
    recurrence_end_date?: string | null;
    recurrence_days?: number[] | null;
  };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { to, name, joinToken, event } = opts;
  const t = await getTenantSettings();
  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const online = event.event_type === 'virtual';
  // Same rule as the reminders: any event with a meeting link gets the tracked join link.
  const joinUrl = event.meeting_link ? `${t.appUrl}/api/join?token=${encodeURIComponent(joinToken)}` : undefined;
  const time = displayTime(event.event_time) ?? '';
  // A series shows its next session, as the page does, not the date it first started.
  const date = (event.event_date ? getNextScheduledSessionDate(event, eventLocalDate(event.timezone)) : null) ?? event.event_date ?? '';
  const subject = `You're registered: ${event.title || 'Event'}`;
  const html = confirmationEmail({
    name,
    eventTitle: event.title || '',
    eventDate: date,
    eventTime: time,
    eventTimezone: event.timezone ?? '',
    eventLocation: online ? '' : (event.location ?? ''),
    meetingLink: joinUrl ? (event.meeting_link ?? '') : '',
    joinUrl,
    formUrl: `${t.appUrl}/events/${encodeURIComponent(event.slug)}`,
    branding,
  });
  const rendered = await applyEmailTemplate({
    key: 'event_confirmation', fallbackSubject: subject, fallbackHtml: html,
    variables: {
      student_name: name,
      event_title: event.title || 'Event',
      event_time_display: [date, time, event.timezone].filter(Boolean).join(' '),
      event_location: online ? 'Online' : (event.location || 'To be announced'),
    },
    branding,
  });
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to, subject: rendered.subject, html: rendered.html });
  if (error) throw new Error(error.message);
}
