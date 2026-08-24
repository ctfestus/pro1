import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Pure requireRole(['admin','instructor']) route. Mock the api-auth seam (keeping the real
// isAuthError) and assert the route's gating: anon -> 401, wrong role -> 403, instructor -> 200.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { GET } from '@/app/api/admin/students-stats/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);

function get() {
  return GET(new Request('http://localhost/api/admin/students-stats') as any);
}

beforeEach(() => mockRequireRole.mockReset());

describe('GET /api/admin/students-stats', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });

  it('403 for a student (wrong role)', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await get()).status).toBe(403);
  });

  it('200 with stats for an instructor', async () => {
    const supabase = makeSupabaseStub({
      course_attempts: { data: [{ student_id: 's1', course_id: 'c1' }], error: null },
      guided_project_attempts: { data: [], error: null },
      courses: { data: [{ id: 'c1', cohort_ids: ['co1'] }], error: null },
      virtual_experiences: { data: [], error: null },
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'i1' }, serviceDb: supabase, role: 'instructor', token: 't' } as any);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completedCount).toEqual({ s1: 1 });
  });
});
