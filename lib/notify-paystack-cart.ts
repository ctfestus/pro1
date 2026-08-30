import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { settleUnfinishedCheckout } from '@/lib/paystack-subscriptions';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Nudges a learner who chose a plan and did not finish paying.
 *
 * Three of them, roughly an hour, a day and three days after they left, and then never again. The
 * cap is the point: this is a reminder about something they started, not a demand, and a shop that
 * keeps mailing about an abandoned basket forever stops being read at all.
 *
 * Two checks before every send, because the cost of getting them wrong is a learner being told to
 * pay for something they already own. The row is only ever claimed if no active subscription
 * exists, and Paystack itself is asked whether the checkout was in fact paid -- our record can lag
 * behind a webhook that has not arrived yet.
 */
export async function sendPaystackCartReminders(
  db: SupabaseClient,
  limit = 25,
  outOfTime: () => boolean = () => false,
) {
  if (!process.env.RESEND_API_KEY) return { sent: 0, skipped: 0 };

  const { data: carts, error } = await db.from('paystack_subscription_transactions')
    .select('reference')
    .eq('status', 'initialized')
    .is('request_id', null)
    .is('cart_dismissed_at', null)
    .lt('reminder_count', 3)
    .not('authorization_url', 'is', null)
    .order('last_reminder_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  if (!carts?.length) return { sent: 0, skipped: 0 };

  const tenant = await getTenantSettings();
  if (!tenant.supportEmail) return { sent: 0, skipped: carts.length };
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`;

  let sent = 0;
  let skipped = 0;
  for (const cart of carts) {
    if (outOfTime()) break;
    try {
      // Claimed first: the count is stamped under a lock before the mail leaves, so two workers
      // cannot send the same nudge and a crash costs one reminder rather than repeating it.
      const { data: claim, error: claimError } = await db.rpc('claim_paystack_cart_reminder', {
        p_reference: cart.reference,
      });
      if (claimError) throw claimError;
      if (claim?.claimed !== true) { skipped++; continue; }

      // Our record can lag a webhook, so Paystack is asked directly -- and whatever it reports is
      // acted on, not merely read. Noticing a completed payment and moving on would leave it
      // uncredited if the webhook and callback were both missed. A real pending payment is stored
      // by the processor; `ongoing` only describes the customer's still-open checkout session, so
      // this pass refuses to nudge or clear it without turning that transient answer into a lock.
      const settled = await settleUnfinishedCheckout(db, cart.reference);
      if (!settled.abandoned) { skipped++; continue; }

      const { data: student, error: studentError } = await db.from('students')
        .select('full_name, email').eq('id', claim.studentId).maybeSingle();
      if (studentError) throw studentError;
      if (!student?.email) { skipped++; continue; }

      const months = Number(claim.durationMonths) === 12
        ? '1 year'
        : `${claim.durationMonths} month${Number(claim.durationMonths) > 1 ? 's' : ''}`;
      const price = `${claim.currency} ${Number(claim.amount).toFixed(2)}`;
      const { error: sendError } = await resend.emails.send({
        from,
        to: student.email,
        subject: `Still interested in ${String(claim.planName).replace(/[\r\n]/g, '')}?`,
        html: [
          `<p>Hi ${escapeHtml((student.full_name || '').split(' ')[0] || 'there')},</p>`,
          `<p>You started subscribing to <strong>${escapeHtml(claim.planName)}</strong> (${escapeHtml(months)}, ${escapeHtml(price)}) and did not finish. Your place is still here whenever you want it.</p>`,
          // Deliberately the payments page rather than the stored Paystack link. A checkout
          // session can time out, and mailing somebody a dead link days later is worse than not
          // mailing at all. Coming back through the app runs the same recovery the Continue button
          // does, which reuses a live link or replaces one Paystack has finished with.
          `<p><a href="${escapeHtml(`${tenant.appUrl}/student?section=payments`)}">Finish your payment</a></p>`,
          '<p>Nothing has been charged, and you owe nothing. If you have changed your mind you can ignore this.</p>',
        ].join(''),
      }, { idempotencyKey: `paystack-cart/${cart.reference}/${claim.reminderNumber}` });
      if (sendError) throw new Error(sendError.message);
      sent++;
    } catch (err) {
      skipped++;
      console.error('[paystack-cart] reminder failed', cart.reference, err);
    }
  }
  return { sent, skipped };
}
