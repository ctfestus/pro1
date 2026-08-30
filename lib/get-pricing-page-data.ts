/**
 * What the public pricing page shows.
 *
 * Read with the anonymous key, exactly as the landing page reads the catalogue. Two views carry
 * the whole public contract: public_pricing_plans and public_free_content_counts. Nothing here
 * uses the service role, so what the world may see is defined in SQL where it can be reviewed,
 * rather than in a projection somebody widens later without noticing what it exposes.
 *
 * The free tier is deliberately not a plan row. An account with no plan already sees what is
 * open to everyone, so the free tier exists -- it simply has no name. Giving it a zero-priced
 * plan would drag something nobody pays for into the subscription record, the synthetic cohort,
 * the expiry sweep and the one-plan-per-learner rule.
 */
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import {
  emptyContentCounts,
  type ContentCounts,
  type PricingPageData,
  type PricingPlan,
  type PricingPrice,
} from '@/lib/pricing-contract';

export type { ContentCounts, PricingPageData, PricingPlan } from '@/lib/pricing-contract';

export const getPricingPageData = unstable_cache(
  async (): Promise<PricingPageData> => {
    const publicClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const [plansResult, freeResult] = await Promise.all([
      // Ordered explicitly. A view carries no ordering contract, so without this Postgres may
      // return plans in any order and the page could rearrange itself between requests with
      // nobody having changed anything.
      publicClient
        .from('public_pricing_plans')
        .select('plan_id, plan_name, plan_description, prices, courses, learning_paths, virtual_experiences, certifications')
        .order('plan_name'),
      publicClient
        .from('public_free_content_counts')
        .select('content_table, content_count'),
    ]);
    if (plansResult.error) throw plansResult.error;
    if (freeResult.error) throw freeResult.error;

    const plans: PricingPlan[] = (plansResult.data ?? []).map((row: any) => ({
      id: row.plan_id,
      name: row.plan_name,
      description: row.plan_description ?? null,
      // Already ordered by duration in the view, so the toggle reads left to right as it comes.
      prices: ((row.prices ?? []) as any[]).map((price): PricingPrice => ({
        id: price.id,
        durationMonths: Number(price.durationMonths),
        amount: Number(price.amount),
        currency: price.currency || 'GHS',
      })),
      coverage: {
        courses: Number(row.courses ?? 0),
        learning_paths: Number(row.learning_paths ?? 0),
        virtual_experiences: Number(row.virtual_experiences ?? 0),
        certifications: Number(row.certifications ?? 0),
      },
    }));

    const free: ContentCounts = emptyContentCounts();
    for (const row of (freeResult.data ?? []) as any[]) {
      const kind = row.content_table as keyof ContentCounts;
      if (kind in free) free[kind] = Number(row.content_count ?? 0);
    }

    return { plans, free };
  },
  ['pricing-page-v2'],
  { revalidate: 300, tags: ['pricing-page'] },
);
