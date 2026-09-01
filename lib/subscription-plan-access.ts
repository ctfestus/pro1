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

export interface PlanContentItem {
  contentTable: PurchasableContentTable;
  contentId: string;
  title: string;
}

export interface PlanWithPrices {
  id: string;
  name: string;
  description: string | null;
  prices: PlanPrice[];
  /** Present only when contents were requested. Capped; `contentCount` is the true total. */
  contents?: PlanContentItem[];
  contentCount?: number;
}

/** Enough to show what a plan is without turning a card into a wall of titles. */
export const PLAN_CONTENTS_PREVIEW_LIMIT = 12;

const CONTENT_TABLES: PurchasableContentTable[] = [
  'courses',
  'virtual_experiences',
  'certifications',
  'learning_paths',
];

/**
 * Titles of what each plan grants, for several plans at once.
 *
 * A learner choosing between plans cannot tell which one holds the course they came for, and
 * the answer was already in the database -- it was just only ever resolved after purchase, for
 * the plan they already owned. Batched across plans so a page showing several does not issue a
 * query per plan per content type.
 */
export async function loadPlanContents(
  db: SupabaseClient,
  planIds: string[],
): Promise<Map<string, PlanContentItem[]>> {
  const byPlan = new Map<string, PlanContentItem[]>();
  if (!planIds.length) return byPlan;

  const { data: coverage, error } = await db.from('subscription_plan_content')
    .select('plan_id, content_table, content_id')
    .in('plan_id', planIds)
    .order('added_at');
  if (error) throw error;
  const rows = (coverage ?? []) as any[];
  if (!rows.length) return byPlan;

  const titles = new Map<string, string>();
  for (const table of CONTENT_TABLES) {
    const ids = [...new Set(rows.filter(row => row.content_table === table).map(row => row.content_id))];
    if (!ids.length) continue;
    // Published only. Content can be attached to a plan while published and unpublished later,
    // and these are service-role reads that see past RLS -- without this a learner comparing
    // plans is shown the title of something withdrawn, advertising what the plan no longer
    // effectively grants.
    const { data: named, error: titleError } = await db.from(table)
      .select('id, title').eq('status', 'published').in('id', ids);
    if (titleError) throw titleError;
    for (const row of (named ?? []) as any[]) titles.set(`${table}:${row.id}`, row.title);
  }

  for (const row of rows) {
    const title = titles.get(`${row.content_table}:${row.content_id}`);
    // A missing title means the item was deleted out from under the plan. Skip it rather than
    // advertising a blank line.
    if (!title) continue;
    const list = byPlan.get(row.plan_id) ?? [];
    list.push({ contentTable: row.content_table, contentId: row.content_id, title });
    byPlan.set(row.plan_id, list);
  }
  return byPlan;
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
 *
 * `sellableOnly` narrows the result to what public_pricing_plans lists, which is the same rule
 * checkout enforces. Without it a surface can offer a purchase the API will refuse: the checks
 * here stop at an active plan with an active price, while the view also requires the plan to be
 * unarchived and to still hold at least one published item.
 *
 * `keepPlanIds` survives that filter. It carries the plan a learner already holds, because a
 * current subscriber may renew a plan that has stopped accepting new learners -- dropping it
 * from their own list would take away the renewal the purchase path still allows.
 */
export async function loadPlansForContent(
  db: SupabaseClient,
  target?: ContentTarget | null,
  options?: { withContents?: boolean; sellableOnly?: boolean; keepPlanIds?: readonly string[] },
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
  let plans = [...byPlan.values()];

  // Asked before contents are loaded, so a plan that is dropped costs no extra reads.
  if (options?.sellableOnly && plans.length) {
    const { data: sellable, error: sellableError } = await db
      .from('public_pricing_plans')
      .select('plan_id')
      .in('plan_id', plans.map(plan => plan.id));
    if (sellableError) throw sellableError;
    const onSale = new Set((sellable ?? []).map((row: any) => row.plan_id));
    const keep = new Set(options.keepPlanIds ?? []);
    plans = plans.filter(plan => onSale.has(plan.id) || keep.has(plan.id));
  }

  if (!options?.withContents || !plans.length) return plans;

  const contents = await loadPlanContents(db, plans.map(plan => plan.id));
  for (const plan of plans) {
    const all = contents.get(plan.id) ?? [];
    plan.contentCount = all.length;
    plan.contents = all.slice(0, PLAN_CONTENTS_PREVIEW_LIMIT);
  }
  return plans;
}
