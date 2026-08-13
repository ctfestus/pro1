import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { subscriptionPaymentAssignedEmail } from '@/lib/email-templates';
import { LEARNER_SETUP_FIELDS, learnerNeedsSetup, sendIndividualLearnerWelcome, type LearnerSetupState } from '@/lib/notify-individual-learner-welcome';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Keyed on the request rather than a bundle of details, so delivery can be recorded against
 * it. subscription_payment_requests.request_email_sent_at is the permanent guard: without
 * it a failed send was unrecoverable and silent, and the hourly sweep had no way to tell an
 * unsent request from one already delivered.
 *
 * Idempotent, so it is safe to call on a retry. Sends first and stamps after: stamping
 * first would mark a request as emailed and then lose the message, which is silent, while a
 * duplicate on crash is visible and absorbed by the per-request Resend key.
 */
export async function notifySubscriptionPaymentRequest(
  db: SupabaseClient,
  input: { requestId: string },
): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data: request, error } = await db
    .from('subscription_payment_requests')
    .select(`id, student_id, plan_name, amount, currency, due_date, status, request_email_sent_at, students!subscription_payment_requests_student_id_fkey ( email, full_name, ${LEARNER_SETUP_FIELDS} )`)
    .eq('id', input.requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw new Error('Subscription payment request not found.');
  if (request.request_email_sent_at) return { sent: false };

  const stamp = async () => {
    const { error: stampError } = await db.rpc('mark_subscription_email_delivered', {
      p_student_id: null,
      p_payment_id: null,
      p_request_id: request.id,
      p_mark_setup: false,
    });
    if (stampError) throw stampError;
  };

  // Nothing to chase: the learner was deleted, or the request was settled or cancelled
  // before the email went out. Stamp it so the sweep stops reconsidering it.
  const student = (request as any).students as ({ email?: string; full_name?: string } & LearnerSetupState) | null;
  if (!request.student_id || !student?.email || !['pending', 'confirmation_submitted'].includes(request.status)) {
    await stamp();
    return { sent: false };
  }

  // A learner who cannot sign in yet needs the combined welcome, which carries the setup
  // link, not a request-only notice. Decided from durable state so a retry after a failed
  // welcome does not downgrade to the plan-only message.
  if (learnerNeedsSetup(student)) {
    return sendIndividualLearnerWelcome(db, {
      studentId: request.student_id,
      email: student.email,
      fullName: student.full_name ?? null,
      requestId: request.id,
    });
  }

  const tenant = await getTenantSettings();
  const dashboardUrl = tenant.appUrl || process.env.APP_URL || '';
  if (!dashboardUrl) throw new Error('Platform App URL is not configured.');
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`.trim();
  if (from === '<>') throw new Error('RESEND_FROM_EMAIL or the platform sender name and support email must be configured.');

  const { error: sendError } = await resend.emails.send({
    from,
    to: student.email,
    subject: `Payment request for ${request.plan_name}`,
    html: subscriptionPaymentAssignedEmail({
      name: student.full_name || 'there',
      planName: request.plan_name,
      amount: Number(request.amount),
      currency: request.currency,
      dueDate: request.due_date,
      dashboardUrl,
      branding: { appName: tenant.appName, appUrl: tenant.appUrl, logoUrl: tenant.logoUrl, emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName },
    }),
  }, { idempotencyKey: `subscription-request/${request.id}` });
  if (sendError) throw new Error(sendError.message);

  await stamp();
  return { sent: true };
}
