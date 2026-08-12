import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireRole = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireRole, isAuthError: () => false }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/provision-individual-student', () => ({ provisionIndividualStudent: vi.fn() }));

import { POST } from '@/app/api/admissions/route';

function request() {
  return new NextRequest('http://localhost/api/admissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify({ action: 'assign-student', studentId: 'student-1', cohortId: null }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireRole.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin' });
});

describe('bootcamp release for individual subscription eligibility', () => {
  it('uses the transactional release function instead of only clearing cohort_id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, released: true }, error: null });
    createClient.mockReturnValue({
      ...makeSupabaseStub({ students: { data: { email: 'student@example.com' }, error: null } }),
      rpc,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('release_student_from_bootcamp', { p_student_id: 'student-1' });
  });

  it('surfaces a release conflict as HTTP 409', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'an individual subscriber cannot be unassigned through the bootcamp workflow' },
    });
    createClient.mockReturnValue({
      ...makeSupabaseStub({ students: { data: { email: 'student@example.com' }, error: null } }),
      rpc,
    });

    const response = await POST(request());
    expect(response.status).toBe(409);
  });
});
