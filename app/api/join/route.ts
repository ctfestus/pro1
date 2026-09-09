import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isScheduledSessionDate, eventLocalDate } from '@/lib/event-sessions';
import { studentsStillInCohorts } from '@/lib/cohort-roster';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length < 8) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = adminClient();

  // Step 1: look up registration by token
  const { data: reg, error: regError } = await supabase
    .from('event_registrations')
    .select('event_id, student_id')
    .eq('join_token', token)
    .maybeSingle();

  if (regError) {
    console.error('[join] registration lookup error:', regError.message, regError.details);
    return new NextResponse('Internal error', { status: 500 });
  }

  if (!reg) {
    console.warn('[join] token not found:', token);
    return new NextResponse('Not found', { status: 404 });
  }

  // Step 2: get the meeting link for the event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('meeting_link, event_date, recurrence, recurrence_end_date, recurrence_days, timezone, cohort_ids')
    .eq('id', reg.event_id)
    .maybeSingle();

  if (eventError) {
    console.error('[join] event lookup error:', eventError.message);
    return new NextResponse('Internal error', { status: 500 });
  }

  // A join token is written once, when the event is assigned to a cohort, and is never revoked.
  // Filtering the attendance report stopped a departed student being *listed*; without this check
  // the link they were emailed at the time stayed a working key to the meeting, and every click
  // recorded them present at a session that is no longer theirs. This is the same rule the events
  // policy applies to the event page, so it admits exactly who could already open the event.
  // An event naming no cohorts is left alone: nothing to check membership against, and locking a
  // running session's attendees out over an unassignment would be a worse bug than the one fixed.
  let admitted: Set<string>;
  try {
    admitted = await studentsStillInCohorts(supabase, [reg.student_id], (event as any)?.cohort_ids ?? []);
  } catch (err) {
    console.error('[join] membership check failed:', err);
    return new NextResponse('Internal error', { status: 500 });
  }
  if (!admitted.has(reg.student_id)) {
    console.warn('[join] token holder is no longer in a cohort this event is assigned to:', reg.student_id);
    return new NextResponse('This session is not available on your account any more.', { status: 403 });
  }

  const rawLink: string | null = event?.meeting_link ?? null;
  if (!rawLink) {
    return new NextResponse('No meeting link configured for this event', { status: 404 });
  }

  // Normalize: add https:// if the stored link has no protocol
  const normalized = /^https?:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`;

  let safeUrl: string;
  try {
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return new NextResponse('Invalid meeting URL', { status: 400 });
    }
    safeUrl = u.toString();
  } catch {
    return new NextResponse('Invalid meeting URL', { status: 400 });
  }

  // Record attendance only when the click falls on an actual scheduled session
  // date. Use the event's timezone -- a click at the correct local time near UTC
  // midnight must not be stamped (and gated) against the wrong calendar day.
  const today = eventLocalDate(event?.timezone);
  if (isScheduledSessionDate(event, today)) {
    const { error: attendanceError } = await supabase
      .from('live_attendance')
      .upsert(
        { event_id: reg.event_id, student_id: reg.student_id, session_date: today, joined_at: new Date().toISOString() },
        { onConflict: 'event_id,student_id,session_date' }
      );

    if (attendanceError) {
      console.error('[join] attendance upsert error:', attendanceError.message);
      // Non-fatal: still redirect even if attendance recording fails
    }
  }

  return NextResponse.redirect(safeUrl);
}
