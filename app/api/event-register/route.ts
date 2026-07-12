import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { confirmationEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > 65536) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Require authenticated student
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase } = auth;

  // Confirm they are a student
  const { data: student } = await supabase
    .from('students')
    .select('id, email, full_name, cohort_id')
    .eq('id', user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { formId, responses: formResponses } = body;
  if (!formId) {
    return NextResponse.json({ error: 'formId is required' }, { status: 400 });
  }

  // Confirm the event exists, is published, and the student's cohort is assigned
  const { data: event } = await supabase
    .from('events')
    .select('id, title, slug, event_date, event_time, timezone, location, meeting_link, status, cohort_ids')
    .eq('id', formId)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if (event.status !== 'published') return NextResponse.json({ error: 'Event not available' }, { status: 403 });
  if (!student.cohort_id || !(event.cohort_ids ?? []).includes(student.cohort_id)) {
    return NextResponse.json({ error: 'Not enrolled in this event' }, { status: 403 });
  }

  // Register via RPC
  const { data: result, error: rpcError } = await supabase.rpc('register_event_attendee', {
    p_event_id:   formId,
    p_student_id: student.id,
  });

  if (rpcError) {
    console.error('[event-register] rpc error:', rpcError.message);
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  if (result?.error === 'already_registered') {
    const { data: existingReg } = await supabase
      .from('event_registrations')
      .select('join_token')
      .eq('event_id', formId)
      .eq('student_id', student.id)
      .single();
    return NextResponse.json({ success: true, join_token: existingReg?.join_token ?? null });
  }

  // Fetch the join_token assigned to this registration
  const { data: regRow } = await supabase
    .from('event_registrations')
    .select('join_token')
    .eq('event_id', formId)
    .eq('student_id', student.id)
    .single();
  const joinToken: string | null = regRow?.join_token ?? null;

  // Save custom form field responses if provided
  if (formResponses && typeof formResponses === 'object' && Object.keys(formResponses).length > 0) {
    await supabase
      .from('event_registrations')
      .update({ responses: formResponses })
      .eq('event_id', formId)
      .eq('student_id', student.id);
  }

  // Send confirmation email (fire-and-forget)
  if (process.env.RESEND_API_KEY && student.email) {
    const t       = await getTenantSettings();
    const FROM    = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
    const subject = `You're registered: ${event.title || 'Event'}`;
    const displayName = formResponses?.first_name || formResponses?.full_name || student.full_name || student.email;
    const html = confirmationEmail({
      name:          displayName,
      eventTitle:    event.title      || '',
      eventDate:     event.event_date ? String(event.event_date) : '',
      eventTime:     event.event_time ? String(event.event_time) : '',
      eventTimezone: event.timezone   || '',
      eventLocation: event.location   || '',
      meetingLink:   event.meeting_link || '',
      joinUrl:       joinToken ? `${t.appUrl}/api/join?token=${joinToken}` : undefined,
      formUrl:       `${t.appUrl}/${event.slug ?? formId}`,
      branding,
    });

    resend.emails
      .send({ from: FROM, to: student.email, subject, html })
      .catch((err: unknown) => console.error('[event-register] confirmation email failed:', err));
  }

  return NextResponse.json({ success: true, join_token: joinToken });
}
