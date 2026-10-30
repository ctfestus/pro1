import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { GET } from '@/app/api/learning-paths/report/route';
import { summarizeLearnerProgress, type PathReportItem } from '@/lib/learning-path-report';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);

function get(pathId = 'path1') {
  return GET(new Request(`http://localhost/api/learning-paths/report?pathId=${pathId}`, {
    headers: { Authorization: 'Bearer test-token' },
  }) as any);
}

const PATH = {
  id: 'path1', title: 'Data Analyst Path', status: 'published', instructor_id: 'owner1',
  item_ids: ['course1', 've1'], cohort_ids: ['bootcamp1', 'plancohort1'], available_to_everyone: false,
};

function stub(overrides: Record<string, any> = {}) {
  return makeSupabaseStub({
    learning_paths: { data: PATH, error: null },
    courses: { data: [{ id: 'course1', title: 'Excel Basics' }], error: null },
    virtual_experiences: { data: [{ id: 've1', title: 'Sales Dashboard' }], error: null },
    certifications: { data: [], error: null },
    students: [
      {
        data: [
          { id: 'bootcamper', email: 'b@example.com', full_name: 'Bootcamp Learner', status: 'active', cohort_id: 'bootcamp1' },
          { id: 'subscriber', email: 's@example.com', full_name: 'Plan Learner', status: 'active', cohort_id: 'plancohort1' },
        ],
        count: 2, error: null,
      },
      { data: [{ id: 'lapsed', email: 'l@example.com', full_name: 'Lapsed Learner', status: 'active', cohort_id: null }], count: 1, error: null },
    ],
    learning_path_progress: { data: [{ id: 'p1', student_id: 'lapsed', completed_item_ids: ['course1'], completed_at: null, cert_id: null, updated_at: '2026-09-01T00:00:00Z' }], count: 1, error: null },
    course_attempts: [
      { data: [{ student_id: 'bootcamper', course_id: 'course1', passed: true, score: 90, completed_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' }], count: 1, error: null },
      { data: [], count: 0, error: null },
    ],
    guided_project_attempts: [
      { data: [{ student_id: 'bootcamper', ve_id: 've1', completed_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z' }], count: 1, error: null },
      { data: [], count: 0, error: null },
    ],
    cohorts: { data: [{ id: 'bootcamp1', name: 'Cohort 7', cohort_kind: 'bootcamp' }, { id: 'plancohort1', name: 'plan-cohort', cohort_kind: 'subscription_plan' }], count: 2, error: null },
    individual_subscriptions: { data: [
      { id: 'sub1', student_id: 'subscriber', plan_id: 'plan1', cohort_id: 'plancohort1', status: 'active', current_period_end: '2026-12-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
      { id: 'sub2', student_id: 'lapsed', plan_id: 'plan1', cohort_id: 'plancohort1', status: 'expired', current_period_end: '2026-09-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
    ], count: 2, error: null },
    subscription_plans: { data: [{ id: 'plan1', name: 'Pro Monthly', cohort_id: 'plancohort1' }], count: 1, error: null },
    cohort_assignments: { data: [{ id: 'a1', cohort_id: 'bootcamp1', assigned_at: '2026-07-01T00:00:00Z' }, { id: 'a2', cohort_id: 'plancohort1', assigned_at: '2026-07-15T00:00:00Z' }], count: 2, error: null },
    ...overrides,
  });
}

beforeEach(() => {
  mockRequireRole.mockReset();
});

describe('GET /api/learning-paths/report', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });

  it('403 for an instructor who does not own the path', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'someone-else' }, role: 'instructor', serviceDb: stub() } as any);
    expect((await get()).status).toBe(403);
  });

  it('400 without a pathId', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb: stub() } as any);
    expect((await get('')).status).toBe(400);
  });

  it('reports cohort learners, subscribers and lapsed subscribers with their progress', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb: stub() } as any);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: any) => i.kind)).toEqual(['course', 'virtual_experience']);

    const byId = Object.fromEntries(body.learners.map((l: any) => [l.student_id, l]));
    expect(byId.bootcamper).toMatchObject({ source: 'cohort', cohort_name: 'Cohort 7', status: 'completed', completed_count: 2, progress_pct: 100, enrolled_at: '2026-07-01T00:00:00Z' });
    expect(byId.subscriber).toMatchObject({ source: 'subscriber', cohort_name: 'Pro Monthly', plan_name: 'Pro Monthly', status: 'not_started', subscription_status: 'active', enrolled_at: '2026-08-01T00:00:00Z' });
    // Stored progress alone still counts, and losing access does not hide the history.
    expect(byId.lapsed).toMatchObject({ source: 'former', status: 'in_progress', completed_count: 1, current_item_id: 've1', subscription_status: 'expired', former_plan_cohort_id: 'plancohort1' });
    expect(byId.subscriber.former_plan_cohort_id).toBeNull();

    expect(body.cohorts.map((c: any) => [c.name, c.source])).toEqual([['Cohort 7', 'cohort'], ['Pro Monthly', 'subscriber']]);
  });

  it("orders a learner's items core first, then their track, as their own view and emails do", async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb: stub({
      learning_paths: { data: { ...PATH, item_ids: ['course1', 've1', 'course2'], tracks: [{ id: 'fin', name: 'Finance', item_ids: ['ve1'] }] }, error: null },
      courses: { data: [{ id: 'course1', title: 'Excel Basics' }, { id: 'course2', title: 'Pivot Tables' }], error: null },
      learning_path_progress: { data: [{ id: 'p1', student_id: 'bootcamper', track_id: 'fin', completed_item_ids: ['course1'], completed_at: null, cert_id: null, updated_at: '2026-09-01T00:00:00Z' }], count: 1, error: null },
      course_attempts: [{ data: [], count: 0, error: null }],
      guided_project_attempts: [{ data: [], count: 0, error: null }],
    }) } as any);
    const body = await (await get()).json();
    const learner = body.learners.find((l: any) => l.student_id === 'bootcamper');
    // Authored: course1, ve1 (Finance), course2. The learner takes course2 before ve1.
    expect(Object.keys(learner.items)).toEqual(['course1', 'course2', 've1']);
    expect(learner.current_item_id).toBe('course2');
  });

  it('finds a subscriber who lapsed mid-item with no stored progress, and drops lapsed ones who did nothing', async () => {
    const serviceDb = stub({
      learning_path_progress: { data: [], count: 0, error: null },
      students: [
        { data: [], count: 0, error: null },
        { data: [
          { id: 'midway', email: 'm@example.com', full_name: 'Midway Learner', status: 'active', cohort_id: null },
          { id: 'ghost', email: 'g@example.com', full_name: 'Ghost Learner', status: 'active', cohort_id: null },
        ], count: 2, error: null },
      ],
      individual_subscriptions: [
        // Discovery: lapsed subscriptions on the path's plan cohort.
        { data: [{ id: 'sub3', student_id: 'midway' }, { id: 'sub4', student_id: 'ghost' }], count: 2, error: null },
        { data: [
          { id: 'sub3', student_id: 'midway', plan_id: 'plan1', cohort_id: 'plancohort1', status: 'expired', current_period_end: '2026-09-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
          { id: 'sub4', student_id: 'ghost', plan_id: 'plan1', cohort_id: 'plancohort1', status: 'expired', current_period_end: '2026-09-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
        ], count: 2, error: null },
      ],
      course_attempts: [
        { data: [{ student_id: 'midway', course_id: 'course1', passed: null, score: 0, completed_at: null, updated_at: '2026-09-08T00:00:00Z' }], count: 1, error: null },
        { data: [], count: 0, error: null },
      ],
      guided_project_attempts: { data: [], count: 0, error: null },
    });
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb } as any);
    const body = await (await get()).json();
    expect(body.learners.map((l: any) => l.student_id)).toEqual(['midway']);
    expect(body.learners[0]).toMatchObject({ source: 'former', status: 'in_progress', plan_name: 'Pro Monthly', former_plan_cohort_id: 'plancohort1' });
  });

  it('fails closed when the path lookup errors instead of reporting not found', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb: stub({ learning_paths: { data: null, error: { message: 'timeout' } } }) } as any);
    expect((await get()).status).toBe(500);
  });

  it('fails closed when item metadata cannot be read instead of reporting removed content', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'owner1' }, role: 'instructor', serviceDb: stub({ courses: { data: null, error: { message: 'timeout' } } }) } as any);
    expect((await get()).status).toBe(500);
  });

  it('lets an admin read a path they do not own', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'admin1' }, role: 'admin', serviceDb: stub() } as any);
    expect((await get()).status).toBe(200);
  });
});

