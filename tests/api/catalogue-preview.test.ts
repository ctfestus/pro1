// The one route in the app that serves catalogue rows to a caller with no session at all.
//
// Two things are load-bearing and must not drift:
// 1. The projection is display-only. It reads with the service role, bypassing RLS, precisely so
//    it can show a locked item's title -- so if `questions` ever joins the select it hands out
//    lesson bodies and answer keys to anyone with the URL.
// 2. Only published rows are visible. Drafts must not be discoverable by guessing a slug.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => {
  const row = vi.fn<(table: string) => any>(() => null);
  const seen = vi.fn<(table: string, filters: Record<string, unknown>) => void>(() => {});
  const loadPlansForContent = vi.fn(async () => [] as any[]);
  return { row, seen, loadPlansForContent };
});

vi.mock('@/lib/subscription-plan-access', () => ({
  loadPlansForContent: h.loadPlansForContent,
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, value: unknown) => { filters[col] = value; return builder; },
        maybeSingle: async () => {
          h.seen(table, filters);
          const data = h.row(table);
          // Model the status filter the route relies on for draft invisibility.
          if (data && filters.status && data.status && data.status !== filters.status) {
            return { data: null, error: null };
          }
          return { data, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { GET } from '@/app/api/catalogue-preview/route';

const request = (query: string) =>
  new NextRequest(`http://localhost/api/catalogue-preview${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.row.mockReturnValue(null);
  h.loadPlansForContent.mockResolvedValue([]);
});

describe('public catalogue preview', () => {
  it('never selects course content, only display fields', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/catalogue-preview/route.ts'), 'utf8');
    const columns = source.slice(source.indexOf('const COLUMNS'), source.indexOf('const UUID'));
    for (const leak of ['questions', 'config', 'correctAnswer', 'lesson', 'item_ids']) {
      expect(columns).not.toContain(leak);
    }
  });

  it('gives a signed-out visitor the price for locked content instead of nothing', async () => {
    h.row.mockImplementation((table) => table === 'courses' ? {
      id: 'c1', title: 'Paid course', slug: 'paid-course', cover_image: 'cover.jpg',
      description: 'Blurb', category: 'Data', available_to_everyone: false, status: 'published',
    } : null);
    h.loadPlansForContent.mockResolvedValue([
      { id: 'plan-1', name: 'Data Track', description: null, prices: [
        { id: 'price-6', durationMonths: 6, amount: 600, currency: 'GHS' },
      ] },
    ]);

    const res = await GET(request('?ref=paid-course&type=course'));
    const { item } = await res.json();

    expect(res.status).toBe(200);
    expect(item.locked).toBe(true);
    expect(item.title).toBe('Paid course');
    expect(item.unlock.plans[0].prices[0].amount).toBe(600);
    // No outline for an anonymous caller, unlike the signed-in preview.
    expect(item.outline).toBeUndefined();
    expect(JSON.stringify(item)).not.toContain('questions');
  });

  it('quotes no price for content that is already open to everyone', async () => {
    h.row.mockImplementation((table) => table === 'courses' ? {
      id: 'c2', title: 'Free course', slug: 'free-course', cover_image: null,
      description: null, category: null, available_to_everyone: true, status: 'published',
    } : null);

    const res = await GET(request('?ref=free-course&type=course'));
    const { item } = await res.json();

    expect(item.locked).toBe(false);
    expect(item.unlock).toBeUndefined();
    expect(h.loadPlansForContent).not.toHaveBeenCalled();
  });

  it('only ever looks at published rows', async () => {
    h.row.mockImplementation((table) => table === 'courses' ? {
      id: 'c3', title: 'Draft course', slug: 'draft-course', cover_image: null,
      description: null, category: null, available_to_everyone: false, status: 'draft',
    } : null);

    const res = await GET(request('?ref=draft-course&type=course'));
    const { item } = await res.json();

    expect(item).toBeNull();
    expect(h.seen).toHaveBeenCalledWith('courses', expect.objectContaining({ status: 'published' }));
  });

  it('keeps cohort-only content invisible, because nothing sells it', async () => {
    // Published and not open to everyone is not the same as for sale. A course built for one
    // client's private cohort is published too, and RLS kept it hidden from anonymous visitors.
    // With no plan covering it there is no shop window to show, so it stays hidden.
    h.row.mockImplementation((table) => table === 'courses' ? {
      id: 'c9', title: 'Acme Corp internal onboarding', slug: 'acme-internal',
      cover_image: null, description: 'Private client programme', category: null,
      available_to_everyone: false, status: 'published',
    } : null);
    h.loadPlansForContent.mockResolvedValue([]);

    const res = await GET(request('?ref=acme-internal&type=course'));
    const { item } = await res.json();

    expect(item).toBeNull();
    expect(JSON.stringify(item)).not.toContain('Acme');
  });

  it('requires a ref', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(400);
  });

  it('reports nothing for an unknown ref rather than erroring', async () => {
    const res = await GET(request('?ref=does-not-exist'));
    const { item } = await res.json();
    expect(res.status).toBe(200);
    expect(item).toBeNull();
  });
});
