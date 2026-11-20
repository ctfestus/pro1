// Calls from the Subscriptions page to /api/payments. One place for the token and the error
// handling, which every action used to repeat.

import { supabase } from '@/lib/supabase';
import type { PaymentDraft } from './drafts';

export async function accessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

async function authFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${await accessToken()}` },
  });
}

/** GET any of our API routes, throwing the server's message (or `fallback`) when it fails. */
export async function getJson(url: string, fallback: string) {
  const res = await authFetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

/** GET a /api/payments action. */
export function getPayments(query: string, fallback: string) {
  return getJson(`/api/payments?${query}`, fallback);
}

/** POST an action, throwing the server's message (or `fallback`) when it fails. */
export function postPayments(body: Record<string, unknown>, fallback: string) {
  return sendJson('/api/payments', 'POST', body, fallback);
}

export async function sendJson(url: string, method: string, body: Record<string, unknown>, fallback: string) {
  const res = await authFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

/** Ask a learner to pay; access starts or extends once their confirmation is approved. */
export function requestPayment(studentId: string, planId: string, payment: PaymentDraft) {
  return postPayments({
    action: 'create-subscription-payment-request',
    studentId,
    planId,
    durationMonths: Number(payment.durationMonths),
    amount: Number(payment.amount),
    currency: payment.currency,
    dueDate: payment.dueDate,
  }, 'Failed to assign payment request');
}

/**
 * Record a payment already received and give access now: a new subscription, or a renewal of the
 * learner's current one. The key makes a retried click the same payment, not a second one.
 */
export function recordPayment(renew: boolean, studentId: string, planId: string, payment: PaymentDraft, idempotencyKey: string) {
  return postPayments({
    action: renew ? 'renew-subscription' : 'create-subscription',
    studentId,
    planId,
    durationMonths: Number(payment.durationMonths),
    amount: Number(payment.amount),
    currency: payment.currency,
    paymentMethod: payment.paymentMethod || null,
    paymentReference: payment.paymentReference || null,
    notes: payment.notes || null,
    idempotencyKey,
  }, 'Failed to save subscription');
}
