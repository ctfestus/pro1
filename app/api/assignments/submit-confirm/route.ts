import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/admin-client';
import { Resend } from 'resend';
import { submissionConfirmEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { sendGroupSubmissionNotifications } from '@/lib/group-submission-notifications';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { assignment_id } = body;
  if (!assignment_id) return NextResponse.json({ error: 'assignment_id required' }, { status: 400 });

  if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: true });

  try {
    const admin = adminClient();
    const [{ data: student }, { data: assignment }, { data: membership }] = await Promise.all([
      admin.from('students').select('full_name, email').eq('id', user.id).single(),
      admin.from('assignments').select('title').eq('id', assignment_id).single(),
      admin.from('group_members').select('group_id, is_leader').eq('student_id', user.id).maybeSingle(),
    ]);

    if (!student?.email || !assignment?.title) return NextResponse.json({ ok: true });

    if (membership?.group_id) {
      const { data: groupSubmission } = await admin
        .from('assignment_submissions')
        .select('id')
        .eq('assignment_id', assignment_id)
        .eq('group_id', membership.group_id)
        .eq('status', 'submitted')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (groupSubmission?.id) {
        await sendGroupSubmissionNotifications({
          submissionId: groupSubmission.id,
          assignmentTitle: assignment.title,
        });
        return NextResponse.json({ ok: true });
      }
    }

    // Individual confirmation: only send if the caller actually has a submitted submission for this
    // assignment. Without this, any logged-in user could trigger a "submission received" email to
    // themselves for an arbitrary assignment id.
    const { data: ownSub } = await admin.from('assignment_submissions')
      .select('id').eq('assignment_id', assignment_id).eq('student_id', user.id).eq('status', 'submitted').limit(1).maybeSingle();
    if (!ownSub) return NextResponse.json({ ok: true });

    const t = await getTenantSettings();
    const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

    const dashboardUrl = `${t.appUrl}/student#assignments`;
    const fallbackSubject = `Submission received: ${assignment.title}`;
    const fallbackHtml = submissionConfirmEmail({
        name: student.full_name || 'there',
        assignmentTitle: assignment.title,
        dashboardUrl,
        branding,
      });
    const rendered = await applyEmailTemplate({ key: 'submission_received', fallbackSubject, fallbackHtml, variables: { student_name: student.full_name || 'there', assignment_title: assignment.title }, branding, actionUrl: dashboardUrl });
    await resend.emails.send({ from: FROM, to: student.email, subject: rendered.subject, html: rendered.html });
  } catch (err) {
    console.error('[submit-confirm]', err);
  }

  return NextResponse.json({ ok: true });
}
