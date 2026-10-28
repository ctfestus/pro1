import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// learning-paths multiplexes instructor authoring and a student read in one POST handler.
// This pins the escaped-bug fix (928bc4d): authoring requires instructor/admin and returns
// 403 for a student, while the student-only action still works for a student.
//
// Two seams: api-auth (the requireRole/requireUser the route's helpers call) and
// @supabase/supabase-js createClient (the route builds its own service-role client for data).

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  const requireUser = vi.fn();
  // get-student-paths resolves the learner via requireStudentUser; with no Student Mode
  // header it behaves exactly like requireUser, so both share one stub in these tests.
  return { ...actual, requireRole: vi.fn(), requireUser, requireStudentUser: requireUser };
});

// vi.hoisted so the holder exists before the mock factory runs at import time (admin-client
// constructs its singleton on load, before any `let` in this file would be initialized).
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.db }));

// The route schedules completion reconciliation via next/server after(), which throws outside
// a real Next request scope; run the scheduled task inline so tests can observe it.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (task: any) => { if (typeof task === 'function') task(); } };
});
vi.mock('@/lib/learning-path-progress', () => ({ reconcilePathCompletion: vi.fn() }));
vi.mock('@/lib/send-path-notification', () => ({ sendPathNotification: vi.fn() }));

import { requireRole, requireUser } from '@/lib/api-auth';
import { reconcilePathCompletion } from '@/lib/learning-path-progress';
import { sendPathNotification } from '@/lib/send-path-notification';
import { POST } from '@/app/api/learning-paths/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRole = vi.mocked(requireRole);
const mockUser = vi.mocked(requireUser);
const mockReconcile = vi.mocked(reconcilePathCompletion);
const mockSendPathNotification = vi.mocked(sendPathNotification);

