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
      learning_paths: { data: [], error: null },
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'i1' }, serviceDb: supabase, role: 'instructor', token: 't' } as any);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completedCount).toEqual({ s1: 1 });
  });

  it('counts path content toward the cohort and each completed item once', async () => {
    // A cohort taught only through a learning path, with a learner who retook courses.
    const supabase = makeSupabaseStub({
      course_attempts: { data: [
        { student_id: 's1', course_id: 'c1' },
        { student_id: 's1', course_id: 'c1' },
        { student_id: 's1', course_id: 'c2' },
        { student_id: 's1', course_id: 'c2' },
      ], error: null },
      guided_project_attempts: { data: [{ student_id: 's1', ve_id: 'v1' }, { student_id: 's1', ve_id: 'v1' }], error: null },
      courses: { data: [{ id: 'c1', cohort_ids: [] }, { id: 'c2', cohort_ids: null }, { id: 'c3', cohort_ids: ['co2'] }], error: null },
      virtual_experiences: { data: [{ id: 'v1', cohort_ids: [] }], error: null },
      // 'draft' and 'cert1' are not published courses or VEs, so they do not count.
      learning_paths: { data: [{ item_ids: ['c1', 'c2', 'v1', 'draft', 'cert1', 'c3'], cohort_ids: ['co1', 'co2'] }], error: null },
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'i1' }, serviceDb: supabase, role: 'admin', token: 't' } as any);

    const body = await (await get()).json();
    expect(body.completedCount).toEqual({ s1: 3 });
    expect(body.cohortContentCount).toEqual({ co1: 4, co2: 4 });
    expect(body.studentContentCount).toEqual({});
  });

  it("counts core plus the learner's own track on a path with tracks", async () => {
    const supabase = makeSupabaseStub({
      course_attempts: { data: [], error: null },
      guided_project_attempts: { data: [], error: null },
      // hr2 is also assigned to the cohort directly, so it counts for everyone.
      courses: { data: ['core', 'fin1', 'hr1', 'hr2'].map(id => ({ id, cohort_ids: id === 'hr2' ? ['co1'] : [] })), error: null },
      virtual_experiences: { data: [], error: null },
      learning_paths: { data: [{
        id: 'lp', item_ids: ['core', 'fin1', 'hr1', 'hr2'], cohort_ids: ['co1'],
        tracks: [{ id: 'fin', name: 'Finance', item_ids: ['fin1'] }, { id: 'hr', name: 'HR', item_ids: ['hr1', 'hr2'] }],
      }], error: null },
      students: { data: [{ id: 'sFin', cohort_id: 'co1' }, { id: 'sHr', cohort_id: 'co1' }, { id: 'sNone', cohort_id: 'co1' }], error: null },
      learning_path_progress: { data: [
        { id: 'p1', student_id: 'sFin', learning_path_id: 'lp', track_id: 'fin' },
        { id: 'p2', student_id: 'sHr', learning_path_id: 'lp', track_id: 'hr' },
      ], error: null },
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'i1' }, serviceDb: supabase, role: 'admin', token: 't' } as any);

    const body = await (await get()).json();
    expect(body.cohortContentCount).toEqual({ co1: 4 });
    // Finance: core + fin1 + hr2 (direct). HR: core + hr1 + hr2. No pick yet: core + hr2.
    expect(body.studentContentCount).toEqual({ sFin: 3, sHr: 3, sNone: 2 });
  });
});
