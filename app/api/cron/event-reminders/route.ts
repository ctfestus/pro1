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
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
// A pending dedupe row older than this belongs to a run that died before marking it sent.
const STALE_PENDING_MS = 10 * 60_000;
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
      // One event failing must not stop the rest. Its dedupe rows stay unsent or go stale, so the
      // next run retries it.
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

  // Where each student's reminder stands: sent, being sent by a live run (fresh pending), left
  // pending by a run that died (stale, grouped by that run's lease), or never claimed.
  const type = DEDUPE_TYPE[kind];
  const prefix = `${event.id}:${sessionDate}:`;
  const keyOf = (studentId: string) => `${prefix}${studentId}`;
  const settled = new Set<string>();
  const staleByLease = new Map<string, string[]>();
  for (const keys of chunkIds(students.map(s => keyOf(s.id)), 50)) {
    const { data: rows, error } = await supabase
      .from('email_dedup').select('dedupe_key, status, sent_at').eq('type', type).in('dedupe_key', keys);
    if (error) throw new Error(`dedupe lookup failed: ${error.message}`);
    for (const r of rows ?? []) {
      const stale = ctx.now.getTime() - new Date(r.sent_at).getTime() >= STALE_PENDING_MS;
      if (r.status === 'pending' && stale) {
        staleByLease.set(r.sent_at, [...(staleByLease.get(r.sent_at) ?? []), r.dedupe_key]);
      } else {
        settled.add(r.dedupe_key);
      }
    }
  }

  const today = eventLocalDate(event.timezone, ctx.now);
  const day: 'today' | 'tomorrow' = sessionDate === today ? 'today' : 'tomorrow';
  const timing = kind === '1h' ? 'in 1 hour' : day;
  const subject = kind === '1h' ? `Starting in 1 hour: ${event.title}` : `Reminder: "${event.title}" is ${day}`;
  const eventTime = event.event_time ? String(event.event_time).slice(0, 5) : '';
  const formUrl = `${ctx.appUrl}/${event.slug ?? event.id}`;

  const payloads = new Map<string, EmailPayload>();
  let skipped = 0;

  for (const student of students) {
    const key = keyOf(student.id);
    if (settled.has(key)) { skipped++; continue; }
    const token = tokens.get(student.id);
    if (needsJoinLink && !token) {
      console.error(`[cron/event-reminders] event=${event.id} student=${student.id} has no join token; not sending an untracked link`);
      skipped++;
      continue;
    }
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
    payloads.set(key, { from: ctx.FROM, to: (student.email ?? '').trim().toLowerCase(), subject: rendered.subject, html: rendered.html });
  }

  const lock = { supabase, type, prefix };
  let sent = 0;

  // A dead run's batch is retried as the same batch -- the rows it claimed share its lease -- so the
  // idempotency key matches and Resend drops it if the first attempt was in fact delivered.
  for (const [oldLease, keys] of staleByLease) {
    const lease = newLease();
    const { data: reclaimed, error } = await supabase.from('email_dedup')
      .update({ sent_at: lease })
      .eq('type', type).eq('status', 'pending').eq('sent_at', oldLease).like('dedupe_key', `${prefix}%`)
      .select('dedupe_key');
    if (error) throw new Error(`dedupe reclaim failed: ${error.message}`);
    // Empty when a rival run reclaimed it first: the conditional update matches nothing for the loser.
    const owned = (reclaimed ?? []).map((r: any) => r.dedupe_key as string);
    const orphaned = owned.filter(k => !payloads.has(k) || !keys.includes(k));
    if (orphaned.length) await releaseLock(lock, lease, orphaned);
    sent += await sendBatch(lock, lease, owned.filter(k => !orphaned.includes(k)), payloads);
  }

  // Never claimed: insert-only, so a key another run already holds is not taken over.
  const staleKeys = new Set([...staleByLease.values()].flat());
  const fresh = [...payloads.keys()].filter(k => !staleKeys.has(k)).sort();
  for (const keys of chunkIds(fresh, BATCH_SIZE)) {
    const lease = newLease();
    const { data: inserted, error } = await supabase.from('email_dedup')
      .upsert(keys.map(k => ({ dedupe_key: k, type, status: 'pending', sent_at: lease })),
        { onConflict: 'dedupe_key,type', ignoreDuplicates: true })
      .select('dedupe_key');
    if (error) throw new Error(`dedupe claim failed: ${error.message}`);
    const owned = (inserted ?? []).map((r: any) => r.dedupe_key as string);
    skipped += keys.length - owned.length;
    sent += await sendBatch(lock, lease, owned, payloads);
  }

  return { sent, skipped };
}

type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
type Lock = { supabase: ReturnType<typeof adminClient>; type: string; prefix: string };

// Lease token for one batch's claims, stored in sent_at. Strictly increasing within a process so
// two batches never share one; release and mark-sent are scoped to it, so a run that outlived the
// stale window cannot settle rows another run has since reclaimed.
let lastLeaseMs = 0;
function newLease(): string {
  lastLeaseMs = Math.max(Date.now(), lastLeaseMs + 1);
  return new Date(lastLeaseMs).toISOString();
}

async function releaseLock({ supabase, type, prefix }: Lock, lease: string, keys?: string[]) {
  let q = supabase.from('email_dedup').delete()
    .eq('type', type).eq('status', 'pending').eq('sent_at', lease).like('dedupe_key', `${prefix}%`);
  if (keys) q = q.in('dedupe_key', keys);
  const { error } = await q;
  if (error) console.error('[cron/event-reminders] failed to release pending claims', error.message);
}

// Sends one claimed batch and settles its claims. Returns how many emails went out.
async function sendBatch(lock: Lock, lease: string, keys: string[], payloads: Map<string, EmailPayload>): Promise<number> {
  if (!keys.length) return 0;
  const sorted = [...keys].sort();
  // Deterministic for this exact set of reminders. Resend keeps keys about 24 hours, far longer
  // than the stale window, so a retry of a batch it already accepted is a no-op there.
  const idempotencyKey = `${lock.type}/${createHash('sha256').update(sorted.join('\n')).digest('hex')}`;

  let sendError: { name?: string; message?: string } | null = null;
  try {
    ({ error: sendError } = await resend.batch.send(sorted.map(k => payloads.get(k)!), { idempotencyKey }));
  } catch (err) {
    // Unknown outcome: Resend may have accepted it. Leave the claims pending; they go stale and
    // the retry reuses the idempotency key.
    console.error('[cron/event-reminders] batch send threw:', err);
    return 0;
  }

  if (sendError) {
    if (sendError.name === 'concurrent_idempotent_requests') return 0; // the same batch is in flight elsewhere
    if (sendError.name !== 'invalid_idempotent_request') {
      // Rejected outright, so nothing went out: release now and let the next run retry.
      console.error('[cron/event-reminders] batch send failed:', sendError);
      await releaseLock(lock, lease);
      return 0;
    }
    // The key was already used for this set of reminders with different content (the wording
    // changed between attempts, e.g. tomorrow became today): it was delivered. Settle it.
    console.log('[cron/event-reminders] batch already sent under its idempotency key; marking sent');
  }

  const { error: markError } = await lock.supabase.from('email_dedup')
    .update({ status: 'sent' })
    .eq('type', lock.type).eq('status', 'pending').eq('sent_at', lease).like('dedupe_key', `${lock.prefix}%`);
  // Left pending, the claims go stale and the retry is dropped by Resend under the same key.
  if (markError) console.error('[cron/event-reminders] mark-sent failed', markError.message);
  return sendError ? 0 : sorted.length;
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
