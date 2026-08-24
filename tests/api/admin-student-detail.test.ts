import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { GET } from '@/app/api/admin/student-detail/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);

function get() {
  return GET(new Request('http://localhost/api/admin/student-detail?studentId=student1') as any);
}

beforeEach(() => mockRequireRole.mockReset());

describe('GET /api/admin/student-detail course status', () => {
  it('shows an active retake instead of an older failed completed attempt', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'admin1' },
      role: 'admin',
      token: 'test-token',
      serviceDb: makeSupabaseStub({
        students: { data: { id: 'student1', full_name: 'Student One', email: 'student@example.com', cohort_id: 'cohort1' }, error: null },
        course_attempts: {
          data: [
            {
              course_id: 'course1',
              score: 40,
              passed: false,
              completed_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              course_id: 'course1',
              score: 0,
              passed: false,
              completed_at: null,
              updated_at: '2026-01-02T00:00:00.000Z',
            },
          ],
          error: null,
        },
        guided_project_attempts: { data: [], error: null },
        assignment_submissions: [
          { data: [], error: null },
          { data: [], error: null },
        ],
        group_members: { data: [], error: null },
        certificates: { data: [], error: null },
        cohorts: { data: { id: 'cohort1', name: 'Cohort One' }, error: null },
        courses: { data: [{ id: 'course1', title: 'SQL Course', slug: 'sql-course' }], error: null },
        assignments: [
          { data: [], error: null },
          { data: [], error: null },
        ],
        virtual_experiences: { data: [], error: null },
      }),
    } as any);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0].status).toBe('in_progress');
  });

  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });
});
