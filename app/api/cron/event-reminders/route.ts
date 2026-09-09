/**
 * Daily cron -- Event reminder emails.
 * Triggered by QStash at 08:00 every day.
 * Sends a day-before reminder to all enrolled students for events happening tomorrow.
 * Works for one-time and recurring events. Uses sent_nudges to avoid duplicate sends.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { reminderEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { studentsStillInCohorts } from '@/lib/cohort-roster';

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
    console.error('[cron/event-reminders] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const supabase = adminClient();
  const now      = new Date();
  const today    = now.toISOString().slice(0, 10);

  // Tomorrow's date string and day-of-week (0=Sun, 1=Mon ... 6=Sat)
  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrow     = tomorrowDate.toISOString().slice(0, 10);
  const tomorrowDay  = tomorrowDate.getUTCDay();

  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
  const emailBatch:   EmailPayload[] = [];
  const nudgeRecords: { student_id: string; form_id: string; nudge_type: string }[] = [];
  let skipped  = 0;
  let movedOut = 0;

  // 1. All events that are assigned to at least one cohort
  const { data: assignments } = await supabase
    .from('cohort_assignments')
    .select('content_id, cohort_id')
    .eq('content_type', 'event');

  if (!assignments?.length) {
    console.log('[cron/event-reminders] No event cohort assignments found');
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  const eventIds = [...new Set(assignments.map(a => a.content_id))];

  const { data: events } = await supabase
    .from('events')
    .select('id, title, slug, event_date, event_time, timezone, location, meeting_link, event_type, recurrence, recurrence_end_date, recurrence_days, cohort_ids')
    .in('id', eventIds);

  if (!events?.length) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  // Filter events scheduled for tomorrow
  const scheduledTomorrow = events.filter((e: any) => {
    if (!e.event_date) return false;
    if (e.recurrence === 'once' || !e.recurrence) {
      return e.event_date === tomorrow;
    }
    // Recurring: started on or before tomorrow and not yet ended
    const days: number[] = Array.isArray(e.recurrence_days) ? e.recurrence_days : [];
    const onThisDay = days.length === 0 || days.includes(tomorrowDay);
    return onThisDay && e.event_date <= tomorrow && (!e.recurrence_end_date || e.recurrence_end_date >= tomorrow);
  });

  if (!scheduledTomorrow.length) {
    console.log('[cron/event-reminders] No events scheduled for tomorrow');
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  const scheduledIds = scheduledTomorrow.map((e: any) => e.id as string);

  // Build a map: eventId -> cohortIds
  const eventCohortMap = new Map<string, string[]>();
  for (const a of assignments) {
    if (!scheduledIds.includes(a.content_id)) continue;
    if (!eventCohortMap.has(a.content_id)) eventCohortMap.set(a.content_id, []);
    eventCohortMap.get(a.content_id)!.push(a.cohort_id);
  }

  // 2. Recent nudges to skip duplicates
  const since1Day = new Date(now.getTime() - 86400000).toISOString();
  const { data: recentNudges } = await supabase
    .from('sent_nudges')
    .select('student_id, form_id')
    .eq('nudge_type', 'event_reminder')
    .in('form_id', scheduledIds)
    .gte('sent_at', since1Day);

  const nudgedSet = new Set<string>();
  for (const n of recentNudges ?? []) nudgedSet.add(`${n.student_id}|${n.form_id}`);

  // 3. For each scheduled event, email all enrolled students (from event_registrations)
  for (const event of scheduledTomorrow) {
    const cohortIds = eventCohortMap.get(event.id) ?? [];
    if (!cohortIds.length) continue;

    // Enrolled students are those with event_registrations rows. A registration is written once,
    // when the event is assigned to a cohort, and never removed, so it has to be checked against
    // the student's current cohort -- otherwise someone moved onto a subscription months ago keeps
    // getting reminders for their old cohort's session.
    const { data: allRegistrations, error: registrationsError } = await supabase
      .from('event_registrations')
      .select('student_id, join_token, student:students(full_name, email)')
      .eq('event_id', event.id);

    // Reading the error matters more here than it looks: a failed query returns no rows, which is
    // indistinguishable from "nobody was ever registered" and opens the fallback below that mails
    // the entire current cohort. Skip the event instead.
    if (registrationsError) {
      console.error('[cron/event-reminders] registration lookup failed for event', event.id, registrationsError.message);
      continue;
    }

    // events.cohort_ids is the source of truth for who an event is assigned to. cohort_assignments
    // is a synced copy that can lag behind a re-assignment, so it only decides which events to look
    // at -- never who hears about them. Falling back to it when the array is empty would have
    // emailed the cohort an event had just been taken away from.
    const eventCohortIds: string[] = Array.isArray((event as any).cohort_ids) ? (event as any).cohort_ids : [];
    if (!eventCohortIds.length) {
      console.log(`[cron/event-reminders] event=${event.id} is assigned to no cohort; skipping`);
      continue;
    }

    let stillEnrolled: Set<string>;
    try {
      stillEnrolled = await studentsStillInCohorts(
        supabase,
        (allRegistrations ?? []).map((r: any) => r.student_id as string),
        eventCohortIds,
      );
    } catch (err) {
      // Skip this event rather than abort the run: sending to an unchecked list is the bug being
      // fixed, and tomorrow is not the last chance -- sent_nudges keeps a retry from duplicating.
      console.error('[cron/event-reminders] roster lookup failed for event', event.id, err);
      continue;
    }
    const registrations = (allRegistrations ?? []).filter((r: any) => stillEnrolled.has(r.student_id));
    const droppedThisEvent = (allRegistrations?.length ?? 0) - registrations.length;
    if (droppedThisEvent > 0) {
      movedOut += droppedThisEvent;
      // A registration with nobody in the cohort behind it is not an error, but it is worth
      // seeing: it means the cohort moved on and the registration row did not.
      console.log(`[cron/event-reminders] event=${event.id} skipped ${droppedThisEvent} registration(s) no longer in an assigned cohort`);
    }

    if (!allRegistrations?.length) {
      // Fall back to the students currently in the assigned cohorts. This path is for an event
      // whose attendees were never auto-registered at all. It deliberately does NOT cover a list
      // the filter emptied: if everybody registered has since left, the answer is to send nothing,
      // not to mail current members who were never registered and would get no tracked join link.
      const { data: cohortStudents } = await supabase
        .from('students')
        .select('id, full_name, email')
        .in('cohort_id', eventCohortIds);

      let fallbackEligible: Set<string>;
      try {
        fallbackEligible = await studentsStillInCohorts(
          supabase,
          (cohortStudents ?? []).map((s: any) => s.id as string),
          eventCohortIds,
        );
      } catch (err) {
        console.error('[cron/event-reminders] fallback roster lookup failed for event', event.id, err);
        continue;
      }

      for (const student of cohortStudents ?? []) {
        if (!fallbackEligible.has(student.id)) { movedOut++; continue; }
        const email = (student.email ?? '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        if (nudgedSet.has(`${student.id}|${event.id}`)) { skipped++; continue; }

        const formUrl = `${t.appUrl}/${event.slug ?? event.id}`;
        emailBatch.push({
          from: FROM,
          to:   email,
          subject: `Reminder: "${event.title}" is tomorrow`,
          html: reminderEmail({
            name:          student.full_name || 'there',
            eventTitle:    event.title       || '',
            eventDate:     tomorrow,
            eventTime:     event.event_time  ? String(event.event_time) : '',
            eventTimezone: event.timezone    || '',
            eventLocation: event.location    || '',
            meetingLink:   event.meeting_link || '',
            formUrl,
            branding,
          }),
        });
        nudgeRecords.push({ student_id: student.id, form_id: event.id, nudge_type: 'event_reminder' });
      }
      continue;
    }

    for (const reg of registrations) {
      const studentData = reg.student as any;
      const email = (studentData?.email ?? '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      if (nudgedSet.has(`${reg.student_id}|${event.id}`)) { skipped++; continue; }

      const joinToken: string | null = reg.join_token ?? null;
      const joinUrl  = joinToken ? `${t.appUrl}/api/join?token=${joinToken}` : undefined;
      const formUrl  = `${t.appUrl}/${event.slug ?? event.id}`;

      emailBatch.push({
        from: FROM,
        to:   email,
        subject: `Reminder: "${event.title}" is tomorrow`,
        html: reminderEmail({
          name:          studentData?.full_name || 'there',
          eventTitle:    event.title            || '',
          eventDate:     tomorrow,
          eventTime:     event.event_time       ? String(event.event_time) : '',
          eventTimezone: event.timezone         || '',
          eventLocation: event.location         || '',
          meetingLink:   event.meeting_link     || '',
          joinUrl,
          formUrl,
          branding,
        }),
      });
      nudgeRecords.push({ student_id: reg.student_id, form_id: event.id, nudge_type: 'event_reminder' });
    }
  }

  // 4. Send
  if (!emailBatch.length) {
    console.log(`[cron/event-reminders] sent=0 skipped=${skipped} movedOut=${movedOut}`);
    return NextResponse.json({ ok: true, sent: 0, skipped, movedOut });
  }

  const sentKeySet = new Set<string>();
  const batches    = chunk(emailBatch, BATCH_SIZE);
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchNudges = nudgeRecords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      await resend.batch.send(batches[i]);
      sent += batches[i].length;
      for (const n of batchNudges) sentKeySet.add(`${n.student_id}|${n.form_id}`);
    } catch (err) {
      console.error('[cron/event-reminders] batch send failed:', err);
    }
  }

  if (sentKeySet.size) {
    const toInsert = nudgeRecords.filter(n => sentKeySet.has(`${n.student_id}|${n.form_id}`));
    if (toInsert.length) await supabase.from('sent_nudges').insert(toInsert);
  }

  console.log(`[cron/event-reminders] sent=${sent} skipped=${skipped} movedOut=${movedOut}`);
  return NextResponse.json({ ok: true, sent, skipped, movedOut });
}
