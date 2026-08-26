import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function notifyPaystackIncident(db: SupabaseClient, incidentId: string) {
  const { data: incident, error } = await db.from('paystack_review_incidents')
    .select('id, reference, provider_transaction_id, kind, reason, event_name, amount, currency, student_id, plan_id, status, notification_attempts, notification_sent_at')
    .eq('id', incidentId)
    .maybeSingle();
  if (error) throw error;
  if (!incident || incident.status !== 'open' || incident.notification_sent_at) return { sent: false };

  const recordAttempt = async (notificationError: string | null) => {
    const { error: updateError } = await db.from('paystack_review_incidents').update({
      notification_attempts: Number(incident.notification_attempts || 0) + 1,
      notification_last_attempt_at: new Date().toISOString(),
      notification_error: notificationError,
    }).eq('id', incident.id);
    if (updateError) throw updateError;
  };

  if (!process.env.RESEND_API_KEY) {
    await recordAttempt('RESEND_API_KEY is not configured');
    return { sent: false };
  }
  const tenant = await getTenantSettings();
  if (!tenant.supportEmail) {
    await recordAttempt('Support email is not configured');
    return { sent: false };
  }

  await recordAttempt(null);
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`;
  const amount = incident.amount == null
    ? null
    : `${incident.currency ? `${incident.currency} ` : ''}${Number(incident.amount).toFixed(2)}`;

  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to: tenant.supportEmail,
      subject: `Paystack review required: ${String(incident.reference || incident.provider_transaction_id || incident.kind).replace(/[\r\n]/g, '')}`,
      html: [
        '<p>A Paystack payment incident requires manual review.</p>',
        `<p><strong>Type:</strong> ${escapeHtml(incident.event_name || incident.kind)}</p>`,
        `<p><strong>Reference:</strong> ${escapeHtml(incident.reference)}</p>`,
        `<p><strong>Transaction ID:</strong> ${escapeHtml(incident.provider_transaction_id)}</p>`,
        amount ? `<p><strong>Amount:</strong> ${escapeHtml(amount)}</p>` : '',
        `<p><strong>Reason:</strong> ${escapeHtml(incident.reason)}</p>`,
        `<p><strong>Student:</strong> ${escapeHtml(incident.student_id)}</p>`,
        '<p>Review the incident in the subscription dashboard. The platform has not changed access automatically.</p>',
      ].join(''),
    }, { idempotencyKey: `paystack-incident/${incident.id}` });
    if (sendError) throw new Error(sendError.message);
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    const { error: stampError } = await db.from('paystack_review_incidents')
      .update({ notification_error: message })
      .eq('id', incident.id);
    if (stampError) throw stampError;
    throw sendError;
  }

  const { error: stampError } = await db.from('paystack_review_incidents').update({
    notification_sent_at: new Date().toISOString(),
    notification_error: null,
  }).eq('id', incident.id).is('notification_sent_at', null);
  if (stampError) throw stampError;
  return { sent: true };
}
