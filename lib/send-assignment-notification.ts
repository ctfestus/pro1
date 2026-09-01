import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { blastEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);

const TYPE_LABELS: Record<string, string> = {
  course: 'course',
  event: 'event',
  virtual_experience: 'virtual experience',
  announcement: 'announcement',
  assignment: 'assignment',
  certification: 'certification',
};

const TYPE_MESSAGES: Record<string, string> = {
  course: 'You have been enrolled in a new course. Log in to start learning.',
  event: 'An upcoming event has been added to your schedule. Check the details below.',
  virtual_experience: 'You have been assigned a new virtual experience. Jump in and get started.',
  announcement: 'A new announcement has been posted for you.',
  assignment: 'You have been assigned a new assignment. Log in to view the details and submit your work.',
  certification: 'You have been enrolled in a new certification. Log in to start preparing.',
};

/**
 * The same content can reach a learner two different ways, and they are not the same message.
 *
 * An instructor assigning work to a cohort is a request: somebody expects it done. Content
 * appearing in a plan someone subscribes to is not -- they pay for a catalogue and it grew.
 * Sending the assignment wording for that told paying learners they had been enrolled in
 * something, with a deadline behind it, every time an admin tidied a plan.
 */
const PLAN_CTA = 'View Now';

const TYPE_CTA: Record<string, string> = {
  course: 'View Course',
  event: 'View Event',
  virtual_experience: 'View Virtual Experience',
  announcement: 'View Announcement',
  assignment: 'View Assignment',
  certification: 'View Certification',
};

/**
 * Fire-and-forget: sends assignment notification emails to all students
 * in the given cohorts. Errors are logged but never thrown.
 */
export async function sendAssignmentNotifications({
  cohortIds,
  groupIds,
  title,
  slug,
  contentType,
  formUrl: formUrlOverride,
  reason = 'assignment',
}: {
  cohortIds: string[];
  groupIds?: string[];
  title: string;
  slug?: string;
  contentType: string;
  formUrl?: string;
  /** 'plan' when this became available through a subscription rather than being assigned. */
  reason?: 'assignment' | 'plan';
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-assignment-notification] RESEND_API_KEY is not set -- emails will not be sent.');
    throw new Error('RESEND_API_KEY is not configured');
  }
  const hasGroups  = Array.isArray(groupIds)  && groupIds.length  > 0;
  const hasCohorts = Array.isArray(cohortIds) && cohortIds.length > 0;
  if (!hasCohorts && !hasGroups) return;

  try {
    const t        = await getTenantSettings();
    const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

    const supabase = adminClient();

    // Fetch students from cohorts and/or groups, then merge + deduplicate by email
    const [cohortStudents, groupMemberRows] = await Promise.all([
      hasCohorts
        ? supabase.from('students').select('full_name, email').in('cohort_id', cohortIds).then(r => r.data ?? [])
        : Promise.resolve([] as { full_name: string | null; email: string | null }[]),
      hasGroups
        ? supabase.from('group_members').select('student_id').in('group_id', groupIds!).then(r => r.data ?? [])
        : Promise.resolve([] as { student_id: string }[]),
    ]);

    const groupStudentIds = Array.from(new Set((groupMemberRows ?? []).map((m: any) => m.student_id).filter(Boolean)));
    const groupStudents = groupStudentIds.length
      ? await supabase.from('students').select('full_name, email').in('id', groupStudentIds).then(r => r.data ?? [])
      : [];

    const students = [...cohortStudents, ...groupStudents];

    if (!students?.length) return;

    const forPlan     = reason === 'plan';
    const typeLabel   = TYPE_LABELS[contentType]   ?? contentType.replace(/_/g, ' ');
    const typeMessage = TYPE_MESSAGES[contentType] ?? 'You have been assigned new content.';
    const ctaLabel    = forPlan ? PLAN_CTA : TYPE_CTA[contentType] ?? 'View';
    const formUrl     = formUrlOverride != null
      ? (formUrlOverride.startsWith('http') ? formUrlOverride : `${t.appUrl}${formUrlOverride}`)
      : `${t.appUrl}/${slug}`;
    const subject     = forPlan
      ? `New ${typeLabel}: ${title}`
      : `You've been assigned: ${title}`;

    // Deduplicate by email
    const seen = new Set<string>();
    const recipients: { email: string; name: string }[] = [];
    for (const s of students) {
      const email = (s.email ?? '').trim().toLowerCase();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !seen.has(email)) {
        seen.add(email);
        recipients.push({ email, name: s.full_name || 'there' });
      }
    }

    if (!recipients.length) return;

    // Send in batches of 100 (Resend limit)
    for (let i = 0; i < recipients.length; i += 100) {
      const batch = recipients.slice(i, i + 100).map(({ email, name }) => {
        // No deadline and no instruction to begin: it is theirs to open when they feel like it.
        const body = forPlan
          ? `Hi ${name},\n\nWe have added a new ${typeLabel} to ${t.appName}:\n\n<b>${title}</b>\n\nLog in now to explore and start learning.`
          : `Hi ${name},\n\n${typeMessage}\n\n<b>${title}</b>\n\nClick the button below to open your ${typeLabel}.`;
        const html = blastEmail({ subject, body, formTitle: title, formUrl, ctaLabel, senderName: t.senderName || t.teamName || t.appName, branding });
        return { from: FROM, to: email, subject, html };
      });
      await resend.batch.send(batch);
    }
  } catch (err) {
    console.error('[send-assignment-notification]', err);
    throw err;
  }
}
