import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireRole = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/provision-individual-student', () => ({ provisionIndividualStudent: vi.fn() }));

import { POST } from '@/app/api/admissions/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireRole.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin' });
});

describe('subscription plan content guards', () => {
  it('does not turn a globally open certification into cohort-restricted content', async () => {
    createClient.mockReturnValue({
      ...makeSupabaseStub({
        certifications: {
          data: { id: 'cert-1', title: 'Open certification', status: 'published', cohort_ids: [], available_to_everyone: true, user_id: 'owner-1' },
          error: null,
        },
        subscription_plans: { data: { id: 'plan-1', cohort_id: 'plan-cohort-1' }, error: null },
      }),
      rpc,
    });

    const response = await POST(new NextRequest('http://localhost/api/admissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify({
        action: 'add-subscription-plan-content', planId: 'plan-1',
        contentTable: 'certifications', contentId: 'cert-1',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      'This certification is already available to everyone. Restrict it to a cohort first, then add it to the subscription plan.',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not add a globally available course to a restricted plan', async () => {
    createClient.mockReturnValue({
      ...makeSupabaseStub({
        courses: {
          data: { id: 'course-1', title: 'Open course', status: 'published', cohort_ids: [], available_to_everyone: true, user_id: 'owner-1' },
          error: null,
        },
        subscription_plans: { data: { id: 'plan-1', cohort_id: 'plan-cohort-1' }, error: null },
      }),
      rpc,
    });

    const response = await POST(new NextRequest('http://localhost/api/admissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify({
        action: 'add-subscription-plan-content', planId: 'plan-1',
        contentTable: 'courses', contentId: 'course-1',
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'This course is already available to everyone. Restrict it to a cohort first, then add it to the subscription plan.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
