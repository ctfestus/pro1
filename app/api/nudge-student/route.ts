import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { nudgeEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { buildStatusRows } from '@/lib/tracking-report';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

type NudgeStatus = 'not_started' | 'stalled' | 'in_progress' | 'failed';
const NUDGE_STATUSES: NudgeStatus[] = ['not_started', 'stalled', 'in_progress', 'failed'];

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { studentEmail, formId, status } = body;

  if (!studentEmail || !formId || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!NUDGE_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'status must be not_started, stalled, in_progress, or failed' }, { status: 400 });
  }

  // Look up content across courses, events, virtual_experiences, and assignments.
  // cohort_ids comes along because owning the content is not on its own a licence to email an
  // arbitrary address -- the recipient has to be a student the content actually reaches.
  const [{ data: course }, { data: event }, { data: ve }, { data: assignment }] = await Promise.all([
    supabase.from('courses').select('user_id, title, slug, cover_image, cohort_ids, status').eq('id', formId).maybeSingle(),
    supabase.from('events').select('user_id, title, slug, cover_image, cohort_ids, status').eq('id', formId).maybeSingle(),
    supabase.from('virtual_experiences').select('user_id, title, slug, cover_image, cohort_ids, status').eq('id', formId).maybeSingle(),
    supabase.from('assignments').select('created_by, title, cover_image, cohort_ids, status, type, config').eq('id', formId).maybeSingle(),
  ]);

  let content: any = null;
  let contentType: string = 'course';

  if (course)           { content = course;      contentType = 'course'; }
  else if (event)       { content = event;        contentType = 'event'; }
  else if (ve)          { content = ve;           contentType = 'virtual_experience'; }
  else if (assignment)  { content = { ...assignment, user_id: assignment.created_by, slug: null }; contentType = 'assignment'; }

  if (!content) return NextResponse.json({ error: 'Content not found' }, { status: 404 });

  const { data: student } = await supabase.from('students').select('role').eq('id', user.id).single();
  const isAdmin = student?.role === 'admin';

  if (content.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A nudge links a student to the content. Students cannot open unpublished content by any route
  // -- app/api/course and app/api/guided-project-progress both require it -- so nudging about a
  // draft mails out a link that will refuse them. This holds for every grant below, direct or via
  // a learning path: a published path containing a draft item grants nothing.
  if (content.status !== 'published') {
    return NextResponse.json({ error: 'That content is not published yet.' }, { status: 409 });
  }

  // The recipient must be a student this content reaches. Without this, an authenticated content
  // owner could post any address in the body and have branded platform email delivered to it.
  const { data: recipient } = await supabase
    .from('students')
    .select('id, email, full_name, cohort_id, role')
    .eq('email', String(studentEmail).trim().toLowerCase())
    .maybeSingle();

  // One message for "no such student" and for "not assigned", so a caller cannot use the response
  // to learn whether an arbitrary address belongs to a student on the platform.
  const refuse = () => NextResponse.json({ error: 'That recipient is not assigned to this content.' }, { status: 403 });

  if (!recipient || recipient.role !== 'student') return refuse();

  // Deliberately no exception for a course marked available to everyone. Being open to enrol is not
  // the same as being enrolled, and a nudge only ever originates from a tracking row -- which
  // exists solely for cohort-assigned or path-granted students.
  const contentCohortIds: string[] = Array.isArray(content.cohort_ids) ? content.cohort_ids : [];
  let reaches = !!recipient.cohort_id && contentCohortIds.includes(recipient.cohort_id);
  // Published learning paths grant their cohorts access to the courses and VEs they contain
  // without writing those cohorts into the item -- the same grant app/api/course honours.
  if (!reaches && recipient.cohort_id && (contentType === 'course' || contentType === 'virtual_experience')) {
    const { data: path } = await supabase
      .from('learning_paths')
      .select('id')
      .eq('status', 'published')
      .contains('item_ids', [formId])
      .contains('cohort_ids', [recipient.cohort_id])
      .limit(1)
      .maybeSingle();
    reaches = !!path;
  }
  if (!reaches) return refuse();

  // Name and address come from the record, never from the request body.
  const recipientEmail = recipient.email as string;
  const studentName    = recipient.full_name || 'there';

  // So does the status. The browser sends what its table last rendered, which can be minutes stale
  // -- long enough to tell someone who just finished that they have not started. Events are not a
  // tracked content type, so those keep the caller's value.
  let nudgeStatus: NudgeStatus = status;
  if (contentType !== 'event') {
    const [row] = await buildStatusRows(supabase, {
      items: [{
        id: formId,
        title: content.title,
        contentType: contentType as 'course' | 'virtual_experience' | 'assignment',
        // Authorization above already established that this content reaches this student; pairing
        // them here is what asks the classifier for their status.
        cohortIds: [recipient.cohort_id],
        status: content.status,
        veFormId: contentType === 'assignment' && content.type === 'virtual_experience'
          ? (content.config?.ve_form_id ?? null)
          : null,
      }],
      students: [recipient],
      cohortNames: new Map(),
      activeCohortIds: [recipient.cohort_id],
    });
    if (row?.status === 'completed') {
      return NextResponse.json({ error: 'That student has already completed this.' }, { status: 409 });
    }
    if (row) nudgeStatus = row.status;
  }

  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const formUrl  = contentType === 'assignment'
    ? `${t.appUrl}/assignments/${formId}`
    : `${t.appUrl}/${content.slug || formId}`;

  const subject = nudgeStatus === 'not_started'
    ? `Your learning journey is waiting, ${studentName || 'there'}!`
    : nudgeStatus === 'in_progress'
    ? `Keep going, ${studentName || 'there'}! You are almost there.`
    : nudgeStatus === 'failed'
    ? `You can still pass this, ${studentName || 'there'}!`
    : `Do not stop now. You started something great, ${studentName || 'there'}!`;

  const html = nudgeEmail({
    name: studentName || 'there',
    contentTitle: content.title,
    contentType,
    status: nudgeStatus,
    formUrl,
    coverImage: content.cover_image || null,
    branding,
  });

  try {
    const { error: sendError } = await resend.emails.send({ from: FROM, to: recipientEmail, subject, html });
    if (sendError) {
      console.error('[nudge-student] Resend error:', sendError);
      return NextResponse.json({ error: 'Failed to send nudge. Please try again.' }, { status: 500 });
    }

    // Record the nudge so the dashboard can reflect it
    await supabase.from('sent_nudges').insert({ student_id: recipient.id, form_id: formId, nudge_type: 'manual' });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[nudge-student]', err);
    return NextResponse.json({ error: 'Failed to send nudge. Please try again.' }, { status: 500 });
  }
}
