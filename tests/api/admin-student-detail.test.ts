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
        learning_paths: { data: [], error: null },
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

  function pathOnlyStub(pathResult: { data: unknown; error: unknown }) {
    return makeSupabaseStub({
      students: { data: { id: 'student1', full_name: 'Student One', email: 'student@example.com', cohort_id: 'cohort1' }, error: null },
      course_attempts: { data: [{ course_id: 'path-course', score: 90, passed: true, completed_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }], error: null },
      guided_project_attempts: { data: [], error: null },
      assignment_submissions: { data: [], error: null },
      group_members: { data: [], error: null },
      certificates: { data: [], error: null },
      cohorts: { data: { id: 'cohort1', name: 'Cohort One' }, error: null },
      // Nothing is assigned to the cohort directly; the second read is the path item lookup.
      courses: [
        { data: [], error: null },
        { data: [{ id: 'path-course', title: 'Path Course', slug: 'path-course' }], error: null },
      ],
      virtual_experiences: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      assignments: { data: [], error: null },
      learning_paths: pathResult,
    });
  }

  it('lists courses the cohort reaches only through a learning path', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'admin1' }, role: 'admin', token: 'test-token',
      serviceDb: pathOnlyStub({ data: [{ item_ids: ['path-course'] }], error: null }),
    } as any);

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courses).toEqual([expect.objectContaining({ id: 'path-course', status: 'completed' })]);
  });

  it('fails instead of showing no courses when the path lookup errors', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'admin1' }, role: 'admin', token: 'test-token',
      serviceDb: pathOnlyStub({ data: null, error: { message: 'timeout' } }),
    } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await get()).status).toBe(500);
  });

  it("leaves out the other tracks' courses on a path with tracks", async () => {
    const calls: { table: string; col: string; vals: unknown }[] = [];
    const spy = (b: any, table: string): any => new Proxy(b, {
      get(t, prop) {
        const v = t[prop];
        if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof v !== 'function') return v;
        return (...args: any[]) => {
          if (prop === 'in') calls.push({ table, col: args[0], vals: args[1] });
          return spy(v(...args), table);
        };
      },
    });
    const stub = pathOnlyStub({ data: [{
      id: 'lp', item_ids: ['path-course', 'fin1', 'hr1'], cohort_ids: ['cohort1'],
      tracks: [{ id: 'fin', name: 'Finance', item_ids: ['fin1'] }, { id: 'hr', name: 'HR', item_ids: ['hr1'] }],
    }], error: null });
    const progress = makeSupabaseStub({ learning_path_progress: { data: [{ learning_path_id: 'lp', track_id: 'fin' }], error: null } });
    const db = { ...stub, from: (table: string) => spy((table === 'learning_path_progress' ? progress : stub).from(table), table) };
    mockRequireRole.mockResolvedValue({ user: { id: 'admin1' }, role: 'admin', token: 'test-token', serviceDb: db } as any);

    expect((await get()).status).toBe(200);
    const lookup = calls.find(c => c.table === 'courses' && c.col === 'id');
    expect(lookup?.vals).toEqual(['path-course', 'fin1']);
  });

  it('fails instead of guessing when the track lookup errors', async () => {
    const stub = pathOnlyStub({ data: [{
      id: 'lp', item_ids: ['path-course', 'fin1'], cohort_ids: ['cohort1'],
      tracks: [{ id: 'fin', name: 'Finance', item_ids: ['fin1'] }],
    }], error: null });
    const progress = makeSupabaseStub({ learning_path_progress: { data: null, error: { message: 'timeout' } } });
    const db = { ...stub, from: (table: string) => (table === 'learning_path_progress' ? progress : stub).from(table) };
    mockRequireRole.mockResolvedValue({ user: { id: 'admin1' }, role: 'admin', token: 'test-token', serviceDb: db } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await get()).status).toBe(500);
  });

  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });
});
