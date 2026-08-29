/**
 * What the public pricing page shows.
 *
 * Read on the server with the service role, because plan coverage is invisible to an anonymous
 * caller: the row-level policy on subscription_plan_content requires a matching subscription.
 * The projection is counts and titles only -- never course content.
 *
 * The free tier is deliberately NOT a plan row. A new account has no plan and sees whatever is
 * marked available to everyone, so the free tier already exists; it simply has no name. Giving
 * it a zero-priced plan row would drag it into the whole purchase machinery -- a subscription
 * record, a synthetic cohort, an expiry date, the renewal sweep, the one-plan-per-learner rule --
 * to model something nobody pays for and that never ends. So it is counted here, not sold.
 */
import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import {
  loadPlanContents,
  loadPlansForContent,
  type PlanPrice,
  type PurchasableContentTable,
} from '@/lib/subscription-plan-access';

export const CONTENT_KINDS: PurchasableContentTable[] = [
  'courses',
  'learning_paths',
  'virtual_experiences',
  'certifications',
];

export type ContentCounts = Record<PurchasableContentTable, number>;

export interface PricingPlan {
  id: string;
  name: string;
  description: string | null;
  prices: PlanPrice[];
  /** How much of each kind the plan grants, for the comparison table. */
  coverage: ContentCounts;
}

export interface PricingPageData {
  plans: PricingPlan[];
  /** What an account with no plan can already open. */
  free: ContentCounts;
}

const emptyCounts = (): ContentCounts => ({
  courses: 0,
  learning_paths: 0,
  virtual_experiences: 0,
  certifications: 0,
});

export const getPricingPageData = unstable_cache(
  async (): Promise<PricingPageData> => {
    const db = adminClient();

    // Active plans with a live price. A plan nobody can buy has no place on a pricing page.
    const plans = await loadPlansForContent(db, null);

    const coverageByPlan = await loadPlanContents(db, plans.map(plan => plan.id));

    // Counted per kind rather than flattened. A plan that grants a learning path grants a path,
    // not the courses inside it -- saying otherwise would inflate the number and confuse anyone
    // who then counted for themselves.
    const priced: PricingPlan[] = plans.map(plan => {
      const coverage = emptyCounts();
      for (const row of coverageByPlan.get(plan.id) ?? []) {
        if (row.contentTable in coverage) coverage[row.contentTable] += 1;
      }
      return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        prices: [...plan.prices].sort((a, b) => a.durationMonths - b.durationMonths),
        coverage,
      };
    });

    const free = emptyCounts();
    for (const table of CONTENT_KINDS) {
      const { count, error } = await db
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .eq('available_to_everyone', true);
      if (error) throw error;
      free[table] = count ?? 0;
    }

    return { plans: priced, free };
  },
  ['pricing-page-v1'],
  { revalidate: 300, tags: ['pricing-page'] },
);
