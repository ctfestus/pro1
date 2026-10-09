// GET /api/student/program: the student's own view of their program must agree with the
// Assignments tab and grading -- a fail is a fail, and a group answer belongs to its participants --
// and must never carry another student's contact details.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());
const buildStatusRows = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/tracking-report', () => ({
  buildStatusRows,
  attachProgress: vi.fn(async () => {}),
}));

import { GET } from '@/app/api/student/program/route';

const ME = 'student-1';
const request = () => new NextRequest('http://localhost/api/student/program', { headers: { authorization: 'Bearer t' } });

const assignment = (id: string, passingScore?: number) => ({
  id, title: `Assignment ${id}`, deadline_date: '2026-10-12', type: 'standard', config: passingScore ? { passingScore } : {}, group_ids: [],
});

function setup({ cohortKind = 'bootcamp', assignments = [] as any[], submissions = [] as any[], submissionsError = null as any } = {}) {
  buildStatusRows.mockResolvedValue(assignments.map(a => ({
    formId: a.id, formTitle: a.title, contentType: 'assignment', status: 'not_started', progressPct: 0, deadline: null,
  })));
  requireStudentUser.mockResolvedValue({
    user: { id: ME, email: 'me@example.com' },
    serviceDb: makeSupabaseStub({
      students: [
        { data: { id: ME, email: 'me@example.com', full_name: 'Efua Boateng', cohort_id: 'cohort-1' }, error: null },
        { data: [
          { id: ME, full_name: 'Efua Boateng', avatar_url: null, email: 'me@example.com' },
          { id: 'student-2', full_name: 'Ama Owusu', avatar_url: 'https://x/a.png', email: 'ama@example.com' },
        ], error: null },
      ],
      cohorts: { data: { id: 'cohort-1', name: 'Cohort 7', start_date: '2026-09-01', end_date: '2026-11-23', cohort_kind: cohortKind }, error: null },
      group_members: [
        { data: { group_id: 'group-1' }, error: null },
        { data: [
          { student_id: 'student-2', is_leader: true, joined_at: '2026-09-01' },
          { student_id: ME, is_leader: false, joined_at: '2026-09-02' },
        ], error: null },
      ],
      groups: { data: { id: 'group-1', name: 'Team Insight', description: null }, error: null },
      courses: { data: [], error: null },
      virtual_experiences: { data: [], error: null },
      learning_paths: { data: [], error: null },
      events: { data: [], error: null },
      assignments: { data: assignments, error: null },
      assignment_submissions: { data: submissionsError ? null : submissions, error: submissionsError },
    }),
  });
}

const statusOf = (body: any, id: string) => body.items.find((i: any) => i.id === id)?.baseStatus;

beforeEach(() => vi.clearAllMocks());

describe('GET /api/student/program', () => {
  it('returns no program for a cohort that is not a bootcamp', async () => {
    setup({ cohortKind: 'subscription_plan' });
    const body = await (await GET(request())).json();
    expect(body).toEqual({ cohort: null, items: [], group: null });
  });

  it('marks a graded assignment below its pass mark as failed, not done', async () => {
    setup({
      assignments: [assignment('low', 70), assignment('high', 70), assignment('default')],
      submissions: [
        { assignment_id: 'low', status: 'graded', score: 40, group_id: null, participants: [] },
        { assignment_id: 'high', status: 'graded', score: 70, group_id: null, participants: [] },
        // No configured pass mark: the platform default (85) applies.
        { assignment_id: 'default', status: 'graded', score: 80, group_id: null, participants: [] },
      ],
    });
    const body = await (await GET(request())).json();
    expect(statusOf(body, 'low')).toBe('failed');
    expect(statusOf(body, 'high')).toBe('done');
    expect(statusOf(body, 'default')).toBe('failed');
  });

  it('credits a group submission only to the members listed as participants', async () => {
    setup({
      assignments: [assignment('included'), assignment('excluded'), assignment('draft')],
      submissions: [
        { assignment_id: 'included', status: 'submitted', score: null, group_id: 'group-1', participants: ['student-2', ME] },
        { assignment_id: 'excluded', status: 'graded', score: 95, group_id: 'group-1', participants: ['student-2'] },
        { assignment_id: 'draft', status: 'draft', score: null, group_id: 'group-1', participants: [] },
      ],
    });
    const body = await (await GET(request())).json();
    expect(statusOf(body, 'included')).toBe('awaiting_grade');
    expect(statusOf(body, 'excluded')).toBe('not_started');
    expect(statusOf(body, 'draft')).toBe('in_progress');
  });

  it('returns group members with names and photos only, leaders first', async () => {
    setup();
    const body = await (await GET(request())).json();
    expect(body.group).toEqual({
      id: 'group-1', name: 'Team Insight', description: null,
      members: [
        { id: 'student-2', name: 'Ama Owusu', avatarUrl: 'https://x/a.png', isLeader: true, isYou: false },
        { id: ME, name: 'Efua Boateng', avatarUrl: null, isLeader: false, isYou: true },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('@example.com');
  });

  it('fails loudly rather than showing handed-in work as not started', async () => {
    setup({ assignments: [assignment('a')], submissionsError: { message: 'timeout' } });
    const response = await GET(request());
    expect(response.status).toBe(500);
  });
});
