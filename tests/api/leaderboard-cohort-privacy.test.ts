import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));

import { GET } from '@/app/api/leaderboard/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('leaderboard cohort privacy', () => {
  it.each(['subscription_plan', 'legacy_individual'])(
    'does not expose names from a %s cohort',
    async cohortKind => {
      requireStudentUser.mockResolvedValue({
        user: { id: 'student-1', email: 'one@example.com' },
        serviceDb: makeSupabaseStub({
          students: {
            data: {
              role: 'student', cohort_id: 'shared-cohort', email: 'one@example.com',
            },
            error: null,
          },
          cohorts: { data: { cohort_kind: cohortKind }, error: null },
        }),
      });

      const response = await GET(new NextRequest(
        'http://localhost/api/leaderboard?cohort_id=shared-cohort',
        { headers: { authorization: 'Bearer token' } },
      ));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'Bootcamp cohort access required.',
      });
    },
  );

  it('fails closed when the requested cohort row is missing', async () => {
    requireStudentUser.mockResolvedValue({
      user: { id: 'student-1', email: 'one@example.com' },
      serviceDb: makeSupabaseStub({
        students: {
          data: {
            role: 'student', cohort_id: 'shared-cohort', email: 'one@example.com',
          },
          error: null,
        },
        cohorts: { data: null, error: null },
      }),
    });

    const response = await GET(new NextRequest(
      'http://localhost/api/leaderboard?cohort_id=shared-cohort',
      { headers: { authorization: 'Bearer token' } },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Bootcamp cohort access required.',
    });
  });
});
