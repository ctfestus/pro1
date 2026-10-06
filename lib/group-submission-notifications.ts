import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { groupSubmissionReceivedEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';

const resend = new Resend(process.env.RESEND_API_KEY);

function validEmail(email: string | null | undefined) {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function sendGroupSubmissionNotifications({
  submissionId,
  assignmentTitle,
}: {
  submissionId: string;
  assignmentTitle: string;
}) {
  if (!process.env.RESEND_API_KEY) return { sent: 0 };

  const supabase = adminClient();
  const { data: submission } = await supabase
    .from('assignment_submissions')
    .select('id, group_id, submitted_by, participants')
    .eq('id', submissionId)
    .maybeSingle();

  if (!submission?.group_id) return { sent: 0 };

  const [{ data: group }, { data: memberRows }, { data: submitter }, t] = await Promise.all([
    supabase.from('groups').select('id, name').eq('id', submission.group_id).maybeSingle(),
    supabase
      .from('group_members')
      .select('student_id, is_leader, students(id, full_name, email)')
      .eq('group_id', submission.group_id),
    submission.submitted_by
      ? supabase.from('students').select('full_name').eq('id', submission.submitted_by).maybeSingle()
      : Promise.resolve({ data: null } as any),
    getTenantSettings(),
  ]);

  const participants = new Set(Array.isArray(submission.participants) ? submission.participants : []);
  const recipients = (memberRows ?? [])
    .map((m: any) => ({
      id: m.students?.id ?? m.student_id,
      name: m.students?.full_name || 'there',
      email: m.students?.email,
      isParticipant: participants.has(m.student_id),
    }))
    .filter((r: any) => r.id && validEmail(r.email));

  if (!recipients.length) return { sent: 0 };

  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const dashboardUrl = `${t.appUrl}/student#assignments`;
  const groupName = group?.name ?? 'your group';
  const emailType = 'group_submission_received';

  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100);
    const emails: { from: string; to: string; subject: string; html: string }[] = [];
    const lockedKeys: string[] = [];

    for (const recipient of batch) {
      const dedupeKey = `group-submission-${submissionId}-${recipient.id}`;
      const { error: lockError } = await supabase
        .from('email_dedup')
        .insert({ dedupe_key: dedupeKey, type: emailType, status: 'pending' });

      if (lockError) {
        if (lockError.code !== '23505') {
          console.error('[group-submission-notifications] dedupe lock error:', lockError);
        }
        continue;
      }

      lockedKeys.push(dedupeKey);
      const fallbackSubject = `Group submission received: ${assignmentTitle}`;
      const fallbackHtml = groupSubmissionReceivedEmail({
          name: recipient.name,
          assignmentTitle,
          groupName,
          submittedByName: submitter?.full_name ?? null,
          isParticipant: recipient.isParticipant,
          dashboardUrl,
          branding,
        });
      const rendered = await applyEmailTemplate({ key: 'group_submission_received', fallbackSubject, fallbackHtml, variables: { student_name: recipient.name, submitted_by: submitter?.full_name ?? 'A group member', assignment_title: assignmentTitle, group_name: groupName }, branding });
      emails.push({ from: FROM, to: recipient.email.trim(), subject: rendered.subject, html: rendered.html });
    }

    if (!emails.length) continue;

    const { error } = await resend.batch.send(emails);
    if (error) {
      console.error('[group-submission-notifications] send error:', error);
      await supabase
        .from('email_dedup')
        .delete()
        .in('dedupe_key', lockedKeys)
        .eq('type', emailType)
        .eq('status', 'pending');
      continue;
    }

    sent += emails.length;
    await supabase
      .from('email_dedup')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in('dedupe_key', lockedKeys)
      .eq('type', emailType);
  }

  return { sent };
}
