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
import { PRICING_CACHE_TAG } from '@/lib/revalidate-pricing';
import { createClient } from '@supabase/supabase-js';
import {
  emptyContentCounts,
  pricingPlanFromRow,
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
        .select('plan_id, plan_name, plan_description, recommended, prices, courses, learning_paths, virtual_experiences, certifications')
        // Recommended first, then by name. The free tier renders before any of these, so the
        // recommended plan lands in the middle -- where a pricing page puts the one it wants
        // chosen. Name alone made that an accident of spelling.
        .order('recommended', { ascending: false })
        .order('plan_name'),
      publicClient
        .from('public_free_content_counts')
        .select('content_table, content_count'),
    ]);
    if (plansResult.error) throw plansResult.error;
    if (freeResult.error) throw freeResult.error;

    const plans: PricingPlan[] = (plansResult.data ?? []).map(pricingPlanFromRow);

    const free: ContentCounts = emptyContentCounts();
    for (const row of (freeResult.data ?? []) as any[]) {
      const kind = row.content_table as keyof ContentCounts;
      if (kind in free) free[kind] = Number(row.content_count ?? 0);
    }

    return { plans, free };
  },
  ['pricing-page-v2'],
  // The timer is the backstop; the tag is what an admin edit clears through
  // revalidatePricingPage, so a withdrawn plan stops being advertised at once.
  // Short enough that a scheduled promotion appears or disappears promptly. Checkout still
  // verifies the exact quote, because an already-open browser tab can be older than any cache.
  { revalidate: 60, tags: [PRICING_CACHE_TAG] },
);
