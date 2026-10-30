/**
 * Cron -- Event reminder emails.
 * Triggered by QStash every 15 minutes (see README "Required scheduled jobs").
 *
 * Every session gets two reminders per student: one once it is less than 24 hours away, and one
 * once it is less than an hour away. A session first seen inside its last hour (created late, or
 * the schedule was down) gets only the one-hour reminder. Works for one-time and recurring events,
 * in each event's own timezone.
 *
 * Every email carries the student's tracked /api/join link, so a click records attendance. A
 * current cohort member with no registration yet is registered here first; a student who cannot
 * be given a token is skipped rather than sent the raw meeting link.
 *
 * email_dedup, keyed per event + session date + student, makes each reminder go out once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { reminderEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { studentsStillInCohorts } from '@/lib/cohort-roster';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { eventLocalDate, getNextSessionStart } from '@/lib/event-sessions';
import { chunkIds, fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

// Resend takes up to 100 per batch; 50 keeps the dedupe keys of one batch in a single
// .in() filter short enough for the query string.
const BATCH_SIZE = 50;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Kind = '24h' | '1h';
const DEDUPE_TYPE: Record<Kind, string> = { '24h': 'event_reminder_24h', '1h': 'event_reminder_1h' };

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

  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  // events.cohort_ids is the source of truth for who an event is assigned to. cohort_assignments is
  // a synced copy that can lag behind a re-assignment, so it is not read here at all.
  // Paged: past the PostgREST row cap a single read is silently truncated, not an error.
  let events: any[];
  try {
    events = await fetchAllRows<any>((from, to) => supabase
      .from('events')
      .select('id, title, slug, event_date, event_time, timezone, location, meeting_link, event_type, recurrence, recurrence_end_date, recurrence_days, cohort_ids', { count: 'exact' })
      .eq('status', 'published')
      .order('id')
      .range(from, to));
  } catch (err) {
    console.error('[cron/event-reminders] events lookup failed', err);
    return NextResponse.json({ error: 'Events lookup failed' }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let sessions = 0;

  for (const event of events) {
    const next = getNextSessionStart(event, now);
    if (!next) continue;
    const msLeft = next.start.getTime() - now.getTime();
    if (msLeft > DAY_MS) continue;
    const kind: Kind = msLeft <= HOUR_MS ? '1h' : '24h';
    // An untimed event "starts" at midnight, so an hour-before reminder would land at 11pm.
    if (kind === '1h' && !next.timed) continue;

    const cohortIds: string[] = Array.isArray(event.cohort_ids) ? event.cohort_ids : [];
    if (!cohortIds.length) {
      console.log(`[cron/event-reminders] event=${event.id} is assigned to no cohort; skipping`);
      continue;
    }
    sessions++;

    try {
      const result = await remindSession(supabase, event, next.date, kind, cohortIds, { FROM, branding, appUrl: t.appUrl, now });
      sent += result.sent;
      skipped += result.skipped;
    } catch (err) {
      // One event failing must not stop the rest. Reminders it had not claimed are picked up by the
      // next run; any it claimed and could not settle are not resent (see remindSession).
      console.error('[cron/event-reminders] event failed', event.id, err);
    }
  }

  console.log(`[cron/event-reminders] sessions=${sessions} sent=${sent} skipped=${skipped}`);
  return NextResponse.json({ ok: true, sessions, sent, skipped });
}

async function remindSession(
  supabase: ReturnType<typeof adminClient>,
  event: any,
  sessionDate: string,
  kind: Kind,
  cohortIds: string[],
  ctx: { FROM: string; branding: any; appUrl: string; now: Date },
): Promise<{ sent: number; skipped: number }> {
  // Recipients are the event's cohorts as they are now. Registrations are never removed when a
  // student moves cohort, so they decide nobody's place on the list -- only their join token.
  const cohortStudents = await fetchAllRowsByIds<{ id: string; full_name: string | null; email: string | null }>(
    cohortIds,
    (chunk, from, to) => supabase.from('students')
      .select('id, full_name, email', { count: 'exact' })
      .in('cohort_id', chunk)
      .order('id')
      .range(from, to),
  );

  const stillIn = await studentsStillInCohorts(supabase, cohortStudents.map(s => s.id), cohortIds);
  const students = cohortStudents.filter(s =>
    stillIn.has(s.id) && EMAIL_RE.test((s.email ?? '').trim().toLowerCase()));
  if (!students.length) return { sent: 0, skipped: 0 };

  // Only an online session with a meeting link needs a token: the email's Join button is the
  // tracked link. Without a meeting link the email links to the event page, as before.
  const needsJoinLink = !!event.meeting_link;
  const tokens = needsJoinLink ? await joinTokens(supabase, event.id, students.map(s => s.id)) : new Map<string, string>();

  const today = eventLocalDate(event.timezone, ctx.now);
  const day: 'today' | 'tomorrow' = sessionDate === today ? 'today' : 'tomorrow';
  const timing = kind === '1h' ? 'in 1 hour' : day;
  const subject = kind === '1h' ? `Starting in 1 hour: ${event.title}` : `Reminder: "${event.title}" is ${day}`;
  const eventTime = event.event_time ? String(event.event_time).slice(0, 5) : '';
  const formUrl = `${ctx.appUrl}/${event.slug ?? event.id}`;

  const type = DEDUPE_TYPE[kind];
  const keyOf = (studentId: string) => `${event.id}:${sessionDate}:${studentId}`;
  let sent = 0;
  let skipped = 0;

  const recipients = students.filter(s => {
    if (!needsJoinLink || tokens.has(s.id)) return true;
    console.error(`[cron/event-reminders] event=${event.id} student=${s.id} has no join token; not sending an untracked link`);
    skipped++;
    return false;
  });

  for (const batch of chunkIds(recipients, BATCH_SIZE)) {
    // Claim first. Insert-only: a reminder already claimed, by this run or any other, comes back
    // missing and is not sent again. A run that dies after claiming leaves its claims in place, so
    // at worst a reminder is missed, never sent twice.
    const { data: claimed, error: claimError } = await supabase.from('email_dedup')
      .upsert(batch.map(s => ({ dedupe_key: keyOf(s.id), type, status: 'pending' })),
        { onConflict: 'dedupe_key,type', ignoreDuplicates: true })
      .select('dedupe_key');
    if (claimError) throw new Error(`dedupe claim failed: ${claimError.message}`);
    const ownedKeys = new Set((claimed ?? []).map((r: any) => r.dedupe_key as string));
    const owned = batch.filter(s => ownedKeys.has(keyOf(s.id)));
    skipped += batch.length - owned.length;
    if (!owned.length) continue;
    const keys = owned.map(s => keyOf(s.id));
    const release = async () => {
      const { error } = await supabase.from('email_dedup').delete().eq('type', type).in('dedupe_key', keys);
      // Left in place, these reminders will not be retried: make that visible.
      if (error) console.error(`[cron/event-reminders] event=${event.id} could not release ${keys.length} claim(s); those reminders will not be retried`, error.message);
    };

    // Nothing has gone out if building the emails fails, so release the claims for the next run.
    const payloads = await Promise.all(owned.map(async student => {
      const token = tokens.get(student.id);
      const joinUrl = token ? `${ctx.appUrl}/api/join?token=${token}` : undefined;
      const name = student.full_name || 'there';
      const fallbackHtml = reminderEmail({
        name,
        eventTitle:    event.title || '',
        eventDate:     sessionDate,
        eventTime,
        eventTimezone: event.timezone || '',
        eventLocation: event.location || '',
        meetingLink:   event.meeting_link || '',
        joinUrl,
        formUrl,
        isOneHour:     kind === '1h',
        day,
        branding:      ctx.branding,
      });
      const rendered = await applyEmailTemplate({
        key: 'event_reminder', fallbackSubject: subject, fallbackHtml,
        variables: {
          student_name: name, event_title: event.title || '', reminder_timing: timing,
          event_time_display: [sessionDate, eventTime, event.timezone].filter(Boolean).join(' '),
          event_location: event.location || (event.meeting_link ? 'Online' : 'To be announced'),
        },
        branding: ctx.branding,
      });
      return { from: ctx.FROM, to: (student.email ?? '').trim().toLowerCase(), subject: rendered.subject, html: rendered.html };
    })).catch(async err => { await release(); throw err; });

    // Resend reports a rejected request in the result. Nothing went out, so drop the claims and let
    // the next run retry. A thrown error is left claimed: the batch may have been accepted.
    const { error: sendError } = await resend.batch.send(payloads);
    if (sendError) {
      console.error('[cron/event-reminders] batch send failed:', sendError);
      await release();
      continue;
    }
    sent += owned.length;
    await supabase.from('email_dedup').update({ status: 'sent' }).eq('type', type).in('dedupe_key', keys);
  }

  return { sent, skipped };
}

// Join token per student, registering anyone in the cohort who has no registration yet (they
// joined the cohort after the event was assigned). Same RPC as auto-registration and /api/event-register.
async function joinTokens(supabase: ReturnType<typeof adminClient>, eventId: string, studentIds: string[]) {
  const read = async (ids: string[]) => {
    const tokens = new Map<string, string>();
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await supabase
        .from('event_registrations').select('student_id, join_token').eq('event_id', eventId).in('student_id', chunk);
      // A failed read looks like "nobody registered"; fail the event instead of registering blind.
      if (error) throw new Error(`registration lookup failed: ${error.message}`);
      for (const r of data ?? []) if (r.join_token) tokens.set(r.student_id, r.join_token);
    }
    return tokens;
  };

  const tokens = await read(studentIds);
  const missing = studentIds.filter(id => !tokens.has(id));
  if (!missing.length) return tokens;

  for (const studentId of missing) {
    const { error } = await supabase.rpc('register_event_attendee', { p_event_id: eventId, p_student_id: studentId });
    if (error) console.error('[cron/event-reminders] register failed', eventId, studentId, error.message);
  }
  for (const [id, token] of await read(missing)) tokens.set(id, token);
  return tokens;
}
