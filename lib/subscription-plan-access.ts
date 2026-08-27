/**
 * Which subscription plans unlock a given piece of content, and what they cost.
 *
 * This is deliberately one implementation shared by every surface that answers a version of
 * "what does it take to open this". The catalogue tells a learner the price on the locked
 * content page; the payments route decides which plans they may actually buy for it. If those
 * two ever disagreed, a learner would be quoted one thing and offered another -- so they read
 * the same rules from the same place rather than each keeping their own copy.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type PurchasableContentTable =
  | 'courses'
  | 'learning_paths'
  | 'virtual_experiences'
  | 'certifications';

export const PURCHASABLE_CONTENT_TABLES = new Set<string>([
  'courses',
  'learning_paths',
  'virtual_experiences',
  'certifications',
]);

/** A plan's access cohort must be one of these, or it is not an individual subscription plan. */
const INDIVIDUAL_COHORT_KINDS = ['legacy_individual', 'subscription_plan'];

export interface PlanPrice {
  id: string;
  durationMonths: number;
  amount: number;
  currency: string;
}

export interface PlanWithPrices {
  id: string;
  name: string;
  description: string | null;
  prices: PlanPrice[];
}

export interface ContentTarget {
  contentTable: string;
  contentId: string;
}

/** Plans that grant this content, whether attached directly or reached through a learning path. */
export async function eligiblePlanIds(
  db: SupabaseClient,
  contentTable: string,
  contentId: string,
): Promise<string[]> {
  const { data: direct, error: directError } = await db.from('subscription_plan_content')
    .select('plan_id').eq('content_table', contentTable).eq('content_id', contentId);
  if (directError) throw directError;
  const planIds = new Set<string>((direct ?? []).map((row: any) => row.plan_id));

  // A plan can grant a course, VE, or certification through a learning path rather than by
  // attaching the item directly. Include those plans so the payment choice matches RLS access.
  if (contentTable !== 'learning_paths') {
    const { data: paths, error: pathError } = await db.from('learning_paths')
      .select('id').eq('status', 'published').contains('item_ids', [contentId]);
    if (pathError) throw pathError;
    const pathIds = (paths ?? []).map((path: any) => path.id);
    if (pathIds.length) {
      const { data: viaPaths, error: coverageError } = await db.from('subscription_plan_content')
        .select('plan_id').eq('content_table', 'learning_paths').in('content_id', pathIds);
      if (coverageError) throw coverageError;
      for (const row of viaPaths ?? []) planIds.add((row as any).plan_id);
    }
  }
  return [...planIds];
}

/**
 * Active plans with their active prices. Pass a target to narrow to the plans that unlock that
 * one item, or null for every plan on offer.
 *
 * Durations and amounts come from what an admin actually configured. Nothing here assumes a
 * fixed set of durations: a tenant selling only six months has exactly one price row, and any
 * surface that hardcodes "1, 3 or 12 months" is advertising options that do not exist.
 */
export async function loadPlansForContent(
  db: SupabaseClient,
  target?: ContentTarget | null,
): Promise<PlanWithPrices[]> {
  const allowedPlanIds = target ? await eligiblePlanIds(db, target.contentTable, target.contentId) : null;
  if (allowedPlanIds && allowedPlanIds.length === 0) return [];

  let priceQuery = db
    .from('subscription_plan_prices')
    .select('id, plan_id, duration_months, amount, currency, sort_order, subscription_plans!subscription_plan_prices_plan_id_fkey(id, name, description, status, cohort_id)')
    .eq('is_active', true);
  if (allowedPlanIds) priceQuery = priceQuery.in('plan_id', allowedPlanIds);
  const { data: prices, error } = await priceQuery.order('sort_order').order('duration_months');
  if (error) throw error;

  const cohortIds = [...new Set((prices ?? []).map((row: any) => row.subscription_plans?.cohort_id).filter(Boolean))];
  const { data: cohorts, error: cohortError } = cohortIds.length
    ? await db.from('cohorts').select('id, cohort_kind').in('id', cohortIds)
    : { data: [], error: null };
  if (cohortError) throw cohortError;
  const eligibleCohorts = new Set((cohorts ?? [])
    .filter((row: any) => INDIVIDUAL_COHORT_KINDS.includes(row.cohort_kind))
    .map((row: any) => row.id));

  const byPlan = new Map<string, PlanWithPrices>();
  for (const row of (prices ?? []) as any[]) {
    const plan = row.subscription_plans;
    if (!plan || plan.status !== 'active' || !eligibleCohorts.has(plan.cohort_id)) continue;
    const current: PlanWithPrices = byPlan.get(plan.id) ?? {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? null,
      prices: [],
    };
    current.prices.push({
      id: row.id,
      durationMonths: row.duration_months,
      amount: Number(row.amount),
      currency: row.currency || 'GHS',
    });
    byPlan.set(plan.id, current);
  }
  return [...byPlan.values()];
}
