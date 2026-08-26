import type { SupabaseClient } from '@supabase/supabase-js';
import { processPaystackSubscriptionReference, type PaystackProcessResult } from '@/lib/paystack-subscriptions';
import { notifySubscriptionActivated } from '@/lib/notify-subscription-activated';
import { notifyPaystackIncident } from '@/lib/notify-paystack-incident';

const MAX_PROCESSING_ATTEMPTS = 10;
const MAX_NOTIFICATION_ATTEMPTS = 10;

async function notifyIncident(db: SupabaseClient, incidentId?: string | null) {
  if (!incidentId) return;
  try { await notifyPaystackIncident(db, incidentId); } catch {}
}

async function recordWebhookIncident(
  db: SupabaseClient,
  eventHash: string,
  kind: string,
  reason: string,
) {
  const { data, error } = await db.rpc('record_paystack_webhook_incident', {
    p_event_hash: eventHash,
    p_kind: kind,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { id?: string; status?: string; reference?: string } | null;
}

async function deadLetterEvent(db: SupabaseClient, eventHash: string, processingError: string) {
  const incident = await recordWebhookIncident(db, eventHash, 'webhook_processing_failed', processingError);
  const now = new Date().toISOString();
  const { error } = await db.from('paystack_webhook_events').update({
    processed_at: now,
    dead_lettered_at: now,
    processing_error: processingError,
  }).eq('event_hash', eventHash);
  if (error) throw error;
  await notifyIncident(db, incident?.id);
}

export async function processStoredPaystackWebhookEvent(
  db: SupabaseClient,
  eventHash: string,
): Promise<PaystackProcessResult | { ok: true; ignored: true } | { ok: true; status: string; reference?: string }> {
  const { data: event, error } = await db.rpc('claim_paystack_webhook_event', {
    p_event_hash: eventHash,
    p_stale_after_seconds: 300,
  });
  if (error) throw error;
  if (!event) return { ok: true, ignored: true };

  const lifecycleEvents = new Set([
    'charge.reversed',
    'refund.processed',
    'charge.dispute.create',
    'charge.dispute.remind',
    'charge.dispute.resolve',
  ]);

  if (lifecycleEvents.has(event.event_name)) {
    try {
      const incident = await recordWebhookIncident(
        db,
        eventHash,
        'lifecycle_event',
        `paystack:${event.event_name}`,
      );
      const { error: updateError } = await db.from('paystack_webhook_events').update({
        processed_at: new Date().toISOString(),
        processing_error: null,
      }).eq('event_hash', eventHash);
      if (updateError) throw updateError;
      if (incident?.status === 'needs_review') await notifyIncident(db, incident.id);
      return { ok: true, status: incident?.status ?? 'ignored', reference: incident?.reference };
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : String(processingError);
      const { error: updateError } = await db.from('paystack_webhook_events')
        .update({ processing_error: message })
        .eq('event_hash', eventHash);
      if (updateError) console.error('[paystack-webhook] could not store lifecycle error', updateError);
      if (Number(event.processing_attempts || 0) >= MAX_PROCESSING_ATTEMPTS) {
        await deadLetterEvent(db, eventHash, message);
        return { ok: true, status: 'dead_lettered', reference: event.reference ?? undefined };
      }
      throw processingError;
    }
  }

  if (event.event_name !== 'charge.success' || !event.reference) {
    const { error: updateError } = await db.from('paystack_webhook_events').update({
      processed_at: new Date().toISOString(),
      processing_error: null,
    }).eq('event_hash', eventHash);
    if (updateError) throw updateError;
    return { ok: true, ignored: true };
  }

  try {
    const result = await processPaystackSubscriptionReference(db, event.reference);
    let incidentId: string | undefined;
    if (result.reason === 'unknown_subscription_reference') {
      const incident = await recordWebhookIncident(db, eventHash, 'unknown_payment', result.reason);
      incidentId = incident?.id;
    }
    const { error: updateError } = await db.from('paystack_webhook_events').update({
      processed_at: new Date().toISOString(),
      processing_error: result.reason === 'unknown_subscription_reference' ? result.reason : null,
    }).eq('event_hash', eventHash);
    if (updateError) throw updateError;
    if (result.paymentId) {
      try { await notifySubscriptionActivated(db, { paymentId: result.paymentId }); } catch {}
    }
    await notifyIncident(db, incidentId ?? result.incidentId);
    return result;
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : String(processingError);
    const { error: updateError } = await db.from('paystack_webhook_events')
      .update({ processing_error: message })
      .eq('event_hash', eventHash);
    if (updateError) console.error('[paystack-webhook] could not store processing error', updateError);
    if (Number(event.processing_attempts || 0) >= MAX_PROCESSING_ATTEMPTS) {
      await deadLetterEvent(db, eventHash, message);
      return { ok: true, status: 'dead_lettered', reference: event.reference ?? undefined };
    }
    throw processingError;
  }
}

export async function retryStoredPaystackWebhookEvents(
  db: SupabaseClient,
  limit = 25,
  outOfTime: () => boolean = () => false,
) {
  const { data: events, error } = await db.from('paystack_webhook_events')
    .select('event_hash')
    .is('processed_at', null)
    .order('processing_attempts', { ascending: true })
    .order('received_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  let processed = 0;
  let failed = 0;
  for (const event of events ?? []) {
    if (outOfTime()) break;
    try {
      await processStoredPaystackWebhookEvent(db, event.event_hash);
      processed++;
    } catch {
      failed++;
    }
  }
  return { processed, failed };
}

export async function retryPaystackIncidentNotifications(
  db: SupabaseClient,
  limit = 25,
  outOfTime: () => boolean = () => false,
) {
  const { data: incidents, error } = await db.from('paystack_review_incidents')
    .select('id')
    .eq('status', 'open')
    .is('notification_sent_at', null)
    .lt('notification_attempts', MAX_NOTIFICATION_ATTEMPTS)
    .order('notification_attempts', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  let sent = 0;
  for (const incident of incidents ?? []) {
    if (outOfTime()) break;
    try {
      const result = await notifyPaystackIncident(db, incident.id);
      if (result.sent) sent++;
    } catch {}
  }
  return { sent };
}