function post(body: unknown) {
  return POST(new Request('http://localhost/api/learning-paths', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any);
}
const forbidden = { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const unauth = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
const instructor = { user: { id: 'i1', email: 'i@x.co' }, serviceDb: {}, role: 'instructor', token: 't' };

beforeEach(() => {
  mockRole.mockReset();
  mockUser.mockReset();
  mockReconcile.mockReset();
  mockSendPathNotification.mockReset();
  mockSendPathNotification.mockResolvedValue({ total: 0, sent: 0, failed: 0 });
  h.db = makeSupabaseStub({});
});

describe('POST /api/learning-paths authoring gate', () => {
  it('401 for anonymous create', async () => {
    mockRole.mockResolvedValue(unauth as any);
    expect((await post({ action: 'create', title: 'P' })).status).toBe(401);
  });

  it('403 for a student trying to create', async () => {
    mockRole.mockResolvedValue(forbidden as any);
    expect((await post({ action: 'create', title: 'P' })).status).toBe(403);
  });

  it('403 for a student trying to delete (same gate, different action)', async () => {
    mockRole.mockResolvedValue(forbidden as any);
    expect((await post({ action: 'delete', id: 'lp1' })).status).toBe(403);
  });

  it('200 with id when an instructor creates a draft path', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = makeSupabaseStub({ learning_paths: { data: { id: 'lp1' }, error: null } });
    const res = await post({ action: 'create', title: 'Path' });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('lp1');
  });

  it('returns success when the path saves but a notification batch partially fails', async () => {
    mockRole.mockResolvedValue(instructor as any);
    mockSendPathNotification.mockResolvedValue({ total: 10, sent: 9, failed: 1 });
    h.db = makeSupabaseStub({ learning_paths: { data: { id: 'lp1' }, error: null } });

    const res = await post({
      action: 'create',
      request_id: '11111111-1111-4111-8111-111111111111',
      title: 'Path',
      status: 'published',
      cohort_ids: ['co1'],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'lp1',
      notification: { total: 10, sent: 9, failed: 1 },
    });
  });

  it('reuses a path created by the same request id without resending notifications', async () => {
    mockRole.mockResolvedValue(instructor as any);
    const requestId = '11111111-1111-4111-8111-111111111111';
    h.db = makeSupabaseStub({
      learning_paths: [
        { data: null, error: { code: '23505' } },
        { data: { id: requestId }, error: null },
      ],
    });

    const res = await post({
      action: 'create', request_id: requestId, title: 'Path',
      status: 'published', cohort_ids: ['co1'],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: requestId, reused: true });
    expect(mockSendPathNotification).not.toHaveBeenCalled();
  });

  it('rejects a malformed create request id', async () => {
    mockRole.mockResolvedValue(instructor as any);
    const res = await post({ action: 'create', request_id: 'not-a-uuid', title: 'Path' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/learning-paths student read path', () => {
  it('lets a student use get-student-paths (same handler, requireUser branch)', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);
    // No cohort and nothing published to everyone -> an empty list, proving the student is allowed
    // in. The handler no longer short-circuits on a missing cohort: it asks for the public paths
    // first, because a free account HAS access to those.
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: null }, error: null },
      learning_paths: { data: [], error: null },
    });
    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    expect((await res.json()).paths).toEqual([]);
  });

  // The reason the early return had to go: a free account clicked an unlocked path in Explore and
  // landed on an empty Learning Paths section.
  it('returns a path offered to everyone to a student with no cohort', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);
    h.db = makeSupabaseStub({
      students: [{ data: { cohort_id: null }, error: null }, { count: 0, error: null }],
      learning_paths: { data: [{ id: 'lp-open', title: 'Open Path', status: 'published', cohort_ids: [], available_to_everyone: true, item_ids: ['c1'] }], error: null },
      learning_path_progress: { data: [], error: null },
      courses: { data: [{ id: 'c1', title: 'Free course', slug: 'free-course', cover_image: null, description: null }], error: null },
      virtual_experiences: { data: [], error: null },
      certifications: { data: [], error: null },
      course_attempts: { data: [], error: null },
      guided_project_attempts: { data: [], error: null },
      certification_attempts: { data: [], error: null },
    });

    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    const { paths } = await res.json();
    expect(paths).toHaveLength(1);
    expect(paths[0].id).toBe('lp-open');
  });

  it('reconciles with the stored track id when that track was removed, so completion is not blocked', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);
    h.db = makeSupabaseStub({
      students: [{ data: { cohort_id: 'co1' }, error: null }, { count: 1, error: null }],
      // Tracks were removed; the learner's row still holds the old track id.
      learning_paths: { data: [{ id: 'lp1', title: 'Path', status: 'published', cohort_ids: ['co1'], item_ids: ['cert1'], tracks: [] }], error: null },
      learning_path_progress: { data: [{ learning_path_id: 'lp1', completed_item_ids: ['cert1'], completed_at: null, cert_id: null, track_id: 'gone' }], error: null },
      courses: { data: [], error: null },
      virtual_experiences: { data: [], error: null },
      certifications: { data: [{ id: 'cert1', title: 'SQL Associate', slug: 'sql-assoc', cover_image: null, description: null }], error: null },
      course_attempts: { data: [], error: null },
      guided_project_attempts: { data: [], error: null },
      certification_attempts: { data: [], error: null },
    });
    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    expect((await res.json()).paths[0].track_id).toBeNull();
    expect(mockReconcile).toHaveBeenCalledWith(h.db, 's1', expect.objectContaining({ id: 'lp1' }), ['cert1'], 'gone');
  });

  it('returns certification items and counts an earlier passing attempt as completed', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);
    h.db = makeSupabaseStub({
      // Two reads in order: the caller's own cohort, then the head count of learners in it.
      students: [{ data: { cohort_id: 'co1' }, error: null }, { count: 4, error: null }],
      learning_paths: { data: [{ id: 'lp1', title: 'Path', status: 'published', cohort_ids: ['co1'], item_ids: ['cert1'] }], error: null },
      learning_path_progress: { data: [], error: null },
      courses: { data: [], error: null },
      virtual_experiences: { data: [], error: null },
      certifications: { data: [{ id: 'cert1', title: 'SQL Associate', slug: 'sql-assoc', cover_image: null, description: null }], error: null },
      course_attempts: { data: [], error: null },
      guided_project_attempts: { data: [], error: null },
      // The student passed this certification BEFORE it was added to the path -- it must
      // still surface as completed (no stored learning_path_progress row exists).
      certification_attempts: { data: [{ certification_id: 'cert1' }], error: null },
    });

    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    const { paths } = await res.json();
    expect(paths).toHaveLength(1);
    expect(paths[0].items[0]).toMatchObject({ id: 'cert1', title: 'SQL Associate', content_type: 'certification' });
    expect(paths[0].progress.completed_item_ids).toContain('cert1');
    // Enrolled learners on the path, so the dashboard can show "4 learners".
    expect(paths[0].learner_count).toBe(4);
    // Every item is complete but the stored progress was never finalized (no completed_at /
    // cert_id) -- the route must schedule the completion reconciliation for this path.
    expect(mockReconcile).toHaveBeenCalledWith(
      h.db, 's1', expect.objectContaining({ id: 'lp1', item_ids: ['cert1'] }), ['cert1'], null,
    );
  });

  // The student read is the one a learner loads on a phone, so what it does NOT read matters as
  // much as what it returns: a course's questions and a VE's modules are megabytes of authored
  // content, needed only to size the bar of an item still in progress. These pin both the
  // numbers and the reads they cost.
  function countingStub(byTable: Record<string, any>) {
    const db = makeSupabaseStub(byTable);
    const from = vi.fn(db.from.bind(db));
    return { db: { ...db, from }, reads: (table: string) => from.mock.calls.filter(c => c[0] === table).length };
  }

  const coursePath = (itemIds: string[]) => ({
    students: [{ data: { cohort_id: 'co1' }, error: null }, { count: 1, error: null }],
    learning_paths: { data: [{ id: 'lp1', title: 'Path', status: 'published', cohort_ids: ['co1'], item_ids: itemIds }], error: null },
    learning_path_progress: { data: [], error: null },
    certifications: { data: [], error: null },
    certification_attempts: { data: [], error: null },
    guided_project_attempts: [{ data: [], error: null }, { data: [], error: null }],
    virtual_experiences: { data: [], error: null },
  });
  const asStudent = () => mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);

  it('counts a finished passing attempt as complete without reading the course content', async () => {
    asStudent();
    const stub = countingStub({
      ...coursePath(['c1']),
      // A second entry is offered deliberately: nothing is in progress, so it must go unused.
      courses: [
        { data: [{ id: 'c1', title: 'Excel', slug: 'excel', cover_image: null, description: null }], error: null },
        { data: [{ id: 'c1', questions: [{ id: 'q1' }, { id: 'q2' }] }], error: null },
      ],
      course_attempts: [{ data: [{ course_id: 'c1', passed: true }], error: null }, { data: [], error: null }],
    });
    h.db = stub.db;

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].progress.completed_item_ids).toContain('c1');
    expect(paths[0].items[0]).toMatchObject({ id: 'c1', title: 'Excel', content_type: 'course' });
    expect(paths[0].items[0]).not.toHaveProperty('in_progress_pct');
    // The whole point of the narrow read: no authored content fetched for a finished item.
    expect(stub.reads('courses')).toBe(1);
  });

  it('does not count a finished failing attempt as complete', async () => {
    asStudent();
    h.db = makeSupabaseStub({
      ...coursePath(['c1']),
      courses: { data: [{ id: 'c1', title: 'Excel', slug: 'excel', cover_image: null, description: null }], error: null },
      course_attempts: [{ data: [{ course_id: 'c1', passed: false }], error: null }, { data: [], error: null }],
    });

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].progress).toBeNull();
  });

  it('sizes an in-progress course from the open attempt and the content read it triggers', async () => {
    asStudent();
    const stub = countingStub({
      ...coursePath(['c1']),
      courses: [
        { data: [{ id: 'c1', title: 'Excel', slug: 'excel', cover_image: null, description: null }], error: null },
        { data: [{ id: 'c1', questions: [{ id: 'q1' }, { id: 'q2' }] }], error: null },
      ],
      course_attempts: [
        { data: [], error: null },
        { data: [{ course_id: 'c1', answers: { q1: 'done' }, updated_at: '2026-08-20T00:00:00Z' }], error: null },
      ],
    });
    h.db = stub.db;

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].items[0].in_progress_pct).toBe(50);
    expect(paths[0].progress).toBeNull();
    // One metadata read plus one content read, and only because an item is mid-flight.
    expect(stub.reads('courses')).toBe(2);
  });

  it('takes the most recent open attempt when a course has several', async () => {
    asStudent();
    h.db = makeSupabaseStub({
      ...coursePath(['c1']),
      courses: [
        { data: [{ id: 'c1', title: 'Excel', slug: 'excel', cover_image: null, description: null }], error: null },
        { data: [{ id: 'c1', questions: [{ id: 'q1' }, { id: 'q2' }] }], error: null },
      ],
      // Ordered newest first by the query; the stale attempt must not win.
      course_attempts: [
        { data: [], error: null },
        { data: [
          { course_id: 'c1', answers: { q1: 'x', q2: 'y' }, updated_at: '2026-08-24T00:00:00Z' },
          { course_id: 'c1', answers: {}, updated_at: '2026-08-01T00:00:00Z' },
        ], error: null },
      ],
    });

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].items[0].in_progress_pct).toBe(100);
  });

  it('keeps a retaken course complete while still reporting the open attempt progress', async () => {
    asStudent();
    h.db = makeSupabaseStub({
      ...coursePath(['c1']),
      courses: [
        { data: [{ id: 'c1', title: 'Excel', slug: 'excel', cover_image: null, description: null }], error: null },
        { data: [{ id: 'c1', questions: [{ id: 'q1' }, { id: 'q2' }] }], error: null },
      ],
      course_attempts: [
        { data: [{ course_id: 'c1', passed: true }], error: null },
        { data: [{ course_id: 'c1', answers: { q1: 'x' }, updated_at: '2026-08-24T00:00:00Z' }], error: null },
      ],
    });

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].progress.completed_item_ids).toContain('c1');
    expect(paths[0].items[0].in_progress_pct).toBe(50);
  });

  it('sizes an in-progress virtual experience from its own open attempt', async () => {
    asStudent();
    const stub = countingStub({
      ...coursePath(['ve1']),
      courses: { data: [], error: null },
      course_attempts: [{ data: [], error: null }, { data: [], error: null }],
      virtual_experiences: [
        { data: [{ id: 've1', title: 'Analyst week', slug: 'analyst-week', cover_image: null, description: null }], error: null },
        { data: [{ id: 've1', modules: [{ lessons: [{ requirements: [{ id: 'r1', type: 'task' }, { id: 'r2', type: 'task' }] }] }] }], error: null },
      ],
      guided_project_attempts: [
        { data: [], error: null },
        { data: [{ ve_id: 've1', progress: { r1: { completed: true } }, updated_at: '2026-08-24T00:00:00Z' }], error: null },
      ],
    });
    h.db = stub.db;

    const { paths } = await (await post({ action: 'get-student-paths' })).json();
    expect(paths[0].items[0]).toMatchObject({ id: 've1', content_type: 'virtual_experience', in_progress_pct: 50 });
    expect(stub.reads('virtual_experiences')).toBe(2);
  });
});

