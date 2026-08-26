import crypto from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyPaystackSignature } from '@/lib/paystack';
import { processStoredPaystackWebhookEvent } from '@/lib/paystack-webhook-processing';
import { PaymentError } from '@/lib/payment-errors';

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');
  let signatureValid = false;
  try {
    signatureValid = verifyPaystackSignature(rawBody, signature);
  } catch (error) {
    if (error instanceof PaymentError && error.code === 'configuration_error') {
      return NextResponse.json({ error: 'Payment webhook is not configured' }, { status: 503 });
    }
    throw error;
  }
  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const referenceValue = event?.data?.reference
    ?? event?.data?.transaction?.reference
    ?? event?.data?.transaction_reference;
  const reference = referenceValue ? String(referenceValue) : null;
  const eventName = event?.event ? String(event.event) : null;
  const transactionIdValue = event?.data?.transaction?.id ?? event?.data?.transaction_id
    ?? (eventName === 'charge.success' ? event?.data?.id : null);
  // Number(null) is 0 and Number.isFinite(0) is true, so a missing id used to be stored as 0 --
  // a value that matches nothing and reads like a real id. Require a positive integer.
  const transactionIdNumber = Number(transactionIdValue);
  const transactionId = transactionIdValue != null
    && Number.isSafeInteger(transactionIdNumber)
    && transactionIdNumber > 0
    ? transactionIdNumber
    : null;
  const eventStatus = event?.data?.resolution || event?.data?.status || null;
  const amountMinorValue = eventName === 'refund.processed'
    ? event?.data?.amount
    : eventName?.startsWith('charge.dispute.') ? event?.data?.refund_amount : null;
  const amountMinor = amountMinorValue != null && Number.isFinite(Number(amountMinorValue))
    ? Math.round(Number(amountMinorValue))
    : null;
  const occurredAtValue = event?.data?.updated_at ?? event?.data?.updatedAt
    ?? event?.data?.created_at ?? event?.data?.createdAt;
  const occurredAtDate = occurredAtValue ? new Date(occurredAtValue) : null;
  const occurredAt = occurredAtDate && Number.isFinite(occurredAtDate.getTime())
    ? occurredAtDate.toISOString()
    : new Date().toISOString();
  const eventHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const db = adminClient();

  let duplicateEvent = false;
  const { error: insertError } = await db.from('paystack_webhook_events').insert({
    event_hash: eventHash,
    event_name: eventName,
    reference,
    event_status: eventStatus ? String(eventStatus) : null,
    transaction_id: transactionId,
    event_amount_minor: amountMinor,
    event_occurred_at: occurredAt,
  });
  if (insertError) {
    const duplicate = insertError.code === '23505' || String(insertError.message ?? '').includes('duplicate');
    if (!duplicate) {
      // Rethrown so the 500 makes Paystack redeliver, but logged first: without this the only
      // record of a webhook we failed to even store is a status code in someone else's dashboard.
      console.error('[paystack/webhook] could not store event', eventName, reference, insertError);
      throw insertError;
    }
    duplicateEvent = true;
    const { data: storedEvent, error: storedEventError } = await db
      .from('paystack_webhook_events')
      .select('processed_at')
      .eq('event_hash', eventHash)
      .maybeSingle();
    if (storedEventError) throw storedEventError;
    if (storedEvent?.processed_at) return NextResponse.json({ ok: true, duplicate: true });
  }

  const supportedEvents = new Set([
    'charge.success',
    'charge.reversed',
    'refund.processed',
    'charge.dispute.create',
    'charge.dispute.remind',
    'charge.dispute.resolve',
  ]);
  if (!eventName || !supportedEvents.has(eventName) || (!reference && !transactionId)) {
    await db.from('paystack_webhook_events').update({
      processed_at: new Date().toISOString(),
      processing_error: null,
    }).eq('event_hash', eventHash);
    return NextResponse.json({ ok: true, ignored: true });
  }

  after(async () => {
    try {
      await processStoredPaystackWebhookEvent(db, eventHash);
    } catch (err) {
      console.error('[paystack/webhook] deferred processing failed', reference, err);
    }
  });
  return NextResponse.json({ ok: true, accepted: true, duplicate: duplicateEvent || undefined });
}
