import { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { assignmentDueReminderEmail } from './email-templates';
import { getTenantSettings } from './get-tenant-settings';
import { applyEmailTemplate, formatEmailDate } from './email-template-service';

// Shared logic for reminding students who have not submitted an assignment.
// Used by the on-demand endpoint (/api/assignments/remind-unsubmitted) and the
// daily cron (/api/cron/assignment-reminders).

export type UnsubmittedResult = {
  assignment: { id: string; title: string; deadline_date: string | null } | null;
  recipients: { id: string; name: string; email: string }[];
};

// Find registered students (by the assignment's cohorts) with no submitted/graded submission.
export async function getUnsubmittedStudents(db: SupabaseClient, assignmentId: string): Promise<UnsubmittedResult> {
  const { data: a } = await db
    .from('assignments')
    .select('id, title, deadline_date, cohort_ids')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!a) return { assignment: null, recipients: [] };

  const assignment = { id: a.id, title: a.title, deadline_date: a.deadline_date ?? null };
  const cohortIds: string[] = Array.isArray(a.cohort_ids) ? a.cohort_ids : [];
  if (!cohortIds.length) return { assignment, recipients: [] };

  const [studentsRes, subsRes] = await Promise.all([
    db.from('students').select('id, full_name, email').in('cohort_id', cohortIds).eq('role', 'student'),
    db.from('assignment_submissions').select('student_id, status').eq('assignment_id', assignmentId).in('status', ['submitted', 'graded']),
  ]);

  const submitted = new Set((subsRes.data ?? []).map((s: any) => s.student_id));
  const recipients = (studentsRes.data ?? [])
    .filter((s: any) => s.email && !submitted.has(s.id))
    .map((s: any) => ({ id: s.id, name: s.full_name || 'there', email: (s.email as string).trim().toLowerCase() }))
    .filter((s: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));

  return { assignment, recipients };
}

// Send reminder emails to unsubmitted students. cooldownDays skips anyone reminded within that
// window (deduped via sent_nudges, nudge_type 'assignment_reminder', form_id = assignment id).
export async function sendAssignmentReminders(
  db: SupabaseClient,
  assignmentId: string,
  opts: { cooldownDays?: number } = {},
): Promise<{ error?: string; sent: number; total: number; skipped: number }> {
  const { assignment, recipients } = await getUnsubmittedStudents(db, assignmentId);
  if (!assignment) return { error: 'Assignment not found', sent: 0, total: 0, skipped: 0 };
  if (!recipients.length) return { sent: 0, total: 0, skipped: 0 };
  if (!process.env.RESEND_API_KEY) return { error: 'Email service not configured', sent: 0, total: recipients.length, skipped: 0 };

  let toSend = recipients;
  let skipped = 0;
  const cooldown = opts.cooldownDays ?? 0;
  if (cooldown > 0) {
    const cutoff = new Date(Date.now() - cooldown * 86400000).toISOString();
    const { data: recent } = await db
      .from('sent_nudges')
      .select('student_id')
      .eq('nudge_type', 'assignment_reminder')
      .eq('form_id', assignmentId)
      .in('student_id', recipients.map(r => r.id))
      .gte('sent_at', cutoff);
    const recentSet = new Set((recent ?? []).map((r: any) => r.student_id));
    toSend = recipients.filter(r => !recentSet.has(r.id));
    skipped = recipients.length - toSend.length;
  }
  if (!toSend.length) return { sent: 0, total: recipients.length, skipped };

  const t = await getTenantSettings();
  const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const dashboardUrl = t.appUrl || process.env.APP_URL || '';
  const due          = assignment.deadline_date;
  const daysLeft     = due ? Math.ceil((new Date(due).getTime() - Date.now()) / 86400000) : 0;
  const dueWord      = daysLeft <= 0 ? 'is due' : daysLeft === 1 ? 'is due tomorrow' : `is due in ${daysLeft} days`;
  const dueText      = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const batch = await Promise.all(toSend.map(async r => {
    const fallbackSubject = `Reminder: "${assignment.title}" ${dueWord}`;
    const fallbackHtml = assignmentDueReminderEmail({ name: r.name, assignmentTitle: assignment.title, dueDate: due ?? '', daysLeft, dashboardUrl, branding });
    const rendered = await applyEmailTemplate({
      key: 'assignment_due', fallbackSubject, fallbackHtml,
      variables: { student_name: r.name, assignment_title: assignment.title, due_date: formatEmailDate(due), due_text: dueText },
      fixedDetails: [{ label: 'Assignment', value: assignment.title }, { label: 'Due', value: formatEmailDate(due) || dueText }],
      branding, actionUrl: `${dashboardUrl}/student?section=assignments`,
    });
    return { from: FROM, to: r.email, subject: rendered.subject, html: rendered.html };
  }));

  let sent = 0;
  const sentStudentIds: string[] = [];
  for (let i = 0; i < batch.length; i += 100) {
    const slice = batch.slice(i, i + 100);
    try {
      await resend.batch.send(slice);
      sent += slice.length;
      sentStudentIds.push(...toSend.slice(i, i + 100).map(r => r.id));
    } catch (err) {
      console.error('[remind-unsubmitted] batch send failed:', err);
    }
  }

  if (sentStudentIds.length) {
    await db.from('sent_nudges').insert(
      sentStudentIds.map(id => ({ student_id: id, form_id: assignmentId, nudge_type: 'assignment_reminder' })),
    );
  }

  return { sent, total: recipients.length, skipped };
}