describe('POST /api/learning-paths update: tracks and completed learners', () => {
  const tracked = {
    status: 'draft', cohort_ids: [], item_ids: ['core', 'fin', 'hr'],
    tracks: [{ id: 'fin', name: 'Finance', item_ids: ['fin'] }, { id: 'hr', name: 'HR', item_ids: ['hr'] }],
  };

  it('404s for a path the instructor does not own, revealing nothing about it', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = makeSupabaseStub({ learning_paths: { data: null, error: null } });
    const res = await post({ action: 'update', id: 'lp-other', tracks: [{ id: 'fin', name: 'Finance', item_ids: [] }] });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/learner/);
  });

  it('500s when the path lookup fails', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = makeSupabaseStub({ learning_paths: { data: null, error: { message: 'down' } } });
    expect((await post({ action: 'update', id: 'lp1', title: 'P' })).status).toBe(500);
  });

  // save_learning_path (migrations 226-227) checks completers and writes under one lock. Modeled
  // here as the database does it: 'completed' when a completer is on a track (or the core) the
  // route says changes. So these pin the route's decision of whose requirements change.
  function shapeDb(prev: any, completers: (string | null)[], outcome?: string) {
    const calls: { fn: string; args: Record<string, any> }[] = [];
    const db = makeSupabaseStub({
      learning_paths: [{ data: prev, error: null }, { data: null, error: null }],
      learning_path_progress: { data: completers.map((track_id, i) => ({ id: `p${i}`, track_id })), error: null },
    }, (fn, args) => {
      calls.push({ fn, args });
      if (fn !== 'save_learning_path') throw new Error(`unexpected rpc ${fn}`);
      if (outcome) return { data: outcome, error: null };
      const hit = completers.some(t => (t ? args.p_changed_track_ids.includes(t) : args.p_core_changed));
      return { data: hit ? 'completed' : 'ok', error: null };
    });
    const from = vi.fn(db.from.bind(db));
    return { db: { ...db, from }, calls, reads: (table: string) => from.mock.calls.filter(c => c[0] === table).length };
  }

  it('500s when the locked save fails, instead of saving', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = makeSupabaseStub({ learning_paths: { data: tracked, error: null } },
      () => ({ data: null, error: { message: 'down' } }));
    expect((await post({ action: 'update', id: 'lp1', tracks: tracked.tracks })).status).toBe(500);
  });

  it('409s when the path changed since it was read, instead of overwriting it', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, [], 'stale').db;
    const res = await post({ action: 'update', id: 'lp1', tracks: tracked.tracks });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/reload/i);
  });

  it('saves every submitted field in one locked call, checked against the version it read', async () => {
    mockRole.mockResolvedValue(instructor as any);
    const { db, calls, reads } = shapeDb({ ...tracked, updated_at: '2026-10-28T10:00:00.123456+00:00' }, []);
    h.db = db;
    const res = await post({ action: 'update', id: 'lp1', title: ' Renamed ', overview: 'New', tracks: tracked.tracks });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      p_path_id: 'lp1', p_instructor_id: 'i1', p_expected_updated_at: '2026-10-28T10:00:00.123456+00:00',
      p_changed_track_ids: [], p_core_changed: false,
      p_patch: { title: 'Renamed', overview: 'New', tracks: tracked.tracks },
    });
    expect(calls[0].args.p_patch).not.toHaveProperty('updated_at');
    // The path is only read: no second, separate write that could fail after the locked save.
    expect(reads('learning_paths')).toBe(1);
  });

  it('409s when adding the first tracks to a path someone completed without one', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb({ ...tracked, tracks: [] }, [null]).db;
    const res = await post({ action: 'update', id: 'lp1', tracks: tracked.tracks });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/create a new path/i);
  });

  it('409s when removing a track a learner completed on', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['fin', 'hr']).db;
    const res = await post({ action: 'update', id: 'lp1', tracks: [tracked.tracks[1]] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 learners .*Finance, HR/);
  });

  it('409s when removing the last track while someone completed on a track', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    const res = await post({ action: 'update', id: 'lp1', tracks: [] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/HR/);
  });

  it('allows removing every track when nobody completed on one', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, []).db;
    expect((await post({ action: 'update', id: 'lp1', tracks: [] })).status).toBe(200);
  });

  it("409s when a completer's track keeps its id but loses its items", async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    // HR keeps its id, but its item moves to Finance: an HR completer would no longer have it required.
    const res = await post({ action: 'update', id: 'lp1', tracks: [{ ...tracked.tracks[0], item_ids: ['fin', 'hr'] }, { ...tracked.tracks[1], item_ids: [] }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/HR/);
  });

  it("409s when another track's cleared item becomes core for a completer", async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    // Finance's item leaves its track, so it is core and now required of an HR completer.
    const res = await post({ action: 'update', id: 'lp1', tracks: [{ ...tracked.tracks[0], item_ids: [] }, tracked.tracks[1]] });
    expect(res.status).toBe(409);
  });

  it('409s when an item moves out of the core a completer took', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['fin']).db;
    // 'core' moves into HR: a Finance completer no longer had it required.
    const res = await post({ action: 'update', id: 'lp1', tracks: [tracked.tracks[0], { ...tracked.tracks[1], item_ids: ['hr', 'core'] }] });
    expect(res.status).toBe(409);
  });

  it("409s when an item list change alone alters a completer's requirements", async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    expect((await post({ action: 'update', id: 'lp1', item_ids: ['core', 'fin', 'hr', 'new-core'] })).status).toBe(409);
  });

  it('allows adding an item to a track no completer is on', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    const res = await post({
      action: 'update', id: 'lp1', item_ids: ['core', 'fin', 'hr', 'fin2'],
      tracks: [{ ...tracked.tracks[0], item_ids: ['fin', 'fin2'] }, tracked.tracks[1]],
    });
    expect(res.status).toBe(200);
  });

  it('never locks a path on a completer who has no track on a path with tracks', async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, [null]).db;
    expect((await post({ action: 'update', id: 'lp1', title: 'Renamed', item_ids: tracked.item_ids, tracks: tracked.tracks })).status).toBe(200);
  });

  it("allows a track change that keeps every completer's track", async () => {
    mockRole.mockResolvedValue(instructor as any);
    h.db = shapeDb(tracked, ['hr']).db;
    const res = await post({ action: 'update', id: 'lp1', tracks: [tracked.tracks[0], { ...tracked.tracks[1], name: 'People & HR' }] });
    expect(res.status).toBe(200);
  });

  it('rejects an unnamed track instead of silently making its items core', async () => {
    mockRole.mockResolvedValue(instructor as any);
    // Rejected before any read: the strict stub would throw on one.
    const update = await post({ action: 'update', id: 'lp1', tracks: [{ id: 'fin', name: '  ', item_ids: ['fin'] }] });
    expect(update.status).toBe(400);
    expect((await update.json()).error).toMatch(/name/i);
    const create = await post({ action: 'create', title: 'P', item_ids: ['a'], tracks: [{ id: 'x', name: 'X' }, { id: 'x', name: 'Y' }] });
    expect(create.status).toBe(400);
  });
});