describe('summarizeLearnerProgress', () => {
  const items: PathReportItem[] = [
    { id: 'c1', title: 'Course', kind: 'course' },
    { id: 'cert1', title: 'Cert', kind: 'certification' },
  ];

  it('treats an active retake as in progress rather than failed', () => {
    const s = summarizeLearnerProgress({
      items, storedCompletedIds: [], veAttempts: [], certAttempts: [],
      courseAttempts: [
        { course_id: 'c1', passed: false, score: 40, completed_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { course_id: 'c1', passed: null, score: 0, completed_at: null, updated_at: '2026-01-03T00:00:00Z' },
      ],
      openPct: new Map([['c1', 35]]),
    });
    expect(s.items.c1).toMatchObject({ status: 'in_progress', progress_pct: 35, score: 40 });
    expect(s.status).toBe('in_progress');
    expect(s.last_active_at).toBe('2026-01-03T00:00:00Z');
  });

  it('marks a failed certification and keeps the path open', () => {
    const s = summarizeLearnerProgress({
      items, storedCompletedIds: ['c1'], courseAttempts: [], veAttempts: [],
      certAttempts: [{ certification_id: 'cert1', passed: false, score: 55, completed_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' }],
    });
    expect(s.items.cert1.status).toBe('failed');
    expect(s).toMatchObject({ completed_count: 1, progress_pct: 50, current_item_id: 'cert1', status: 'in_progress' });
  });

  it('puts the learner on the unfinished item they touched last, not the first unfinished one', () => {
    const s = summarizeLearnerProgress({
      items: [...items, { id: 've1', title: 'VE', kind: 'virtual_experience' }],
      storedCompletedIds: [], certAttempts: [],
      courseAttempts: [{ course_id: 'c1', passed: null, score: 0, completed_at: null, updated_at: '2026-03-01T00:00:00Z' }],
      veAttempts: [{ ve_id: 've1', completed_at: null, updated_at: '2026-03-09T00:00:00Z' }],
    });
    expect(s.current_item_id).toBe('ve1');
  });

  it('reports not started when nothing has been touched', () => {
    const s = summarizeLearnerProgress({ items, storedCompletedIds: [], courseAttempts: [], veAttempts: [], certAttempts: [] });
    expect(s).toMatchObject({ status: 'not_started', completed_count: 0, progress_pct: 0, current_item_id: 'c1', last_active_at: null });
  });
});