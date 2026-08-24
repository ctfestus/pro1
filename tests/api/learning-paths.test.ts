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
    // No cohort -> the handler returns an empty path list (200), proving the student is allowed in.
    h.db = makeSupabaseStub({ students: { data: { cohort_id: null }, error: null } });
    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    expect((await res.json()).paths).toEqual([]);
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
      h.db, 's1', expect.objectContaining({ id: 'lp1', item_ids: ['cert1'] }), ['cert1'],
    );
  });
});
