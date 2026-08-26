import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const createClient = vi.hoisted(() => vi.fn());
const verifyPaystackSignature = vi.hoisted(() => vi.fn());
const processStoredPaystackWebhookEvent = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/paystack', () => ({ verifyPaystackSignature }));
vi.mock('@/lib/paystack-webhook-processing', () => ({ processStoredPaystackWebhookEvent }));
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: any) => { if (typeof task === 'function') return task(); },
}));

import { POST } from '@/app/api/paystack/webhook/route';
import { PaymentError } from '@/lib/payment-errors';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/paystack/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': 'sig' },
    body: JSON.stringify(body),
  });
}

function dbWithInsert(error: any = null, storedEvent: any = { processed_at: null }) {
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
  const insert = vi.fn().mockResolvedValue({ data: null, error });
  const maybeSingle = vi.fn().mockResolvedValue({ data: storedEvent, error: null });
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  return { from: vi.fn(() => ({ insert, update, select })), insert, update, select, maybeSingle };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  verifyPaystackSignature.mockReturnValue(true);
  processStoredPaystackWebhookEvent.mockResolvedValue({
    ok: true,
    reference: 'sub-ref',
    status: 'success',
    paymentId: 'payment-1',
  });
});

describe('Paystack webhook', () => {
  it('rejects requests with invalid signatures', async () => {
    verifyPaystackSignature.mockReturnValue(false);
    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    expect(response.status).toBe(401);
    expect(processStoredPaystackWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns a clean service-unavailable response when Paystack is not configured', async () => {
    verifyPaystackSignature.mockImplementation(() => {
      throw new PaymentError('configuration_error', 'secret missing', 503);
    });
    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    const data = await response.json();
    expect(response.status).toBe(503);
    expect(data.error).toBe('Payment webhook is not configured');
  });

  it('processes charge.success for subscription references', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);
    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    expect(response.status).toBe(200);
    expect(processStoredPaystackWebhookEvent).toHaveBeenCalledWith(db, expect.any(String));
  });

  it('stores only the operational webhook fields needed for recovery', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);
    await POST(request({
      event: 'charge.success',
      data: {
        id: 42,
        reference: 'sub-ref',
        status: 'success',
        customer: { email: 'private@example.com' },
        authorization: { bin: '123456', last4: '7890' },
      },
    }));

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'sub-ref',
      transaction_id: 42,
    }));
    expect(JSON.stringify(db.insert.mock.calls[0][0])).not.toContain('private@example.com');
  });

  it('preserves the non-PII amount and occurrence time needed for partial refund ordering', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);
    await POST(request({
      event: 'refund.processed',
      data: {
        transaction: { id: 42, reference: 'sub-ref' },
        amount: 100,
        currency: 'GHS',
        updated_at: '2026-08-26T09:00:00.000Z',
      },
    }));

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_amount_minor: 100,
      event_occurred_at: '2026-08-26T09:00:00.000Z',
    }));
  });

  it('treats processed duplicate webhook delivery as already acknowledged', async () => {
    const db = dbWithInsert({ code: '23505', message: 'duplicate key value' }, { processed_at: '2026-08-26T00:00:00Z' });
    createClient.mockReturnValue(db);
    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.duplicate).toBe(true);
    expect(processStoredPaystackWebhookEvent).not.toHaveBeenCalled();
  });

  it('retries duplicate webhook delivery when the first attempt was not processed', async () => {
    const db = dbWithInsert({ code: '23505', message: 'duplicate key value' }, { processed_at: null });
    createClient.mockReturnValue(db);
    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.duplicate).toBe(true);
    expect(processStoredPaystackWebhookEvent).toHaveBeenCalledWith(db, expect.any(String));
  });

  it('acknowledges before deferred processing completes', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);
    processStoredPaystackWebhookEvent.mockRejectedValue(new Error('temporary Paystack outage'));

    const response = await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.accepted).toBe(true);
  });

  // Number(null) is 0 and Number.isFinite(0) is true, so an event with no id used to be stored
  // as transaction 0 -- a value that matches no payment but reads like a real identifier.
  it('stores a missing transaction id as null rather than zero', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);

    await POST(request({ event: 'charge.success', data: { reference: 'sub-ref' } }));

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ transaction_id: null }));
  });

  it('keeps a real transaction id', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);

    await POST(request({ event: 'charge.success', data: { reference: 'sub-ref', id: 302731 } }));

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ transaction_id: 302731 }));
  });

  it('rejects a transaction id that is not a usable whole number', async () => {
    const db = dbWithInsert();
    createClient.mockReturnValue(db);

    await POST(request({ event: 'refund.processed', data: { transaction: { reference: 'sub-ref', id: 'not-a-number' } } }));

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ transaction_id: null }));
  });
});
