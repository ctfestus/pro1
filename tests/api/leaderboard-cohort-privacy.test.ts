import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { GET } from '@/app/api/leaderboard/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireStudentUser.mockResolvedValue({ user: { id: 'student-1', email: 'one@example.com' } });
});

describe('leaderboard cohort privacy', () => {
  it.each(['subscription_plan', 'legacy_individual'])(
    'does not expose names from a %s cohort',
    async cohortKind => {
      createClient.mockReturnValue(makeSupabaseStub({
        students: {
          data: {
            role: 'student', cohort_id: 'shared-cohort', email: 'one@example.com',
            cohort: { cohort_kind: cohortKind },
          },
          error: null,
        },
      }));

      const response = await GET(new NextRequest(
        'http://localhost/api/leaderboard?cohort_id=shared-cohort',
        { headers: { authorization: 'Bearer token' } },
      ));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'Leaderboard is available only for bootcamp cohorts.',
      });
    },
  );
});
