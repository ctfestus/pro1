/**
 * POST /api/assignments/grade-notify
 * Sends an email to a student when their assignment is graded.
 * Called fire-and-forget from the instructor dashboard after saveGrade().
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { assignmentGradedEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { passMarkOf } from '@/lib/assignment-scenarios';

export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: true }); // silently skip if no email configured

  // Only instructors/admins can trigger grade notifications
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: { submissionId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { submissionId } = body;
  if (!submissionId) {
    return NextResponse.json({ error: 'submissionId required' }, { status: 400 });
  }

  // Fetch the submission (with participants) and the assignment title through the real relationship.
  // The title is NOT taken from the request body: a client could otherwise put arbitrary text into a
  // "your assignment was graded" email.
  const { data: sub } = await adminClient()
    .from('assignment_submissions')
    .select('id, score, feedback, student_id, participants, assignment:assignments!assignment_id(title, config)')
    .eq('id', submissionId)
    .maybeSingle();

  if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  const assignmentRow = (Array.isArray(sub.assignment) ? sub.assignment[0] : sub.assignment) as { title?: string; config?: any } | undefined;
  const assignmentTitle = assignmentRow?.title;
  if (!assignmentTitle) return NextResponse.json({ ok: true });

  // Resolve the set of student IDs to notify: participants array if present, otherwise just the submitter
  const participantIds: string[] = Array.isArray(sub.participants) && sub.participants.length > 0
    ? sub.participants
    : [sub.student_id];

  const { data: recipientRows } = await adminClient()
    .from('students')
    .select('id, full_name, email')
    .in('id', participantIds);

  const recipients = (recipientRows ?? []).filter(
    (s: any) => s.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()),
  );

  if (recipients.length === 0) return NextResponse.json({ ok: true });

  try {
    const t        = await getTenantSettings();
    const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
    const passed   = sub.score != null && sub.score >= passMarkOf(assignmentRow?.config);

    const resend = new Resend(process.env.RESEND_API_KEY);
    await Promise.all(recipients.map(async (student: any) => {
      const html = assignmentGradedEmail({
        name:            student.full_name || 'there',
        assignmentTitle,
        score:           sub.score,
        passed,
        feedback:        sub.feedback,
        studentUrl:      `${t.appUrl}/student`,
        branding,
      });
      const fallbackSubject = `Your assignment has been graded: ${assignmentTitle}`;
      const resultStatus = sub.score == null ? 'Feedback available' : passed ? 'Passed' : 'Not passed';
      const rendered = await applyEmailTemplate({
        key: 'assignment_graded', fallbackSubject, fallbackHtml: html,
        variables: {
          student_name: student.full_name || 'there', assignment_title: assignmentTitle,
          score: sub.score ?? '', score_display: sub.score == null ? 'Not scored' : `${sub.score}/100`,
          result_status: resultStatus, feedback: sub.feedback || '',
        },
        fixedDetails: [
          { label: 'Assignment', value: assignmentTitle }, { label: 'Result', value: resultStatus },
          { label: 'Score', value: sub.score == null ? null : `${sub.score}/100` }, { label: 'Feedback', value: sub.feedback || null },
        ],
        branding, actionUrl: `${t.appUrl}/student#assignments`,
      });
      return resend.emails.send({ from: FROM, to: student.email.trim(), subject: rendered.subject, html: rendered.html });
    }));
  } catch (err) {
    console.error('[grade-notify]', err);
  }

  return NextResponse.json({ ok: true });
}
