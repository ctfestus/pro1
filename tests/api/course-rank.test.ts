import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));

import { GET } from '@/app/api/course-rank/route';

const profile = { role: 'student', cohort_id: 'cohort-1', email: 'kojo@example.com' };
const roster = [
  { id: 'student-a', full_name: 'Ama', email: 'ama@example.com' },
  { id: 'student-b', full_name: 'Kojo', email: 'kojo@example.com' },
];
const attempts = [
  { student_id: 'student-a', score: 90, points: 100, completed_at: '2026-10-01T00:00:00Z' },
  { student_id: 'student-b', score: 80, points: 90, completed_at: '2026-10-01T00:00:00Z' },
];

function authAs(tables: Record<string, QueryResult | QueryResult[]>) {
  requireStudentUser.mockResolvedValue({
    user: { id: 'student-b', email: 'kojo@example.com' },
    serviceDb: makeSupabaseStub(tables),
  });
}

// students is read three times: caller profile, bootcamp access check, cohort roster.
const students = (p: unknown = profile, r: unknown = roster): QueryResult[] =>
  [{ data: p, error: null }, { data: p, error: null }, { data: r, error: null }];

const get = (query = 'course_id=course-1') => GET(new NextRequest(
  `http://localhost/api/course-rank?${query}`,
  { headers: { authorization: 'Bearer token' } },
));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('course rank', () => {
  it('ranks the caller within their bootcamp cohort without emails', async () => {
    authAs({
      students: students(),
      cohorts: { data: { cohort_kind: 'bootcamp' }, error: null },
      course_attempts: { data: attempts, error: null },
    });
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      eligible: true,
      rank: 2,
      total: 2,
      above: { name: 'Ama', rank: 1 },
      me: { name: 'Kojo', rank: 2, score: 80, points: 90 },
      below: null,
    });
    expect(JSON.stringify(body)).not.toContain('@example.com');
  });

  it('does not count attempts from students outside the cohort roster', async () => {
    authAs({
      students: students(),
      cohorts: { data: { cohort_kind: 'bootcamp' }, error: null },
      course_attempts: {
        data: [...attempts, { student_id: 'other-cohort', score: 100, points: 999, completed_at: '2026-10-01T00:00:00Z' }],
        error: null,
      },
    });
    const body = await (await get()).json();
    expect(body).toMatchObject({ rank: 2, total: 2, above: { name: 'Ama' } });
  });

  it.each(['subscription_plan', 'legacy_individual'])('is ineligible in a %s cohort', async kind => {
    authAs({
      students: students(),
      cohorts: { data: { cohort_kind: kind }, error: null },
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ eligible: false });
  });

  it('is ineligible without a cohort or as a non-student', async () => {
    authAs({ students: { data: { ...profile, cohort_id: null }, error: null } });
    expect(await (await get()).json()).toEqual({ eligible: false });

    authAs({ students: { data: { ...profile, role: 'instructor' }, error: null } });
    expect(await (await get()).json()).toEqual({ eligible: false });
  });

  it('gives the same ineligible answer for an unknown, inaccessible or unfinished course', async () => {
    authAs({
      students: students(),
      cohorts: { data: { cohort_kind: 'bootcamp' }, error: null },
      course_attempts: { data: [attempts[0]], error: null },
    });
    const res = await get('course_id=someone-elses-course');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ eligible: false });
  });

  it('requires course_id', async () => {
    authAs({});
    expect((await get('')).status).toBe(400);
  });

  it('passes through an auth failure', async () => {
    requireStudentUser.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await get()).status).toBe(401);
  });

  it('reports a database failure as 500, not as ineligible', async () => {
    authAs({
      students: students(),
      cohorts: { data: { cohort_kind: 'bootcamp' }, error: null },
      course_attempts: { data: null, error: { message: 'boom' } },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await get()).status).toBe(500);
    errSpy.mockRestore();
  });
});
