import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Role-tiering archetype: requireRole(['admin','instructor','staff']). The gate admits three
// roles and rejects student/anon; internally staff+admin take the published-scoped branch and
// instructors the owner-scoped branch -- both reach 200. Proves the gate, not the row scoping.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { GET } from '@/app/api/tracking/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);

function get(qs = '') {
  return GET(new Request(`http://localhost/api/tracking${qs}`) as any);
}

// Every table the handler fans out to -- all empty so it returns an empty-but-200 payload.
function emptyDb() {
  return makeSupabaseStub({
    courses: { data: [], error: null },
    virtual_experiences: { data: [], error: null },
    assignments: { data: [], error: null },
    learning_paths: { data: [], error: null },
    cohorts: { data: [], error: null },
    students: { data: [], error: null },
    course_attempts: { data: [], error: null },
    guided_project_attempts: { data: [], error: null },
    assignment_submissions: { data: [], error: null },
    cohort_assignments: { data: [], error: null },
  });
}
function authed(role: string, db: any = emptyDb()) {
  mockRequireRole.mockResolvedValue({ user: { id: 'u1' }, serviceDb: db, role, token: 't' } as any);
}

// One published course shared by two cohorts, five students, no attempts anywhere -- so every
// pairing is a "not_started" row and the row count is students x content, not students.
const STUDENTS = [
  { id: 's1', email: 'ama@example.com',  full_name: 'Ama Mensah',   cohort_id: 'co1' },
  { id: 's2', email: 'kofi@example.com', full_name: 'Kofi Boateng', cohort_id: 'co1' },
  { id: 's3', email: 'zara@example.com', full_name: 'Zara Ali',     cohort_id: 'co1' },
  { id: 's4', email: 'bea@example.com',  full_name: 'Bea Owusu',    cohort_id: 'co2' },
  { id: 's5', email: 'yaw@example.com',  full_name: 'Yaw Darko',    cohort_id: 'co2' },
];

/**
 * A course with no cohorts of its own, reachable only because a published learning path that
 * contains it is assigned to one. This is the grant app/api/course and app/api/guided-project-
 * progress honour at read time, and the case the report used to miss entirely -- no cohort in the
 * dropdown, no rows, no KPIs, for a cohort whose students could open and finish the course.
 */
function pathGrantedDb(courseStatus = 'published') {
  return makeSupabaseStub({
    courses: { data: [{ id: 'c1', title: 'Course One', slug: null, cohort_ids: [], deadline_days: null, status: courseStatus }], error: null },
    virtual_experiences: { data: [], error: null },
    assignments: { data: [], error: null },
    learning_paths: { data: [{ item_ids: ['c1'], cohort_ids: ['co1'] }], error: null },
    cohorts: { data: [{ id: 'co1', name: 'Alpha' }], error: null },
    students: { data: [{ id: 's1', email: 'ama@example.com', full_name: 'Ama Mensah', cohort_id: 'co1' }], error: null },
    course_attempts: { data: [], error: null },
    cohort_assignments: { data: [], error: null },
  });
}

function populatedDb() {
  return makeSupabaseStub({
    courses: { data: [{ id: 'c1', title: 'Course One', cohort_ids: ['co1', 'co2'], questions: [], deadline_days: null, status: 'published' }], error: null },
    virtual_experiences: { data: [], error: null },
    assignments: { data: [], error: null },
    learning_paths: { data: [], error: null },
    cohorts: { data: [{ id: 'co1', name: 'Alpha' }, { id: 'co2', name: 'Beta' }], error: null },
    students: { data: STUDENTS, error: null },
    course_attempts: { data: [], error: null },
    cohort_assignments: { data: [], error: null },
  });
}

beforeEach(() => mockRequireRole.mockReset());

describe('GET /api/tracking', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });

  it('403 for a student (wrong role)', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await get()).status).toBe(403);
  });

  it('200 for staff (published-scoped branch)', async () => {
    authed('staff');
    expect((await get()).status).toBe(200);
  });

  it('200 for admin (published-scoped branch)', async () => {
    authed('admin');
    expect((await get()).status).toBe(200);
  });

  it('200 for instructor (owner-scoped branch)', async () => {
    authed('instructor');
    expect((await get()).status).toBe(200);
  });
});

// The table holds one page at a time, so the aggregates it displays have to be computed here --
// they cannot be recovered from the rows the browser was sent.
describe('GET /api/tracking paging', () => {
  it('returns a single page plus the full match count', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?pageSize=2')).json();
    expect(json.rows).toHaveLength(2);
    expect(json.total).toBe(5);
    expect(json.pageSize).toBe(2);
  });

  it('slices the final page without changing the total', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?pageSize=2&page=3')).json();
    expect(json.rows).toHaveLength(1);
    expect(json.total).toBe(5);
  });

  it('orders rows so a row cannot repeat or vanish between pages', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?all=1')).json();
    expect(json.rows.map((r: any) => r.studentName))
      .toEqual(['Ama Mensah', 'Bea Owusu', 'Kofi Boateng', 'Yaw Darko', 'Zara Ali']);
  });

  it('all=1 returns every matching row, for CSV export', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?all=1')).json();
    expect(json.rows).toHaveLength(5);
  });

  it('applies search server-side, so it reaches beyond the current page', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?pageSize=2&search=kofi')).json();
    expect(json.total).toBe(1);
    expect(json.rows[0].studentEmail).toBe('kofi@example.com');
  });

  it('keeps the KPI strip describing the whole set while the status filter narrows the table', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?status=completed')).json();
    expect(json.total).toBe(0);
    expect(json.stats.total).toBe(5);
    expect(json.stats.not_started).toBe(5);
  });

  it('returns every reachable cohort even when filtered to one', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?cohortId=co1')).json();
    expect(json.cohorts.map((c: any) => c.id)).toEqual(['co1', 'co2']);
  });

  it('reports a cohort that reaches a course only through a published learning path', async () => {
    authed('admin', pathGrantedDb());
    const json = await (await get()).json();
    expect(json.cohorts).toEqual([{ id: 'co1', name: 'Alpha' }]);
    expect(json.total).toBe(1);
    expect(json.rows[0]).toMatchObject({ formTitle: 'Course One', studentEmail: 'ama@example.com', status: 'not_started' });
  });

  it('counts path-granted rows in the KPI strip too', async () => {
    authed('admin', pathGrantedDb());
    const json = await (await get()).json();
    expect(json.stats.total).toBe(1);
    expect(json.stats.not_started).toBe(1);
  });

  it('does not extend a path grant to a draft item', async () => {
    // Both grants the app honours require the item itself to be published, so a draft keeps only
    // its own cohorts -- here, none.
    authed('admin', pathGrantedDb('draft'));
    const json = await (await get()).json();
    expect(json.total).toBe(0);
    expect(json.cohorts).toEqual([]);
  });

  it('treats an unknown status as no match rather than crashing', async () => {
    authed('admin', populatedDb());
    const json = await (await get('?status=total')).json();
    expect(json.total).toBe(0);
    expect(json.stats.total).toBe(5);
  });
});
