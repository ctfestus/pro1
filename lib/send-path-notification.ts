import { createHash } from 'crypto';
import { Resend } from 'resend';
import { learningPathAssignedEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);
const BATCH_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 3;

export type PathNotificationResult = {
  total: number;
  sent: number;
  failed: number;
};

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error: any) {
  return error?.statusCode === 429
    || error?.name === 'rate_limit_exceeded'
    || /too many requests|rate limit/i.test(error?.message ?? '');
}

async function sendBatchWithRetry(
  emails: Parameters<typeof resend.batch.send>[0],
  idempotencyKey: string,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const { error } = await resend.batch.send(emails, { idempotencyKey });
      if (!error) return;
      if (!isRateLimitError(error) || attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`${error.name ?? ''} ${error.message ?? 'Batch send failed'}`.trim());
      }
    } catch (error) {
      if (!isRateLimitError(error) || attempt === MAX_RATE_LIMIT_RETRIES) throw error;
    }

    await wait(1000 * (2 ** attempt));
  }
}

export async function sendPathNotification(
  supabase: any,
  lp: { id: string; title: string; description?: string | null; item_ids?: string[] },
  cohortIds: string[],
  /** 'plan' when the path became available through a subscription rather than being assigned. */
  reason: 'assignment' | 'plan' = 'assignment',
): Promise<PathNotificationResult> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-path-notification] RESEND_API_KEY is not set.');
    throw new Error('RESEND_API_KEY is not configured');
  }
  if (!cohortIds.length) return { total: 0, sent: 0, failed: 0 };

  const itemIds: string[] = lp.item_ids ?? [];
  const [{ data: coursesRaw }, { data: vesRaw }, { data: certsRaw }] = itemIds.length
    ? await Promise.all([
        supabase.from('courses').select('id, title, cover_image').in('id', itemIds),
        supabase.from('virtual_experiences').select('id, title, cover_image').in('id', itemIds),
        supabase.from('certifications').select('id, title, cover_image').in('id', itemIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const contentMap: Record<string, any> = {};
  for (const c of coursesRaw ?? []) contentMap[c.id] = { ...c, content_type: 'course' };
  for (const v of vesRaw     ?? []) contentMap[v.id] = { ...v, content_type: 'virtual_experience' };
  for (const x of certsRaw   ?? []) contentMap[x.id] = { ...x, content_type: 'certification' };

  const items = itemIds.map((id: string) => {
    const f = contentMap[id];
    return {
      title:       f?.title ?? 'Untitled',
      coverImage:  f?.cover_image ?? null,
      isVE:        f?.content_type === 'virtual_experience',
      isCert:      f?.content_type === 'certification',
      description: undefined as string | undefined,
    };
  });

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, full_name, email')
    .in('cohort_id', cohortIds)
    .eq('role', 'student');

  if (studentsError) throw studentsError;
  const recipients = (students ?? [])
    .filter((student: any) => Boolean(student.email))
    .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  if (!recipients.length) return { total: 0, sent: 0, failed: 0 };

  const t            = await getTenantSettings();
  const FROM         = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding     = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const dashboardUrl = `${t.appUrl}/student#learning_paths`;

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const recipientBatch = recipients.slice(i, i + BATCH_SIZE);
    const emails = recipientBatch.map((student: any) => ({
      from: FROM,
      to: student.email,
      subject: reason === 'plan'
        ? `New learning path: ${lp.title}`
        : `You've been enrolled in a new learning path: ${lp.title}`,
      html: learningPathAssignedEmail({
        name:            student.full_name ?? 'there',
        pathTitle:       lp.title,
        pathDescription: lp.description ?? undefined,
        items,
        dashboardUrl,
        branding,
        reason,
        appName: t.appName,
      }),
    }));
    const payloadHash = createHash('sha256').update(JSON.stringify(emails)).digest('hex');

    try {
      await sendBatchWithRetry(emails, `learning-path/${lp.id}/${payloadHash}`);
      sent += emails.length;
    } catch (error) {
      failed += emails.length;
      console.error('[send-path-notification] batch failed:', error);
    }
  }

  return { total: recipients.length, sent, failed };
}
