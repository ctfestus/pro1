import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const processPaystackSubscriptionReference = vi.hoisted(() => vi.fn());
const notifySubscriptionActivated = vi.hoisted(() => vi.fn());
const notifyPaystackIncident = vi.hoisted(() => vi.fn());

vi.mock('@/lib/paystack-subscriptions', () => ({ processPaystackSubscriptionReference }));
vi.mock('@/lib/notify-subscription-activated', () => ({ notifySubscriptionActivated }));
vi.mock('@/lib/notify-paystack-incident', () => ({ notifyPaystackIncident }));

import {
  processStoredPaystackWebhookEvent,
  retryStoredPaystackWebhookEvents,
} from '@/lib/paystack-webhook-processing';

beforeEach(() => {
  vi.clearAllMocks();
  notifySubscriptionActivated.mockResolvedValue({ sent: true });
  notifyPaystackIncident.mockResolvedValue({ sent: true });
});

describe('stored Paystack webhook processing', () => {
  it('marks an unrelated successful charge as processed without opening an incident', async () => {
    processPaystackSubscriptionReference.mockResolvedValue({
      ok: true, reference: 'other-ref', status: 'ignored', skipped: true, reason: 'unknown_reference',
    });
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'event-1', event_name: 'charge.success', reference: 'other-ref', processing_attempts: 1 },
        error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({ paystack_webhook_events: { data: null, error: null } }, rpc) as any;

    await expect(processStoredPaystackWebhookEvent(db, 'event-1')).resolves.toMatchObject({ status: 'ignored' });
    expect(notifyPaystackIncident).not.toHaveBeenCalled();
  });

  it('creates one incident for a missing platform transaction', async () => {
    processPaystackSubscriptionReference.mockResolvedValue({
      ok: false, reference: 'sub-missing', status: 'needs_review', skipped: true,
      reason: 'unknown_subscription_reference',
    });
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'event-2', event_name: 'charge.success', reference: 'sub-missing', processing_attempts: 1 },
        error: null,
      };
      if (fn === 'record_paystack_webhook_incident') return {
        data: { id: 'incident-1', status: 'needs_review', reference: 'sub-missing' }, error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({ paystack_webhook_events: { data: null, error: null } }, rpc) as any;

    await expect(processStoredPaystackWebhookEvent(db, 'event-2')).resolves.toMatchObject({ status: 'needs_review' });
    expect(notifyPaystackIncident).toHaveBeenCalledOnce();
    expect(notifyPaystackIncident).toHaveBeenCalledWith(db, 'incident-1');
  });

  it('records lifecycle events without changing access', async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'refund-1', event_name: 'refund.processed', reference: 'sub-ref', processing_attempts: 1 },
        error: null,
      };
      if (fn === 'record_paystack_webhook_incident') return {
        data: { id: 'incident-refund', status: 'needs_review', reference: 'sub-ref' }, error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({ paystack_webhook_events: { data: null, error: null } }, rpc) as any;

    await expect(processStoredPaystackWebhookEvent(db, 'refund-1')).resolves.toMatchObject({ status: 'needs_review' });
    expect(processPaystackSubscriptionReference).not.toHaveBeenCalled();
    expect(notifyPaystackIncident).toHaveBeenCalledWith(db, 'incident-refund');
  });

  it('does not notify twice when the incident key already exists', async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'reminder-1', event_name: 'charge.dispute.remind', reference: 'sub-ref', processing_attempts: 1 },
        error: null,
      };
      if (fn === 'record_paystack_webhook_incident') return {
        data: { id: 'incident-dispute', status: 'already_open', reference: 'sub-ref' }, error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({ paystack_webhook_events: { data: null, error: null } }, rpc) as any;

    await expect(processStoredPaystackWebhookEvent(db, 'reminder-1')).resolves.toMatchObject({ status: 'already_open' });
    expect(notifyPaystackIncident).not.toHaveBeenCalled();
  });

  it('dead-letters a persistent failure into the same incident queue', async () => {
    processPaystackSubscriptionReference.mockRejectedValue(new Error('Paystack unavailable'));
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'event-dead', event_name: 'charge.success', reference: 'sub-ref', processing_attempts: 10 },
        error: null,
      };
      if (fn === 'record_paystack_webhook_incident') return {
        data: { id: 'incident-dead', status: 'needs_review', reference: 'sub-ref' }, error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({
      paystack_webhook_events: [{ data: null, error: null }, { data: null, error: null }],
    }, rpc) as any;

    await expect(processStoredPaystackWebhookEvent(db, 'event-dead')).resolves.toMatchObject({ status: 'dead_lettered' });
    expect(notifyPaystackIncident).toHaveBeenCalledWith(db, 'incident-dead');
  });

  it('replays unprocessed events in bounded batches', async () => {
    processPaystackSubscriptionReference.mockResolvedValue({
      ok: true, reference: 'sub-ref', status: 'success', paymentId: 'payment-1',
    });
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_paystack_webhook_event') return {
        data: { event_hash: 'event-3', event_name: 'charge.success', reference: 'sub-ref', processing_attempts: 1 },
        error: null,
      };
      throw new Error(`unexpected RPC ${fn}`);
    });
    const db = makeSupabaseStub({
      paystack_webhook_events: [{ data: [{ event_hash: 'event-3' }], error: null }, { data: null, error: null }],
    }, rpc) as any;

    await expect(retryStoredPaystackWebhookEvents(db)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(notifySubscriptionActivated).toHaveBeenCalledWith(db, { paymentId: 'payment-1' });
  });
});
