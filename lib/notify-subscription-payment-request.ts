import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { subscriptionPaymentAssignedEmail } from '@/lib/email-templates';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function notifySubscriptionPaymentRequest(
  db: SupabaseClient,
  input: { studentId: string; planName: string; amount: number; currency: string; dueDate: string },
) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const { data: student, error } = await db.from('students').select('email, full_name').eq('id', input.studentId).maybeSingle();
  if (error) throw error;
  if (!student?.email) throw new Error('Student email not found.');
  const tenant = await getTenantSettings();
  const dashboardUrl = tenant.appUrl || process.env.APP_URL || '';
  if (!dashboardUrl) throw new Error('Platform App URL is not configured.');
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`;
  const { error: sendError } = await resend.emails.send({
    from,
    to: student.email,
    subject: `Payment request for ${input.planName}`,
    html: subscriptionPaymentAssignedEmail({
      name: student.full_name || 'there',
      planName: input.planName,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
      dashboardUrl,
      branding: { appName: tenant.appName, appUrl: tenant.appUrl, logoUrl: tenant.logoUrl, emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName },
    }),
  });
  if (sendError) throw new Error(sendError.message);
}
