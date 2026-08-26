import crypto from 'node:crypto';
import { PaymentError } from '@/lib/payment-errors';

export interface PaystackInitializeInput {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  callbackUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaystackInitializeResult {
  authorizationUrl: string;
  reference: string;
}

export interface PaystackVerification {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paidAt?: string | null;
  transactionId?: number | null;
  channel?: string | null;
  gatewayResponse?: string | null;
}

export class PaystackApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PaystackApiError';
  }
}

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) throw new PaymentError('configuration_error', 'Online payment is temporarily unavailable.', 503);
  return key;
}

function publicBaseUrl() {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (!configured) return '';
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function paystackIsConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim() && publicBaseUrl());
}

export function paystackCallbackUrl(reference: string) {
  const base = publicBaseUrl();
  if (!base) throw new PaymentError('configuration_error', 'Online payment return URL is not configured.', 503);
  return `${base}/student?section=payments&paystack_reference=${encodeURIComponent(reference)}`;
}

export function makePaystackReference(prefix = 'sub') {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function verifyPaystackSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Paystack normally answers in well under a second. Without a bound, one slow call can hold a
// serverless invocation open until the platform kills it, and the hourly sweep makes up to 25 of
// them in a row. 504 rather than a 4xx deliberately: both callers that branch on this status
// treat 4xx as "Paystack rejected it" and act on the transaction. A timeout tells us nothing
// about what Paystack did, so it must fall through to a plain rethrow.
const PAYSTACK_TIMEOUT_MS = 10_000;

async function paystackFetch(url: string, init: RequestInit, action: string) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS) });
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new PaystackApiError(504, `Paystack ${action} timed out`);
    }
    throw error;
  }
}

export async function initializePaystackTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
  const response = await paystackFetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      amount: String(Math.round(input.amount * 100)),
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl ?? undefined,
      metadata: input.metadata,
    }),
  }, 'initialization');
  const raw = await response.json().catch(() => null);
  if (!response.ok || !raw?.status || !raw?.data?.authorization_url) {
    throw new PaystackApiError(response.status, 'Paystack transaction initialization failed');
  }
  return {
    authorizationUrl: raw.data.authorization_url,
    reference: raw.data.reference,
  };
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerification> {
  const response = await paystackFetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  }, 'verification');
  const raw = await response.json().catch(() => null);
  if (!response.ok || !raw?.status || !raw?.data) {
    throw new PaystackApiError(response.status, 'Paystack transaction verification failed');
  }
  const data = raw.data;
  return {
    status: String(data.status || ''),
    reference: String(data.reference || reference),
    amount: Number(data.amount || 0) / 100,
    currency: String(data.currency || ''),
    paidAt: data.paid_at ?? data.paidAt ?? null,
    transactionId: data.id == null ? null : Number(data.id),
    channel: data.channel ?? null,
    gatewayResponse: data.gateway_response ?? null,
  };
}
