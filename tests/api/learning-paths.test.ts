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

import { requireRole, requireUser } from '@/lib/api-auth';
import { POST } from '@/app/api/learning-paths/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRole = vi.mocked(requireRole);
const mockUser = vi.mocked(requireUser);

function post(body: unknown) {
  return POST(new Request('http://localhost/api/learning-paths', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any);
}
const forbidden = { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const unauth = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
const instructor = { user: { id: 'i1', email: 'i@x.co' }, supabase: {}, role: 'instructor', token: 't' };

beforeEach(() => {
  mockRole.mockReset();
  mockUser.mockReset();
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
});

describe('POST /api/learning-paths student read path', () => {
  it('lets a student use get-student-paths (same handler, requireUser branch)', async () => {
    mockUser.mockResolvedValue({ user: { id: 's1', email: 's@x.co' }, supabase: {}, token: 't' } as any);
    // No cohort -> the handler returns an empty path list (200), proving the student is allowed in.
    h.db = makeSupabaseStub({ students: { data: { cohort_id: null }, error: null } });
    const res = await post({ action: 'get-student-paths' });
    expect(res.status).toBe(200);
    expect((await res.json()).paths).toEqual([]);
  });
});
