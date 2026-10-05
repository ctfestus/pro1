// Link previews are served to anonymous crawlers, so they must never reveal more than the page
// shows a signed-out visitor: no drafts, no cohort-only content, nothing guessed by slug.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: {} as Record<string, any>,
  plans: vi.fn(async () => [] as any[]),
  tenant: { appUrl: 'https://learn.example.com', appName: 'Example Academy' } as any,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/subscription-plan-access', () => ({ loadPlansForContent: h.plans }));
vi.mock('@/lib/get-tenant-settings', () => ({ getTenantSettings: async () => h.tenant }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, value: unknown) => { filters[col] = value; return builder; },
        maybeSingle: async () => {
          const row = h.rows[table];
          if (!row) return { data: null, error: null };
          const matches = Object.entries(filters).every(([col, value]) => row[col] === value);
          return { data: matches ? row : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { buildShareMetadata, shareImage } from '@/lib/content-share-metadata';
import { IMG_SOCIAL } from '@/lib/cloudinary-url';

const UUID = '89536a5c-16f3-411d-8f7f-e0e01080e5af';
const APP = 'https://learn.example.com';

const course = (over: Record<string, unknown> = {}) => ({
  id: UUID, slug: 'shared-slug', title: 'SQL Basics', description: 'Learn SQL.',
  cover_image: 'users/a/covers/b', status: 'published', available_to_everyone: true, ...over,
});

const ogImage = (m: any) => m.openGraph?.images?.[0]?.url as string | undefined;

beforeEach(() => {
  h.rows = {};
  h.plans.mockResolvedValue([]);
  h.tenant = { appUrl: APP, appName: 'Example Academy' };
});

describe('buildShareMetadata visibility', () => {
  it('previews published content open to everyone', async () => {
    h.rows.courses = course();
    const m: any = await buildShareMetadata('shared-slug');
    expect(m.title).toBe('SQL Basics');
    expect(ogImage(m)).toContain(IMG_SOCIAL);
    expect(m.openGraph.url).toBe(`${APP}/shared-slug`);
  });

  it('gives a draft no preview', async () => {
    h.rows.courses = course({ status: 'draft' });
    expect((await buildShareMetadata('shared-slug')).title).toBe('Not Found');
  });

  it('gives cohort-only content (not free, not on a sellable plan) no preview', async () => {
    h.rows.courses = course({ available_to_everyone: false });
    h.rows.public_free_content = null;
    expect((await buildShareMetadata('shared-slug')).title).toBe('Not Found');
  });

  it('previews paid content that a sellable plan covers', async () => {
    h.rows.courses = course({ available_to_everyone: false });
    h.rows.public_free_content = null;
    h.plans.mockResolvedValue([{ id: 'plan' }]);
    expect((await buildShareMetadata('shared-slug')).title).toBe('SQL Basics');
  });

  it('honours catalogueType when a slug exists in two tables', async () => {
    h.rows.courses = course();
    h.rows.virtual_experiences = course({ title: 'Fintech VE' });
    expect((await buildShareMetadata('shared-slug')).title).toBe('SQL Basics');
    expect((await buildShareMetadata('shared-slug', 'virtual_experience')).title).toBe('Fintech VE');
  });

  it('never previews an event: they are cohort-only to a signed-out visitor', async () => {
    h.rows.events = course({ title: 'Private Event' });
    expect((await buildShareMetadata('shared-slug')).title).toBe('Not Found');
  });
});

describe('buildShareMetadata base URL', () => {
  it('ignores a relative or malformed tenant appUrl and uses the env origin', async () => {
    h.rows.courses = course({ cover_image: null });
    for (const appUrl of ['learn.example.com', '/app', 'not a url']) {
      h.tenant = { appUrl, appName: 'Example Academy' };
      const m: any = await buildShareMetadata('shared-slug');
      expect(m.openGraph.url).toBe('http://localhost:3000/shared-slug');
      expect(ogImage(m)).toBe('http://localhost:3000/api/og/brand');
    }
  });

  it('reduces a configured appUrl with a path to its origin', async () => {
    h.rows.courses = course();
    h.tenant = { appUrl: 'https://learn.example.com/some/path/', appName: '' };
    expect(((await buildShareMetadata('shared-slug')) as any).openGraph.url).toBe(`${APP}/shared-slug`);
  });
});

describe('shareImage', () => {
  const base = { id: UUID, type: 'course' as const };

  it('always returns an image: no cover falls back to the brand card', () => {
    expect(shareImage({ ...base, coverImage: null }, APP)).toEqual({ url: `${APP}/api/og/brand`, sized: true });
    expect(shareImage({ ...base, coverImage: '' }, APP)).toEqual({ url: `${APP}/api/og/brand`, sized: true });
  });

  it('proxies data: covers only for types the proxy serves', () => {
    expect(shareImage({ ...base, coverImage: 'data:image/png;base64,AA' }, APP).url).toBe(`${APP}/api/og/${UUID}`);
    expect(shareImage({ ...base, type: 'certification', coverImage: 'data:image/png;base64,AA' }, APP).url)
      .toBe(`${APP}/api/og/brand`);
  });

  it('does not claim 1200x630 for an uncropped external cover', () => {
    expect(shareImage({ ...base, coverImage: 'https://proj.supabase.co/a.jpg' }, APP))
      .toEqual({ url: 'https://proj.supabase.co/a.jpg', sized: false });
  });
});
