import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const zrange = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({ zrange }),
}));

import { GET } from '@/app/api/activity/feed/route';

const request = () => new NextRequest(
  'http://localhost/api/activity/feed?cohort_id=cohort-1',
  { headers: { authorization: 'Bearer token' } },
);

function authedWith(cohortKind: string | null) {
  requireUser.mockResolvedValue({
    user: { id: 'student-1', email: 'one@example.com' },
    supabase: makeSupabaseStub({
      students: { data: { role: 'student', cohort_id: 'cohort-1', email: 'one@example.com' }, error: null },
      cohorts: { data: cohortKind ? { cohort_kind: cohortKind } : null, error: null },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  zrange.mockResolvedValue([]);
});

describe('GET /api/activity/feed bootcamp access', () => {
  it.each(['subscription_plan', 'legacy_individual'])(
    'does not read Redis for a %s cohort',
    async cohortKind => {
      authedWith(cohortKind);

      const response = await GET(request());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ events: [] });
      expect(zrange).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the cohort row is missing', async () => {
    authedWith(null);

    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ events: [] });
    expect(zrange).not.toHaveBeenCalled();
  });

  it('returns feed events for a bootcamp cohort member', async () => {
    authedWith('bootcamp');
    zrange.mockResolvedValue([
      JSON.stringify({ name: 'Ada', action: 'completed', title: 'SQL Basics', contentType: 'course', ts: 1 }),
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [{ name: 'Ada', action: 'completed', title: 'SQL Basics', contentType: 'course', ts: 1 }],
    });
    expect(zrange).toHaveBeenCalledOnce();
  });
});