describe('POST /api/learning-paths choose-track', () => {
  const student = { user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' };
  const path = {
    id: 'lp1', status: 'published', cohort_ids: ['co1'], available_to_everyone: false, item_ids: ['core', 'fin'],
    tracks: [{ id: 'fin', name: 'Finance', item_ids: ['fin'] }],
  };
  const choose = (track_id = 'fin') => post({ action: 'choose-track', path_id: 'lp1', track_id });

  it('switches the track only while the path is unfinished', async () => {
    mockUser.mockResolvedValue(student as any);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      // The read, then the conditional switch returning the row it changed.
      learning_path_progress: [{ data: { completed_at: null, cert_id: null }, error: null }, { data: [{ id: 'p1' }], error: null }],
    });
    expect((await choose()).status).toBe(200);
  });

  it('409s when the path was completed between the check and the switch', async () => {
    mockUser.mockResolvedValue(student as any);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      // Unfinished when read, but the unfinished-only switch matched no row.
      learning_path_progress: [{ data: { completed_at: null, cert_id: null }, error: null }, { data: [], error: null }],
    });
    expect((await choose()).status).toBe(409);
  });

  it('409s on a completed path without writing', async () => {
    mockUser.mockResolvedValue(student as any);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      learning_path_progress: [{ data: { completed_at: '2026-10-01T00:00:00Z', cert_id: 'c1' }, error: null }, { data: null, error: { message: 'must not write' } }],
    });
    expect((await choose()).status).toBe(409);
  });

  it('creates the row on a first pick, and switches under the same condition if one appeared', async () => {
    mockUser.mockResolvedValue(student as any);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      learning_path_progress: [
        { data: null, error: null },
        { data: null, error: { code: '23505', message: 'duplicate' } },
        { data: [{ id: 'p1' }], error: null },
      ],
    });
    expect((await choose()).status).toBe(200);
  });

  it("404s for a path outside the learner's cohort, and 400s for a track the path does not have", async () => {
    mockUser.mockResolvedValue(student as any);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'other' }, error: null },
      learning_paths: { data: path, error: null },
      learning_path_progress: { data: null, error: null },
    });
    expect((await choose()).status).toBe(404);
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      learning_path_progress: { data: null, error: null },
    });
    expect((await choose('hr')).status).toBe(400);
  });

  it('500s when the progress read fails, instead of guessing the path is unfinished', async () => {
    mockUser.mockResolvedValue(student as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: path, error: null },
      learning_path_progress: { data: null, error: { message: 'down' } },
    });
    expect((await choose()).status).toBe(500);
  });
});

describe('POST /api/learning-paths get-student-paths failures', () => {
  it('500s when the progress read fails, instead of showing the learner as having no track', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, serviceDb: {}, token: 't' } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1', full_name: 'S' }, error: null },
      learning_paths: { data: [{ id: 'lp1', title: 'P', status: 'published', cohort_ids: ['co1'], item_ids: ['core'], tracks: [] }], error: null },
      learning_path_progress: { data: null, error: { message: 'down' } },
    });
    expect((await post({ action: 'get-student-paths' })).status).toBe(500);
  });
});
