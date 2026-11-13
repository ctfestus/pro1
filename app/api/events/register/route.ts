import { NextRequest, NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { normalizeGuestEmail, normalizeGuestName } from '@/lib/books/guest-access';
import { emailHash, guestRateLimited } from '@/lib/books/guest-purchase';
import { eventIsOpenForRegistration, publicEventFields } from '@/lib/events/public-event';
import { validateRegistrationResponses } from '@/lib/events/registration';
import { sendPublicRegistrationEmail } from '@/lib/events/confirmation-email';

// POST /api/events/register  { eventId, name, email, responses }  -> { message }
//
// Registration for an event open to the public (migration 244), with or without an account. A
// signed-in visitor is registered under their account's email; anyone else under the address they
// type. The join link only ever goes out by email, so the answer is the same whether this made a
// new registration or the address was already registered (the email is simply sent again).
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE = { message: 'You are registered. Check your email for the confirmation.' };

export async function POST(req: NextRequest) {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > 65536) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const eventId = typeof body?.eventId === 'string' && UUID.test(body.eventId) ? body.eventId : null;
  if (!eventId) return NextResponse.json({ error: 'A valid event id is required.' }, { status: 400 });

  // Signed in is optional. A bad or expired token just registers as a guest.
  let studentId: string | null = null;
  let accountEmail: string | null = null;
  if (req.headers.get('authorization')) {
    const auth = await requireUser(req);
    if (!isAuthError(auth)) {
      // Linked only when the account has a students row (the column references it).
      const { data: student } = await auth.serviceDb.from('students').select('id').eq('id', auth.actor.id).maybeSingle();
      studentId = student?.id ?? null;
      accountEmail = normalizeGuestEmail(auth.actor.email);
    }
  }

  const name = normalizeGuestName(body?.name);
  if (!name) return NextResponse.json({ error: 'Enter your full name (letters only).' }, { status: 400 });
  const email = accountEmail ?? normalizeGuestEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  if (await guestRateLimited(req, [['event-ip', 'ip', 200, 60 * 60]])) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  const db = adminClient();
  try {
    const { data: event, error } = await db
      .from('events')
      .select('id, title, slug, status, public_registration, event_date, event_time, timezone, location, event_type, meeting_link, recurrence, recurrence_end_date, recurrence_days, fields')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw error;
    if (!event || event.status !== 'published' || event.public_registration !== true) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }
    if (!eventIsOpenForRegistration(event)) {
      return NextResponse.json({ error: 'This event has ended.' }, { status: 409 });
    }
    const checked = validateRegistrationResponses(publicEventFields(event.fields), body?.responses);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    // Counted only for a real, open event, so junk ids cannot use up anyone's allowance. Per event
    // rather than tenant-wide, so a flood on one event cannot close registration on the rest.
    if (await guestRateLimited(req, [
      ['event-email', emailHash(email), 6, 60 * 60],
      [`event-${event.id}`, 'all', 2000, 60 * 60],
    ])) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
    }

    const { data: result, error: rpcError } = await db.rpc('register_event_publicly', {
      p_event_id: event.id,
      p_name: name,
      p_email: email,
      p_responses: checked.responses,
      p_student_id: studentId,
    });
    if (rpcError) throw rpcError;
    const status = (result as any)?.status;
    if (status === 'closed') return NextResponse.json({ error: 'Registration for this event is closed.' }, { status: 409 });
    if (status === 'full') return NextResponse.json({ error: 'This event is full.' }, { status: 409 });
    const joinToken = (result as any)?.join_token;
    if ((status !== 'registered' && status !== 'existing') || typeof joinToken !== 'string') {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }

    // A repeat registration resends under the name first given, not whatever was typed this time.
    const storedName = typeof (result as any)?.name === 'string' ? (result as any).name : name;
    after(async () => {
      try {
        await sendPublicRegistrationEmail({ to: email, name: storedName, joinToken, event });
      } catch (e: any) {
        console.error('[events/register] confirmation email failed', event.id, e?.message ?? e);
      }
    });
    return NextResponse.json(DONE, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[events/register] failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not register you. Try again.' }, { status: 500 });
  }
}
