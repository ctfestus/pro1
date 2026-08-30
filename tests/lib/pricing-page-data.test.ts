// What the public pricing page reads, and how.
//
// The page is served to anyone, so the two things that matter are that it reads with the
// anonymous key rather than the service role, and that the free tier it advertises matches what
// a new learner can genuinely open.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  rows: vi.fn((_view: string) => [] as any[]),
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: any[]) => {
    h.createClient(...args);
    return {
      from: (view: string) => ({
        select: async () => ({ data: h.rows(view), error: null }),
      }),
    };
  },
}));

// Otherwise the first case's answer is memoised and served to the rest.
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));

import { getPricingPageData } from '@/lib/get-pricing-page-data';

const migration = readFileSync(
  join(process.cwd(), 'migrations/196_public_pricing_views.sql'),
  'utf8',
);
const loader = readFileSync(join(process.cwd(), 'lib/get-pricing-page-data.ts'), 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.mockReturnValue([]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

describe('pricing page data', () => {
  it('reads with the anonymous key, never the service role', () => {
    // A public page reading with the service role puts the public contract in a TypeScript
    // projection, where widening it is a one-line accident. The views carry it instead.
    expect(loader).not.toContain('admin-client');
    expect(loader).not.toContain('SERVICE_ROLE');
    expect(loader).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('shapes a plan from the view, prices and counts together', async () => {
    h.rows.mockImplementation((view) => view === 'public_pricing_plans' ? [{
      plan_id: 'pro', plan_name: 'Pro', plan_description: 'Everything',
      prices: [
        { id: 'm', durationMonths: 1, amount: 100, currency: 'GHS' },
        { id: 'y', durationMonths: 12, amount: 900, currency: 'GHS' },
      ],
      courses: 12, learning_paths: 2, virtual_experiences: 3, certifications: 1,
    }] : []);

    const data = await getPricingPageData();

    expect(data.plans[0].name).toBe('Pro');
    expect(data.plans[0].prices.map(p => p.durationMonths)).toEqual([1, 12]);
    expect(data.plans[0].coverage).toEqual({
      courses: 12, learning_paths: 2, virtual_experiences: 3, certifications: 1,
    });
  });

  it('counts the free tier from the view, and defaults a kind it does not mention', async () => {
    h.rows.mockImplementation((view) => view === 'public_free_content_counts' ? [
      { content_table: 'courses', content_count: 5 },
      { content_table: 'learning_paths', content_count: 1 },
    ] : []);

    const data = await getPricingPageData();

    expect(data.free.courses).toBe(5);
    expect(data.free.learning_paths).toBe(1);
    expect(data.free.certifications).toBe(0);
  });

  it('survives a plan with no prices or an unknown content kind', async () => {
    h.rows.mockImplementation((view) => view === 'public_pricing_plans'
      ? [{ plan_id: 'p', plan_name: 'P', plan_description: null, prices: null }]
      : [{ content_table: 'something_else', content_count: 9 }]);

    const data = await getPricingPageData();

    expect(data.plans[0].prices).toEqual([]);
    expect(data.plans[0].coverage.courses).toBe(0);
    expect(Object.values(data.free).every(count => count === 0)).toBe(true);
  });
});

describe('the public pricing views', () => {
  it('counts free content reached through a free learning path, not just the flag', () => {
    // The access rule on each content table opens an item sitting inside a published, free
    // learning path, and that clause needs no login. Counting only available_to_everyone
    // understates the free tier and promises a new learner less than they actually get.
    expect(migration).toContain('free_path_items');
    expect(migration).toContain('unnest(lp.item_ids)');
    expect(migration).toContain("lp.status = 'published' AND lp.available_to_everyone");
  });

  it('offers only plans that are active, individual and actually priced', () => {
    expect(migration).toContain("p.status = 'active'");
    expect(migration).toContain("c.cohort_kind IN ('legacy_individual', 'subscription_plan')");
    expect(migration).toContain('pr.is_active');
  });

  it('counts only published content towards a plan', () => {
    // Content withdrawn after it was attached is no longer something the plan grants.
    expect(migration).toContain('published_content');
    expect(migration).toContain('JOIN published_content pc');
  });

  it('exposes names and counts, never content', () => {
    for (const leak of ['questions', 'correctAnswer', 'lesson', 'config']) {
      expect(migration).not.toContain(leak);
    }
  });

  it('is readable without a session', () => {
    expect(migration).toContain('GRANT SELECT ON public.public_pricing_plans TO anon');
    expect(migration).toContain('GRANT SELECT ON public.public_free_content_counts TO anon');
  });

  it('is applied to the fresh schema as well as the migration', () => {
    const fresh = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
    expect(fresh).toContain('CREATE OR REPLACE VIEW public.public_pricing_plans');
    expect(fresh).toContain('CREATE OR REPLACE VIEW public.public_free_content_counts');
  });
});
