import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaystackReviewItem {
  kind: 'incident' | 'stalled';
  id: string;
  reference: string | null;
  reason: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  studentId: string | null;
  studentName: string | null;
  studentEmail: string | null;
  planName: string | null;
  occurredAt: string;
  notifiedAt: string | null;
  notificationError: string | null;
  blocksCredit: boolean;
}

const STALLED_CHECKOUT_MS = 6 * 60 * 60 * 1000;
const IN_FLIGHT_STATUSES = ['initialized', 'pending', 'ongoing', 'processing', 'queued'];

export async function getPaystackReviewQueue(
  db: SupabaseClient,
  options: { limit?: number; planIds?: string[] | null } = {},
) {
  const limit = options.limit ?? 100;
  const planIds = options.planIds ?? null;
  if (planIds && planIds.length === 0) {
    return { items: [] as PaystackReviewItem[], heartbeat: await getSweepHeartbeat(db) };
  }

  let incidentQuery = db.from('paystack_review_incidents')
    .select(`
      id, reference, reason, kind, event_name, amount, currency, student_id, plan_id,
      blocks_credit, status, created_at, notification_sent_at, notification_error,
      students!paystack_review_incidents_student_id_fkey(full_name,email),
      subscription_plans!paystack_review_incidents_plan_id_fkey(name)
    `)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (planIds) incidentQuery = incidentQuery.in('plan_id', planIds);
  const { data: incidents, error: incidentError } = await incidentQuery;
  if (incidentError) throw incidentError;

  const transactionColumns = `id, reference, status, amount, currency, plan_name, student_id, updated_at,
    students!paystack_subscription_transactions_student_id_fkey(full_name,email)`;
  let stalledQuery = db.from('paystack_subscription_transactions').select(transactionColumns)
    .in('status', IN_FLIGHT_STATUSES)
    .lt('updated_at', new Date(Date.now() - STALLED_CHECKOUT_MS).toISOString())
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (planIds) stalledQuery = stalledQuery.in('plan_id', planIds);
  const { data: stalled, error: stalledError } = await stalledQuery;
  if (stalledError) throw stalledError;

  const items: PaystackReviewItem[] = [
    ...(incidents ?? []).map((row: any) => ({
      kind: 'incident' as const,
      id: row.id,
      reference: row.reference,
      reason: row.reason ?? row.event_name ?? row.kind,
      status: row.event_name ?? row.kind,
      amount: row.amount == null ? null : Number(row.amount),
      currency: row.currency,
      studentId: row.student_id,
      studentName: row.students?.full_name ?? null,
      studentEmail: row.students?.email ?? null,
      planName: row.subscription_plans?.name ?? null,
      occurredAt: row.created_at,
      notifiedAt: row.notification_sent_at,
      notificationError: row.notification_error,
      blocksCredit: Boolean(row.blocks_credit),
    })),
    ...(stalled ?? []).map((row: any) => ({
      kind: 'stalled' as const,
      id: row.id,
      reference: row.reference,
      reason: 'checkout_never_completed',
      status: row.status,
      amount: row.amount == null ? null : Number(row.amount),
      currency: row.currency,
      studentId: row.student_id,
      studentName: row.students?.full_name ?? null,
      studentEmail: row.students?.email ?? null,
      planName: row.plan_name,
      occurredAt: row.updated_at,
      notifiedAt: null,
      notificationError: null,
      blocksCredit: false,
    })),
  ];
  items.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
  return { items: items.slice(0, limit), heartbeat: await getSweepHeartbeat(db) };
}

export async function getSweepHeartbeat(db: SupabaseClient) {
  const { data, error } = await db.from('cron_heartbeats')
    .select('last_success_at,last_summary')
    .eq('job_name', 'subscription-expiry-sweep')
    .maybeSingle();
  if (error) throw error;
  if (!data?.last_success_at) return { lastSuccessAt: null, staleHours: null, stale: true, summary: null };
  const staleHours = (Date.now() - new Date(data.last_success_at).getTime()) / 3_600_000;
  return { lastSuccessAt: data.last_success_at, staleHours, stale: staleHours > 3, summary: data.last_summary ?? null };
}
