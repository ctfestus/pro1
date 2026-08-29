// What the public pricing page is allowed to say.
//
// Two things carry real risk here: counting a plan's contents wrongly, which misprices the offer
// in a visitor's head, and treating the free tier as a plan, which would drag something nobody
// pays for into the billing machinery.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  loadPlansForContent: vi.fn(async () => [] as any[]),
  loadPlanContents: vi.fn(async () => new Map<string, any[]>()),
  counts: vi.fn((_table: string) => 0),
  seen: vi.fn((_table: string, _filters: Record<string, unknown>) => {}),
}));

vi.mock('@/lib/subscription-plan-access', () => ({
  loadPlansForContent: h.loadPlansForContent,
  loadPlanContents: h.loadPlanContents,
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, value: unknown) => { filters[col] = value; return builder; },
        then: (resolve: any) => {
          h.seen(table, filters);
          return Promise.resolve({ count: h.counts(table), error: null }).then(resolve);
        },
      };
      return builder;
    },
  }),
}));

// unstable_cache must not memoise across cases here, or the second test reads the first's answer.
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));

import { getPricingPageData, CONTENT_KINDS } from '@/lib/get-pricing-page-data';

beforeEach(() => {
  vi.clearAllMocks();
  h.loadPlansForContent.mockResolvedValue([]);
  h.loadPlanContents.mockResolvedValue(new Map());
  h.counts.mockReturnValue(0);
});

describe('pricing page data', () => {
  it('counts a plan by kind, not as one flat total', () => {
    // A visitor reads "3 courses, 1 learning path". Flattening to "4 things" is not something
    // anyone can check against the catalogue.
    h.loadPlansForContent.mockResolvedValue([
      { id: 'pro', name: 'Pro', description: null, prices: [{ id: 'p1', durationMonths: 1, amount: 100, currency: 'GHS' }] },
    ]);
    h.loadPlanContents.mockResolvedValue(new Map([['pro', [
      { contentTable: 'courses', contentId: 'c1', title: 'A' },
      { contentTable: 'courses', contentId: 'c2', title: 'B' },
      { contentTable: 'learning_paths', contentId: 'l1', title: 'Path' },
    ]]]));

    return getPricingPageData().then(data => {
      expect(data.plans[0].coverage).toEqual({
        courses: 2, learning_paths: 1, virtual_experiences: 0, certifications: 0,
      });
    });
  });

  it('orders a plan cheapest term first, so the toggle reads left to right', async () => {
    h.loadPlansForContent.mockResolvedValue([
      { id: 'pro', name: 'Pro', description: null, prices: [
        { id: 'y', durationMonths: 12, amount: 900, currency: 'GHS' },
        { id: 'm', durationMonths: 1, amount: 100, currency: 'GHS' },
        { id: 'q', durationMonths: 3, amount: 270, currency: 'GHS' },
      ] },
    ]);
    const data = await getPricingPageData();
    expect(data.plans[0].prices.map(p => p.durationMonths)).toEqual([1, 3, 12]);
  });

  it('counts the free tier from what is open to everyone, and only published rows', async () => {
    h.counts.mockImplementation((table: string) => (table === 'courses' ? 4 : 0));
    const data = await getPricingPageData();

    expect(data.free.courses).toBe(4);
    expect(data.free.certifications).toBe(0);
    for (const table of CONTENT_KINDS) {
      expect(h.seen).toHaveBeenCalledWith(table, expect.objectContaining({
        status: 'published',
        available_to_everyone: true,
      }));
    }
  });

  it('never treats the free tier as a purchasable plan', async () => {
    h.counts.mockReturnValue(7);
    const data = await getPricingPageData();
    // Free content is counted, never returned as something with a price attached to it.
    expect(data.plans).toEqual([]);
    expect(data.free.courses).toBe(7);
  });

  it('shows only plans someone can actually buy', () => {
    // loadPlansForContent already drops inactive plans and plans with no live price. This pins
    // the fact that the pricing page relies on that rather than filtering its own way.
    const source = readFileSync(join(process.cwd(), 'lib/get-pricing-page-data.ts'), 'utf8');
    expect(source).toContain('loadPlansForContent(db, null)');
    expect(source).not.toContain('subscription_plans');
  });

  it('reads plan coverage on the server, because a visitor cannot', () => {
    // RLS on subscription_plan_content requires a matching subscription, so an anonymous caller
    // sees nothing. This has to stay a server read with the service role.
    const source = readFileSync(join(process.cwd(), 'lib/get-pricing-page-data.ts'), 'utf8');
    expect(source).toContain("from '@/lib/admin-client'");
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });
});
