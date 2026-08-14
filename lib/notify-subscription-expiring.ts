import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { subscriptionExpiringEmail } from '@/lib/email-templates';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Warns a learner before their access disappears.
 *
 * Expiry is the one lifecycle event with no human behind it: cancellation and plan changes
 * are admin actions, so someone can tell the learner, but expiry happens on a timer and
 * takes their courses with it.
 *
 * Guarded by expiry_warning_for_period_end rather than a plain boolean, so a renewal that
 * moves current_period_end makes the subscription eligible for a fresh warning while a
 * repeated sweep over the same period does not resend.
 */
export async function notifySubscriptionExpiring(
  db: SupabaseClient,
  input: { subscriptionId: string; periodEnd: string },
): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data: subscription, error } = await db
    .from('individual_subscriptions')
    .select('id, student_id, status, current_period_end, expiry_warning_for_period_end, subscription_plans!individual_subscriptions_plan_id_fkey ( name ), students!individual_subscriptions_student_id_fkey ( email, full_name )')
    .eq('id', input.subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!subscription) throw new Error('Subscription not found.');

  // The queue selected this row on a specific period. If it renewed in between, the period
  // it was chosen for is no longer the one it is in, and warning now would announce an end
  // date that may be months away.
  if (subscription.current_period_end !== input.periodEnd) return { sent: false };

  // Already warned for this exact period. A renewal changes current_period_end, so the
  // comparison rather than a null check is what allows the next warning through.
  if (subscription.expiry_warning_for_period_end === subscription.current_period_end) return { sent: false };

  const student = (subscription as any).students as { email?: string; full_name?: string } | null;
  const plan = (subscription as any).subscription_plans as { name?: string } | null;

  // Nothing to warn about: the learner is gone, or the subscription already ended or was
  // cancelled. Marked so the sweep stops reconsidering it.
  if (subscription.status !== 'active' || !subscription.student_id || !student?.email) {
    await markWarned(db, subscription.id, subscription.current_period_end);
    return { sent: false };
  }

  const tenant = await getTenantSettings();
  const dashboardUrl = tenant.appUrl || process.env.APP_URL || '';
  if (!dashboardUrl) throw new Error('Platform App URL is not configured.');
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`.trim();
  if (from === '<>') throw new Error('RESEND_FROM_EMAIL or the platform sender name and support email must be configured.');

  const daysLeft = Math.max(
    1,
    Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / 86_400_000),
  );

  const { error: sendError } = await resend.emails.send({
    from,
    to: student.email,
    subject: `Your ${plan?.name ?? 'subscription'} access ends soon`,
    html: subscriptionExpiringEmail({
      name: student.full_name || 'there',
      planName: plan?.name ?? 'your plan',
      periodEnd: subscription.current_period_end,
      daysLeft,
      dashboardUrl,
      branding: {
        appName: tenant.appName,
        appUrl: tenant.appUrl,
        logoUrl: tenant.logoUrl,
        emailBannerUrl: tenant.emailBannerUrl,
        teamName: tenant.teamName,
      },
    }),
  }, { idempotencyKey: `subscription-expiring/${subscription.id}/${subscription.current_period_end}` });
  if (sendError) throw new Error(sendError.message);

  await markWarned(db, subscription.id, subscription.current_period_end);
  return { sent: true };
}

async function markWarned(db: SupabaseClient, subscriptionId: string, periodEnd: string) {
  const { error } = await db.rpc('mark_subscription_expiry_warned', {
    p_subscription_id: subscriptionId,
    p_period_end: periodEnd,
  });
  if (error) throw error;
}
